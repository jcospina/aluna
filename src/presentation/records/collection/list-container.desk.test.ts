// The collection running: its inline Alpine started on the markup the renderer writes, and a card
// pressed through the real `public/records/record-view.js`. Split from `list-container.test.ts` by what
// it needs standing — a page, not a string.

import { afterEach, describe, expect, test } from "bun:test";
import { releaseRegionContent } from "#shell/core/region-scope.js";
import { recordAddress } from "#shell/core/routes.js";
import { RECORD_CREATED_EVENT } from "#shell/core/shell-dom.js";
import { OPEN_THE_RECORD_EVENT } from "#shell/desk/desk-address.js";
import { recordsRegionStatusMessage } from "#shell/records/records-region-status.js";
import { until } from "../../../platform/async.test-support.ts";

import { startAlpine } from "../../controls/double/alpine.test-support.ts";
import type { El } from "../../controls/double/choice-picker.test-support.ts";
import {
  SAMPLE as FORM_SAMPLE,
  oneField,
  probeField,
} from "../../fields/field-renderer.test-support.ts";
import type { RenderableCapability } from "../../fields/field-renderer.ts";
import { answerPresses, recordDesk } from "../record-view/record-view.test-support.ts";
import { renderRecordView } from "../record-view/record-view.ts";
import { bound, collectionPage, inOrder, named, shown } from "./collection-page.test-support.ts";
import {
  ITEM_TRIGGER_CLASS,
  recordItemId,
  renderCollection,
  renderItemWrapper,
} from "./list-container.ts";

const SAMPLE: RenderableCapability = {
  ...FORM_SAMPLE,
  actions: ["create", "read", "update", "delete", "search"],
};

describe("the collection and its create form are two views of one surface", () => {
  test("the list shows first, and the create form is out of sight", async () => {
    const page = collectionPage(SAMPLE);
    expect(shown(page.region)).toBe(true);
    expect(shown(page.form)).toBe(false);
    expect(bound(page.newButton, "aria-expanded")).toBe("false");
  });

  test("New gives the whole window to the form and puts the keyboard on its first field", async () => {
    // A view swap that leaves focus on a control no longer on screen strands a keyboard user at
    // the top of the desk.
    const page = collectionPage(SAMPLE);
    page.press(page.newButton);
    await page.settled();
    expect(shown(page.form)).toBe(true);
    expect(shown(page.region)).toBe(false);
    expect(shown(page.doc.querySelector(".capability-empty") as El)).toBe(false);
    expect(bound(page.newButton, "aria-expanded")).toBe("true");
    expect(page.doc.activeElement).toBe(page.field("title"));
  });

  test("a form whose first field is a drawn picker lands the keyboard on the picker", async () => {
    const probe = oneField(probeField("choice"), "repeatable", "picker");
    const page = collectionPage(probe, renderCollection({ capability: probe }));
    page.press(page.newButton);
    await page.settled();
    expect(page.doc.activeElement?.getAttribute("role")).toBe("combobox");
  });

  test("a form whose first field is a segmented row lands on its first segment that can be pressed", async () => {
    // Neither drawn control is a form element, so a form of only these once opened onto no focus.
    const values = [
      { value: "off", label: "Off", disabled: true as const },
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ];
    const probe = oneField(probeField("choice", { values }), "repeatable", "segmented");
    const page = collectionPage(probe, renderCollection({ capability: probe }));
    page.press(page.newButton);
    await page.settled();
    expect(page.doc.activeElement?.tag).toBe("button");
    expect(page.doc.activeElement?.getAttribute("data-value")).toBe("low");
  });

  test("a create saved for this capability closes the form and returns focus to New", async () => {
    const page = collectionPage(SAMPLE);
    page.press(page.newButton);
    await page.settled();
    page.doc.fire(RECORD_CREATED_EVENT, page.form, { detail: { capabilityId: SAMPLE.id } });
    await page.settled();
    expect(shown(page.form)).toBe(false);
    expect(shown(page.region)).toBe(true);
    expect(page.doc.activeElement).toBe(page.newButton);
  });

  test("a create saved by another capability leaves this form as it was", async () => {
    const page = collectionPage(SAMPLE);
    page.press(page.newButton);
    await page.settled();
    page.doc.fire(RECORD_CREATED_EVENT, page.form, { detail: { capabilityId: "notes" } });
    await page.settled();
    expect(shown(page.form)).toBe(true);
    expect(page.doc.activeElement).toBe(page.field("title"));
  });

  test("Cancel is the same exit from the other end, and returns focus to New", async () => {
    const page = collectionPage(SAMPLE);
    page.press(page.newButton);
    await page.settled();
    page.press(named(page.form, "button", "Cancel"));
    await page.settled();
    expect(shown(page.form)).toBe(false);
    expect(page.doc.activeElement).toBe(page.newButton);
  });

  test("the back control above the form is a third way out, to the same place", async () => {
    // One surface, two ways in: the form arrives under the back control a record's does.
    const page = collectionPage(SAMPLE);
    const back = named(page.doc, "button", `Back to ${SAMPLE.label}`);
    const [backAt, formAt] = inOrder(page.doc, back, page.form);
    expect(backAt).toBeLessThan(formAt as number);
    page.press(page.newButton);
    await page.settled();
    expect(shown(back)).toBe(true);
    page.press(back);
    await page.settled();
    expect(shown(page.form)).toBe(false);
    expect(page.doc.activeElement).toBe(page.newButton);
  });
});

