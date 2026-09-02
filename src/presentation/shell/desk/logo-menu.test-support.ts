import { LONG_PRESS_MS, startLogoMenu } from "#shell/logo-menu.js";

/**
 * A document small enough to run the menu's rules in Bun, and no smaller.
 *
 * The rules ask a handful of things of the DOM — find by attribute, walk up, move a node,
 * take the focus, receive an event — so this implements exactly those, the way the desk's
 * other client rules take their doubles. A rule proved against a double that has stopped
 * resembling the DOM is proved against nothing, so every operation here is the one the
 * browser performs: `append` moves a node out of wherever it was, `focus` is what
 * `activeElement` then answers, and `closest` walks the real parent chain.
 */
export class Node {
  readonly children: Node[] = [];
  parent: Node | null = null;
  root: Doc | null = null;
  value = "";
  ownText = "";
  /** Whether a press on this lands the keyboard on it, the way a real control does. */
  focusable = false;
  /** What the browser writes an inline style through, and reads one back from. */
  readonly style = {
    declared: new Map<string, string>(),
    setProperty(name: string, value: string) {
      this.declared.set(name, value);
    },
    getPropertyValue(name: string) {
      return this.declared.get(name) ?? "";
    },
  };

  constructor(readonly attributes: Record<string, string> = {}) {}

