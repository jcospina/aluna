// The rows running: `public/list-field.js` started on the edit form the server renders, and every
// gesture sent the way the browser sends it — to the element under the pointer or holding focus,
// bubbling to the document the control listens on.

import { describe, expect, test } from "bun:test";
import { renderCreateForm } from "../fields/field-renderer.ts";
import { installDomGlobals } from "./choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "./choice-picker.test-support.ts";
import { editFormFor, listCapability } from "./list-field.test-support.ts";
import { startedOn } from "./started-module.test-support.ts";

installDomGlobals();

const PITCH = 20;

/** The stored rows in a started document, stacked `PITCH` apart so a pointer height means one. */
async function rows(...tags: string[]) {
  const doc = new Doc();
  parseHtml(editFormFor("repeatable", { tags }), doc);
  await startedOn("list-field.js", doc);
  const field = doc.querySelector("[data-list-field]") as El;
  const rowsNow = () => field.querySelectorAll("[data-list-field-row]");
  const layOut = () =>
    rowsNow().forEach((row, at) => {
      row.box = { ...row.box, top: at * PITCH, bottom: at * PITCH + PITCH, height: PITCH };
    });
  layOut();
  return {
    doc,
    form: doc.querySelector("form") as El,
    field,
    layOut,
    text: () => rowsNow().map((row) => row.querySelector("input")?.value),
    grip: (at: number) => rowsNow()[at]?.querySelector("[data-list-field-grip]") as El,
  };
}

describe("a list field's rows, moved by the two gestures that move them", () => {
  test("a drag of the first row past the other two puts it last", async () => {
    const list = await rows("one", "two", "three");
    const grip = list.grip(0);
    const at = { pointerId: 1, button: 0 };
    list.doc.fire("pointerdown", grip, { ...at, clientY: 10 });
    list.doc.fire("pointermove", grip, { ...at, clientY: 10 + 2 * PITCH + 5 });
    list.doc.fire("pointerup", grip, { ...at, clientY: 10 + 2 * PITCH + 5 });
    expect(list.text()).toEqual(["two", "three", "one"]);
  });

  test("space takes the last row, the up arrow moves it, and space puts it down", async () => {
    const list = await rows("one", "two", "three");
    const grip = list.grip(2);
    grip.focus();
    for (const key of [" ", "ArrowUp", " "])
      list.doc.fire("keydown", list.doc.activeElement, { key });
    expect(list.text()).toEqual(["one", "three", "two"]);
  });
});

describe("what a list field's rows leave the form to do", () => {
  test("every row's remove is a plain button, and nothing in the form is draggable", async () => {
    const list = await rows("one", "two");
    const removes = list.field.querySelectorAll("[data-list-field-remove]");
    expect(removes.length).toBe(2);
    expect(removes.map((button) => [button.tag, button.getAttribute("type")])).toEqual([
      ["button", "button"],
      ["button", "button"],
    ]);
    expect([...list.form.descendants()].filter((node) => node.hasAttribute("draggable"))).toEqual(
      [],
    );
  });

  test("an optional repeatable list left empty lets the form submit", async () => {
    // The refusal a required list gets is `public/field-errors.js`'s, so it runs too.
    const doc = new Doc();
    parseHtml(renderCreateForm(listCapability("repeatable")), doc);
    await startedOn("list-field.js", doc);
    await startedOn("field-errors.js", doc);
    expect(doc.fire("submit", doc.querySelector("form") as El)).toEqual({
      prevented: false,
      stopped: false,
    });
  });
});

describe("the root the rows are started on", () => {
  test("a root that cannot be listened on starts nothing and throws nothing", async () => {
    const { startListFields } = await import("#shell/list-field.js");
    expect(() => startListFields({} as never)).not.toThrow();
  });
});
