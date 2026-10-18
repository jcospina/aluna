// A way out the desk holds rather than draws: a refusal on the way, a
// record a delete took, which nothing may leave standing, and changes typed while the way out was
// still reading, which it never draws over.

import { afterEach, describe, expect, test } from "bun:test";
import { backOutOfLeaving } from "#shell/desk/leaving-a-run.js";
import {
  UNSAVED_LEAVING_BACK_SELECTOR,
  UNSAVED_LEAVING_SELECTOR,
} from "#shell/desk/leaving-unsaved-changes.js";
import {
  INTERNAL_ERROR_FRAGMENT,
  READ_UNAVAILABLE_FRAGMENT,
} from "../../../../../runtime/router/wire/failure-responses.ts";
import { Doc, type El, parseHtml } from "../../../../controls/double/choice-picker.test-support.ts";
import { type WayBackDesk, wayBackDesk } from "./way-back.test-support.ts";

let desk: WayBackDesk | undefined;
afterEach(() => {
  backOutOfLeaving();
  desk?.restore();
  desk = undefined;
});

/** What a refusal's markup says, as the bar would say it. */
const sentenceOf = (markup: string) =>
  (parseHtml(markup, new Doc()).children[0] as El).textContent.trim();

/** The notes list, then its note, then the recipe listed on the note: three entries. */
async function recipeFromNote(framed = false) {
  desk = await wayBackDesk((places) => places.list("notes"), framed);
  await desk.pressOn(desk.card());
  await desk.pressOn(desk.listedCard());
  return desk;
}

describe("a refusal the server gives without the platform's markers", () => {
  test("is said on the bar, and the record stands", async () => {
    desk = await wayBackDesk((places) => places.list("notes"));
    const at = desk;
    await at.pressOn(at.card());
    at.broken.add(at.at.list("notes"));
    await at.pressOn(at.back());
    expect(at.said).toEqual([sentenceOf(INTERNAL_ERROR_FRAGMENT)]);
    expect(at.view()).not.toBeNull();
  });
});

describe("a record a confirmed delete took", () => {
  test("is read past a refusal on the way, and the next place is drawn", async () => {
    const at = await recipeFromNote();
    at.busy.add(at.at.record("notes"));
    at.commit("delete");
    await at.settled();
    expect(at.asked().slice(-2)).toEqual([at.at.record("notes"), at.at.list("notes")]);
    expect(at.said).toEqual([sentenceOf(READ_UNAVAILABLE_FRAGMENT)]);
    expect(at.view()).toBeNull();
  });

  test("with nothing it could return to drawn, the window goes rather than show it", async () => {
    desk = await wayBackDesk((places) => places.list("notes"));
    const at = desk;
    await at.pressOn(at.card());
    at.broken.add(at.at.list("notes"));
    at.commit("delete");
    await at.settled();
    expect(at.said).toEqual([sentenceOf(INTERNAL_ERROR_FRAGMENT)]);
    expect(at.putAway.asked).toBe(1);
  });
});

describe("changes typed while a way out is still reading", () => {
  const field = (at: WayBackDesk) =>
    at.view().querySelector('[name="text"]') as El & { value: string };

  test("after a save are kept: the way out draws nothing over them", async () => {
    const at = await recipeFromNote(true);
    at.reads.holding = true;
    at.commit("save");
    await at.settled();
    at.type("Typed after the save");
    at.reads.holding = false;
    await at.releaseAll();
    expect(field(at).value).toBe("Typed after the save");
    expect(at.tab.location.pathname).toBe(at.at.record("recipes"));
  });

  test("are kept when the person answers a press's question by keeping them", async () => {
    const at = await recipeFromNote(true);
    at.reads.holding = true;
    at.commit("save");
    await at.settled();
    at.type("Typed after the save");
    await at.pressOn(at.listedCard());
    expect(at.doc.querySelector(UNSAVED_LEAVING_SELECTOR)).not.toBeNull();
    await at.pressOn(at.doc.querySelector(UNSAVED_LEAVING_BACK_SELECTOR) as El);
    at.reads.holding = false;
    await at.releaseAll();
    expect(field(at).value).toBe("Typed after the save");
  });
});
