import { PROMPT_FORM_ID } from "#shell/desk-window.js";
import { LONG_PRESS_MS, startLogoMenu } from "#shell/logo-menu.js";
import { PROMPT_NOTICE_ID } from "#shell/shell-dom.js";

import { FIRST_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import { renderCapabilityLogo } from "../../../server/http/fragments.ts";
import { El, parseHtml } from "../../controls/choice-picker.test-support.ts";

/**
 * A document small enough to run the menu's rules in Bun. Every operation is the one the browser
 * performs: `append` moves a node out of wherever it was, and `closest` walks the parent chain.
 */
export class Node {
  readonly children: Node[] = [];
  parent: Node | null = null;
  root: Doc | null = null;
  value = "";
  ownText = "";
  tag = "";
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
   * A box, so placement can be asked for and answered. Fixed rather than measured: these rules
   * decide where a floating panel goes, and a stand-in box is enough to see them decide.
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
   * Dispatch one event the way the browser does: outermost capture first, then the document's
   * listeners in registration order, and nothing after a listener that stops it.
   */
  fire(type: string, target: Node, extra: Record<string, unknown> = {}) {
    // A press moves the focus before the click is dispatched, and onto the body when what was
    // pressed cannot hold it. Rules that decide whether to take focus back read `activeElement`.
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

/** The server's markup, carried into this document node for node with its words and values. */
function adopt(from: El): Node {
  const node = new Node({ ...from.attributes });
  node.tag = from.tag;
  node.ownText = from.ownText;
  node.value = from.value;
  const role = from.getAttribute("role");
  node.focusable = from.tag === "button" || from.tag === "input" || role === "menuitem";
  node.append(...from.children.map(adopt));
  return node;
}

/** The one node under `root` that `holds`, or a failure saying which was looked for. */
function only(root: Node, what: string, holds: (node: Node) => boolean): Node {
  const found = [...root.descendants()].filter(holds);
  if (found.length !== 1)
    throw new Error(`expected one ${what} in the slot, found ${found.length}`);
  return found[0] as Node;
}

/**
 * One capability's slot, exactly as the server renders it, with its controls found the way a
 * person finds them — by role and name — so the module's own hooks are what is under test.
 */
export function slotFor(id: string, label: string) {
  const html = renderCapabilityLogo({
    id,
    label,
    display_label_override: null,
    incarnation_id: FIRST_INCARNATION_ID,
    version: 1,
    logo: { status: "absent", attempts: 0 },
  });
  const slot = adopt(parseHtml(html, new El("div")).children[0] as El);
  const is = (tag: string, name: string) => (node: Node) =>
    node.tag === tag && (node.getAttribute("aria-label") ?? node.textContent.trim()) === name;
  const role = (name: string) => (node: Node) => node.getAttribute("role") === name;
  const logo = only(slot, "logo", is("button", `Open ${label}`));
  const menu = only(slot, "menu", role("menu"));
  const form = only(slot, "rename form", (node) => node.tag === "form");
  return {
    slot,
    logo,
    logoLabel: only(logo, "label", (node) => node.tag === "span" && node.textContent === label),
    menu,
    rename: only(
      menu,
      "Rename",
      (node) => role("menuitem")(node) && node.textContent.trim() === "Rename",
    ),
    remove: only(
      menu,
      "Delete",
      (node) => role("menuitem")(node) && node.textContent.trim() === "Delete",
    ),
    form,
    input: only(form, "name field", is("input", `Rename ${label}`)),
    error: only(form, "refusal", role("alert")),
    cancel: only(form, "Cancel", is("button", "Cancel")),
    save: only(form, "Save", is("button", "Save")),
  };
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
  const promptBar = new Node({ id: PROMPT_FORM_ID });
  promptBar.box = { left: 0, top: 400, right: 500, bottom: 460, width: 500, height: 60 };
  // The slot the bar speaks in, empty — and so boxless — until a test puts a sentence in it.
  const notice = new Node({ id: PROMPT_NOTICE_ID });
  notice.box = { left: 0, top: 400, right: 500, bottom: 400, width: 500, height: 0 };
  root.append(layer, menus, notice, promptBar, root.body);
  startLogoMenu(root as never, root.outer as never);
  return { root, notes, recipes, menus, layer, promptBar, notice };
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
