import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  active,
  gripOf,
  installDom,
  labelsOf,
  layOut,
  listField,
  middleOf,
  type Node,
  removeDom,
  rowsOf,
  saidBy,
  stuckRows,
  textOf,
  tookFocusAway,
} from "./list-field.test-support.ts";

// Moving a row, by the two gestures that move it.
//
// A suite of its own because reordering is its own subject: the rest of `list-field.test.ts`
// is about what a row *is* and what the server writes, and this is about what happens while
// one is in somebody's hand. The two paths are deliberately written side by side here, so a
// difference between dragging a row and typing it into place shows up as a failure rather
// than as a bug report.

beforeAll(installDom);
afterAll(removeDom);

/**
 * The order a row sits in is part of the field's value, so a person has to be able to change
 * it — by dragging, which is what people already know, and without dragging, which is the
 * only way that works for a keyboard.
 *
 * Both drive the same movement, and these tests are deliberately written against both so a
 * difference between them shows up as a failure rather than as a bug report.
 */
/** A pointer pressing and moving, and a key pressed — the two ways a row is taken hold of. */
const pointer = (target: Node | null | undefined, y = 0) => ({
  target,
  clientY: y,
  pointerId: 1,
  preventDefault: () => {},
});
const key = (target: Node | null | undefined, name: string) => ({
  target,
  key: name,
  preventDefault: () => {},
});