// A card is pressed through the real `public/records/record-view.js`, started on the collection the
// server renders: the wrapper's class and what it opens have to agree for the desk to be asked, and
// the record arrives from its record address, never from the card.
describe("a card press asks the desk for its record", () => {
  const RECORD = {
    id: "3e8b1f0c-5a2d-4c7e-9b64-1f0a7d2e5c83",
    created_at: "2026-08-27T00:00:00.000Z",
    title: "Buy oat milk",
  };
  const openable = renderCollection({
    capability: SAMPLE,
    items: renderItemWrapper("<span>Buy oat milk</span>", RECORD, { capabilityId: SAMPLE.id }),
  });
  let desk: Awaited<ReturnType<typeof recordDesk>>;
  afterEach(() => desk.restore());

  /** Every record the desk was asked to open, as each press asked. */
  function asks() {
    const asked: unknown[] = [];
    desk.doc.addEventListener(OPEN_THE_RECORD_EVENT, (event) => {
      asked.push({ ...(event as unknown as CustomEvent<object>).detail });
    });
    return asked;
  }

  test("a press inside a card asks for its own record, and the collection stays meanwhile", async () => {
    desk = await recordDesk(openable);
    const asked = asks();
    const item = desk.doc.getElementById(recordItemId(SAMPLE.id, RECORD.id)) as El;
    desk.press(item.children[0] as El);
    expect(asked).toEqual([{ capability: SAMPLE.id, record: RECORD.id }]);
    // Nothing is cloned and nothing is swapped: the window changes when the desk draws the address.
    expect(item.isConnected).toBe(true);
    expect(desk.doc.querySelector(`[aria-label="${SAMPLE.label}"]`)).not.toBeNull();
    expect(desk.asked.processed).toHaveLength(0);
    expect(desk.doc.querySelector("form[data-record-edit-form]")).toBeNull();
  });

  test("the desk answers with the record's form, drawn from the record's address", async () => {
    desk = await recordDesk(openable, { capabilityId: SAMPLE.id });
    const drawn = answerPresses(desk, () => renderRecordView(SAMPLE, RECORD));
    desk.press(desk.doc.getElementById(recordItemId(SAMPLE.id, RECORD.id)) as El);
    expect(drawn).toEqual([recordAddress(SAMPLE.id, RECORD.id)]);
    const form = named(desk.doc, "form", `Edit ${SAMPLE.label}`);
    expect(form.querySelector('input[name="title"]')?.value).toBe(RECORD.title);
    expect(desk.tab.entries().at(-1)).toBe(recordAddress(SAMPLE.id, RECORD.id));
  });

  test("the record is a real button: it holds no key handling of its own", async () => {
    // Enter and Space already activate a button, so the module answers the click and no key.
    desk = await recordDesk(openable);
    const asked = asks();
    const item = desk.doc.getElementById(recordItemId(SAMPLE.id, RECORD.id)) as El;
    for (const key of ["Enter", " "]) desk.doc.fire("keydown", item, { key });
    expect(asked).toEqual([]);
    expect(item.isConnected).toBe(true);
  });

  test("a card with nothing to open asks for nothing", async () => {
    desk = await recordDesk(
      renderCollection({ capability: SAMPLE, items: renderItemWrapper("<span>x</span>", RECORD) }),
    );
    const asked = asks();
    const card = desk.doc.querySelector(`.${ITEM_TRIGGER_CLASS}`) as El;
    desk.press(card);
    expect(asked).toEqual([]);
    expect(card.isConnected).toBe(true);
  });
});

