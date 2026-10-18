// A card press, on the desk as the page starts it, with the real `public/records/record-view.js`
// started on it: the press takes the record address's own path, as a name pressed in an answer
// and the open icon do. The card is one listed on a Notes record, of Recipes, so the address it
// writes is its own capability's and never the window's.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { recordAddress } from "#shell/core/routes.js";
import { startedOn } from "../../../controls/double/started-module.test-support.ts";
import {
  DEFAULT_COLLECTION_LAYOUT,
  renderItemWrapper,
} from "../../../records/collection/list-container.ts";
import { renderLinkingSection } from "../../../records/linking/record-links.ts";
import { El } from "../desk-dom.test-support.ts";
import { deskNodes } from "../viewport-desk.test-support.ts";
import { deskAnswering, restoreDesk, settled } from "./record-address-desk.test-support.ts";

const SOURCE = randomUUID();
const TARGET = randomUUID();

/** The button class `record-view.js` asks a pressed control about, which the desk does not stand. */
const BUTTONS = {
  [Symbol.hasInstance]: (value: unknown) =>
    value instanceof El && value.tagName.toLowerCase() === "button",
};
const globals = globalThis as Record<string, unknown>;
afterEach(() => {
  Reflect.deleteProperty(globals, "HTMLButtonElement");
  restoreDesk();
});

/** The desk open on a Notes record, a Recipes record listed on it as Recipes draws its card. */
async function cardDesk(endings: readonly number[]) {
  const desk = await deskAnswering(recordAddress("notes", SOURCE), endings);
  Object.defineProperty(globals, "HTMLButtonElement", { value: BUTTONS, configurable: true });
  await startedOn("records/record-view.js", desk.desk.doc);
  const section = renderLinkingSection({
    capability: { id: "recipes", label: "Recipes" },
    layout: DEFAULT_COLLECTION_LAYOUT,
    field: "notes",
    count: 1,
    cards: renderItemWrapper(
      "<span>Fig jam</span>",
      { id: TARGET },
      {
        capabilityId: "recipes",
        listed: true,
      },
    ),
  });
  const view = () => desk.desk.windows()[0]?.querySelector("[data-record-view]") as El;
  view()
    .querySelector(".capability-record-view__body")
    ?.append(...deskNodes(section));
  const card = view().querySelector(".record-links .capability-item") as El;
  const press = async () => {
    card.click();
    await settled();
  };
  return { ...desk, view, card, press };
}

describe("a press on a card listed on a record", () => {
  test("writes its own record's address, asks for it, and retitles the window", async () => {
    const desk = await cardDesk([200, 200]);
    expect(desk.title()).toBe("Notes");
    await desk.press();
    expect(desk.written()).toEqual([`push ${recordAddress("recipes", TARGET)}`]);
    expect(desk.asked()).toEqual([
      recordAddress("notes", SOURCE),
      recordAddress("recipes", TARGET),
    ]);
    expect(desk.title()).toBe("Recipes");
    expect(desk.region().querySelector('[data-active-capability-id="recipes"]')).not.toBeNull();
    expect(desk.view()).not.toBeNull();
  });

  test("and Back returns to the record it was listed on", async () => {
    const desk = await cardDesk([200, 200, 200]);
    await desk.press();
    await desk.travelTo(recordAddress("notes", SOURCE));
    expect(desk.asked().at(-1)).toBe(recordAddress("notes", SOURCE));
    expect(desk.title()).toBe("Notes");
  });

  test("refused, is drawn as a refused record address is: what the window held stays", async () => {
    // A deletion under way closes the read gate, which a clone never passed and a press does.
    const desk = await cardDesk([200, 409]);
    await desk.press();
    expect(desk.asked()).toEqual([
      recordAddress("notes", SOURCE),
      recordAddress("recipes", TARGET),
    ]);
    expect(desk.desk.windows()).toHaveLength(1);
    expect(desk.title()).toBe("Notes");
    expect(desk.region().querySelector('[data-active-capability-id="notes"]')).not.toBeNull();
    expect(desk.view()?.contains(desk.card)).toBe(true);
    expect(desk.written().at(-1)).toBe(`replace ${recordAddress("notes", SOURCE)}`);
  });
});
