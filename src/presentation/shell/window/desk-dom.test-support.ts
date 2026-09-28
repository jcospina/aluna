// As much of a document as the three real window modules and the frame they share actually touch.
//
// Enough for `openWindow`, `openAnswerWindow`, `openPanel` and `putAway` to mount and tear down for
// real, so a claim about what a window does can be settled by running one. `AlunaWindow.refresh()`
// returns before drawing anything below two pixels, which is why no SVG geometry is needed.
//
// Every accessor here is the browser's, not a convenience: `className`, `id`, `title`, `type`,
// `hidden`, `disabled` and `dataset` all read and write the attributes, events travel the capture
// and bubble phases, and focus is the page's one `activeElement` — because a double that is more
// forgiving than a browser turns a test into a statement about the double.
//
// Not a test file, so bun never runs it.

import {
  assertAttributeName,
  canTakeFocus,
  type DispatchedEvent,
  dispatchAlong,
  type EventNode,
  type ListenerOptions,
  Listeners,
} from "../../../server/dom-events.test-support.ts";
import { parseInto, type TreeBuilder, VOID_TAGS } from "../../../server/html-parse.test-support.ts";

/** The desk every measurement is taken against, so no test restates a width. */
export const DESK = { width: 1440, height: 900 };

/** A property that is its attribute, read and written through it, as the browser reflects one. */
function reflected(name: string) {
  return {
    get(this: El): string {
      return this.attrs.get(name) ?? "";
    },
    set(this: El, value: string) {
      this.attrs.set(name, String(value));
    },
  };
}

/** A boolean property that is its attribute's presence. */
function present(name: string) {
  return {
    get(this: El): boolean {
      return this.attrs.has(name);
    },
    set(this: El, on: boolean) {
      if (on) this.attrs.set(name, "");
      else this.attrs.delete(name);
    },
  };
}

const camel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const kebab = (key: string) => key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);

/**
 * A node. `page` is what `isConnected` is measured against, and `pageDocument` where an event that
 * climbs past it goes next; both are set when a desk is stood up.
 */
export class El implements EventNode {
  static page: El | null = null;
  static pageDocument: EventNode | null = null;
  /** What `focus()` last landed on; `activeElement` falls back to the page once it leaves. */
  static active: El | null = null;

  /** This node's own words; its children's are held by the children. */
  private ownText = "";
  clientWidth = 0;
  clientHeight = 0;
  offsetHeight = 0;
  value = "";
  readonly children: El[] = [];
  readonly attrs = new Map<string, string>();
  readonly props = new Map<string, string>();
  readonly listeners = new Listeners();
  parent: El | null = null;
  /** What the last `focus()` that took was asked with. */
  focusOptions: unknown;
  readonly style = {
    left: "",
    top: "",
    display: "",
    setProperty: (name: string, value: string) => this.props.set(name, value),
    removeProperty: (name: string) => this.props.delete(name),
  };

  declare className: string;
  declare title: string;
  declare type: string;
  declare hidden: boolean;
  declare disabled: boolean;

  static {
    Object.defineProperties(El.prototype, {
      className: reflected("class"),
      title: reflected("title"),
      type: reflected("type"),
      hidden: present("hidden"),
      disabled: present("disabled"),
    });
  }

  constructor(readonly tagName: string) {}

  /** Only the words this node holds itself, for a walk that visits the children on its own. */
  get ownWords(): string {
    return this.ownText;
  }

  /** Read through the tree and written by replacing it, the two halves of the browser's own. */
  get textContent(): string {
    return this.children.reduce((text, child) => text + child.textContent, this.ownText);
  }

  set textContent(words: string) {
    for (const child of [...this.children]) child.remove();
    this.ownText = words;
  }

  /** Markup in, nodes out: the shared parser builds the children, and reading serialises them. */
  get innerHTML(): string {
    return this.children.map(serialised).join("");
  }

  set innerHTML(markup: string) {
    this.textContent = "";
    parseInto(markup, this, BUILDER);
  }

  get id(): string {
    return this.attrs.get("id") ?? "";
  }

  set id(value: string) {
    this.attrs.set("id", value);
  }