  append(...nodes: Node[]): this {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      node.root = this.root ?? (this instanceof Doc ? this : null);
      for (const child of node.descendants()) child.root = node.root;
      this.children.push(node);
    }
    return this;
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
    this.root = null;
    for (const child of this.descendants()) child.root = null;
  }

  /** Whether anything still holds this node, which is what a detached one answers no to. */
  get isConnected(): boolean {
    for (let node: Node | null = this; node; node = node.parent)
      if (node instanceof Doc) return true;
    return false;
  }

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

  get textContent(): string {
    return this.children.reduce((text, child) => text + child.textContent, this.ownText);
  }

  set textContent(words: string) {
    for (const child of [...this.children]) child.remove();
    this.ownText = words;
  }

  focus(): void {
    const holder = this.root;
    if (holder) holder.activeElement = this;
  }

  select(): void {}

  /**
   * A box, so placement can be asked for and answered. Fixed rather than measured: what
   * these rules decide is *where* a floating panel goes, and a stand-in box is enough to
   * see them decide it.
   */
  box = { left: 12, top: 34, right: 112, bottom: 74, width: 100, height: 40 };

  getBoundingClientRect() {
    return this.box;
  }

  dispatchEvent(event: { type: string }): void {
    this.root?.dispatched.push(event.type);
  }

  matches(selector: string): boolean {
    const exact = /^\[([a-z-]+)=([a-z-]+)\]$/.exec(selector);
    if (exact) return this.getAttribute(exact[1] as string) === exact[2];
    const present = /^\[([a-z-]+)\]$/.exec(selector);
    if (present) return this.getAttribute(present[1] as string) !== null;
    throw new Error(`Unsupported selector: ${selector}`);
  }

  closest(selector: string): Node | null {
    for (let node: Node | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  querySelector(selector: string): Node | null {
    for (const node of this.descendants()) if (node.matches(selector)) return node;
    return null;
  }

  querySelectorAll(selector: string): Node[] {
    return [...this.descendants()].filter((node) => node.matches(selector));
  }

  *descendants(): Generator<Node> {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }
}

type Listener = (event: Record<string, unknown>) => void;

export class Doc extends Node {
  readonly listeners: { type: string; run: Listener; capture: boolean; outer: boolean }[] = [];
  readonly dispatched: string[] = [];
  activeElement: Node | null = null;
  readonly body = new Node({ id: "body" });

  constructor() {
    super();
    this.root = this;
    this.activeElement = this.body;
  }

  addEventListener(type: string, run: Listener, capture: unknown = false): void {
    this.listeners.push({ type, run, capture: capture === true, outer: false });
  }

  /** The window's half of the capture path — everything outside the document. */
  get outer() {
    return {
      addEventListener: (type: string, run: Listener, capture: unknown = false) => {
        this.listeners.push({ type, run, capture: capture === true, outer: true });
      },
    };
  }

  getElementById(id: string): Node | null {
    for (const node of this.descendants()) if (node.getAttribute("id") === id) return node;
    return null;
  }

  /**
   * Dispatch one event the way the browser does: outermost capture first, then the
   * listeners on the document in the order they registered, and nothing after a listener
   * that stops it.
   */
  fire(type: string, target: Node, extra: Record<string, unknown> = {}) {
    // A press moves the focus before the click is dispatched, and onto the body when what
    // was pressed cannot hold it. Rules that decide whether to *take* focus back read
    // `activeElement`, so a double that skipped this would prove them against nothing.
    if (type === "click") this.activeElement = target.focusable ? target : this.body;
    let stopped = false;
    let prevented = false;
    const event = {
      type,
      target,
      ...extra,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    };
    const chain = [
      ...this.listeners.filter((each) => each.type === type && each.outer),
      ...this.listeners.filter((each) => each.type === type && !each.outer),
    ];
    for (const listener of chain) {
      if (stopped) break;
      listener.run(event);
    }
    return { prevented, stopped };
  }
}

/** One capability's slot, built the way the server renders it. */
export function slotFor(id: string, label: string) {
  const logoLabel = new Node({ "data-logo-label": "", class: "logo-label" });
  logoLabel.ownText = label;
  const logo = new Node({ "data-capability-logo": "", "data-capability-id": id }).append(logoLabel);
  const rename = new Node({ role: "menuitem", "data-logo-menu-rename": "" });
  const remove = new Node({ role: "menuitem", "data-capability-delete": "" });
  for (const control of [logo, rename, remove]) control.focusable = true;
  const menu = new Node({ "data-logo-menu": "", hidden: "" }).append(rename, remove);
  const input = new Node({ "data-logo-rename-input": "" });
  input.value = label;
  const error = new Node({ "data-logo-rename-error": "" });
  const cancel = new Node({ "data-logo-rename-cancel": "" });
  const save = new Node({ "data-logo-rename-save": "", "data-busy-label": "Saving…" });
  save.ownText = "Save";
  for (const control of [input, cancel, save]) control.focusable = true;
  const form = new Node({ "data-logo-rename": "", hidden: "" }).append(input, save, cancel, error);
  const slot = new Node({ "data-logo-slot": "", "data-capability-id": id }).append(
    logo,
    menu,
    form,
  );
  return { slot, logo, logoLabel, menu, rename, remove, form, input, error, cancel, save };
}

/** A desk with two capabilities on it, wired to the real module. */
export function desk() {
  const root = new Doc();
  const notes = slotFor("notes", "Notes");
  const recipes = slotFor("recipes", "Recipes");
  const layer = new Node({ id: "capability-logos" }).append(notes.slot, recipes.slot);
  const menus = new Node({ id: "capability-menus" });
  // The desk's floor. A floating panel stops above it, so the sentence the bar speaks
  // about a refused name is never covered by the editor it is about.
  const promptBar = new Node({ id: "spec-build-form" });
  promptBar.box = { left: 0, top: 400, right: 500, bottom: 460, width: 500, height: 60 };
  root.append(layer, menus, promptBar, root.body);
  startLogoMenu(root as never, root.outer as never);
  return { root, notes, recipes, menus, layer, promptBar };
}

/** The gesture a finger makes: down, held past the interval, then up. */
export async function pressAndHold(
  scene: ReturnType<typeof desk>,
  on: Node,
  during: () => void = () => {},
) {
  scene.root.fire("pointerdown", on, { pointerType: "touch", clientX: 40, clientY: 60 });
  during();
  await Bun.sleep(LONG_PRESS_MS + 30);
  scene.root.fire("pointerup", on, { pointerType: "touch" });
}
