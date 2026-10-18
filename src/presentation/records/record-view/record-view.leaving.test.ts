// The edges of opening and leaving a record, run through the real `public/records/record-view.js` on the
// markup the server renders: a desk missing a piece the way out needs does nothing rather than half
// of something, and focus goes back only while nobody else has claimed it.

import { afterEach, describe, expect, test } from "bun:test";
import { focusFirstField } from "#shell/core/shell-dom.js";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import { capabilityRecordsRegionId } from "../../fields/field-renderer.ts";
import { named } from "../collection/collection-page.test-support.ts";
import { renderCollection, renderItemWrapper } from "../collection/list-container.ts";
import {
  answerPresses,
  CAPABILITY,
  RECORD,
  recordDesk,
  standingWindow,
} from "./record-view.test-support.ts";
import { RECORD_VIEW_ATTR, recordItemId, renderRecordView } from "./record-view.ts";

const ITEMS = renderItemWrapper(`<span>${RECORD.text}</span>`, RECORD, {
  capabilityId: CAPABILITY.id,
});

type Desk = Awaited<ReturnType<typeof recordDesk>>;
let desk: Desk;
afterEach(() => desk.restore());

/** The notes window, a press on its card answered with the record as its record address draws it. */
async function stand(
  collection = renderCollection({ capability: CAPABILITY, items: ITEMS }),
  answer?: () => Promise<unknown>,
  capability = CAPABILITY,
) {
  desk = await recordDesk(collection, { capabilityId: CAPABILITY.id, answer });
  answerPresses(desk, () => renderRecordView(capability, RECORD));
  return desk;
}

const item = () => desk.doc.getElementById(recordItemId(CAPABILITY.id, RECORD.id)) as El;
const view = () => desk.doc.querySelector(`[${RECORD_VIEW_ATTR}]`) as El;
const back = () => named(view(), "button", `Back to ${CAPABILITY.label}`);
const land = (html: string) => {
  desk.region.replaceChildren(...parseHtml(html, new Doc()).children);
  return Promise.resolve();
};
const settle = (items: string) => {
  const records = desk.region.querySelector(`#${capabilityRecordsRegionId(CAPABILITY.id)}`) as El;
  records.replaceChildren(...parseHtml(items, new Doc()).children);
  desk.doc.fire("htmx:afterSettle", records);
};

async function open() {
  desk.press(item());
  await desk.settled();
  return view();
}

describe("opening a record on a desk missing a piece", () => {
  test("a record with no field to stand on opens with the keyboard left where it was", async () => {
    const inactive = {
      ...CAPABILITY,
      schema: { fields: CAPABILITY.schema.fields.filter((f) => f.lifecycle === "inactive") },
    };
    await stand(undefined, undefined, inactive);
    const opened = await open();
    expect(opened).not.toBeNull();
    // What the desk does once a record address lands (`focusLanded`), on a record with no field.
    focusFirstField(opened as never);
    expect(desk.doc.activeElement).toBe(desk.doc.body);
  });

  test("a card standing outside any collection still opens its own record", async () => {
    // A card listed on another record stands in no collection of its own.
    await stand();
    const loose = item();
    desk.region.append(loose);
    desk.press(loose);
    await desk.settled();
    expect(view()).not.toBeNull();
    expect(desk.tab.at()).toBe(1);
  });

  test("with no htmx on the page the record still opens", async () => {
    await stand();
    standingWindow().htmx = undefined;
    expect(await open()).not.toBeNull();
  });
});

describe("leaving a record on a desk missing a piece", () => {
  test("no capability standing, no region to read into, or no htmx: back does nothing", async () => {
    const breaks = [
      () =>
        desk.doc
          .querySelector("[data-active-capability-id]")
          ?.removeAttribute("data-active-capability-id"),
      () => desk.region.removeAttribute("data-content-region"),
      () => {
        standingWindow().htmx = undefined;
      },
    ];
    for (const broken of breaks) {
      await stand();
      await open();
      broken();
      expect(() => desk.press(back())).not.toThrow();
      expect(desk.asked.requests).toEqual([]);
      expect(view().isConnected).toBe(true);
      desk.restore();
    }
    await stand();
  });
});

describe("focus after leaving, only while nobody has claimed it", () => {
  test("focus claimed before the read came back is never taken, even once it is let go", async () => {
    await stand(undefined, async () => {
      await land(renderCollection({ capability: CAPABILITY, loadThroughRead: true }));
      (desk.region.querySelector('input[type="search"]') as El).focus();
    });
    await open();
    desk.press(back());
    await desk.settled();
    desk.doc.activeElement.blur();
    settle(ITEMS);
    expect(desk.doc.activeElement).toBe(desk.doc.body);
  });

  test("a record focused on arrival is not chased by a later settle once it is gone", async () => {
    await stand(undefined, () => land(renderCollection({ capability: CAPABILITY, items: ITEMS })));
    await open();
    desk.press(back());
    await desk.settled();
    expect(desk.doc.activeElement.id).toBe(recordItemId(CAPABILITY.id, RECORD.id));
    settle("");
    expect(desk.doc.activeElement).toBe(desk.doc.body);
  });

  test("an answer with no records region in it is left alone", async () => {
    await stand(undefined, () => land("<p>Something else took the window.</p>"));
    await open();
    expect(() => desk.press(back())).not.toThrow();
    await desk.settled();
    expect(desk.doc.activeElement).toBe(desk.doc.body);
  });
});
