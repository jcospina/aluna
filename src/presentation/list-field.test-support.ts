import type { ListInputMode } from "../registry/index.ts";
import { type RenderableCapability, renderEditForm } from "./field-renderer.ts";

// The DOM the repeated-value control is exercised against, and the fixtures built in it.
//
// A file of its own because it is apparatus rather than assertion: `list-field.test.ts`
// says what the rows do, and this says what a node is while it is being asked. Installing
// the globals is a call the suite makes in its own `beforeAll`, rather than a hook fired
// from an import, so the suite owns its own setup and can be read top to bottom.

/**
 * The rules, run.
 *
 * The module is authored for a browser and asks the DOM's own constructors what a node is,
 * so the constructors are what a Bun run has to supply. They are installed as globals for
 * the length of this file and taken away again — the module reads them when a rule runs
 * rather than when it is imported, so this is enough and nothing outside this file ever
 * sees them.
 *
 * Three things this double models rather than approximates, because tests were passing for
 * the wrong reason without them. Selectors match on a **class** as well as an attribute, so
 * a line that hunts `.ink__ground` is exercised rather than silently returning nothing.
 * Focus is a **single** thing the document holds, and a disabled element cannot take it,
 * which is what a browser does and what `moveListRow`'s fallback leans on. And `disabled`
 * is a **property reflecting the attribute**, so a correct implementation written either
 * way passes.
 */

/** What the document is standing on. One node, the way a document has one. */
let activeNode: Node | null = null;

/** Every node whose removal took the focus with it, so a suite can assert the blur happened. */
const blurred: Node[] = [];

/** Put the focus somewhere, or nowhere — what a person clicking away from the grip does. */
export function active(next: Node | null): void {
  activeNode = next;
}

/** Whether taking this node out of the document has blurred something, since the last ask. */
export function tookFocusAway(): boolean {
  return blurred.splice(0).length > 0;
}

/** The minimum of an event: a name, and whether it climbs. */
export class DoubleEvent {
  readonly bubbles: boolean;
  constructor(
    readonly type: string,
    init: { bubbles?: boolean } = {},
  ) {
    this.bubbles = init.bubbles ?? false;
  }
}

export class Node {
  readonly childNodes: Node[] = [];
  parent: Node | null = null;
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  /** Every event dispatched at or through this node, in order. */
  readonly heard: string[] = [];
  value = "";

  constructor(
    readonly tag: string,
    attributes: Record<string, string> = {},
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }

  /** Where this node is on the page, for the rules that measure rather than count. */
  box = { top: 0, height: 20 };

  /**
   * What a drag writes and takes back off. Only `transform` is ever set, which is the whole
   * of how a row is made to follow a finger, so that is all this holds.
   */
  readonly style = { transform: "" };

  /** A node taken out of its parent is a node that is nowhere, which is what `remove` does. */
  get isConnected(): boolean {
    return this.parent !== null;
  }
  private text = "";

  get textContent(): string {
    return this.text;
  }

  set textContent(next: string) {
    for (const child of this.childNodes.splice(0)) child.parent = null;
    this.text = next;
  }

  /** Enough of a token list for the two state classes a held row takes. */
  readonly classList = {
    add: (name: string) => {
      const names = new Set((this.attributes.get("class") ?? "").split(/\s+/).filter(Boolean));
      names.add(name);
      this.attributes.set("class", [...names].join(" "));
    },
    remove: (name: string) => {
      const names = (this.attributes.get("class") ?? "").split(/\s+/).filter(Boolean);
      this.attributes.set("class", names.filter((one) => one !== name).join(" "));
    },
    contains: (name: string) => (this.attributes.get("class") ?? "").split(/\s+/).includes(name),
  };

  /**
   * The rows a pointer is dragged over have to be somewhere. Stacked in document order by
   * `layOut` below, which is the only geometry any rule here reads.
   */
  getBoundingClientRect() {
    return { top: this.box.top, height: this.box.height, bottom: this.box.top + this.box.height };
  }

  get id(): string {
    return this.attributes.get("id") ?? "";
  }

  set id(next: string) {
    this.attributes.set("id", next);
  }

  /** Reflected, like a browser's — so `el.disabled = true` and the attribute are one state. */
  get disabled(): boolean {
    return this.attributes.has("disabled");
  }

