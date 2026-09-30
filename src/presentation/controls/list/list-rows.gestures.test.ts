// Every gesture a list field's rows answer, run through the real `design/scripts/controls/list-rows.js` on
// the edit form the server renders. Each test wires a fresh copy of the module onto its own page,
// because which row is held is the module's own state. Where the browser would blur a grip whose
// row it moves, the page says so: a moved focused node is a blurred one.

import { describe, expect, test } from "bun:test";

import type * as ListRows from "#design/controls/list-rows.js";
import { installDomGlobals } from "../double/choice-picker.fixture.test-support.ts";
import { Doc, El, parseHtml } from "../double/choice-picker.test-support.ts";
import { editFormFor } from "./list-field.test-support.ts";

installDomGlobals();

const PITCH = 20;
let copies = 0;

/** A page holding one list field with `tags`, and a fresh copy of the rows' module wired onto it. */
async function listPage(tags: string[], { top = 100, blurOnMove = false } = {}) {
  copies += 1;
  const rows = (await import(
    `../../../../design/scripts/controls/list-rows.js?copy=${copies}`
  )) as typeof ListRows;
  const doc = new Doc();
  parseHtml(editFormFor("repeatable", { tags }), doc);
  rows.wireListRows(doc as never);
  const field = doc.querySelector("[data-list-field]") as El;
  const values = field.querySelector("[data-list-field-values]") as El;
  const rowsNow = () => values.querySelectorAll("[data-list-field-row]");
  const layOut = () =>
    rowsNow().forEach((row, at) => {
      row.box = {
        ...row.box,
        top: top + at * PITCH,
        bottom: top + at * PITCH + PITCH,
        height: PITCH,
      };
    });
  layOut();
  if (blurOnMove) {
    // The browser blurs a focused node that leaves the document, even to come straight back.
    const blurring = (node: El) => {
      const focused = doc.activeElement;
      if (node.contains(focused)) {
        focused.blur();
        doc.fire("focusout", focused);
      }
    };
    const before = El.prototype.before;
    const append = El.prototype.append;
    for (const row of rowsNow()) {
      row.before = function (this: El, ...nodes: El[]) {
        for (const node of nodes) blurring(node);
        before.apply(this, nodes);
      };
    }
    values.append = function (this: El, ...nodes: El[]) {
      for (const node of nodes) blurring(node);
      return append.apply(this, nodes);
    };
  }
  const changes: string[] = [];
  const live = field.querySelector("[data-list-field-live]") as El;
  doc.addEventListener("input", (event) => {
    if ((event as unknown as { target: El }).target === field) changes.push(live.textContent);
  });
  const label = field.getAttribute("data-list-field-label") as string;
  return {
    rows,
    doc,
    field,
    values,
    live,
    changes,
    layOut,
    text: () => rowsNow().map((row) => row.querySelector("input")?.value),
    row: (at: number) => rowsNow()[at] as El,
    grip: (at: number) => rowsNow()[at]?.querySelector("[data-list-field-grip]") as El,
    said: (what: Parameters<typeof ListRows.reorderSentence>[0], position: number) =>
      rows.reorderSentence(what, label, position, rowsNow().length),
    key: (on: El, key: string) => doc.fire("keydown", on, { key }),
    pointer: (type: string, on: El, clientY: number) =>
      doc.fire(type, on, { clientY, pointerId: 7, button: 0 }),
  };
}

