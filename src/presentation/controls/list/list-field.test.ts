import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { CREATE_CANCELLED_EVENT, RECORD_CREATED_EVENT } from "#shell/core/shell-dom.js";
import { normalizeListInputValues } from "../../../runtime/field-types/list-input.ts";
import { elementsOf, moduleSources } from "../../../server/http/served-page.test-support.ts";
import { renderCreateForm } from "../../fields/field-renderer.ts";
import { readSource } from "../../safety/source.test-support.ts";
import { El as ParsedEl, parseHtml } from "../double/choice-picker.test-support.ts";
import { startedOn } from "../double/started-module.test-support.ts";
import {
  editFormFor,
  el,
  gripOf,
  installDom,
  labelsOf,
  listCapability,
  listField,
  type Node,
  removeDom,
  rowsOf,
  stuckRows,
  textOf,
} from "./list-field.test-support.ts";

// Repeated-value rows: the server renders them, and the control makes them behave. The control
// is `design/scripts/controls/list-rows.js` and `public/controls/list-field.js` is the product's half of the seam.

/** A root that hands every listener it is given straight back, by event name. */
function fakeRoot() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const root = {
    addEventListener: (type: string, listener: (event: Event) => void) => {
      const already = listeners.get(type) ?? [];
      already.push(listener as (event: unknown) => void);
      listeners.set(type, already);
    },
  };
  const fire = (type: string, event: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return { root, fire };
}

beforeAll(installDom);
afterAll(removeDom);

describe("the rows a list field is typed into", () => {
  test("the shipped page loads the module, and it starts itself on the document it finds", async () => {
    expect(moduleSources(await elementsOf(readSource("public/index.html")))).toContain(
      "/static/controls/list-field.js",
    );
    const { root, fire } = fakeRoot();
    await startedOn("controls/list-field.js", root);
    const { addListRow } = await import("#shell/controls/list-field.js");
    const { field, add } = listField("green");
    const form = el("form");
    form.append(field);
    addListRow(add);
    fire(RECORD_CREATED_EVENT, { target: form });
    expect(rowsOf(field)).toHaveLength(1);
  });

  test("the order can be changed without dragging, because the grip is a button", () => {
    // A drag is unavailable to a keyboard and invisible until you try it, so it may not be the
    // only way in. The grip is a `<button>`, which is what puts it in the tab order; the keys it
    // answers are run in `list-field.reorder.test.ts`.
    const page = parseHtml(
      editFormFor("repeatable", { tags: ["green", "slow"] }),
      new ParsedEl("div"),
    );
    const grips = page.querySelectorAll("button").filter((b) => b.hasAttribute("aria-describedby"));
    expect(grips.length).toBeGreaterThan(0);
    for (const grip of grips) {
      expect(grip.getAttribute("type")).toBe("button");
      expect(grip.hasAttribute("draggable")).toBe(false);
      // The keys are named where the grip is described, because a grab is a mode and a mode
      // nobody was told about is a row they cannot put down.
      const help = page.querySelector(`#${grip.getAttribute("aria-describedby")}`);
      expect(help?.textContent.trim()).not.toBe("");
    }
  });
});

/**
 * The controls on each row, as the facts that have to agree about them. Checked separately, the
 * hook, the label and whether the control can act can each be right while the button is wrong.
 */
function rowControls(form: string) {
  const rows = parseHtml(form, new ParsedEl("div")).querySelectorAll("[data-list-field-row]");
  return rows.flatMap((row) =>
    row.querySelectorAll("button").map((control) => ({
      is: control.hasAttribute("data-list-field-grip") ? "grip" : "remove",
      says: control.getAttribute("aria-label") ?? "",
      stuck: control.hasAttribute("disabled"),
    })),
  );
}

