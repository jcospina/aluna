// The smallest document the developer panel's body runs in: elements and text nodes, attributes
// that are the one store of class and data, parents for `closest`, events that bubble, focus that
// says when it moves, a selection a test can set, a clipboard that writes down what it was handed,
// a clock a test moves, and a box a test gives an element. It refuses what a browser refuses — an
// empty tag, attribute name or selector — so a mutant that empties one cannot pass for working.
//
// Installed for a suite and taken away after it, never at module scope: Bun loads a whole shard
// into one process, and a `document` standing at import time starts every browser module in it.
// Not a test file, so bun never runs it.

import { afterAll, beforeAll } from "bun:test";
import { cssEscape } from "../../../../server/dom-double/dom-events.test-support.ts";

type Child = FakeElement | FakeText;
type Listener = (event: FakeEvent) => void;
type ListenerOptions = boolean | { capture?: boolean } | undefined;

export class FakeEvent {
  target: FakeElement | null = null;
  defaultPrevented = false;
  key = "";
  code = "";
  button = 0;
  /** The buttons held down while it happened: 1 is the main one. */
  buttons = 0;
  detail = 1;
  clientX = 0;
  clientY = 0;
  metaKey = false;
  ctrlKey = false;
  altKey = false;
  shiftKey = false;
  clipboardData: { setData: (type: string, text: string) => void } | null = null;

  constructor(
    readonly type: string,
    init: Partial<Omit<FakeEvent, "type" | "target" | "defaultPrevented" | "preventDefault">> = {},
  ) {
    Object.assign(this, init);
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

const captureOf = (options: ListenerOptions) =>
  typeof options === "boolean" ? options : options?.capture === true;

/** Listeners as the browser keys them: by type, listener and capture flag together. */
class Listening {
  private readonly heard = new Map<string, { listener: Listener; capture: boolean }[]>();

  addEventListener(type: string, listener: Listener, options?: ListenerOptions) {
    const capture = captureOf(options);
    const held = this.heard.get(type) ?? [];
    if (held.some((one) => one.listener === listener && one.capture === capture)) return;
    this.heard.set(type, [...held, { listener, capture }]);
  }

  removeEventListener(type: string, listener: Listener, options?: ListenerOptions) {
    const capture = captureOf(options);
    const held = this.heard.get(type) ?? [];
    this.heard.set(
      type,
      held.filter((one) => one.listener !== listener || one.capture !== capture),
    );
  }

  /** How many listeners stand for this type, which is how a test sees one left behind. */
  listening(type: string): number {
    return this.heard.get(type)?.length ?? 0;
  }

  protected hear(event: FakeEvent) {
    for (const { listener } of [...(this.heard.get(event.type) ?? [])]) listener(event);
  }
}

/** A CSS string's escapes undone, as the browser reads `[name="…"]`. */
const cssUnescape = (value: string) =>
  value.replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/g, (_, hex, char) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char,
  );

const dataName = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export class FakeText {
  readonly nodeType = 3;
  parent: FakeElement | null = null;

  constructor(public data: string) {}

  get textContent() {
    return this.data;
  }

  set textContent(text: string) {
    this.data = text;
  }

  get parentElement() {
    return this.parent;
  }

  remove() {
    this.parent?.removeChild(this);
  }
}

export class FakeElement extends Listening {
  readonly nodeType = 1;
  readonly tagName: string;
  title = "";
  /** How far it can scroll, which a test sets; it scrolls no further, as a page's do not. */
  maxScroll = Number.POSITIVE_INFINITY;
  private scrolled = 0;
  parent: FakeElement | null = null;
  readonly childNodes: Child[] = [];
  /** The box a test gives it, in the page's coordinates. */
  box = { left: 0, top: 0, width: 0, height: 0 };
  /** Set on the top of a tree to take it off the page, as putting the panel away does. */
  detached = false;
  private readonly attributes = new Map<string, string>();

  readonly dataset = new Proxy({} as Record<string, string | undefined>, {
    get: (_, key) =>
      typeof key === "string" ? (this.getAttribute(dataName(key)) ?? undefined) : undefined,
    set: (_, key, value) => {
      this.setAttribute(dataName(String(key)), String(value));
      return true;
    },
  });

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  get className() {
    return this.attributes.get("class") ?? "";
  }

  set className(names: string) {
    this.attributes.set("class", names);
  }

  get classList() {
    const names = () => this.className.split(" ").filter(Boolean);
    return {
      add: (name: string) => {
        if (!names().includes(name)) this.className = [...names(), name].join(" ");
      },
      remove: (name: string) => {
        this.className = names()
          .filter((each) => each !== name)
          .join(" ");
      },
      contains: (name: string) => names().includes(name),
    };
  }