describe("the keyboard's hold", () => {
  test("space takes the row, says so and marks it; the arrows move it; space puts it down", async () => {
    const page = await listPage(["one", "two", "three"]);
    const grip = page.grip(2);
    grip.focus();
    expect(page.key(grip, " ").prevented).toBe(true);
    expect([
      page.row(2).classList.contains("is-grabbed"),
      grip.getAttribute("aria-pressed"),
    ]).toEqual([true, "true"]);
    expect(page.live.textContent).toBe(page.said("grabbed", 3));
    expect(page.key(grip, "ArrowUp").prevented).toBe(true);
    expect([page.text(), page.live.textContent]).toEqual([
      ["one", "three", "two"],
      page.said("moved", 2),
    ]);
    page.key(grip, " ");
    expect(page.changes).toEqual([page.said("dropped", 2)]);
    expect([
      page.row(1).classList.contains("is-grabbed"),
      grip.hasAttribute("aria-pressed"),
    ]).toEqual([false, false]);
  });

  test("Enter takes it too, and a drop that moved nothing is no edit", async () => {
    const page = await listPage(["one", "two"]);
    const grip = page.grip(0);
    page.key(grip, "Enter");
    expect(page.live.textContent).toBe(page.said("grabbed", 1));
    page.key(grip, "Enter");
    expect(page.changes).toEqual([]);
  });

  test("an end of the list moves nowhere, and says nothing new", async () => {
    const page = await listPage(["one", "two"]);
    const grip = page.grip(1);
    page.key(grip, " ");
    page.key(grip, "ArrowDown");
    expect([page.text(), page.live.textContent]).toEqual([["one", "two"], page.said("grabbed", 2)]);
    const first = page.grip(0);
    page.key(grip, " ");
    page.key(first, " ");
    page.key(first, "ArrowUp");
    expect([page.text(), page.live.textContent]).toEqual([["one", "two"], page.said("grabbed", 1)]);
  });

  test("a key that is not a move, held or not, is left alone", async () => {
    const page = await listPage(["one", "two"]);
    const grip = page.grip(0);
    expect(page.key(grip, "Escape").prevented).toBe(false);
    page.key(grip, " ");
    expect(page.key(grip, "ArrowLeft").prevented).toBe(false);
    expect(page.text()).toEqual(["one", "two"]);
  });

  test("Escape puts it back where it was, with the keyboard on its grip, and says so", async () => {
    const page = await listPage(["one", "two", "three"], { blurOnMove: true });
    const grip = page.grip(0);
    grip.focus();
    page.key(grip, " ");
    page.key(grip, "ArrowDown");
    expect(page.doc.activeElement).toBe(grip);
    expect(page.key(grip, "Escape").prevented).toBe(true);
    expect([page.text(), page.doc.activeElement, page.live.textContent]).toEqual([
      ["one", "two", "three"],
      grip,
      page.said("returned", 1),
    ]);
  });

  test("a single row's grip takes nothing, and keeps its keys", async () => {
    const page = await listPage(["only"]);
    expect(page.key(page.grip(0), " ").prevented).toBe(false);
    expect(page.row(0).classList.contains("is-grabbed")).toBe(false);
  });
});

