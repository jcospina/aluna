// Where a record's Back goes on a desk and what it says: the entry before as this page saw it,
// named by a record's title or by a list's logo label, and the record's own list where the page
// saw none. The visible Back and the browser's land on one entry.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { OPENER, RecordOpener } from "#shell/controls/open/open-linked-record.js";
import { Doc, type El, parseHtml } from "../../../../controls/double/choice-picker.test-support.ts";
import { CAPABILITY } from "../../../../records/record-view/record-view.test-support.ts";
import { recordItemId, recordTitle } from "../../../../records/record-view/record-view.ts";
import { type WayBackDesk, wayBackDesk } from "./way-back.test-support.ts";

let desk: WayBackDesk | undefined;
afterEach(() => {
  desk?.restore();
  desk = undefined;
});

async function stand(...args: Parameters<typeof wayBackDesk>) {
  desk = await wayBackDesk(...args);
  return desk;
}

const titleOf = (at: WayBackDesk, id: "notes" | "recipes") =>
  recordTitle(CAPABILITY, at.stored[id]);
const onFirstField = (at: WayBackDesk) =>
  at.doc.activeElement === at.view().querySelector('[name="text"]');

/** The notes list, then its note, then the recipe listed on the note: three entries. */
async function recipeFromNote() {
  const at = await stand((places) => places.list("notes"));
  await at.pressOn(at.card());
  await at.pressOn(at.listedCard());
  return at;
}

describe("Back names the place the record was opened from, and returns there", () => {
  test("a record opened by a listed card names that record, and steps back onto it", async () => {
    const at = await recipeFromNote();
    const { list, record } = at.at;
    expect(at.names()).toEqual([titleOf(at, "notes"), true]);
    await at.pressOn(at.back());
    // Drawn fresh from the record's address, then the bar steps back onto its entry.
    expect(at.asked().at(-1)).toBe(record("notes"));
    expect(at.tab.pending()).toEqual([-1]);
    await at.tab.arrived();
    expect([at.tab.at(), at.tab.entries()]).toEqual([
      1,
      [list("notes"), record("notes"), record("recipes")],
    ]);
    expect(at.names()).toEqual([at.labels.notes, true]);
    expect(onFirstField(at)).toBe(true);
    // And on to the list, where the keyboard lands on the card of the record just left.
    await at.pressOn(at.back());
    expect(at.asked().at(-1)).toBe(list("notes"));
    await at.tab.arrived();
    expect(at.tab.at()).toBe(0);
    expect(at.doc.activeElement.id).toBe(recordItemId("notes", at.stored.notes.id));
  });

  test("a record opened by the open icon in a linked field names that record too", async () => {
    const at = await stand((places) => places.list("notes"));
    await at.pressOn(at.card());
    const [icon] = parseHtml(OPENER, new Doc()).children as El[];
    at.view()
      .querySelector("form")
      ?.append(icon as El);
    const opener = new RecordOpener(icon as never, new AbortController().signal, {
      pressed: () => {},
      gone: () => {},
    });
    opener.point({ capability: "recipes", record: at.stored.recipes.id, name: "Fig jam" });
    await at.pressOn(icon as El);
    expect(at.tab.location.pathname).toBe(at.at.record("recipes"));
    expect(at.names()).toEqual([titleOf(at, "notes"), true]);
    await at.pressOn(at.back());
    expect(at.asked().at(-1)).toBe(at.at.record("notes"));
    expect(at.tab.pending()).toEqual([-1]);
  });

  test("the browser's Back from the same record lands on the same entry", async () => {
    const at = await recipeFromNote();
    await at.tab.travel(-1);
    expect([at.tab.at(), at.tab.location.pathname]).toEqual([1, at.at.record("notes")]);
    expect(at.names()).toEqual([at.labels.notes, true]);
  });

  test("a record opened from a name in an answer over a list names that list", async () => {
    const at = await stand((places) => places.list("recipes"));
    await at.answerLink("notes", at.stored.notes.id);
    expect(at.names()).toEqual([at.labels.recipes, true]);
    await at.pressOn(at.back());
    expect(at.asked().at(-1)).toBe(at.at.list("recipes"));
    await at.tab.arrived();
    expect([at.tab.at(), at.tab.entries()]).toEqual([
      0,
      [at.at.list("recipes"), at.at.record("notes")],
    ]);
    // The note has no card in Recipes, so the keyboard starts that list instead.
    expect(at.doc.activeElement).toBe(at.region.querySelector(".capability-collection__new") as El);
  });

  test("a record opened from a name in an answer over a record names that record", async () => {
    const at = await stand((places) => places.list("notes"));
    await at.pressOn(at.card());
    await at.answerLink("recipes", at.stored.recipes.id);
    expect(at.names()).toEqual([titleOf(at, "notes"), true]);
    await at.pressOn(at.back());
    expect(at.asked().at(-1)).toBe(at.at.record("notes"));
    await at.tab.arrived();
    expect(at.tab.at()).toBe(1);
  });

  test("after a pasted address or a reload, Back names its own list and replaces", async () => {
    const at = await stand((places) => places.record("notes"));
    expect(at.names()).toEqual([at.labels.notes, true]);
    await at.pressOn(at.back());
    expect(at.asked()).toEqual([at.at.list("notes")]);
    expect(at.tab.pending()).toEqual([]);
    expect(at.tab.entries()).toEqual([at.at.list("notes")]);
  });

  test("a list is named by its logo's label as it stands, renamed or not", async () => {
    const at = await stand((places) => places.list("notes"));
    await at.pressOn(at.card());
    expect(at.names()).toEqual([CAPABILITY.label, true]);
    // Renamed while the note stands: the logo's swap has the desk follow the window again.
    at.labels.notes = `Jottings ${randomUUID()}`;
    at.follow();
    expect(at.names()).toEqual([at.labels.notes, true]);
    // And drawn fresh after a trip away, it names the list by that label still.
    await at.pressOn(at.listedCard());
    await at.tab.travel(-1);
    expect(at.names()).toEqual([at.labels.notes, true]);
  });

  test("a record whose entry before was never shown names its own list", async () => {
    const at = await stand((places) => places.list("notes"));
    at.reads.holding = true;
    await at.pressOn(at.card());
    // A swap elsewhere while the note is on its way, and then another note asked for over it.
    at.follow();
    await at.answerLink("notes", randomUUID());
    await at.release();
    await at.release();
    expect(at.names()).toEqual([at.labels.notes, true]);
    at.reads.holding = false;
    await at.pressOn(at.back());
    expect(at.asked().at(-1)).toBe(at.at.list("notes"));
  });
});
