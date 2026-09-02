import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LIST_FIELD_TYPES, SCALAR_FIELD_TYPES } from "../../registry/index.ts";
import { normalizeListInputValues } from "../../runtime/field-types/list-input.ts";
import { renderCreateForm } from "../fields/field-renderer.ts";
import { codeOf, readSource } from "../safety/source.test-support.ts";
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

// Repeated-value rows: the server renders them, and the control makes them behave.
//
// The control itself is `design/scripts/list-rows.js` and ships as it stands, the way
// `design/styles/` and `design/scripts/ink.js` do — a row, how it moves, and what every
// row is called once it has. `public/list-field.js` is the product's half of the seam:
// the delegation, and the two ways a create form finishes. What is asserted here is what
// a file is the right place to assert: the seam is wired, the shell loads it, the hooks
// the control queries by are the ones the server writes, and the glue owns none of it.

const MODULE = codeOf("public/list-field.js");
const MECHANICS = codeOf("design/scripts/list-rows.js");
const GLUE = codeOf("public/app.js");
const SHELL = readSource("public/index.html");

beforeAll(installDom);
afterAll(removeDom);

describe("the rows a list field is typed into", () => {
  test("the shipped page loads the module, and it starts itself against the real document", () => {
    expect(SHELL).toContain('<script type="module" src="/static/list-field.js"></script>');
    expect(MODULE).toContain('if (typeof document !== "undefined") startListFields(document);');
  });

  test("it answers every way a row is added, moved, removed, or put back", () => {
    expect(MODULE).toContain('root.addEventListener?.("aluna:record-created"');
    expect(MODULE).toContain('root.addEventListener?.("aluna:create-cancelled"');
    expect(MODULE).toContain("collapseListFieldRows(form)");
    // Delegated on the document, because these forms are swapped in long after load and
    // a per-form script tag would have to be written into every one of them.
    expect(MODULE).toContain("Element.prototype.querySelectorAll.call(form");
    // Every gesture is asked for at once and answered by the control, not restated here. A
    // second dispatcher in the product is how the two halves drift into disagreeing.
    expect(MODULE).toContain("wireListRows(root)");
    for (const gesture of ["click", "pointerdown", "pointermove", "pointerup", "keydown"]) {
      expect(MECHANICS, `the control does not answer ${gesture}`).toContain(`on("${gesture}"`);
      expect(MODULE, `the product answers ${gesture} itself`).not.toContain(`"${gesture}"`);
    }
  });

  test("the product takes the control from the design layer rather than keeping a copy", () => {
    // The same seam `public/ink.js` is: the import climbs out of `/static/`, which is
    // `public/`, so one path is right in the browser and on disk.
    expect(MODULE).toContain('from "../design/scripts/list-rows.js"');
    // The rules live there and nowhere else — a second implementation under public/ is
    // the defect this asserts against.
    for (const rule of ["querySelectorAll(ROW)", "cloneNode(true)", 'setAttribute("disabled"']) {
      expect(MECHANICS).toContain(rule);
      expect(MODULE).not.toContain(rule);
    }
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

    // The hooks the control queries by, verbatim on both sides.
    for (const hook of [
      "data-list-field",
      "data-list-field-values",
      "data-list-field-row",
      "data-list-field-add",
      "data-list-field-remove",
      "data-list-field-grip",
    ]) {
      expect(form).toContain(hook);
      expect(MECHANICS).toContain(`[${hook}]`);
    }
    // The live region is in the form from the start rather than written when a drag begins:
    // a region added and filled in the same turn is one no screen reader is yet watching.
    expect(form).toContain("data-list-field-live");
    expect(MECHANICS).toContain("[data-list-field-live]");
    // And the two it reads through `dataset` to re-key every row's id and accessible
    // name after an add or a remove. Drop or rename either and the rows fall back to a
    // generic "Value 1 / Value 2" and collide on `list-value-N` ids.
    expect(form).toContain('data-list-field-label="Tags"');
    expect(MECHANICS).toContain("dataset.listFieldLabel");
    expect(form).toContain('data-list-input-id="cap-tasks-tags"');
    expect(MECHANICS).toContain("dataset.listInputId");
  });

  test("the order can be changed without dragging, because the grip is a button", () => {
    // A drag is what people already know, and it is also unavailable to a keyboard and
    // invisible until you try it — so it may not be the only way in. What makes the other
    // way possible is that the grip is a `<button>`: that is what puts it in the tab order
    // and what lets space, the arrows and escape reach it at all.
    const form = editFormFor("repeatable", { tags: ["green", "slow"] });
    expect(form).toContain('<button class="field-list__grip" type="button" data-list-field-grip');
    expect(form).not.toContain("draggable");
    // The keys are named where the grip is described, because a grab is a mode and a mode
    // nobody was told about is a row they cannot put down.
    expect(form).toContain("Press space to pick this row up, then the arrow keys to move it.");
    expect(form).toMatch(/aria-describedby="edit-tasks-tags-reorder-help"/);
    expect(form).toContain('id="edit-tasks-tags-reorder-help"');
    for (const key of ["ArrowUp", "ArrowDown", "Escape"]) {
      expect(MECHANICS, `the control does not answer ${key}`).toContain(key);
    }
  });

  test("the glue kept none of it", () => {
    expect(GLUE).not.toContain("ListRow");
    expect(GLUE).not.toContain("data-list-field");
  });
});