describe("what the server writes on a row", () => {
  test("every control agrees with itself about which row it belongs to", () => {
    const controls = rowControls(editFormFor("repeatable", { tags: ["one", "two", "three"] }));
    expect(controls).toEqual([
      { is: "grip", says: "Reorder Tags 1 of 3", stuck: false },
      { is: "remove", says: "Remove Tags value 1", stuck: false },
      { is: "grip", says: "Reorder Tags 2 of 3", stuck: false },
      { is: "remove", says: "Remove Tags value 2", stuck: false },
      { is: "grip", says: "Reorder Tags 3 of 3", stuck: false },
      { is: "remove", says: "Remove Tags value 3", stuck: false },
    ]);
  });

  test("the one row a create form opens with cannot be reordered, and can still be emptied", () => {
    // Nowhere to move the only row there is, and a control that cannot act says so — while
    // the remove stays, because emptying the row is still something to do.
    expect(rowControls(renderCreateForm(listCapability("repeatable")))).toEqual([
      { is: "grip", says: "Reorder Tags 1 of 1", stuck: true },
      { is: "remove", says: "Remove Tags value 1", stuck: false },
    ]);
  });

  test("the grip is drawn as the six dots every sortable list is dragged by", () => {
    // The one mark on the row that is a convention rather than a decision: a person who has
    // moved a row anywhere else already knows what it is for.
    const page = parseHtml(renderCreateForm(listCapability("repeatable")), new ParsedEl("div"));
    const grip = page.querySelector("[data-list-field-grip]");
    expect(grip?.querySelectorAll("circle")).toHaveLength(6);
  });

  test("a required list says so on the field, because no one control can carry it", () => {
    // One nonblank row is what it wants, so `required` on a row would refuse a complete list.
    // The field says the word and `public/fields/field-errors.js` enforces it.
    // The refusal itself is run in `field-errors.required.test.ts` ("a required list is refused…").
    const parsed = (html: string) => parseHtml(html, new ParsedEl("div"));
    const required = parsed(renderCreateForm(listCapability("repeatable", true)));
    expect(required.querySelector("[required]")).toBeNull();
    // The comma mode has one control, so it keeps the native constraint it can carry.
    const comma = parsed(renderCreateForm(listCapability("comma_separated", true)));
    expect(comma.querySelector('input[name="tags"]')?.hasAttribute("required")).toBe(true);
  });
});