  /** A live view over `data-*`, the same attributes read another way, as the browser's is. */
  get dataset(): Record<string, string | undefined> {
    const attrs = this.attrs;
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_target, key) =>
        typeof key === "string" ? attrs.get(`data-${kebab(key)}`) : undefined,
      set: (_target, key, value) => {
        if (typeof key === "string") attrs.set(`data-${kebab(key)}`, String(value));
        return true;
      },
      has: (_target, key) => typeof key === "string" && attrs.has(`data-${kebab(key)}`),
      deleteProperty: (_target, key) => {
        if (typeof key === "string") attrs.delete(`data-${kebab(key)}`);
        return true;
      },
      ownKeys: () =>
        [...attrs.keys()]
          .filter((name) => name.startsWith("data-"))
          .map((name) => camel(name.slice(5))),
      getOwnPropertyDescriptor: (_target, key) => {
        const value = typeof key === "string" ? attrs.get(`data-${kebab(key)}`) : undefined;
        return value === undefined ? undefined : { value, enumerable: true, configurable: true };
      },
    });
  }

  /**
   * The browser's own `Node.contains`, itself included. Read by the release a run's story goes
   * through on its way off the page (`public/region-scope.js`), which walks what the desk has
   * anchored; a node without it answers that walk with a `TypeError`.
   */
  contains(other: El | null | undefined): boolean {
    for (let at = other ?? null; at; at = at.parent) if (at === this) return true;
    return false;
  }

  /** Reachable from the page, the way a browser means it — not merely holding a parent. */
  get isConnected(): boolean {
    for (let at: El | null = this; at; at = at.parent) if (at === El.page) return true;
    return false;
  }

  get parentNode(): El | null {
    return this.parent;
  }

  get parentElement(): El | null {
    return this.parent;
  }

  /** Backed by the `class` attribute alone: two stores for one class is a class a selector misses. */
  get classList() {
    const write = (names: string[]) => {
      this.className = names.join(" ");
    };
    /** `DOMTokenList` refuses an empty token or one with a space in it, as the browser does. */
    const token = (name: string) => {
      if (name === "") throw new DOMException("The token must not be empty.", "SyntaxError");
      if (/\s/.test(name)) {
        throw new DOMException(`"${name}" contains whitespace.`, "InvalidCharacterError");
      }
      return name;
    };
    return {
      add: (name: string) => {
        if (!this.names().includes(token(name))) write([...this.names(), name]);
      },
      remove: (name: string) => write(this.names().filter((held) => held !== token(name))),
      contains: (name: string) => this.names().includes(name),
      toggle: (name: string, on?: boolean) => {
        token(name);
        const wanted = on ?? !this.names().includes(name);
        if (wanted) this.classList.add(name);
        else this.classList.remove(name);
      },
    };
  }

  get firstChild(): El | null {
    return this.children[0] ?? null;
  }

  get childNodes(): El[] {
    return this.children;
  }

  names(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }

  appendChild(child: El): El {
    child.remove();
    this.children.push(child);
    child.parent = this;
    return child;
  }

  /** Words become a text node and a fragment gives up its children, as `ParentNode.append` does. */
  append(...nodes: (El | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") {
        const text = new El("#text");
        text.textContent = node;
        this.appendChild(text);
      } else if (node.tagName === "#fragment") this.append(...node.children);
      else this.appendChild(node);
    }
  }

  replaceChildren(...nodes: (El | string)[]): void {
    for (const child of [...this.children]) child.remove();
    this.ownText = "";
    this.append(...nodes);
  }

  remove(): void {
    const at = this.parent?.children.indexOf(this) ?? -1;
    if (at >= 0) this.parent?.children.splice(at, 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    assertAttributeName(name);
    this.attrs.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  toggleAttribute(name: string, on?: boolean): boolean {
    assertAttributeName(name);
    const wanted = on ?? !this.attrs.has(name);
    if (wanted) this.attrs.set(name, "");
    else this.attrs.delete(name);
    return wanted;
  }

  /** What `x-show` or a script's `style.display` leaves on the node. */
  get displayNone(): boolean {
    return this.style.display === "none" || this.props.get("display") === "none";
  }

  /** Whether the keyboard is here: the page's one `activeElement`, not a flag of the node's own. */
  get focused(): boolean {
    return El.active === this && this.isConnected;
  }

  /** The browser's rules: a detached, hidden, disabled or unfocusable node refuses in silence. */
  focus(options?: unknown): void {
    if (!canTakeFocus(this, this.isConnected)) return;
    El.active = this;
    this.focusOptions = options;
  }

  blur(): void {
    if (El.active === this) El.active = null;
  }

  /** A real press, the way `HTMLElement.click` makes one: a click that bubbles from here. */
  click(): void {
    if (this.disabled) return;
    this.dispatchEvent({ type: "click", target: this } as never);
  }

  /** The pointers this node holds, so a gesture that never captured its own is seen not to. */
  private readonly captured = new Set<number>();

  setPointerCapture(pointerId: number): void {
    this.captured.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId);
  }

  addEventListener(type: string, run: (event: never) => void, options?: ListenerOptions): void {
    this.listeners.add(type, run, options);
  }

  removeEventListener(type: string, run: (event: never) => void, options?: ListenerOptions): void {
    this.listeners.remove(type, run, options);
  }

  /** Down to the node and back up, capture then bubble, and on to the document from the page. */
  dispatchEvent(event: DispatchedEvent): boolean {
    const path: EventNode[] = [];
    for (let at: El | null = this; at; at = at.parent) path.push(at);
    if (path.at(-1) === El.page && El.pageDocument) path.push(El.pageDocument);
    return dispatchAlong(path, event);
  }

  descendants(): El[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  closest(selector: string): El | null {
    for (let at: El | null = this; at; at = at.parent) if (at.matches(selector)) return at;
    return null;
  }

  matches(selector: string): boolean {
    const parts = selector.split(",").map((one) => one.trim());
    if (parts.some((one) => one === "")) throw new SyntaxError(`not a selector: "${selector}"`);
    return parts.some((one) => this.matchesOne(one));
  }

  querySelector(selector: string): El | null {
    return this.descendants().find((node) => node.matches(selector)) ?? null;
  }

  querySelectorAll(selector: string): El[] {
    return this.descendants().filter((node) => node.matches(selector));
  }

  getBoundingClientRect() {
    return { width: DESK.width, height: DESK.height, x: 0, y: 0, top: 0, left: 0 };
  }

  private matchesOne(whole: string): boolean {
    if (!this.pseudosHold(whole)) return false;
    const selector = whole.replace(/^:scope\s*>?\s*/, "").replace(/:[a-z-]+(\([^)]*\))?/g, "");
    const tag = /^[a-z][\w-]*/i.exec(selector)?.[0];
    if (tag !== undefined && tag.toLowerCase() !== this.tagName.toLowerCase()) return false;
    const id = /#([\w-]+)/.exec(selector)?.[1];
    if (id !== undefined && this.id !== id) return false;
    return this.hasClasses(selector) && this.hasAttributes(selector);
  }

  /** The only pseudo-classes the desk writes, and the reason it writes them. */
  private pseudosHold(selector: string): boolean {
    if (selector.includes(":not(:disabled)")) return !this.disabled;
    if (selector.includes(":disabled")) return this.disabled;
    return true;
  }

  private hasClasses(selector: string): boolean {
    const asked = [...selector.matchAll(/\.([\w-]+)/g)];
    return asked.every((name) => this.names().includes(name[1] ?? ""));
  }

  private hasAttributes(selector: string): boolean {
    const asked = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    return asked.every(([, name = "", value]) => {
      const held = this.attrs.get(name);
      return held !== undefined && (value === undefined || held === value);
    });
  }
}