  /** What the element reads as, every span flattened, the hidden ones included. */
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(text: string) {
    this.replaceChildren(...(text ? [text] : []));
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  }

  get lastChild(): Child | null {
    return this.childNodes.at(-1) ?? null;
  }

  get parentElement(): FakeElement | null {
    return this.parent;
  }

  get isConnected(): boolean {
    let root: FakeElement = this;
    while (root.parent) root = root.parent;
    return !root.detached;
  }

  get firstChild(): Child | null {
    return this.childNodes[0] ?? null;
  }

  /** No border on anything the panel draws, so the content starts at the box's own edge. */
  readonly clientLeft = 0;
  readonly clientTop = 0;

  get scrollTop() {
    return this.scrolled;
  }

  set scrollTop(to: number) {
    this.scrolled = Math.min(Math.max(to, 0), this.maxScroll);
  }

  get clientWidth() {
    return this.box.width;
  }

  get clientHeight() {
    return this.box.height;
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.box;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  setAttribute(name: string, value: string) {
    if (!/^[^\s"'>/=]+$/.test(name)) throw new Error(`InvalidCharacterError: "${name}"`);
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  private adopt(node: Child | string): Child[] {
    if (node instanceof FakeFragment) return node.childNodes.splice(0);
    const child = typeof node === "string" ? new FakeText(node) : node;
    child.parent?.removeChild(child);
    return [child];
  }

  append(...nodes: (Child | string)[]) {
    for (const node of nodes) {
      for (const child of this.adopt(node)) {
        child.parent = this;
        this.childNodes.push(child);
      }
    }
  }

  insertBefore(node: Child, before: Child | null) {
    const adopted = this.adopt(node);
    const at = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
    for (const child of adopted) child.parent = this;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, ...adopted);
  }

  /** Taking out the element that has focus, even to put it back, loses the focus, as a page's does. */
  removeChild(child: Child) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    if (child instanceof FakeElement && child.contains(fakeDocument.activeElement)) {
      fakeDocument.activeElement = null;
    }
    child.parent = null;
  }

  remove() {
    this.parent?.removeChild(this);
  }

  replaceChildren(...nodes: (Child | string)[]) {
    for (const child of this.childNodes) child.parent = null;
    this.childNodes.length = 0;
    this.append(...nodes);
  }

  contains(node: Child | null): boolean {
    for (let at: Child | null = node; at; at = at.parent) if (at === this) return true;
    return false;
  }

  /** Every element under this one, in document order. */
  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  /**
   * One compound selector: a tag or a class, then any number of `[name]` or `[name="value"]`.
   */
  matches(selector: string): boolean {
    if (selector.trim() === "") throw new Error("SyntaxError: the empty selector");
    const tagName = /^([a-z]+)/.exec(selector)?.[1];
    if (tagName !== undefined && tagName.toUpperCase() !== this.tagName) return false;
    const className = /^\.([\w-]+)/.exec(selector)?.[1];
    if (className !== undefined && !this.classList.contains(className)) return false;
    for (const [, name = "", value] of selector.matchAll(/\[([\w-]+)(?:="((?:\\.|[^"])*)")?\]/g)) {
      const held = this.getAttribute(name);
      if (held === null || (value !== undefined && held !== cssUnescape(value))) return false;
    }
    return true;
  }

  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.descendants().find((el) => el.matches(selector)) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((el) => el.matches(selector));
  }

  /**
   * Boxes only for what the panel's sheet leaves standing: nothing under a `hidden` element, and
   * nothing in the body of a folded node (`devpanel.css`).
   */
  getClientRects(): object[] {
    for (let node = this.parent; node; node = node.parent) {
      if (node.hasAttribute("hidden")) return [];
      const folded = node.parent?.classList.contains("is-folded");
      if (node.classList.contains("devpanel__body") && folded) return [];
    }
    return [{}];
  }

  /** Focus moves, and says so, only when it lands somewhere new, as the browser's does. */
  focus(options?: { preventScroll?: boolean; focusVisible?: boolean }) {
    const before = fakeDocument.activeElement;
    if (before === this) return;
    fakeDocument.activeElement = this;
    fakeDocument.scrolledToFocus = options?.preventScroll !== true;
    fakeDocument.ringed = options?.focusVisible !== false;
    before?.dispatchEvent(new FakeEvent("focusout"));
    this.dispatchEvent(new FakeEvent("focusin"));
  }

  dispatchEvent(event: FakeEvent): boolean {
    event.target ??= this;
    for (let node: FakeElement | null = this; node; node = node.parent) node.hear(event);
    return !event.defaultPrevented;
  }
}

class FakeFragment extends FakeElement {
  constructor() {
    super("fragment");
  }
}

/** The nearest element holding both, as a range names where it sits. */
const commonAncestor = (one: Child, other: Child): FakeElement | null => {
  for (let node: FakeElement | null = one instanceof FakeElement ? one : one.parent; node; ) {
    if (node.contains(other)) return node;
    node = node.parent;
  }
  return null;
};

/** A point in a tree: a text node and a character in it, or an element and a child of it. */
type Point = { node: Child; offset: number };

/** How many characters of `holder`'s text come before `target` begins. */
function startOf(holder: FakeElement, target: Child): number {
  let count = 0;
  let found = false;
  const walk = (node: Child) => {
    if (found) return;
    if (node === target) {
      found = true;
      return;
    }
    if (node instanceof FakeText) count += node.data.length;
    else for (const child of node.childNodes) walk(child);
  };
  walk(holder);
  return count;
}

/** How many characters of `holder`'s text come before a point. */
function charsBefore(holder: FakeElement, { node, offset }: Point): number {
  if (node instanceof FakeText) return startOf(holder, node) + offset;
  const inside = node.childNodes.slice(0, offset);
  return startOf(holder, node) + inside.reduce((sum, child) => sum + child.textContent.length, 0);
}

/**
 * A selection: nothing, a caret, or a span between two points, copied as the text between them.
 * `modify` writes down what it was asked rather than moving, having no lines to move along.
 */
export class FakeSelection {
  anchor: Point | null = null;
  focus: Point | null = null;
  /** Where the last extend put the moving end. */
  extended: Point | null = null;
  readonly modified: string[] = [];