describe("reordering a row", () => {
  /** Where each row is drawn, relative to where it rests: the whole of what a drag shows. */
  const drawnAt = (field: Node) => rowsOf(field).map((row) => row.style.transform || "at rest");

  test("the dragged row follows the pointer and the others open a gap for it", async () => {
    // The point of a drag is that you can see the thing move. Nothing in the document
    // changes places while the finger is down: the row in hand is translated to wherever
    // the pointer is, and the rows it passes are translated by whole slots to get out of
    // its way — so the list a person sees is transforms over a list that has not moved.
    const { dragListRow, startListDrag, syncListRows } = await import("#design/list-rows.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    layOut(field);
    const grip = gripOf(rowsOf(field)[0]);

    startListDrag(pointer(grip, middleOf(0)) as never);
    // Nothing is drawn anywhere new until the pointer has actually gone somewhere.
    expect(drawnAt(field)).toEqual(["at rest", "at rest", "at rest"]);

    // Half a row down is not yet past anybody: the row has moved and nothing else has.
    dragListRow(pointer(undefined, middleOf(0) + 10) as never);
    expect(drawnAt(field)).toEqual(["translateY(10px)", "at rest", "at rest"]);
    expect(textOf(field)).toEqual(["one", "two", "three"]);

    // Past the second row's centre: it comes up to fill the gap, and the row in hand keeps
    // tracking the pointer rather than snapping into a slot.
    dragListRow(pointer(undefined, middleOf(0) + 24) as never);
    expect(drawnAt(field)).toEqual(["translateY(24px)", "translateY(-20px)", "at rest"]);

    // Past the third as well, and both come up.
    dragListRow(pointer(undefined, middleOf(0) + 45) as never);
    expect(drawnAt(field)).toEqual(["translateY(45px)", "translateY(-20px)", "translateY(-20px)"]);
    // Still not moved: the order is the same as it was when the finger went down.
    expect(textOf(field)).toEqual(["one", "two", "three"]);
  });

  test("letting go commits the one move, and takes every transform back off", async () => {
    const { dragListRow, endListDrag, startListDrag, syncListRows } = await import(
      "#design/list-rows.js"
    );
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    layOut(field);
    const grip = gripOf(rowsOf(field)[0]);

    startListDrag(pointer(grip, middleOf(0)) as never);
    expect(field.classList.contains("is-dragging")).toBe(true);
    expect((rowsOf(field)[0] as Node).classList.contains("is-grabbed")).toBe(true);

    dragListRow(pointer(undefined, middleOf(0) + 45) as never);
    endListDrag(pointer(undefined) as never);

    // The row is drawn in its landing slot already, so the DOM move is the frame in which
    // nothing appears to happen — which is the point of doing it last.
    expect(textOf(field)).toEqual(["two", "three", "one"]);
    expect(drawnAt(field)).toEqual(["at rest", "at rest", "at rest"]);
    expect(field.classList.contains("is-dragging")).toBe(false);
    expect(rowsOf(field).some((row) => row.classList.contains("is-grabbed"))).toBe(false);
    expect(labelsOf(field)).toEqual(["Tags 1", "Tags 2", "Tags 3"]);
  });

  test("dragging back up puts it in front of a row rather than behind it", async () => {
    const { dragListRow, endListDrag, startListDrag, syncListRows } = await import(
      "#design/list-rows.js"
    );
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    layOut(field);

    startListDrag(pointer(gripOf(rowsOf(field)[2]), middleOf(2)) as never);
    dragListRow(pointer(undefined, middleOf(2) - 45) as never);
    // Both rows it has passed move down to make room at the top.
    expect(drawnAt(field)).toEqual(["translateY(20px)", "translateY(20px)", "translateY(-45px)"]);
    endListDrag(pointer(undefined) as never);

    expect(textOf(field)).toEqual(["three", "one", "two"]);
  });

  test("a drag that lands where it started is not an edit", async () => {
    const { endListDrag, startListDrag, syncListRows } = await import("#design/list-rows.js");
    const { field } = listField("one", "two");
    syncListRows(field);
    layOut(field);

    startListDrag(pointer(gripOf(rowsOf(field)[0]), middleOf(0)) as never);
    endListDrag(pointer(undefined) as never);

    // Nothing moved, so nothing changed — and a field marked invalid keeps its sentence
    // rather than having it cleared by a gesture that did nothing.
    expect(field.heard).toEqual([]);
  });
});

/**
 * The other half of the same movement, and the reason a drag is not enough on its own.
 */
describe("reordering a row without a drag", () => {
  test("space takes the row, the arrows move it, and space puts it down", async () => {
    const { keyListRow, syncListRows } = await import("#design/list-rows.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    const grip = gripOf(rowsOf(field)[2]);

    keyListRow(key(grip, " ") as never);
    expect(saidBy(field)).toBe(
      "Tags 3 of 3, grabbed. Use the arrow keys to move it, space to drop it, escape to put it back.",
    );

    keyListRow(key(grip, "ArrowUp") as never);
    expect(textOf(field)).toEqual(["one", "three", "two"]);
    expect(saidBy(field)).toBe("Tags 2 of 3.");

    keyListRow(key(grip, "ArrowUp") as never);
    expect(textOf(field)).toEqual(["three", "one", "two"]);

    // At the top there is nowhere further to go, and the row stays where it is.
    keyListRow(key(grip, "ArrowUp") as never);
    expect(textOf(field)).toEqual(["three", "one", "two"]);

    keyListRow(key(grip, " ") as never);
    expect(saidBy(field)).toBe("Tags 1 of 3, dropped.");
    expect(field.heard).toEqual(["input"]);
  });

  test("the grip keeps the focus across a move, which is what keeps the row in hand", async () => {
    // Moving a row takes it out of the document and puts it back, and that blurs whatever
    // inside it had focus — here, the very grip driving the move. Left alone, the first
    // arrow press would blur the grip, `focusout` would read that as the person leaving,
    // and the row would be dropped by the key that was meant to move it.
    const { blurListRow, keyListRow, syncListRows } = await import("#design/list-rows.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    const grip = gripOf(rowsOf(field)[0]) as Node;
    grip.focus();

    keyListRow(key(grip, " ") as never);
    keyListRow(key(grip, "ArrowDown") as never);
    // The move did take the focus away — the double blurs on removal exactly as a browser
    // does — and the grip took it straight back.
    expect(tookFocusAway()).toBe(true);
    expect(grip.focused).toBe(true);
    // A `focusout` arriving from that move is the move's own, so the row is still held.
    blurListRow({ target: grip } as never);
    keyListRow(key(grip, "ArrowDown") as never);
    expect(textOf(field)).toEqual(["two", "three", "one"]);
    expect(grip.focused).toBe(true);

    // Leaving for real still drops it, and leaves the grip where the person put them.
    active(null);
    blurListRow({ target: grip } as never);
    expect(saidBy(field)).toBe("Tags 3 of 3, dropped.");
    keyListRow(key(grip, "ArrowUp") as never);
    expect(textOf(field)).toEqual(["two", "three", "one"]);
  });

  test("escape puts the row back where it was picked up from", async () => {
    const { keyListRow, syncListRows } = await import("#design/list-rows.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    const grip = gripOf(rowsOf(field)[0]);

    keyListRow(key(grip, " ") as never);
    keyListRow(key(grip, "ArrowDown") as never);
    keyListRow(key(grip, "ArrowDown") as never);
    expect(textOf(field)).toEqual(["two", "three", "one"]);

    keyListRow(key(grip, "Escape") as never);

    expect(textOf(field)).toEqual(["one", "two", "three"]);
    expect(saidBy(field)).toBe("Tags 1 of 3, put back.");
    // Put back is not an edit, so the field is not told it changed.
    expect(field.heard).toEqual([]);
  });

  test("every way out of the mode is a way out", async () => {
    // A row nobody can put down is the one failure a grab mode has, so leaving by any route
    // has to drop it: tabbing away, clicking elsewhere, or removing the row outright.
    const { blurListRow, keyListRow, removeListRow, syncListRows } = await import(
      "#design/list-rows.js"
    );
    const { field } = listField("one", "two", "three");
    syncListRows(field);

    const first = gripOf(rowsOf(field)[0]);
    keyListRow(key(first, " ") as never);
    blurListRow({ target: first } as never);
    expect(saidBy(field)).toBe("Tags 1 of 3, dropped.");
    // Dropped means dropped: the arrows are the page's again.
    keyListRow(key(first, "ArrowDown") as never);
    expect(textOf(field)).toEqual(["one", "two", "three"]);

    keyListRow(key(gripOf(rowsOf(field)[1]), " ") as never);
    removeListRow(rowsOf(field)[1]?.querySelector("[data-list-field-remove]") as never);
    expect(textOf(field)).toEqual(["one", "three"]);
    keyListRow(key(gripOf(rowsOf(field)[0]), "ArrowDown") as never);
    expect(textOf(field)).toEqual(["one", "three"]);
  });
});

/**
 * What happens when a gesture is interrupted rather than finished — by another gesture, or
 * by the row it is holding being taken away.
 */
describe("a hold that is interrupted", () => {
  test("reaching for a second row puts the first one down", async () => {
    // Refusing the press instead would be the one thing a person cannot see: a grip that
    // answers nothing, because a row they may have forgotten they were holding is in hand.
    const { keyListRow, syncListRows } = await import("#design/list-rows.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    const first = gripOf(rowsOf(field)[0]) as Node;
    const third = gripOf(rowsOf(field)[2]) as Node;

    keyListRow(key(first, " ") as never);
    keyListRow(key(third, " ") as never);

    expect(first.getAttribute("aria-pressed")).toBe(null);
    expect(third.getAttribute("aria-pressed")).toBe("true");
    // And the arrows now move the second row rather than doing nothing.
    keyListRow(key(third, "ArrowUp") as never);
    expect(textOf(field)).toEqual(["one", "three", "two"]);
  });

  test("a row that has left the list is let go of rather than moved back into it", async () => {
    // A collapse or an htmx swap can take the held row away underneath the gesture. Moving
    // it then would re-insert a row that had been removed.
    const { keyListRow, syncListRows } = await import("#design/list-rows.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    const grip = gripOf(rowsOf(field)[1]) as Node;

    keyListRow(key(grip, " ") as never);
    const taken = rowsOf(field)[1] as Node;
    taken.remove();
    expect(textOf(field)).toEqual(["one", "three"]);

    keyListRow(key(grip, "ArrowDown") as never);
    keyListRow(key(grip, "ArrowUp") as never);
    expect(textOf(field)).toEqual(["one", "three"]);
    expect(rowsOf(field)).toHaveLength(2);
    // And the hold is gone, so the next row can be picked up.
    const next = gripOf(rowsOf(field)[1]) as Node;
    keyListRow(key(next, " ") as never);
    expect(next.getAttribute("aria-pressed")).toBe("true");
  });

  test("a list of one has nothing to reorder, and its grip says so", async () => {
    const { keyListRow, startListDrag, syncListRows } = await import("#design/list-rows.js");
    const { field } = listField("only");
    syncListRows(field);
    expect(stuckRows(field)).toEqual([true]);

    const grip = gripOf(rowsOf(field)[0]);
    keyListRow(key(grip, " ") as never);
    startListDrag(pointer(grip, 0) as never);
    expect(saidBy(field)).toBe("");
    expect((rowsOf(field)[0] as Node).classList.contains("is-grabbed")).toBe(false);
  });

  test("each grip says which row it holds, and every row is re-keyed where it lands", async () => {
    const { keyListRow, syncListRows } = await import("#design/list-rows.js");
    const { field } = listField("one", "two", "three");
    syncListRows(field);
    expect(rowsOf(field).map((row) => gripOf(row)?.getAttribute("aria-label"))).toEqual([
      "Reorder Tags 1 of 3",
      "Reorder Tags 2 of 3",
      "Reorder Tags 3 of 3",
    ]);

    const grip = gripOf(rowsOf(field)[2]);
    keyListRow(key(grip, " ") as never);
    keyListRow(key(grip, "ArrowUp") as never);

    expect(labelsOf(field)).toEqual(["Tags 1", "Tags 2", "Tags 3"]);
    expect(rowsOf(field).map((row) => row.querySelector("input")?.id)).toEqual([
      "cap-tasks-tags-1",
      "cap-tasks-tags-2",
      "cap-tasks-tags-3",
    ]);
    // The grip that moved is now the second row's, and says so.
    expect(gripOf(rowsOf(field)[1])).toBe(grip as never);
    expect(grip?.getAttribute("aria-label")).toBe("Reorder Tags 2 of 3");
  });
});