describe("where the keyboard's hold ends without a key", () => {
  test("leaving the grip puts the row down where it is", async () => {
    const page = await listPage(["one", "two", "three"]);
    const grip = page.grip(2);
    grip.focus();
    page.key(grip, " ");
    page.key(grip, "ArrowUp");
    grip.blur();
    page.doc.fire("focusout", grip);
    expect(page.changes).toEqual([page.said("dropped", 2)]);
    expect(() => page.doc.fire("focusout", grip)).not.toThrow();
  });

  test("leaving the grip before any move puts the row down too", async () => {
    const page = await listPage(["one", "two"]);
    const grip = page.grip(0);
    grip.focus();
    page.key(grip, " ");
    grip.blur();
    page.doc.fire("focusout", grip);
    expect([grip.hasAttribute("aria-pressed"), page.live.textContent]).toEqual([
      false,
      page.said("dropped", 1),
    ]);
  });

  test("the blur a move causes is not the person leaving", async () => {
    const page = await listPage(["one", "two", "three"], { blurOnMove: true });
    const grip = page.grip(0);
    grip.focus();
    page.key(grip, " ");
    page.key(grip, "ArrowDown");
    page.key(grip, "ArrowDown");
    expect(page.text()).toEqual(["two", "three", "one"]);
    expect(page.changes).toEqual([]);
  });

  test("a blur of something else, or while a pointer holds it, drops nothing", async () => {
    const page = await listPage(["one", "two", "three"]);
    page.key(page.grip(0), " ");
    page.doc.fire("focusout", page.row(1).querySelector("input") as El);
    expect(page.grip(0).getAttribute("aria-pressed")).toBe("true");
    const other = await listPage(["one", "two"]);
    other.pointer("pointerdown", other.grip(0), 110);
    other.doc.fire("focusout", other.grip(0));
    expect(other.grip(0).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the pointer's drag", () => {
  test("down on a grip takes the row and captures the pointer; up puts it where it appears", async () => {
    const page = await listPage(["one", "two", "three"]);
    const grip = page.grip(0);
    const captured: string[] = [];
    Object.assign(grip, {
      setPointerCapture: (id: number) => void captured.push(`set ${id}`),
      releasePointerCapture: (id: number) => void captured.push(`release ${id}`),
    });
    expect(page.pointer("pointerdown", grip, 110).prevented).toBe(true);
    expect([page.field.classList.contains("is-dragging"), page.live.textContent]).toEqual([
      true,
      "",
    ]);
    page.pointer("pointermove", grip, 110 + PITCH + 5);
    page.pointer("pointerup", grip, 110 + PITCH + 5);
    expect([page.text(), captured, page.live.textContent]).toEqual([
      ["two", "one", "three"],
      ["set 7", "release 7"],
      "",
    ]);
    expect(page.changes).toEqual([""]);
  });

  test("a row dragged exactly one row's height has not yet passed its neighbour", async () => {
    const page = await listPage(["one", "two", "three"]);
    page.pointer("pointerdown", page.grip(0), 110);
    page.pointer("pointermove", page.grip(0), 110 + PITCH);
    page.pointer("pointerup", page.grip(0), 110 + PITCH);
    expect(page.text()).toEqual(["one", "two", "three"]);
  });

  test("a cancelled pointer ends the drag the way letting go does", async () => {
    const page = await listPage(["one", "two", "three"]);
    page.pointer("pointerdown", page.grip(0), 110);
    page.pointer("pointermove", page.grip(0), 110 + 2 * PITCH + 5);
    page.pointer("pointercancel", page.grip(0), 110 + 2 * PITCH + 5);
    expect([page.text(), page.row(0).style.translate || "at rest"]).toEqual([
      ["two", "three", "one"],
      "at rest",
    ]);
  });

  test("a press anywhere but a grip takes nothing, and a keyboard hold ignores the pointer", async () => {
    const page = await listPage(["one", "two"]);
    const input = page.row(0).querySelector("input") as El;
    expect(page.pointer("pointerdown", input, 110).prevented).toBe(false);
    page.key(page.grip(0), " ");
    expect(() => page.pointer("pointermove", page.grip(0), 150)).not.toThrow();
    expect(() => page.pointer("pointerup", page.grip(0), 150)).not.toThrow();
    expect(page.grip(0).getAttribute("aria-pressed")).toBe("true");
  });

  test("a pointer let go after the hold was put back by Escape says the row was put back", async () => {
    const page = await listPage(["one", "two", "three"]);
    const grip = page.grip(0);
    page.pointer("pointerdown", grip, 110);
    page.key(grip, "Escape");
    expect(page.live.textContent).toBe(page.said("returned", 1));
  });
});

describe("reaching for a second row", () => {
  test("puts the first down where it was moved to, saying so", async () => {
    const page = await listPage(["one", "two", "three"]);
    page.key(page.grip(0), " ");
    page.key(page.grip(0), "ArrowDown");
    page.key(page.grip(2), " ");
    expect(page.changes).toEqual([page.said("dropped", 2)]);
    expect(page.grip(2).getAttribute("aria-pressed")).toBe("true");
  });

  test("the same grip reached again by the pointer is the hold already standing", async () => {
    const page = await listPage(["one", "two", "three"]);
    const grip = page.grip(0);
    page.key(grip, " ");
    page.key(grip, "ArrowDown");
    page.pointer("pointerdown", grip, 130);
    expect(page.changes).toEqual([]);
    page.key(grip, " ");
    expect(page.changes).toHaveLength(1);
  });

  test("in another field, the first is let go silently, drag and all", async () => {
    const first = await listPage(["one", "two", "three"]);
    const doc = first.doc;
    const second = parseHtml(editFormFor("repeatable", { tags: ["a", "b"] }), new El("div"));
    doc.append(second);
    first.pointer("pointerdown", first.grip(0), 110);
    first.pointer("pointermove", first.grip(0), 150);
    first.key(second.querySelector("[data-list-field-grip]") as El, " ");
    expect([first.live.textContent, first.changes]).toEqual(["", []]);
    expect([
      first.row(0).classList.contains("is-grabbed"),
      first.grip(0).hasAttribute("aria-pressed"),
      first.field.classList.contains("is-dragging"),
      first.row(0).style.translate || "at rest",
    ]).toEqual([false, false, false, "at rest"]);
  });
});

describe("a held row taken out from under its gesture", () => {
  test("a move, or a drop, of a row no longer in the list lets go of it silently", async () => {
    for (const end of ["ArrowUp", " "]) {
      const page = await listPage(["one", "two", "three"]);
      const grip = page.grip(1);
      page.key(grip, " ");
      const standing = page.live.textContent;
      page.row(1).remove();
      page.rows.keyListRow({ target: grip, key: end, preventDefault: () => {} } as never);
      expect([grip.hasAttribute("aria-pressed"), page.changes, page.live.textContent]).toEqual([
        false,
        [],
        standing,
      ]);
    }
  });
});

describe("adding and removing rows", () => {
  test("Add copies a row's shape, not its value or its hold, and names every row again", async () => {
    const page = await listPage(["only"]);
    expect(page.grip(0).hasAttribute("disabled")).toBe(true);
    page.doc.fire("click", page.field.querySelector("[data-list-field-add]") as El);
    const fresh = page.row(1);
    const expected = parseHtml(editFormFor("repeatable", { tags: ["only", ""] }), new El("div"));
    const labels = (root: El) =>
      root
        .querySelectorAll("[data-list-field-remove], [data-list-field-grip]")
        .map((one) => one.getAttribute("aria-label"));
    expect(fresh.querySelector("input")?.value).toBe("");
    expect(page.doc.activeElement).toBe(fresh.querySelector("input") as El);
    expect(labels(page.field)).toEqual(labels(expected));
    expect(page.grip(0).hasAttribute("disabled")).toBe(false);
  });

  test("a row added while another is held is not held itself", async () => {
    const page = await listPage(["one", "two"]);
    page.key(page.grip(0), " ");
    page.doc.fire("click", page.field.querySelector("[data-list-field-add]") as El);
    expect(page.row(2).classList.contains("is-grabbed")).toBe(false);
  });

  test("removing the last row lands on the new last, and every row is named again", async () => {
    const page = await listPage(["one", "two", "three"]);
    page.doc.fire("click", page.row(2).querySelector("[data-list-field-remove]") as El);
    const expected = parseHtml(editFormFor("repeatable", { tags: ["one", "two"] }), new El("div"));
    const labels = (root: El) =>
      root
        .querySelectorAll("[data-list-field-remove]")
        .map((one) => one.getAttribute("aria-label"));
    expect(page.doc.activeElement).toBe(page.row(1).querySelector("input") as El);
    expect(labels(page.field)).toEqual(labels(expected));
  });

  test("removing the first row names every row after it again", async () => {
    const page = await listPage(["one", "two", "three"]);
    page.doc.fire("click", page.row(0).querySelector("[data-list-field-remove]") as El);
    const expected = parseHtml(
      editFormFor("repeatable", { tags: ["two", "three"] }),
      new El("div"),
    );
    const labels = (root: El) =>
      root
        .querySelectorAll("[data-list-field-remove], [data-list-field-grip], input[type=text]")
        .map((one) => one.getAttribute("aria-label"));
    expect(labels(page.field)).toEqual(labels(expected));
    expect(page.doc.activeElement).toBe(page.row(0).querySelector("input") as El);
  });

  test("removing the held row puts it back first; removing another leaves the hold as it is", async () => {
    const page = await listPage(["one", "two", "three"]);
    page.key(page.grip(0), " ");
    page.key(page.grip(0), "ArrowDown");
    page.doc.fire("click", page.row(2).querySelector("[data-list-field-remove]") as El);
    expect([page.text(), page.grip(1).getAttribute("aria-pressed")]).toEqual([
      ["two", "one"],
      "true",
    ]);
    page.doc.fire("click", page.row(1).querySelector("[data-list-field-remove]") as El);
    expect(page.live.textContent).toBe(
      page.rows.reorderSentence(
        "returned",
        page.field.getAttribute("data-list-field-label") as string,
        1,
        2,
      ),
    );
  });
});