  get anchorNode() {
    return this.anchor?.node ?? null;
  }

  get focusNode() {
    return this.focus?.node ?? null;
  }

  get isCollapsed() {
    const { anchor, focus } = this;
    return anchor === null || (anchor.node === focus?.node && anchor.offset === focus.offset);
  }

  get rangeCount() {
    return this.anchor === null ? 0 : 1;
  }

  /** A caret, as a press leaves one. */
  collapse(node: Child, offset = 0) {
    this.anchor = { node, offset };
    this.focus = { node, offset };
  }

  selectAllChildren(node: FakeElement) {
    this.anchor = { node, offset: 0 };
    this.focus = { node, offset: node.childNodes.length };
  }

  setBaseAndExtent(anchor: Child, anchorOffset: number, focus: Child, focusOffset: number) {
    this.anchor = { node: anchor, offset: anchorOffset };
    this.focus = { node: focus, offset: focusOffset };
  }

  extend(node: Child, offset: number) {
    if (this.anchor === null) throw new Error("InvalidStateError: no range to extend");
    this.focus = { node, offset };
    this.extended = { node, offset };
  }

  modify(alter: string, direction: string, granularity: string) {
    this.modified.push(`${alter} ${direction} ${granularity}`);
  }

  removeAllRanges() {
    this.anchor = null;
    this.focus = null;
  }

  getRangeAt(_index: number) {
    const anchor = this.anchor as Point;
    const focus = this.focus ?? anchor;
    const holder = commonAncestor(anchor.node, focus.node) as FakeElement;
    const [fromAnchor, fromFocus] = [charsBefore(holder, anchor), charsBefore(holder, focus)];
    const [start, end] = [Math.min(fromAnchor, fromFocus), Math.max(fromAnchor, fromFocus)];
    const first = fromAnchor <= fromFocus ? anchor : focus;
    return {
      commonAncestorContainer: holder,
      startContainer: first.node,
      startOffset: first.offset,
      cloneContents: () => ({ textContent: holder.textContent.slice(start, end) }),
      isPointInRange: (node: Child, offset: number) => {
        const at = charsBefore(holder, { node, offset });
        return holder.contains(node) && at >= (start ?? 0) && at <= (end ?? 0);
      },
    };
  }
}

/** The window, as far as the panel listens to it: losing focus. */
class FakeWindow extends Listening {
  dispatch(event: FakeEvent) {
    this.hear(event);
    return event;
  }
}

/** The topmost element a node hangs from. */
const rootOf = (node: Child): FakeElement => {
  let root = node instanceof FakeElement ? node : (node.parent as FakeElement);
  while (root.parent) root = root.parent;
  return root;
};

/** A range between two points, read as the text between them in the tree they share. */
class FakeRange {
  start: Point | null = null;
  end: Point | null = null;

  setStart(node: Child, offset: number) {
    this.start = { node, offset };
  }

