import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { renderCreateForm } from "./field-renderer.ts";
import { codeOf, readSource } from "./source.test-support.ts";

// Repeated-value rows: the server renders them, and one shell module makes them behave.
//
// A module of its own since the desk's message work (5.8/02) — the rows are a subject,
// they are reached only through events, and nothing about them has to be in place before
// Alpine starts, which is the only reason `public/app.js` is a classic script at all.
// What is asserted here is what a file is the right place to assert: the seam is wired,
// the shell loads it, and the glue no longer owns any of it.

const MODULE = codeOf("public/list-field.js");
const GLUE = codeOf("public/app.js");
const SHELL = readSource("public/index.html");

describe("the rows a list field is typed into", () => {
  test("the shipped page loads the module, and it starts itself against the real document", () => {
    expect(SHELL).toContain('<script type="module" src="/static/list-field.js"></script>');
    expect(MODULE).toContain('if (typeof document !== "undefined") startListFields(document);');
  });

  test("it answers every way a row is added, removed, or put back", () => {
    expect(MODULE).toContain('root.addEventListener?.("click"');
    expect(MODULE).toContain('root.addEventListener?.("aluna:record-created"');
    expect(MODULE).toContain('root.addEventListener?.("aluna:create-cancelled"');
    expect(MODULE).toContain("collapseListFieldRows(form)");
    // Delegated on the document, because these forms are swapped in long after load and
    // a per-form script tag would have to be written into every one of them.
    expect(MODULE).toContain("Element.prototype.querySelectorAll.call(form");
  });

  test("what the module looks for is what the server writes", () => {
    const form = renderCreateForm({
      id: "tasks",
      label: "Tasks",
      noun: "task",
      schema: {
        fields: [
          { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
        ],
      },
      form: {
        list_inputs: [{ field: "tags", mode: "repeatable" }],
        choice_inputs: [],
        long_text: [],
        guidance: [],
      },
      actions: ["create", "read", "update", "delete", "search"],
    });

    // The hooks the module queries by, verbatim on both sides.
    for (const hook of [
      "data-list-field",
      "data-list-field-values",
      "data-list-field-row",
      "data-list-field-add",
      "data-list-field-remove",
    ]) {
      expect(form).toContain(hook);
      expect(MODULE).toContain(`[${hook}]`);
    }
    // And the two it reads through `dataset` to re-key every row's id and accessible
    // name after an add or a remove. Drop or rename either and the rows fall back to a
    // generic "Value 1 / Value 2" and collide on `list-value-N` ids.
    expect(form).toContain('data-list-field-label="Tags"');
    expect(MODULE).toContain("dataset.listFieldLabel");
    expect(form).toContain('data-list-input-id="cap-tasks-tags"');
    expect(MODULE).toContain("dataset.listInputId");
  });

  test("the glue kept none of it", () => {
    expect(GLUE).not.toContain("ListFieldRow");
    expect(GLUE).not.toContain("data-list-field");
  });
});

/**
 * The rules, run.
 *
 * The module is authored for a browser and asks the DOM's own constructors what a node
 * is, so the constructors are what a Bun run has to supply. They are installed as globals
 * for the length of this file and taken away again — the module reads them when a rule
 * runs rather than when it is imported, so this is enough and nothing outside this file
 * ever sees them.
 */
class Node {
  readonly childNodes: Node[] = [];
  parent: Node | null = null;
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  value = "";
  focused = false;

  constructor(
    readonly tag: string,
    attributes: Record<string, string> = {},
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }

  get id(): string {
    return this.attributes.get("id") ?? "";
  }

  set id(next: string) {
    this.attributes.set("id", next);
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

  matches(selector: string): boolean {
    return selector
      .split(",")
      .some((one) => this.attributes.has(one.trim().replace(/^\[|\]$/g, "")));
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
      ...(child.tag === selector || child.matches(selector) ? [child] : []),
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

  remove(): void {
    const siblings = this.parent?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  focus(): void {
    this.focused = true;
  }

  cloneNode(_deep: boolean): Node {
    const copy = new Node(this.tag, Object.fromEntries(this.attributes));
    copy.value = this.value;
    for (const child of this.childNodes) copy.append(child.cloneNode(true));
    return copy;
  }
}

const installed: string[] = [];
beforeAll(() => {
  for (const name of [
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLButtonElement",
    "HTMLFormElement",
  ]) {
    if (name in globalThis) continue;
    installed.push(name);
    Object.defineProperty(globalThis, name, { value: Node, configurable: true, writable: true });
  }
});
afterAll(() => {
  for (const name of installed) Reflect.deleteProperty(globalThis, name);
});

/** One list field as the server renders it: the wrapper, one row, and the add control. */
function listField() {
  const field = new Node("div", {
    "data-list-field": "",
  });
  field.dataset.listFieldLabel = "Tags";
  field.dataset.listInputId = "cap-tasks-tags";
  const values = new Node("div", { "data-list-field-values": "" });
  const row = new Node("div", { "data-list-field-row": "" });
  const input = new Node("input");
  input.value = "green";
  row.append(input, new Node("button", { "data-list-field-remove": "" }));
  values.append(row);
  const add = new Node("button", { "data-list-field-add": "" });
  field.append(values, add);
  return { field, values, add, row, input };
}

const rowsOf = (field: Node) => field.querySelectorAll("[data-list-field-row]");
const labelsOf = (field: Node) =>
  rowsOf(field).map((row) => row.querySelector("input")?.getAttribute("aria-label"));

describe("what the rows actually do", () => {
  test("adding a row clears the copy, re-keys every row, and lands the cursor in it", async () => {
    const { addListFieldRow, syncListFieldRows } = await import("#shell/list-field.js");
    const { field, add, input } = listField();
    syncListFieldRows(field);

    addListFieldRow(add);

    expect(rowsOf(field)).toHaveLength(2);
    // The clone is a copy of a filled row, so the value has to go; the id and the
    // accessible name are positional and are restated for every row, not just the new one.
    const [first, second] = rowsOf(field);
    expect(second?.querySelector("input")?.value).toBe("");
    expect(second?.querySelector("input")?.focused).toBe(true);
    expect(first?.querySelector("input")?.id).toBe("cap-tasks-tags-1");
    expect(second?.querySelector("input")?.id).toBe("cap-tasks-tags-2");
    expect(labelsOf(field)).toEqual(["Tags 1", "Tags 2"]);
    expect(input.value).toBe("green");
  });

  test("the add control adds and the remove control removes, and never the other way", async () => {
    // The press is delegated, so the dispatcher is the only thing standing between two
    // controls that do opposite things.
    const { startListFields } = await import("#shell/list-field.js");
    const presses: Array<(event: unknown) => void> = [];
    startListFields({
      addEventListener: (type: string, listener: (event: Event) => void) => {
        if (type === "click") presses.push(listener as (event: unknown) => void);
      },
    });
    const { field, add } = listField();

    for (const press of presses) press({ target: add });
    expect(rowsOf(field)).toHaveLength(2);

    const remove = rowsOf(field)[1]?.querySelector("[data-list-field-remove]");
    for (const press of presses) press({ target: remove });
    expect(rowsOf(field)).toHaveLength(1);
  });

  test("the last row is emptied rather than taken away", async () => {
    const { removeListFieldRow } = await import("#shell/list-field.js");
    const { field, row } = listField();

    removeListFieldRow(row.querySelector("[data-list-field-remove]") as never);

    // A field with no row at all cannot be typed into and nothing puts one back.
    expect(rowsOf(field)).toHaveLength(1);
    expect(row.querySelector("input")?.value).toBe("");
  });

  test("a finished create form goes back to the one row it was rendered with", async () => {
    const { addListFieldRow, collapseListFieldRows } = await import("#shell/list-field.js");
    const { field, add } = listField();
    const form = new Node("form");
    form.append(field);
    addListFieldRow(add);
    addListFieldRow(add);
    expect(rowsOf(field)).toHaveLength(3);

    collapseListFieldRows(form as never);

    expect(rowsOf(field)).toHaveLength(1);
    expect(labelsOf(field)).toEqual(["Tags 1"]);
  });
});
