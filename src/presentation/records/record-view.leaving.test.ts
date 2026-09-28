// The edges of opening and leaving a record, run through the real `public/record-view.js` on the
// markup the server renders: a desk missing a piece the swap needs does nothing rather than half
// of something, and focus goes back only while nobody else has claimed it.

import { afterEach, describe, expect, test } from "bun:test";

import { Doc, type El, parseHtml } from "../controls/choice-picker.test-support.ts";
import { capabilityRecordsRegionId } from "../fields/field-renderer.ts";
import { named } from "./collection-page.test-support.ts";
import { itemElementIdForTemplate, renderCollection, renderItemWrapper } from "./list-container.ts";
import {
  CAPABILITY,
  RECORD,
  recordDesk,
  standingWindow,
  TEMPLATE_ID,
} from "./record-view.test-support.ts";
import { RECORD_VIEW_ATTR, renderRecordViewTemplate } from "./record-view.ts";

const ITEMS =
  renderItemWrapper(`<span>${RECORD.text}</span>`, RECORD, { templateId: TEMPLATE_ID }) +
  renderRecordViewTemplate(TEMPLATE_ID, CAPABILITY, RECORD);

type Desk = Awaited<ReturnType<typeof recordDesk>>;
let desk: Desk;
afterEach(() => desk.restore());

async function stand(
  collection = renderCollection({ capability: CAPABILITY, items: ITEMS }),
  answer?: () => Promise<unknown>,
) {
  desk = await recordDesk(collection, { capabilityId: CAPABILITY.id, answer });
  return desk;
}

const item = () => desk.doc.getElementById(itemElementIdForTemplate(TEMPLATE_ID)) as El;
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
    const items =
      renderItemWrapper("<span>x</span>", RECORD, { templateId: TEMPLATE_ID }) +
      renderRecordViewTemplate(TEMPLATE_ID, inactive, RECORD);
    await stand(renderCollection({ capability: inactive, items }));
    expect(await open()).not.toBeNull();
    expect(desk.doc.activeElement).toBe(desk.doc.body);
  });

  test("an item standing outside any collection opens nothing", async () => {
    await stand();
    const loose = item();
    desk.region.append(loose);
    desk.press(loose);
    await desk.settled();
    expect(view()).toBeNull();
    expect(loose.isConnected).toBe(true);
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
    expect(desk.doc.activeElement.id).toBe(itemElementIdForTemplate(TEMPLATE_ID));
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
