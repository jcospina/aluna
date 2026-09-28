// The collection running: its inline Alpine started on the markup the renderer writes, and a record
// opened by the real `public/record-view.js`. Split from `list-container.test.ts` by what it needs
// standing — a page, not a string.

import { afterEach, describe, expect, test } from "bun:test";

import { recordsRegionStatusMessage } from "#shell/records-region-status.js";
import { releaseRegionContent } from "#shell/region-scope.js";
import { RECORD_CREATED_EVENT } from "#shell/shell-dom.js";
import { until } from "../../platform/async.test-support.ts";

import { startAlpine } from "../controls/alpine.test-support.ts";
import type { El } from "../controls/choice-picker.test-support.ts";
import {
  SAMPLE as FORM_SAMPLE,
  oneField,
  probeField,
} from "../fields/field-renderer.test-support.ts";
import type { RenderableCapability } from "../fields/field-renderer.ts";
import { bound, collectionPage, inOrder, named, shown } from "./collection-page.test-support.ts";
import {
  ITEM_TRIGGER_CLASS,
  itemElementIdForTemplate,
  renderCollection,
  renderItemWrapper,
} from "./list-container.ts";
import { recordDesk } from "./record-view.test-support.ts";
import { renderRecordViewTemplate } from "./record-view.ts";

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

// A record opens by the real `public/record-view.js`, started on the collection the server renders:
// the wrapper's class, its open hook and the template it names all have to agree for this to swap.
describe("a record opens in the collection's place", () => {
  const RECORD = { id: "task-7", created_at: "2026-08-27T00:00:00.000Z", title: "Buy oat milk" };
  const templateId = "record-tasks-task-7";
  const openable = renderCollection({
    capability: SAMPLE,
    items:
      renderItemWrapper("<span>Buy oat milk</span>", RECORD, { templateId }) +
      renderRecordViewTemplate(templateId, SAMPLE, RECORD),
  });
  let desk: Awaited<ReturnType<typeof recordDesk>>;
  afterEach(() => desk.restore());

  test("pressing the record swaps its form in and puts the keyboard on the first field", async () => {
    desk = await recordDesk(openable);
    const item = desk.doc.getElementById(itemElementIdForTemplate(templateId)) as El;
    desk.press(item.children[0] as El);
    const form = named(desk.doc, "form", `Edit ${SAMPLE.label}`);
    expect(item.isConnected).toBe(false);
    expect(desk.doc.querySelector(`[aria-label="${SAMPLE.label}"]`)).toBeNull();
    expect(desk.asked.processed).toHaveLength(1);
    expect(desk.asked.processed[0]?.contains(form)).toBe(true);
    await desk.settled();
    expect(desk.doc.activeElement).toBe(form.querySelector('input[name="title"]') as El);
    expect(desk.doc.activeElement.value).toBe(RECORD.title);
    // Visibly: the press that opened the record was a click, which rings nothing by itself.
    expect(desk.doc.activeElement.focusOptions).toEqual({ focusVisible: true });
  });

  test("the record is a real button: it holds no key handling of its own", async () => {
    // Enter and Space already activate a button, so the module answers the click and no key.
    desk = await recordDesk(openable);
    const item = desk.doc.getElementById(itemElementIdForTemplate(templateId)) as El;
    for (const key of ["Enter", " "]) desk.doc.fire("keydown", item, { key });
    expect(item.isConnected).toBe(true);
  });

  test("a card with nothing to open opens nothing", async () => {
    desk = await recordDesk(
      renderCollection({ capability: SAMPLE, items: renderItemWrapper("<span>x</span>", RECORD) }),
    );
    const card = desk.doc.querySelector(`.${ITEM_TRIGGER_CLASS}`) as El;
    desk.press(card);
    expect(card.isConnected).toBe(true);
    expect(desk.asked.processed).toHaveLength(0);
  });
});

// The close a committed create asks for, sent by the real `public/record-mutations.js`: the form
// listens for it on the window, so a created event that does not climb closes nothing.
describe("a create the server committed closes the form it came from", () => {
  test("the saved form goes away and New has the keyboard again", async () => {
    const desk = await recordDesk(renderCollection({ capability: SAMPLE }), {
      capabilityId: SAMPLE.id,
      modules: ["record-mutations.js"],
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

// The search chrome's hooks, pressed through the real `public/search-chrome.js`: a renamed hook
// leaves Clear hidden forever, or the no-match sentence with nowhere to be said.
describe("the search chrome, running on the collection the server renders", () => {
  test("typing shows Clear, a search that finds nothing says so, and Clear goes back", async () => {
    const desk = await recordDesk(renderCollection({ capability: SAMPLE }), {
      capabilityId: SAMPLE.id,
      modules: ["search-chrome.js"],
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