// The close a committed create asks for, sent by the real `public/records/record-mutations.js`: the form
// listens for it on the window, so a created event that does not climb closes nothing.
describe("a create the server committed closes the form it came from", () => {
  test("the saved form goes away and New has the keyboard again", async () => {
    const desk = await recordDesk(renderCollection({ capability: SAMPLE }), {
      capabilityId: SAMPLE.id,
      modules: ["records/record-mutations.js"],
    });
    const globals = globalThis as { fetch: unknown };
    const fetched = globals.fetch;
    globals.fetch = () => Promise.resolve(new Response(""));
    try {
      startAlpine(desk.doc);
      const newButton = named(desk.doc, "button", `New ${SAMPLE.label}`);
      const form = named(desk.doc, "form", `Add to ${SAMPLE.label}`);
      desk.press(newButton);
      await desk.settled();
      expect(shown(form)).toBe(true);

      // htmx's own two events for the request, dispatched on the form and bubbling, as it sends them.
      for (const type of ["htmx:beforeRequest", "htmx:afterRequest"]) {
        const detail = { elt: form, successful: true, xhr: { status: 200 } };
        form.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
      }
      await desk.settled();
      await desk.settled();

      expect(shown(form)).toBe(false);
      expect(desk.doc.activeElement).toBe(newButton);
    } finally {
      globals.fetch = fetched;
      desk.restore();
    }
  });
});

// The search chrome's hooks, pressed through the real `public/records/search-chrome.js`: a renamed hook
// leaves Clear hidden forever, or the no-match sentence with nowhere to be said.
describe("the search chrome, running on the collection the server renders", () => {
  test("typing shows Clear, a search that finds nothing says so, and Clear goes back", async () => {
    const desk = await recordDesk(renderCollection({ capability: SAMPLE }), {
      capabilityId: SAMPLE.id,
      modules: ["records/search-chrome.js"],
    });
    const globals = globalThis as { fetch: unknown };
    const fetched = globals.fetch;
    globals.fetch = () => Promise.resolve(new Response(""));
    try {
      const search = desk.doc.querySelector('form[role="search"]') as El;
      const input = search.querySelector('input[type="search"]') as El;
      const clear = named(search, "button", "Clear");
      const feedback = desk.doc.querySelector(".capability-search__feedback") as El;
      input.value = "zzz";
      desk.doc.fire("input", input);
      expect(clear.hidden).toBe(false);

      desk.doc.fire("submit", search);
      const noMatch = recordsRegionStatusMessage("no-matches", "search");
      await until(() => feedback.textContent === noMatch);
      expect(feedback.getAttribute("aria-live")).toBe("polite");

      desk.press(clear);
      expect(input.value).toBe("");
      expect(clear.hidden).toBe(true);
    } finally {
      globals.fetch = fetched;
      releaseRegionContent(desk.region as never);
      desk.restore();
    }
  });
});