  setEnd(node: Child, offset: number) {
    this.end = { node, offset };
  }

  private at(point: Point) {
    return charsBefore(rootOf(point.node), point);
  }

  comparePoint(node: Child, offset: number) {
    const point = this.at({ node, offset });
    if (point < this.at(this.start as Point)) return -1;
    return point > this.at(this.end as Point) ? 1 : 0;
  }

  toString() {
    const start = this.start as Point;
    return rootOf(start.node).textContent.slice(this.at(start), this.at(this.end as Point));
  }
}

class FakeDocument extends Listening {
  readonly documentElement = new FakeElement("html");
  readonly defaultView = new FakeWindow();
  /** How many elements have been made, which is what a rewrite that keeps things saves. */
  created = 0;
  readonly selection = new FakeSelection();
  activeElement: FakeElement | null = null;
  /** Whether the last focus was allowed to scroll its element into view. */
  scrolledToFocus = false;
  /** Whether the last focus was allowed to draw the keyboard's focus ring. */
  ringed = false;
  /** Where a test says the caret lands, and every point it was asked about. */
  caret: ((x: number, y: number) => { offsetNode: Child; offset: number } | null) | undefined =
    () => null;
  readonly askedCaret: { x: number; y: number }[] = [];

  createElement(tagName: string) {
    if (!/^[a-z][a-z0-9-]*$/.test(tagName)) throw new Error(`InvalidCharacterError: "${tagName}"`);
    this.created += 1;
    return new FakeElement(tagName);
  }

  createDocumentFragment() {
    return new FakeFragment();
  }

  createRange() {
    return new FakeRange();
  }

  getSelection() {
    return this.selection;
  }

  caretPositionFromPoint(x: number, y: number) {
    this.askedCaret.push({ x, y });
    return this.caret?.(x, y) ?? null;
  }

  /** An event the document itself hears: a release, a move, a copy, or the selection changing. */
  dispatch(event: FakeEvent) {
    this.hear(event);
    return event;
  }
}

/** One for every suite in a file: the panel binds its document listeners once per module. */
export const fakeDocument = new FakeDocument();

/** What the clipboard was handed, newest last, and whether it refuses the next one. */
export const copied: string[] = [];
export const clipboardState = { refuses: false };

const clipboard = {
  writeText: (text: string) => {
    if (clipboardState.refuses) return Promise.reject(new Error("NotAllowedError"));
    copied.push(text);
    return Promise.resolve();
  },
};

/** A clock that moves only when a test moves it, for the timers and frames the panel asks for. */
export const clock = {
  now: 0,
  /** How long the next frame takes to come, which a throttled or busy page stretches. */
  frameMs: 16,
  pending: new Map<number, { at: number; run: (now: number) => void }>(),
  nextId: 1,
  /** Move the clock on, running every timer that falls due on the way, in order. */
  advance(ms: number) {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].run(this.now);
    }
    this.now = until;
  },
};

const later = (run: (now: number) => void, ms: number) => {
  const id = clock.nextId++;
  clock.pending.set(id, { at: clock.now + ms, run });
  return id;
};

const cancel = (id: number | undefined) => {
  if (id !== undefined) clock.pending.delete(id);
};

const timers = {
  setTimeout: (run: () => void, ms = 0) => later(run, ms),
  clearTimeout: cancel,
  requestAnimationFrame: (run: (now: number) => void) => later(run, clock.frameMs),
  cancelAnimationFrame: cancel,
};

const OCCUPIED = ["HTMLElement", "Element", "document", "CSS", "navigator", ...Object.keys(timers)];

/** Install the double for the suite this is called in, and take it away after. */
export function usePanelDom() {
  const globals = globalThis as unknown as Record<string, unknown>;
  const displaced = new Map<string, PropertyDescriptor | undefined>();

  beforeAll(() => {
    for (const name of OCCUPIED) {
      displaced.set(name, Object.getOwnPropertyDescriptor(globals, name));
    }
    const installed = {
      // The module asks `instanceof HTMLElement` before it writes anywhere — the same guard
      // every browser module here uses — so the fake has to answer to that name.
      HTMLElement: FakeElement,
      Element: FakeElement,
      document: fakeDocument,
      CSS: { escape: cssEscape },
      navigator: { clipboard },
      ...timers,
    };
    for (const [name, value] of Object.entries(installed)) {
      Object.defineProperty(globals, name, { value, configurable: true, writable: true });
    }
  });

  afterAll(() => {
    for (const name of OCCUPIED) {
      const descriptor = displaced.get(name);
      if (descriptor) Object.defineProperty(globals, name, descriptor);
      else delete globals[name];
    }
  });
}