describe("what the rows actually do", () => {
  test("adding a row clears the copy, re-keys every row, and lands the cursor in it", async () => {
    const { addListRow, syncListRows } = await import("#shell/controls/list-field.js");
    const { field, add, input } = listField();
    syncListRows(field);

    addListRow(add);

    expect(rowsOf(field)).toHaveLength(2);
    // The clone is a copy of a filled row, so the value has to go; the id and the
    // accessible name are positional and are restated for every row, not just the new one.
    const [first, second] = rowsOf(field);
    expect(second?.querySelector("input")?.value).toBe("");
    expect(second?.querySelector("input")?.focused).toBe(true);
    const inputId = field.dataset.listInputId;
    expect(first?.querySelector("input")?.id).toBe(`${inputId}-1`);
    expect(second?.querySelector("input")?.id).toBe(`${inputId}-2`);
    expect(labelsOf(field)).toEqual(["Tags 1", "Tags 2"]);
    expect(input.value).toBe("green");
  });

  test("every press reaches the one control it names, and never another", async () => {
    // The press is delegated, so the dispatcher is the only thing standing between two
    // controls that do opposite things.
    const { startListFields } = await import("#shell/controls/list-field.js");
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

  test("a disabled control is refused by the dispatcher, wherever the press lands", async () => {
    const { pressListRow, syncListRows } = await import("#shell/controls/list-field.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    const middle = rowsOf(field)[1] as Node;
    middle.querySelector("[data-list-field-remove]")?.setAttribute("disabled", "");

    pressListRow(middle.querySelector("[data-list-field-remove]") as never);
    expect(textOf(field)).toEqual(["one", "two", "three"]);

    // A real press lands on the glyph inside the button, never the button itself, so the
    // dispatcher has to climb out of it before it can refuse or act on anything.
    const glyphIn = (button: Node | undefined) => button?.querySelector("[aria-hidden]") as Node;
    pressListRow(glyphIn(middle.querySelector("[data-list-field-remove]") as Node) as never);
    expect(textOf(field)).toEqual(["one", "two", "three"]);

    const first = rowsOf(field)[0] as Node;
    pressListRow(glyphIn(first.querySelector("[data-list-field-remove]") as Node) as never);
    expect(textOf(field)).toEqual(["two", "three"]);
  });

  test("a structural edit says the field changed, so a standing refusal clears", async () => {
    // Removing the duplicate row a refusal named is the correction it asked for, but a removed
    // node fires nothing, so every mutation announces an `input` for the clearing to reach.
    const { addListRow, removeListRow, syncListRows } = await import(
      "#shell/controls/list-field.js"
    );
    const { keyListRow } = await import("#design/controls/list-rows.js");
    const { field, add } = listField("one", "two");
    syncListRows(field);
    expect(field.heard).toEqual([]);

    addListRow(add);
    const grip = gripOf(rowsOf(field)[1]);
    keyListRow({ target: grip, key: " ", preventDefault: () => {} } as never);
    keyListRow({ target: grip, key: "ArrowUp", preventDefault: () => {} } as never);
    keyListRow({ target: grip, key: " ", preventDefault: () => {} } as never);
    removeListRow(rowsOf(field)[0]?.querySelector("[data-list-field-remove]") as never);
    expect(field.heard).toEqual(["input", "input", "input"]);

    // Emptying the last row is an edit too, and the only one that changes no row count.
    const alone = listField("only");
    syncListRows(alone.field);
    removeListRow(alone.row.querySelector("[data-list-field-remove]") as never);
    expect(alone.field.heard).toEqual(["input"]);
    // It climbs, because the listener that clears is delegated on the document.
    expect(alone.input.heard).toEqual([]);
  });

  test("an added row is drawn with a hand of its own, not the one it was copied from", async () => {
    const { addListRow, syncListRows } = await import("#shell/controls/list-field.js");
    const { field, add } = listField("green");
    // What the ink system leaves on a row it has drawn: a seed on the control, and its layers.
    const drawn = rowsOf(field)[0]?.querySelector(".field__control") as Node;
    drawn.setAttribute("data-ink-seed", "1000");
    drawn.append(el("svg", { class: "ink__ground" }), el("svg", { class: "ink__layer" }));
    syncListRows(field);

    addListRow(add);

    // The clone carries the layers and the seed of the row it copied. The layers would be drawn
    // a second time, and `mountInk` takes a seed it finds, leaving two rows in the same hand.
    const copy = rowsOf(field)[1] as Node;
    expect(copy.querySelectorAll("[data-ink-seed]")).toHaveLength(0);
    expect(copy.querySelectorAll(".ink__ground")).toHaveLength(0);
    expect(copy.querySelectorAll(".ink__layer")).toHaveLength(0);
    // And the row it was copied from keeps both.
    const original = rowsOf(field)[0] as Node;
    expect(original.querySelector("[data-ink-seed]")?.getAttribute("data-ink-seed")).toBe("1000");
    expect(original.querySelectorAll(".ink__layer").length).toBeGreaterThan(0);
  });

  test("the last row is emptied rather than taken away", async () => {
    const { removeListRow } = await import("#shell/controls/list-field.js");
    const { field, row } = listField();

    removeListRow(row.querySelector("[data-list-field-remove]") as never);

    // A field with no row at all cannot be typed into and nothing puts one back.
    expect(rowsOf(field)).toHaveLength(1);
    expect(row.querySelector("input")?.value).toBe("");
  });
});

describe("both modes hand over the same ordered array", () => {
  const VALUES = ["one", "two", "three"];

  /** What a browser would post for a repeatable field: one entry per row, in row order. */
  const posted = (field: Node) => textOf(field).map((value) => value ?? "");

  test("a repeatable field posts its rows in the order they are in", async () => {
    const { keyListRow, syncListRows } = await import("#design/controls/list-rows.js");
    const { field } = listField(...VALUES);
    syncListRows(field);

    expect(normalizeListInputValues("repeatable", posted(field))).toEqual(VALUES);

    // Moved with the keyboard, because what is being checked is that the *rows* changed
    // places rather than their names — and that is what the wire reads either way.
    const grip = gripOf(rowsOf(field)[2]);
    const press = (key: string) =>
      keyListRow({ target: grip, key, preventDefault: () => {} } as never);
    press(" ");
    press("ArrowUp");
    press(" ");
    expect(normalizeListInputValues("repeatable", posted(field))).toEqual(["one", "three", "two"]);
  });

  test("a comma-separated field posts one entry, and arrives at the same array", async () => {
    const { addListRow, syncListRows } = await import("#shell/controls/list-field.js");
    const { field, add } = listField(...VALUES);
    syncListRows(field);

    // The same three values, in the same order, typed into the one control the other mode
    // draws. Both reach the capability's own code as the same array.
    expect(normalizeListInputValues("comma_separated", ["one, two, three"])).toEqual(
      normalizeListInputValues("repeatable", posted(field)),
    );

    // The empty row an Add opens is a placeholder and is dropped. That the two modes then
    // read a comma differently is `src/runtime/field-types/list-input.test.ts`'s subject, not this one's.
    addListRow(add);
    expect(posted(field)).toHaveLength(4);
    expect(normalizeListInputValues("repeatable", posted(field))).toEqual(VALUES);
  });

  test("the renderer prefills the same stored array into either control", () => {
    const stored = { tags: VALUES };
    const repeatable = editFormFor("repeatable", stored);
    const comma = editFormFor("comma_separated", stored);

    // One row apiece, in order …
    const typed = (form: string) =>
      [...form.matchAll(/name="tags" value="([^"]*)"/g)].map((found) => found[1]);
    expect(typed(repeatable)).toEqual(VALUES);
    // … or one control holding the separator the mode is named for.
    expect(typed(comma)).toEqual([VALUES.join(", ")]);
    expect(comma).not.toContain("data-list-field-row");
  });
});

describe("finishing with a form", () => {
  test("a committed create and a cancelled one both put the rows back", async () => {
    // Both listeners were only ever proved to exist. Gutting either body left every
    // assertion about them passing, because the fake root delivered nothing but clicks.
    const { addListRow, startListFields } = await import("#shell/controls/list-field.js");
    for (const [event, target] of [
      [RECORD_CREATED_EVENT, "form"],
      [CREATE_CANCELLED_EVENT, "button"],
    ] as const) {
      const { root, fire } = fakeRoot();
      startListFields(root);
      const { field, add } = listField("green");
      const form = el("form");
      form.append(field);
      addListRow(add);
      addListRow(add);
      expect(rowsOf(field)).toHaveLength(3);

      // Cancel is announced by the control that was pressed, so the listener has to walk
      // up to the form itself before it can put anything back.
      const from =
        target === "form"
          ? form
          : (() => {
              const b = el("button");
              field.append(b);
              return b;
            })();
      fire(event, { target: from });
      expect(rowsOf(field), `${event} did not collapse the rows`).toHaveLength(1);
    }
  });

  test("the row that survives a collapse is the first one, whatever order it ended in", async () => {
    // The count and the labels come back either way, since `syncListRows` restates both, so a
    // collapse keeping the last row read identically. Which value survives tells them apart.
    const { collapseListFieldRows, syncListRows } = await import("#shell/controls/list-field.js");
    const { keyListRow } = await import("#design/controls/list-rows.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    const form = el("form");
    form.append(field);
    const grip = gripOf(rowsOf(field)[2]);
    keyListRow({ target: grip, key: " ", preventDefault: () => {} } as never);
    keyListRow({ target: grip, key: "ArrowUp", preventDefault: () => {} } as never);
    keyListRow({ target: grip, key: " ", preventDefault: () => {} } as never);
    expect(textOf(field)).toEqual(["one", "three", "two"]);

    collapseListFieldRows(form as never);

    expect(textOf(field)).toEqual(["one"]);
    expect(labelsOf(field)).toEqual(["Tags 1"]);
    // One row on its own has nothing to reorder, and its grip says so again after the
    // collapse.
    expect(stuckRows(field)).toEqual([true]);
  });

  test("a field arriving without its two data attributes still names every row", async () => {
    // The fallbacks are what a row is called when a template dropped the field's identity.
    // Asserted, because the sentence claiming them was only ever a source substring.
    const { mountListRows } = await import("#design/controls/list-rows.js");
    const { field } = listField("one", "two");
    Reflect.deleteProperty(field.dataset, "listFieldLabel");
    Reflect.deleteProperty(field.dataset, "listInputId");

    // `mountListRows` is the design page's entry point: every list field under a root, put into
    // the state its row count implies. It takes the document, which is why it gets a container.
    const page = el("div");
    page.append(field);
    mountListRows(page);

    expect(labelsOf(field)).toEqual(["Value 1", "Value 2"]);
    expect(rowsOf(field).map((row) => row.querySelector("input")?.id)).toEqual([
      "list-value-1",
      "list-value-2",
    ]);
    expect(stuckRows(field)).toEqual([false, false]);
  });

  test("a finished create form goes back to the one row it was rendered with", async () => {
    const { addListRow, collapseListFieldRows } = await import("#shell/controls/list-field.js");
    const { field, add } = listField();
    const form = el("form");
    form.append(field);
    addListRow(add);
    addListRow(add);
    expect(rowsOf(field)).toHaveLength(3);

    collapseListFieldRows(form as never);

    expect(rowsOf(field)).toHaveLength(1);
    expect(labelsOf(field)).toEqual(["Tags 1"]);
  });
});
