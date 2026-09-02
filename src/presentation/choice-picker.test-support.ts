// A document small enough to run the drawn choice controls in Bun, and no smaller.
//
// The scene is built by parsing the markup the field renderer actually emits, rather than
// by hand-assembling nodes: the picker's whole contract is that a script finds what the
// server wrote, so a double whose shape was typed out separately would prove the module
// against a second author's idea of the markup. Parse the real thing and the two can
// never drift.
//
// Everything here is the operation the browser performs — `append` moves a node out of
// wherever it was, `focus` is what `activeElement` then answers, `closest` walks the real
// parent chain, and an event dispatched on a node runs that node's listeners and then
// every ancestor's, in order.

/** One parsed selector step: a tag, some classes, and some attribute tests. */
interface Step {
  readonly tag: string | null;
  readonly classes: readonly string[];
  readonly attributes: readonly (readonly [string, string | null])[];
}

/* HTML's void elements. SVG children like `<path>` are not among them — the renderer
 * closes those explicitly, and treating one as void would pop a tag nobody opened. */
const VOID_TAGS = new Set(["input", "br", "img", "hr", "meta", "link"]);

function parseSelector(selector: string): Step[] {
  return selector
    .trim()
    .split(/\s+(?![^[]*\])/)
    .map((part) => {
      // A pseudo-class is refused rather than ignored. Skipping one silently turned
      // `button:not([disabled])` into `button[disabled]` — the exact inverse — and a
      // double that answers the opposite of the browser is worse than one that cannot
      // answer at all.
      if (/:/.test(part)) throw new Error(`Unsupported selector in the DOM double: ${selector}`);
      return {
        tag: /^[a-zA-Z][a-zA-Z0-9-]*/.exec(part)?.[0] ?? null,
        classes: [...part.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((match) => match[1] as string),
        attributes: [...part.matchAll(/\[([a-zA-Z0-9_-]+)(?:="?([^\]"]*)"?)?\]/g)].map(
          (match) => [match[1] as string, match[2] ?? null] as const,
        ),
      };
    });
}

const decode = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

type Listener = (event: Record<string, unknown>) => void;

/** The tags each DOM constructor the module tests against stands for. */
export const ELEMENT_CLASSES = {
  HTMLInputElement: ["input"],
  HTMLTextAreaElement: ["textarea"],
  HTMLButtonElement: ["button"],
  HTMLFormElement: ["form"],
} as const;

/**
 * The input types whose `value` IDL property *reflects* the content attribute rather than
 * shadowing it (HTML's "default" value mode). It is the reason a hidden input cannot be
 * cleared by `form.reset()` once anything has written through it, which is exactly the
 * trap the drawn controls' carrier falls into — so the double models it rather than
 * letting a test pass on a property a real browser does not have.
 */
const REFLECTED_VALUE_TYPES = new Set(["hidden", "submit", "reset", "button", "image"]);

export class El {
  readonly children: El[] = [];
  parent: El | null = null;
  ownText = "";
  /** The raw value, and the dirty flag with it: `null` until something writes through. */
  private ownValue: string | null = null;

  /** Reflected, like the real property: `[hidden]` stops matching once it is shown. */
  get hidden(): boolean {
    return this.hasAttribute("hidden");
  }

  set hidden(next: boolean) {
    if (next) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }

  /**
   * A textarea's default value is its *content*, and its `value` shadows that content the
   * moment anything writes through it — the markup keeps saying what the server rendered
   * however much has since been typed. A double that answered the content either way would
   * let a counter read the wrong number and still be green.
   */
  get value(): string {
    if (this.reflectsValue) return this.getAttribute("value") ?? "";
    return this.ownValue ?? (this.tag === "textarea" ? this.ownText : "");
  }

  set value(next: string) {
    if (this.reflectsValue) this.setAttribute("value", next);
    else this.ownValue = next;
  }

  private get reflectsValue(): boolean {
    return this.tag === "input" && REFLECTED_VALUE_TYPES.has(this.getAttribute("type") ?? "text");
  }

  /** What `form.reset()` does: every control back to the default its markup declared. */
  reset(): void {
    for (const node of this.descendants()) {
      // A textarea's default is the content, not an attribute, so a reset is the dirty
      // flag going out rather than a value being copied in.
      if (node.tag === "textarea") node.ownValue = null;
      if (node.tag !== "input") continue;
      node.value = node.getAttribute("value") ?? "";
      if (node.getAttribute("type") === "radio" || node.getAttribute("type") === "checkbox") {
        node.checked = node.hasAttribute("checked");
      }
    }
  }

  checked = false;
  readonly listeners: { type: string; run: Listener; capture: boolean }[] = [];

  /**
   * Written through to the `style` attribute, because the browser's is: a test that reads
   * `getAttribute("style")` back was reading `null` however much the module had written.
   */
  private readonly ownStyle: Record<string, string> = {};

  get style(): Record<string, string> {
    return new Proxy(this.ownStyle, {
      set: (target, key: string, value: string) => {
        target[key] = value;
        const written = Object.entries(target)
          .filter(([, one]) => one !== "")
          .map(([name, one]) => `${kebab(name)}: ${one};`)
          .join(" ");
        if (written === "") this.removeAttribute("style");
        else this.setAttribute("style", written);
        return true;
      },
    });
  }
  /** What `place()` measures. Fixed: what it decides is above-or-below, not a pixel. */
  offsetHeight = 36;
  private ownContentHeight = 200;
  scrollWidth = 200;

  /**
   * The height the content needs, floored at the box the element has been *given* —
   * which is what a browser reports, since a box taller than its content scrolls
   * nothing. Modelled rather than fixed because that floor is the entire reason a
   * growing textarea measures itself at `height: auto`: with a height already written,
   * a shrinking one would measure the box it is trying to shrink and never come back
   * down. A constant here would let that line be deleted with every test still green.
   */
  get scrollHeight(): number {
    const given = Number.parseFloat(this.ownStyle.height ?? "");
    return Math.max(this.ownContentHeight, Number.isFinite(given) ? given : 0);
  }

  /** A fixture sets the content height; the floor above is the browser's, not its. */
  set scrollHeight(next: number) {
    this.ownContentHeight = next;
  }
  /**
   * The scrollport, which is the border box less its scrollbars — the distinction the
   * reveal turns on, so the double keeps them apart rather than letting one stand for both.
   * Defaulted from `box` and settable by a fixture that wants a scrollbar.
   */
  clientTop = 0;
  clientLeft = 0;
  private ownClientHeight: number | null = null;
  private ownClientWidth: number | null = null;

  get clientHeight(): number {
    return this.ownClientHeight ?? this.box.bottom - this.box.top;
  }

  set clientHeight(next: number) {
    this.ownClientHeight = next;
  }

  get clientWidth(): number {
    return this.ownClientWidth ?? this.box.right - this.box.left;
  }

  set clientWidth(next: number) {
    this.ownClientWidth = next;
  }

  /**
   * What the reveal moves, clamped the way a real scroller clamps it. Unclamped, a fixture
   * could assert a scroll position no browser would ever report.
   *
   * There is deliberately no `scrollIntoView` here: it is what the picker gave up, because
   * it scrolls every ancestor and not only the list. A stub would let it back in silently.
   */
  private ownScrollTop = 0;
  private ownScrollLeft = 0;

  get scrollTop(): number {
    return this.ownScrollTop;
  }

  set scrollTop(next: number) {
    const room = Math.max(this.scrollHeight - this.clientHeight, 0);
    this.ownScrollTop = Math.min(Math.max(next, 0), room);
  }

  get scrollLeft(): number {
    return this.ownScrollLeft;
  }

  set scrollLeft(next: number) {
    const room = Math.max(this.scrollWidth - this.clientWidth, 0);
    this.ownScrollLeft = Math.min(Math.max(next, 0), room);
  }

  /**
   * The box this element reports, and the few computed properties the placement walk asks
   * about. Both are settable by a fixture, because what the walk decides depends entirely
   * on them: which ancestors clip a fixed panel, and how much room each side has.
   */
  box: { top: number; bottom: number; left: number; right: number; width: number; height: number } =
    { top: 100, bottom: 136, left: 0, right: 200, width: 200, height: 36 };
  computed: {
    overflowX: string;
    overflowY: string;
    position: string;
    transform: string;
    translate: string;
    scale: string;
    rotate: string;
  } = {
    overflowX: "visible",
    overflowY: "visible",
    position: "static",
    // The four properties that make a containing block for a fixed panel. A browser
    // computes each of them to `none` when nothing sets it, and the surface states its
    // motion in the individual three, so a double that only carried `transform` would
    // let the panel walk past the element it is really positioned against.
    transform: "none",
    translate: "none",
    scale: "none",
    rotate: "none",
  };

  constructor(
    readonly tag: string,
    readonly attributes: Record<string, string> = {},
  ) {}

  /* ── the tree ───────────────────────────────────────────────────────────── */

  append(...nodes: El[]): this {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
    this.ownerDoc?.report(nodes);
    return this;
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  /** Deep, like the clone a record view is taken from its template by. */
  cloneNode(deep = false): El {
    const copy = new El(this.tag, { ...this.attributes });
    copy.ownText = this.ownText;
    // The raw value and the dirty flag both travel, which is what the cloning steps for a
    // value-carrying control say: a clone of an untouched control is untouched too, and so
    // still resets to what its markup declares.
    copy.ownValue = this.ownValue;
    copy.checked = this.checked;
    copy.box = { ...this.box };
    copy.computed = { ...this.computed };
    if (deep) for (const child of this.children) copy.append(child.cloneNode(true));
    return copy;
  }

  /** What puts a record view where its collection was. */
  replaceWith(incoming: El): void {
    const siblings = this.parent?.children;
    const at = siblings?.indexOf(this) ?? -1;
    if (!siblings || at < 0) return;
    const host = this.parent as El;
    incoming.remove();
    siblings.splice(at, 1, incoming);
    incoming.parent = host;
    this.parent = null;
    host.ownerDoc?.report([incoming]);
  }

  get isConnected(): boolean {
    for (let node: El | null = this; node; node = node.parent) if (node instanceof Doc) return true;
    return false;
  }

  /** Null at the document, exactly as a real element's is. The clipping walk needs it. */
  get parentElement(): El | null {
    return this.parent === null || this.parent instanceof Doc ? null : this.parent;
  }

  /**
   * A control's form owner. Every control the shell renders is inside the form it posts
   * through, so the ancestor walk is the whole of it — there is no `form=""` attribute in
   * any markup this parses, and answering one that was not there would be an invention.
   */
  get form(): El | null {
    return this.closest("form");
  }

  contains(other: El): boolean {
    for (let node: El | null = other; node; node = node.parent) if (node === this) return true;
    return false;
  }

  *descendants(): Generator<El> {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  /** The child nodes the picker walks to read an option's label apart from its note. */
  get childNodes(): El[] {
    return this.ownText === "" ? this.children : [textNode(this.ownText), ...this.children];
  }

  /* ── attributes ─────────────────────────────────────────────────────────── */

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  get id(): string {
    return this.attributes.id ?? "";
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  get dataset(): Record<string, string | undefined> {
    const own = this.attributes;
    return new Proxy(
      {},
      {
        get: (_target, key: string) => own[`data-${kebab(key)}`],
        set: (_target, key: string, value: string) => {
          own[`data-${kebab(key)}`] = value;
          return true;
        },
      },
    );
  }

  get classList() {
    const own = this.attributes;
    const names = () => new Set((own.class ?? "").split(/\s+/).filter(Boolean));
    const write = (set: Set<string>) => {
      own.class = [...set].join(" ");
    };
    return {
      contains: (name: string) => names().has(name),
      add: (name: string) => {
        const set = names();
        set.add(name);
        write(set);
      },
      remove: (name: string) => {
        const set = names();
        set.delete(name);
        write(set);
      },
      toggle: (name: string, force?: boolean) => {
        const set = names();
        if (force ?? !set.has(name)) set.add(name);
        else set.delete(name);
        write(set);
      },
    };
  }

  get textContent(): string {
    return this.children.reduce((text, child) => text + child.textContent, this.ownText);
  }

  set textContent(words: string) {
    for (const child of [...this.children]) child.remove();
    this.ownText = words;
  }

  /* ── matching ───────────────────────────────────────────────────────────── */

  matchesStep(step: Step): boolean {
    if (step.tag && step.tag !== this.tag) return false;
    if (!step.classes.every((name) => this.classList.contains(name))) return false;
    return step.attributes.every(
      ([name, value]) =>
        this.hasAttribute(name) && (value === null || this.getAttribute(name) === value),
    );
  }

  matches(selector: string): boolean {
    return selector.split(",").some((one) => this.matchesSteps(parseSelector(one)));
  }

  /** The last step must match this; every earlier step must match some ancestor. */
  private matchesSteps(steps: readonly Step[]): boolean {
    const last = steps.at(-1);
    if (!last || !this.matchesStep(last)) return false;
    let node = this.parent;
    for (const step of [...steps.slice(0, -1)].reverse()) {
      while (node && !node.matchesStep(step)) node = node.parent;
      if (!node) return false;
      node = node.parent;
    }
    return true;
  }

  closest(selector: string): El | null {
    for (let node: El | null = this; node; node = node.parent)
      if (node.matches(selector)) return node;
    return null;
  }

  querySelector(selector: string): El | null {
    for (const node of this.descendants()) if (node.matches(selector)) return node;
    return null;
  }

  querySelectorAll(selector: string): El[] {
    return [...this.descendants()].filter((node) => node.matches(selector));
  }

  /* ── behavior ───────────────────────────────────────────────────────────── */

  focus(): void {
    const doc = this.ownerDoc;
    if (doc) doc.activeElement = this;
  }

  getBoundingClientRect() {
    return { ...this.box };
  }

  addEventListener(type: string, run: Listener, capture: unknown = false): void {
    this.listeners.push({ type, run, capture: capture === true });
  }

  dispatchEvent(event: { type: string; detail?: unknown }): void {
    this.ownerDoc?.fire(event.type, this, { detail: event.detail });
  }

  get ownerDoc(): Doc | null {
    for (let node: El | null = this; node; node = node.parent) if (node instanceof Doc) return node;
    return null;
  }

  get ownerDocument(): Doc | null {
    return this.ownerDoc;
  }
}

function textNode(text: string): El {
  const node = new El("#text");
  node.ownText = text;
  return node;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export class Doc extends El {
  activeElement: El | null = null;
  readonly changes: { value: unknown }[] = [];
  /** The arrival watches running on this document, and what each one asked to watch. */
  private readonly observers: ((records: { addedNodes: El[] }[]) => void)[] = [];
  readonly watches: { target: El; options: { childList?: boolean; subtree?: boolean } }[] = [];

  constructor() {
    super("#document");
  }

  /** Tell every watch what just entered the tree. */
  report(added: readonly El[]): void {
    if (added.length === 0 || this.observers.length === 0) return;
    for (const observer of [...this.observers]) observer([{ addedNodes: [...added] }]);
  }

  /** Every live box watch, and the fixture's way of telling one its element has a size. */
  readonly resizes: { target: El; run: () => void }[] = [];

  /**
   * Give an element a width and tell every watch on it. Two steps in a browser, one here:
   * the double has no layout, so the size is written and the notification is the same call.
   */
  resize(target: El, width: number): void {
    target.clientWidth = width;
    for (const watch of this.resizes) if (watch.target === target) watch.run();
  }

  /** The window half the placement walk reads: the viewport, computed styles, and the watch. */
  get defaultView() {
    const doc = this;
    return {
      innerWidth: 1200,
      innerHeight: 900,
      /**
       * Synchronous where the browser's is a microtask. The difference does not reach the
       * picker — nothing it does between an arrival and the mount that follows depends on
       * the order — and it lets a test insert a form and read what mounted on the next line.
       *
       * `observe` keeps what it was asked to watch. A watch configured for anything but
       * `childList` over the subtree is a watch that hears nothing in a real browser, and a
       * stub that shrugged at its own arguments would let exactly that ship green.
       */
      MutationObserver: class {
        constructor(private readonly run: (records: { addedNodes: El[] }[]) => void) {}
        observe(target: El, options: { childList?: boolean; subtree?: boolean } = {}): void {
          doc.watches.push({ target, options });
          if (options.childList === true && options.subtree === true) doc.observers.push(this.run);
        }
      },
      /**
       * A box watch. The browser fires one callback on `observe` and again whenever the
       * element's box changes — including the change from *no box at all*, which is what a
       * control inside an unopened panel has and what makes this observer necessary rather
       * than decorative.
       *
       * The double cannot see layout, so a fixture moves a size and calls
       * {@link Doc.resize}; the initial fire is modelled here because a watcher that only
       * heard later changes would let a mount-time measurement go unproven.
       */
      ResizeObserver: class {
        constructor(private readonly run: () => void) {}
        observe(target: El): void {
          doc.resizes.push({ target, run: this.run });
          this.run();
        }
        /** The half a watcher that is never released would never call. */
        disconnect(): void {
          for (let index = doc.resizes.length - 1; index >= 0; index -= 1) {
            if (doc.resizes[index]?.run === this.run) doc.resizes.splice(index, 1);
          }
        }
      },
      getComputedStyle: (node: El) => ({ ...node.computed, filter: "none" }),
      addEventListener: (type: string, run: Listener) => {
        this.addEventListener(type, run);
      },
    };
  }

  /**
   * The document's one element child — `<html>` in a browser, and the root a scene parses
   * into here. A module that boots over the whole page starts from this rather than from
   * the document, so a scene that parsed its markup straight into the document would hand
   * one `undefined` and mount nothing.
   */
  get documentElement(): El | null {
    return this.children[0] ?? null;
  }

  getElementById(id: string): El | null {
    for (const node of this.descendants()) if (node.getAttribute("id") === id) return node;
    return null;
  }

  /**
   * Dispatch one event the way the browser does: capturing listeners from the document
   * down, then bubbling ones from the target up, and nothing after a listener that stops
   * it. Capture is modelled because the placement watch depends on it — an inner
   * scroller's `scroll` does not bubble, so a non-capturing document listener never hears
   * it, and a double that ignored the flag would prove that watch against nothing.
   */
  fire(type: string, target: El, extra: Record<string, unknown> = {}) {
    let prevented = false;
    let stopped = false;
    const event = {
      type,
      target,
      ...extra,
      // Readable as well as writable, because a listener may need to know whether an
      // earlier one in the same phase has already refused what it is looking at.
      get defaultPrevented() {
        return prevented;
      },
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    };
    const path: El[] = [];
    for (let node: El | null = target; node; node = node.parent) path.push(node);

    const bubbles = type !== "scroll";
    const chain = [
      ...[...path].reverse().flatMap((node) => node.listeners.filter((one) => one.capture)),
      ...(bubbles ? path : [target]).flatMap((node) =>
        node.listeners.filter((one) => !one.capture),
      ),
    ];
    for (const listener of chain) {
      if (stopped) break;
      if (listener.type === type) listener.run(event);
    }
    if (type === "change") this.changes.push({ value: (target as El).value });
    return { prevented, stopped };
  }
}

/* ── the parser ────────────────────────────────────────────────────────────── */

const TOKEN =
  /<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;

/** Parse the renderer's markup into the double. Every tag it emits is closed or void. */
export function parseHtml(html: string, into: El): El {
  const stack: El[] = [into];
  for (const match of html.matchAll(TOKEN)) {
    consumeToken(stack, match);
  }
  return into;
}

function consumeToken(stack: El[], match: RegExpMatchArray): void {
  const [, closing, opening, rawAttributes, selfClosed, text] = match;
  const top = stack.at(-1) as El;
  if (closing) {
    // Only a close tag that matches what is open pops it, so a stray one can never
    // silently reparent everything after it.
    if (stack.length > 1 && top.tag === closing) stack.pop();
    return;
  }
  if (text) {
    appendText(top, decode(text));
    return;
  }
  if (opening) openElement(stack, top, opening, rawAttributes ?? "", selfClosed === "/");
}

function openElement(
  stack: El[],
  top: El,
  tag: string,
  rawAttributes: string,
  selfClosed: boolean,
): void {
  const node = new El(tag, parseAttributes(rawAttributes));
  // An input's `value` attribute is what the browser seeds the property from, and the
  // property is what a form posts and what a carrier is written through. A textarea is
  // seeded from its content instead, which is not parsed yet — its `value` falls back to
  // that content until something writes through it.
  if (tag !== "textarea") node.value = node.getAttribute("value") ?? "";
  node.checked = node.hasAttribute("checked");
  top.append(node);
  if (!selfClosed && !VOID_TAGS.has(tag)) stack.push(node);
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of raw.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) {
    const name = match[1];
    if (name) attributes[name] = decode(match[2] ?? "");
  }
  return attributes;
}

/**
 * Text before a child becomes the element's own text; text after it becomes a text node.
 *
 * A `<textarea>`'s *first* text drops one leading U+000A, which is what HTML's tree
 * construction does ("A start tag whose tag name is textarea… if the next token is a
 * U+000A LINE FEED, ignore that token"). Modelled rather than skipped because the renderer
 * writes that newline deliberately, and a double without the rule would let a value
 * beginning with a newline round-trip in a test while a browser handed the control one
 * character less.
 */
function appendText(parent: El, text: string): void {
  const first = parent.children.length === 0 && parent.ownText === "";
  const content = first && parent.tag === "textarea" ? text.replace(/^\n/, "") : text;
  if (parent.children.length === 0) parent.ownText += content;
  else parent.append(textNode(content));
}

/** A document holding one rendered form, with the module started against it. */
export async function scene(formHtml: string) {
  const { startChoiceControls } = await import("#shell/choice-picker.js");
  const doc = new Doc();
  parseHtml(formHtml, doc);
  startChoiceControls(doc as never);
  const form = doc.querySelector("form") as El;
  const field = doc.querySelector("[data-choice-presentation]") as El;
  return {
    doc,
    form,
    field,
    button: field.querySelector(".listbox__button"),
    panel: field.querySelector(".listbox__panel"),
    valueEl: field.querySelector(".listbox__value"),
    carrier: field.querySelector("[data-choice-value]"),
    options: () => field.querySelectorAll('[role="option"]'),
    press: (on: El) => doc.fire("click", on),
    /** Returns what the browser would: whether the control took the key for itself. */
    key: (key: string, on: El) => doc.fire("keydown", on, { key }),
    scrollWithin: (on: El) => doc.fire("scroll", on),
  };
}