/** How the shared parser makes this double's nodes. */
const BUILDER: TreeBuilder<El> = {
  element(tag, attributes) {
    if (tag === "template") throw new Error("the desk double does not model <template>");
    const node = new El(tag);
    for (const [name, value] of attributes) node.attrs.set(name, value);
    return node;
  },
  contentOf: (element) => element,
  append: (holder, node) => holder.append(node),
  text: (holder, words) => holder.append(words),
};

const escaped = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A node written back out as markup, which is what reading `innerHTML` gives. */
function serialised(node: El): string {
  if (node.tagName === "#text") return escaped(node.ownWords);
  const attrs = [...node.attrs.entries()]
    .map(([name, value]) => ` ${name}="${escaped(value).replaceAll('"', "&quot;")}"`)
    .join("");
  const open = `<${node.tagName}${attrs}>`;
  if (VOID_TAGS.has(node.tagName)) return open;
  return `${open}${escaped(node.ownWords)}${node.children.map(serialised).join("")}</${node.tagName}>`;
}

/**
 * What the desk is, node by node, with the marks that legitimately move left out: which window is
 * focused and which sits at which level are presentation, and change whenever a window opens.
 * Everything else — every node, id, attribute, `data-*` and word — has to come back unchanged.
 */
export function deskTrace(node: El): string {
  const attrs = [...node.attrs.entries()]
    .filter(([name]) => name !== "class" && name !== "style")
    .sort()
    .map(([name, value]) => `${name}=${value}`)
    .join(",");
  const own = `<${node.tagName} ${attrs} ${node.ownWords}>`;
  return own + node.children.map(deskTrace).join("");
}

/** Everything the desk says, marks included — for asking whether a sentence is anywhere on it. */
export function everythingSaid(node: El): string {
  const parts = [
    node.tagName,
    node.className,
    node.ownWords,
    node.title,
    node.value,
    [...node.attrs.values()].join(" "),
    [...node.props.values()].join(" "),
  ];
  return parts.join(" ") + node.children.map(everythingSaid).join("");
}