/**
 * The controls on each row, as the facts that have to agree about them.
 *
 * Asserted together and not one at a time. Checked separately, the hook, what the label
 * says and whether the control can act can each be right while the button is wrong.
 */
function rowControls(form: string) {
  return [...form.matchAll(/<button class="([^"]*)" type="button" ([^>]*)>/g)]
    .filter(([, classes]) => /field-list__(grip|action)/.test(classes ?? ""))
    .map(([, classes, rest]) => ({
      is: /field-list__grip/.test(classes ?? "") ? "grip" : "remove",
      hook: /data-list-field-(grip|remove)/.exec(rest ?? "")?.[1] ?? "",
      says: /aria-label="([^"]*)"/.exec(rest ?? "")?.[1] ?? "",
      stuck: (rest ?? "").includes(" disabled"),
    }));
}

describe("what the server writes on a row", () => {
  test("every control agrees with itself about which row it belongs to", () => {
    const controls = rowControls(editFormFor("repeatable", { tags: ["one", "two", "three"] }));
    expect(controls).toEqual([
      { is: "grip", hook: "grip", says: "Reorder Tags 1 of 3", stuck: false },
      { is: "remove", hook: "remove", says: "Remove Tags value 1", stuck: false },
      { is: "grip", hook: "grip", says: "Reorder Tags 2 of 3", stuck: false },
      { is: "remove", hook: "remove", says: "Remove Tags value 2", stuck: false },
      { is: "grip", hook: "grip", says: "Reorder Tags 3 of 3", stuck: false },
      { is: "remove", hook: "remove", says: "Remove Tags value 3", stuck: false },
    ]);
  });

  test("the one row a create form opens with cannot be reordered, and can still be emptied", () => {
    // Nowhere to move the only row there is, and a control that cannot act says so — while
    // the remove stays, because emptying the row is still something to do.
    expect(rowControls(renderCreateForm(listCapability("repeatable")))).toEqual([
      { is: "grip", hook: "grip", says: "Reorder Tags 1 of 1", stuck: true },
      { is: "remove", hook: "remove", says: "Remove Tags value 1", stuck: false },
    ]);
  });

  test("the grip is drawn as the six dots every sortable list is dragged by", () => {
    // The one mark on the row that is a convention rather than a decision: a person who has
    // moved a row anywhere else already knows what it is for.
    const form = renderCreateForm(listCapability("repeatable"));
    expect([...form.matchAll(/<circle cx="\d+" cy="\d+" r="1.6">/g)]).toHaveLength(6);
  });

  test("a required list says so on the field, because no one control can carry it", () => {
    // One nonblank row is what it wants, so `required` on a row would refuse a list that is
    // complete. The field says the word and `public/field-errors.js` enforces it, exactly
    // as the drawn picker's is enforced.
    const required = renderCreateForm(listCapability("repeatable", true));
    expect(required).toContain("data-list-required");
    expect(required).not.toContain(" required>");
    expect(renderCreateForm(listCapability("repeatable"))).not.toContain("data-list-required");
    // The comma mode has one control, so it keeps the native constraint it can carry.
    expect(renderCreateForm(listCapability("comma_separated", true))).toContain(" required>");
    expect(codeOf("public/field-errors.js")).toContain("[data-list-required]");
  });
});