  set disabled(next: boolean) {
    if (next) this.attributes.set("disabled", "");
    else this.attributes.delete("disabled");
  }

  get focused(): boolean {
    return activeNode === this;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  /** A comma-separated list of `[attribute]`, `.class` and tag selectors. */
  matches(selector: string): boolean {
    return selector.split(",").some((one) => {
      const part = one.trim();
      if (part === "") return false;
      if (part.startsWith("[")) return this.attributes.has(part.replace(/^\[|\]$/g, ""));
      if (part.startsWith(".")) {
        return (this.attributes.get("class") ?? "").split(/\s+/).includes(part.slice(1));
      }
      return this.tag === part;
    });
  }

  closest(selector: string): Node | null {
    for (let node: Node | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  querySelector(selector: string): Node | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): Node[] {
    return this.childNodes.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  append(...nodes: Node[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.childNodes.push(node);
    }
  }

  /** Move a node in beside this one, which is how one row changes places with another. */
  before(node: Node): void {
    this.place(node, 0);
  }

  after(node: Node): void {
    this.place(node, 1);
  }

  private place(node: Node, offset: number): void {
    const siblings = this.parent?.childNodes;
    if (!siblings) return;
    node.remove();
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this) + offset, 0, node);
  }

  /** What a browser answers when asked who has focus. One per node, all the same object. */
  get ownerDocument(): { activeElement: Node | null } {
    return { activeElement: activeNode };
  }

  remove(): void {
    const siblings = this.parent?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
    // Taking a node out of the document takes the focus with it, which is exactly what
    // makes moving a row blur the grip that is driving the move.
    if (activeNode && (activeNode === this || this.contains(activeNode))) {
      activeNode = null;
      blurred.push(this);
    }
  }

  /** @param {Node} other */
  contains(other: Node): boolean {
    for (let node: Node | null = other; node; node = node.parent) if (node === this) return true;
    return false;
  }

  /** Heard here, and by every ancestor when the event climbs. */
  dispatchEvent(event: DoubleEvent): boolean {
    for (let node: Node | null = this; node; node = node.parent) {
      node.heard.push(event.type);
      if (!event.bubbles) break;
    }
    return true;
  }

  focus(): void {
    // A browser will not put focus on a disabled control, and `moveListRow` leans on that:
    // the button it just disabled must not keep it.
    if (this.disabled) return;
    activeNode = this;
  }

  cloneNode(_deep: boolean): Node {
    // Built from its own constructor, not the base one: a copied `<input>` that came back
    // as a plain node would fail every `instanceof HTMLInputElement` the control makes, and
    // a clone nothing recognises is a clone nothing clears.
    const Built = this.constructor as new (
      tag: string,
      attributes?: Record<string, string>,
    ) => Node;
    const copy = new Built(this.tag, Object.fromEntries(this.attributes));
    copy.value = this.value;
    for (const child of this.childNodes) copy.append(child.cloneNode(true));
    return copy;
  }
}

/*
 * One class per constructor rather than one shared by all five, so every `instanceof` guard
 * in the control is a guard a test can actually break. With one class they all answered
 * yes to everything, and five type checks had no coverage at all.
 */
class DoubleElement extends Node {}
class DoubleInput extends Node {}
class DoubleButton extends Node {}
class DoubleForm extends Node {}

/** The tag a node is built with decides which constructor it answers to. */
const constructorFor = (tag: string): typeof Node =>
  tag === "input"
    ? DoubleInput
    : tag === "button"
      ? DoubleButton
      : tag === "form"
        ? DoubleForm
        : DoubleElement;

const installed: string[] = [];

/** Install the constructors the control asks the world for. Undone by `removeDom`. */
export function installDom(): void {
  const globals: Record<string, unknown> = {
    Element: Node,
    HTMLElement: Node,
    HTMLInputElement: DoubleInput,
    HTMLButtonElement: DoubleButton,
    HTMLFormElement: DoubleForm,
    Event: DoubleEvent,
  };
  for (const [name, value] of Object.entries(globals)) {
    if (name in globalThis) continue;
    installed.push(name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

/** Take them away again, so nothing outside this suite ever sees them. */
export function removeDom(): void {
  for (const name of installed) Reflect.deleteProperty(globalThis, name);
  installed.length = 0;
}

/** A node of the constructor its tag implies, the way `document.createElement` gives one. */
export function el(tag: string, attributes: Record<string, string> = {}): Node {
  const Built = constructorFor(tag);
  return new Built(tag, attributes);
}

/**
 * One row, built the shape the server writes it.
 *
 * Nested rather than flat, and that matters: the input sits inside a `.field__control` shell
 * carrying a drawn boundary and its seed, the grip and the remove each carry a glyph that a
 * real press actually lands on, and the input carries the `name` every row shares — which is
 * what makes "the order they are in is the order they post in" a thing this file can check.
 */
function listRow(value: string, seed: number) {
  const row = el("div", { "data-list-field-row": "" });
  const grip = el("button", { "data-list-field-grip": "" });
  grip.append(el("svg", { "aria-hidden": "true" }));

  const shell = el("span", { class: "field__control", "data-ink-seed": String(seed) });
  const input = el("input", { class: "field__input", name: "tags" });
  input.value = value;
  shell.append(input, el("svg", { class: "ink__ground" }), el("svg", { class: "ink__layer" }));

  const remove = el("button", {
    "data-list-field-remove": "",
    class: "btn btn--outline btn--sm",
  });
  remove.append(el("svg", { "aria-hidden": "true" }), el("svg", { class: "ink__layer" }));
  row.append(grip, shell, remove);
  return row;
}

/** One list field as the server renders it: the wrapper, its rows, and the add control. */
export function listField(...values: string[]) {
  const field = el("div", {
    "data-list-field": "",
  });
  field.dataset.listFieldLabel = "Tags";
  field.dataset.listInputId = "cap-tasks-tags";
  const holder = el("div", { "data-list-field-values": "" });
  const rows = (values.length > 0 ? values : ["green"]).map((value, index) =>
    listRow(value, 1000 + index),
  );
  holder.append(...rows);
  const add = el("button", { "data-list-field-add": "" });
  const live = el("div", { "data-list-field-live": "" });
  field.append(holder, add, live);
  const row = rows[0] as Node;
  return { field, values: holder, add, live, row, input: row.querySelector("input") as Node };
}

/** One capability with a single list field, in the mode asked for. */
export function listCapability(mode: ListInputMode, required = false): RenderableCapability {
  return {
    id: "tasks",
    label: "Tasks",
    noun: "task",
    schema: {
      fields: [{ name: "tags", label: "Tags", type: "string[]", required, lifecycle: "active" }],
    },
    form: {
      list_inputs: [{ field: "tags", mode }],
      choice_inputs: [],
      long_text: [],
      guidance: [],
    },
    actions: ["create", "read", "update", "delete", "search"],
  };
}

/** That capability's edit form, holding a stored record. */
export function editFormFor(mode: ListInputMode, stored: Record<string, unknown>): string {
  return renderEditForm(listCapability(mode), { id: "record-1", ...stored });
}

export const rowsOf = (field: Node) => field.querySelectorAll("[data-list-field-row]");
export const labelsOf = (field: Node) =>
  rowsOf(field).map((row) => row.querySelector("input")?.getAttribute("aria-label"));
export const textOf = (field: Node) =>
  rowsOf(field).map((row) => row.querySelector("input")?.value);
/** The grip a row is taken hold of by. */
export const gripOf = (row: Node | undefined) => row?.querySelector("[data-list-field-grip]");

/** Which rows cannot be moved at all: the state a list of one leaves its only grip in. */
export const stuckRows = (field: Node) =>
  rowsOf(field).map((row) => gripOf(row)?.hasAttribute("disabled"));

/**
 * Stack the rows down the page, 20px apiece, so a pointer height means something. Called
 * again after a move, because the rows have changed places and the page has not.
 */
export function layOut(field: Node): void {
  rowsOf(field).forEach((row, index) => {
    row.box = { top: index * 20, height: 20 };
  });
}

/** The middle of the row now sitting at this position, which is where a pointer aims. */
export const middleOf = (index: number) => index * 20 + 10;

/** What was last said into the field's live region. */
export const saidBy = (field: Node) =>
  field.querySelector("[data-list-field-live]")?.textContent ?? "";
