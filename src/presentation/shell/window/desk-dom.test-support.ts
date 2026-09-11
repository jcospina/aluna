// As much of a document as the three real window modules and the frame they share actually touch.
//
// Enough for `openWindow`, `openAnswerWindow`, `openPanel` and `putAway` to mount and tear down for
// real, so a claim about what a window does can be settled by running one. `AlunaWindow.refresh()`
// returns before drawing anything below two pixels, which is why no SVG geometry is needed.
//
// Every accessor here is the browser's, not a convenience: `className` is the one place a class
// lives, `id` is the attribute, and `isConnected` means reachable from the page — because a double
// that is more forgiving than a browser turns a test into a statement about the double.
//
// Not a test file, so bun never runs it.

/** The desk every measurement is taken against, so no test restates a width. */
export const DESK = { width: 1440, height: 900 };

/** A node. `page` is what `isConnected` is measured against, set when a desk is stood up. */
export class El {
  static page: El | null = null;

  className = "";
  textContent = "";
  title = "";
  type = "";
  innerHTML = "";
  disabled = false;
  clientWidth = 0;
  clientHeight = 0;
  offsetHeight = 0;
  value = "";
  readonly dataset: Record<string, string> = {};
  readonly children: El[] = [];
  readonly attrs = new Map<string, string>();
  readonly props = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  parent: El | null = null;
  focused = false;
  readonly style = {
    left: "",
    top: "",
    setProperty: (name: string, value: string) => this.props.set(name, value),
    removeProperty: (name: string) => this.props.delete(name),
  };

  constructor(readonly tagName: string) {}

  get id(): string {
    return this.attrs.get("id") ?? "";
  }

  set id(value: string) {
    this.attrs.set("id", value);
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

  /** Backed by `className` alone: two stores for one class is a class a selector cannot see. */
  get classList() {
    const write = (names: string[]) => {
      this.className = names.join(" ");
    };
    return {
      add: (name: string) => {
        if (!this.names().includes(name)) write([...this.names(), name]);
      },
      remove: (name: string) => write(this.names().filter((held) => held !== name)),
      contains: (name: string) => this.names().includes(name),
      toggle: (name: string, on?: boolean) => {
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

  append(...nodes: El[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  replaceChildren(...nodes: El[]): void {
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }

  remove(): void {
    const at = this.parent?.children.indexOf(this) ?? -1;
    if (at >= 0) this.parent?.children.splice(at, 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
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

  toggleAttribute(name: string, on: boolean): void {
    if (on) this.attrs.set(name, "");
    else this.attrs.delete(name);
  }

  focus(): void {
    this.focused = true;
  }

  setPointerCapture(): void {}

  releasePointerCapture(): void {}

  addEventListener(type: string, run: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), run]);
  }

  removeEventListener(): void {}

  /** Up the tree as well as at the node, so a delegated listener hears what was pressed. */
  dispatchEvent(event: { type: string; detail?: unknown }): boolean {
    for (let at: El | null = this; at; at = at.parent) {
      for (const run of at.listeners.get(event.type) ?? []) run(event);
    }
    return true;
  }

  descendants(): El[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  closest(selector: string): El | null {
    for (let at: El | null = this; at; at = at.parent) if (at.matches(selector)) return at;
    return null;
  }

  matches(selector: string): boolean {
    return selector.split(",").some((one) => one.trim() !== "" && this.matchesOne(one.trim()));
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
    return asked.every((attribute) => this.attributeIs(attribute[1] ?? "", attribute[2]));
  }

  private attributeIs(name: string, value: string | undefined): boolean {
    const key = name.replace(/^data-/, "").replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    const held = this.attrs.get(name) ?? (name.startsWith("data-") ? this.dataset[key] : undefined);
    if (held === undefined) return false;
    return value === undefined || held === value;
  }
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
  const data = Object.entries(node.dataset)
    .sort()
    .map(([name, value]) => `${name}=${value}`)
    .join(",");
  const own = `<${node.tagName} ${attrs} ${data} ${node.textContent}>`;
  return own + node.children.map(deskTrace).join("");
}

/** Everything the desk says, marks included — for asking whether a sentence is anywhere on it. */
export function everythingSaid(node: El): string {
  const parts = [
    node.tagName,
    node.className,
    node.textContent,
    node.title,
    node.value,
    node.innerHTML,
    [...node.attrs.values()].join(" "),
    Object.values(node.dataset).join(" "),
    [...node.props.values()].join(" "),
  ];
  return parts.join(" ") + node.children.map(everythingSaid).join("");
}