describe("what the rows actually do", () => {
  test("adding a row clears the copy, re-keys every row, and lands the cursor in it", async () => {
    const { addListRow, syncListRows } = await import("#shell/list-field.js");
    const { field, add, input } = listField();
    syncListRows(field);

    addListRow(add);

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

  test("every press reaches the one control it names, and never another", async () => {
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

  test("a disabled control is refused by the dispatcher, wherever the press lands", async () => {
    const { pressListRow, syncListRows } = await import("#shell/list-field.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    const middle = rowsOf(field)[1] as Node;
    middle.querySelector("[data-list-field-remove]")?.setAttribute("disabled", "");

    pressListRow(middle.querySelector("[data-list-field-remove]") as never);
    expect(textOf(field)).toEqual(["one", "two", "three"]);

    // A real press lands on the glyph inside the button, never the button itself — so the
    // dispatcher has to climb out of it before it can refuse or act on anything. Both
    // halves: the glyph of a control that can act, and the glyph of one that cannot.
    const glyphIn = (button: Node | undefined) => button?.querySelector("[aria-hidden]") as Node;
    pressListRow(glyphIn(middle.querySelector("[data-list-field-remove]") as Node) as never);
    expect(textOf(field)).toEqual(["one", "two", "three"]);

    const first = rowsOf(field)[0] as Node;
    pressListRow(glyphIn(first.querySelector("[data-list-field-remove]") as Node) as never);
    expect(textOf(field)).toEqual(["two", "three"]);
  });

  test("a structural edit says the field changed, so a standing refusal clears", async () => {
    // Removing the duplicate row a refusal named is the correction it asked for, but a
    // removed node fires nothing. `public/field-errors.js` clears a marked field on
    // `input`, and every mutation announces one so that reaches it.
    const { addListRow, removeListRow, syncListRows } = await import("#shell/list-field.js");
    const { keyListRow } = await import("#design/list-rows.js");
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
    const { addListRow, syncListRows } = await import("#shell/list-field.js");
    const { field, add } = listField("green");
    syncListRows(field);
    const seedsBefore = rowsOf(field).map((row) =>
      row.querySelector("[data-ink-seed]")?.getAttribute("data-ink-seed"),
    );
    expect(seedsBefore).toEqual(["1000"]);

    addListRow(add);

    // The clone carries the layers *and* the seed of the row it copied. Both have to go:
    // the layers because the ink system would not recognise them and would draw a second
    // pair, and the seed because `mountInk` takes one if it finds one — leaving two rows
    // wearing the same squiggle.
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
    const { removeListRow } = await import("#shell/list-field.js");
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
    const { keyListRow, syncListRows } = await import("#design/list-rows.js");
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
    const { addListRow, syncListRows } = await import("#shell/list-field.js");
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

  test("a committed create and a cancelled one both put the rows back", async () => {
    // Both listeners were only ever proved to exist. Gutting either body left every
    // assertion about them passing, because the fake root delivered nothing but clicks.
    const { addListRow, startListFields } = await import("#shell/list-field.js");
    for (const [event, target] of [
      ["aluna:record-created", "form"],
      ["aluna:create-cancelled", "button"],
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
    // The count and the labels come back either way — `syncListRows` restates both — so a
    // collapse that kept the *last* row read identically. What tells them apart is which
    // value is left standing, and whether the survivor is at both boundaries.
    const { collapseListFieldRows, syncListRows } = await import("#shell/list-field.js");
    const { keyListRow } = await import("#design/list-rows.js");
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
    const { mountListRows } = await import("#design/list-rows.js");
    const { field } = listField("one", "two");
    Reflect.deleteProperty(field.dataset, "listFieldLabel");
    Reflect.deleteProperty(field.dataset, "listInputId");

    // `mountListRows` is the design page's entry point: every list field *under* a root,
    // put into the state its row count implies. It is what puts an authored row right, and
    // it takes the document rather than the field, which is why it is handed a container.
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
    const { addListRow, collapseListFieldRows } = await import("#shell/list-field.js");
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

/**
 * The other absence in the design, and the one that is not a gap: a file field has nowhere
 * to live until Files arrives in Module 7, so nothing is built for one here.
 *
 * A standing rule rather than a behaviour, and it is worth being plain about which: there
 * is nothing to exercise, so this asserts that four traces of a file input are absent and
 * claims no more than that.
 */
describe("file fields", () => {
  test("are not a type, and no trace of one reaches the form renderer", () => {
    expect([...SCALAR_FIELD_TYPES, ...LIST_FIELD_TYPES]).not.toContain("file");
    const renderer = codeOf("src/presentation/fields/field-renderer.ts");
    for (const trace of ['type="file"', "FileList", "multipart/form-data", "enctype"]) {
      expect(renderer, `the field renderer names ${trace}`).not.toContain(trace);
    }
  });
});
