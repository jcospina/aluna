// A record opened on a real desk: the swap (`public/record-view.js`) and the mutation rules
// (`public/record-mutations.js`) started on the markup the server renders, and every way out of the
// record pressed the way a person presses it.

import { afterEach, describe, expect, test } from "bun:test";

import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/prompt-bar.js";
import { MUTATION_OUTCOME_UNKNOWN, UNCONFIRMED_ON_THE_DESK } from "#shell/record-mutations.js";
import { registerRegionRelease, releaseRegionContent } from "#shell/region-scope.js";
import { capabilityActionUrl, capabilityUrl } from "#shell/routes.js";
import { DELETING_RECORD_LABEL } from "../controls/busy-label.ts";
import { Doc, type El, parseHtml } from "../controls/choice-picker.test-support.ts";
import { capabilityRecordsRegionId } from "../fields/field-renderer.ts";
import { named } from "./collection-page.test-support.ts";
import { itemElementIdForTemplate, renderCollection, renderItemWrapper } from "./list-container.ts";
import { CAPABILITY, RECORD, recordDesk } from "./record-view.test-support.ts";
import { RECORD_VIEW_ATTR, renderRecordViewTemplate } from "./record-view.ts";

const templateId = "record-notes-note-1";
const ITEMS =
  renderItemWrapper(`<span>${RECORD.text}</span>`, RECORD, { templateId }) +
  renderRecordViewTemplate(templateId, CAPABILITY, RECORD);

/**
 * A notes window with one record in it, the swap and the mutation rules started on it, and the
 * record already open. `answer` is what the collection read does when it is asked for.
 */
async function openRecord(answer: () => Promise<unknown> = () => Promise.resolve()) {
  const collection = renderCollection({ capability: CAPABILITY, items: ITEMS });
  const desk = await recordDesk(collection, {
    capabilityId: CAPABILITY.id,
    modules: ["record-view.js", "record-mutations.js"],
    answer,
  });
  const item = desk.doc.getElementById(itemElementIdForTemplate(templateId)) as El;
  desk.press(item);
  await desk.settled();
  const view = desk.doc.querySelector(`[${RECORD_VIEW_ATTR}]`) as El;
  const question = view.querySelector(
    `form[hx-post="${capabilityActionUrl(CAPABILITY.id, "delete")}"]`,
  ) as El;
  return {
    ...desk,
    collection,
    itemId: item.id,
    view,
    form: named(view, "form", `Edit ${CAPABILITY.label}`),
    question,
    /** The action row's Delete, which only asks. */
    asks: named(view, "button", "Delete"),
    /** Whether the record asked for its collection back, which is what leaving is. */
    left: () =>
      desk.asked.requests.map(({ verb, path, context }) => [
        verb,
        path,
        context.swap,
        context.target,
      ]),
  };
}

/** Every sentence handed to the prompt bar's standing slot while the test runs. */
function heard(doc: Doc): string[] {
  const said: string[] = [];
  doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
    said.push((event as unknown as CustomEvent<{ sentence: string }>).detail.sentence);
  });
  return said;
}

/** The collection the read brings back, landed where htmx lands it: focus goes with the view. */
function land(desk: Awaited<ReturnType<typeof openRecord>>, html: string) {
  desk.region.replaceChildren(...parseHtml(html, new Doc()).children);
  return Promise.resolve();
}

/** The collection as the server serves it: its records still to be read. */
const serving = () => renderCollection({ capability: CAPABILITY, loadThroughRead: true });

/** The records arriving in the landed collection, and htmx saying they have settled. */
function settle(desk: Awaited<ReturnType<typeof openRecord>>, items: string) {
  const records = desk.region.querySelector(`#${capabilityRecordsRegionId(CAPABILITY.id)}`) as El;
  records.replaceChildren(...parseHtml(items, new Doc()).children);
  desk.doc.fire("htmx:afterSettle", records);
}

/** Press back, focused the way a press leaves it, and wait for the read to finish. */
async function goBack(desk: Awaited<ReturnType<typeof openRecord>>) {
  const back = named(desk.view, "button", `Back to ${CAPABILITY.label}`);
  back.focus();
  desk.press(back);
  await desk.settled();
  return back;
}

describe("the record swap — the way out", () => {
  let desk: Awaited<ReturnType<typeof openRecord>>;
  afterEach(() => desk.restore());

  test("back asks for the collection again — the fresh read into the window, not a snapshot", async () => {
    desk = await openRecord();
    desk.press(named(desk.view, "button", `Back to ${CAPABILITY.label}`));
    expect(desk.left()).toEqual([["GET", capabilityUrl(CAPABILITY.id), "innerHTML", desk.region]]);
  });

  test("the form's own Cancel leaves the same way", async () => {
    desk = await openRecord();
    desk.press(named(desk.form, "button", "Cancel"));
    expect(desk.left()).toEqual([["GET", capabilityUrl(CAPABILITY.id), "innerHTML", desk.region]]);
  });

  test("a second press while the collection is on its way asks once", async () => {
    desk = await openRecord();
    const back = named(desk.view, "button", `Back to ${CAPABILITY.label}`);
    desk.press(back);
    desk.press(back);
    expect(desk.left()).toHaveLength(1);
  });

  test("the record that was open has the keyboard again once its collection lands", async () => {
    desk = await openRecord(() => land(desk, desk.collection));
    await goBack(desk);
    expect(desk.doc.activeElement?.id).toBe(desk.itemId);
  });

  test("records still on their way give the record the keyboard when they settle", async () => {
    desk = await openRecord(() => land(desk, serving()));
    await goBack(desk);
    expect(desk.doc.activeElement).toBe(desk.doc.body);
    settle(desk, ITEMS);
    expect(desk.doc.activeElement?.id).toBe(desk.itemId);
  });

  test("the keyboard is handed back once: a later settle of the records moves nothing", async () => {
    desk = await openRecord(() => land(desk, serving()));
    await goBack(desk);
    settle(desk, "");
    const newButton = named(desk.region, "button", `New ${CAPABILITY.label}`);
    expect(desk.doc.activeElement).toBe(newButton);
    // The person presses the empty ground, and a search lands the records again much later.
    newButton.blur();
    settle(desk, ITEMS);
    expect(desk.doc.activeElement).toBe(desk.doc.body);
  });

  test("a record that is gone from what settles hands the keyboard to New instead", async () => {
    desk = await openRecord(() => land(desk, serving()));
    await goBack(desk);
    settle(desk, "");
    expect(desk.doc.activeElement).toBe(named(desk.region, "button", `New ${CAPABILITY.label}`));
  });

  test("the keyboard the person has already moved stays where they put it", async () => {
    desk = await openRecord(() => land(desk, serving()));
    await goBack(desk);
    const search = desk.region.querySelector('input[type="search"]') as El;
    search.focus();
    settle(desk, ITEMS);
    expect(desk.doc.activeElement).toBe(search);
  });

  test("a read that fails leaves the record standing, and it can be left again", async () => {
    desk = await openRecord(() => Promise.reject(new Error("severed")));
    const back = await goBack(desk);
    expect(desk.doc.activeElement).toBe(back);
    desk.press(back);
    expect(desk.left()).toHaveLength(2);
  });

  test("leaving releases what the record held before the read goes out", async () => {
    const released: string[] = [];
    desk = await openRecord(() => {
      released.push("read");
      return Promise.resolve();
    });
    registerRegionRelease(desk.form as never, "a save in flight", () => released.push("save"));
    await goBack(desk);
    expect(released).toEqual(["save", "read"]);
  });

  test("a committed update leaves the same way pressing back does", async () => {
    desk = await openRecord();
    desk.doc.fire("htmx:beforeRequest", desk.form, { detail: { elt: desk.form } });
    desk.doc.fire("htmx:afterRequest", desk.form, {
      detail: { elt: desk.form, successful: true, xhr: { status: 200 } },
    });
    expect(desk.left()).toEqual([["GET", capabilityUrl(CAPABILITY.id), "innerHTML", desk.region]]);
  });

  test("a refused update stays, so the refusal has somewhere to be read", async () => {
    desk = await openRecord();
    desk.doc.fire("htmx:beforeRequest", desk.form, { detail: { elt: desk.form } });
    desk.doc.fire("htmx:afterRequest", desk.form, {
      detail: { elt: desk.form, successful: false, xhr: { status: 422 } },
    });
    expect(desk.left()).toEqual([]);
  });
});

// The confirmation's wiring, run on the markup the server renders with the real module started.
describe("the record's deletion — the wiring", () => {
  let desk: Awaited<ReturnType<typeof openRecord>>;
  afterEach(() => desk.restore());

  test("Delete asks, landing on Cancel; Cancel puts the question away and does not leave", async () => {
    desk = await openRecord();
    const row = desk.asks.parent as El;
    desk.press(desk.asks);
    expect(row.hidden).toBe(true);
    expect(desk.question.hidden).toBe(false);
    const cancel = named(desk.question, "button", "Cancel");
    expect(desk.doc.activeElement).toBe(cancel);

    desk.press(cancel);
    expect(row.hidden).toBe(false);
    expect(desk.question.hidden).toBe(true);
    expect(desk.doc.activeElement).toBe(desk.asks);
    expect(desk.left()).toEqual([]);
  });

  test("while the delete is out it says so, and nothing can be pressed to cancel it", async () => {
    desk = await openRecord();
    desk.press(desk.asks);
    desk.doc.fire("htmx:beforeRequest", desk.question, { detail: { elt: desk.question } });
    const remove = named(desk.question, "button", DELETING_RECORD_LABEL);
    expect(remove.disabled).toBe(true);
    expect(named(desk.question, "button", "Cancel").disabled).toBe(true);
    expect(desk.question.getAttribute("aria-busy")).toBe("true");
  });

  test("a committed delete leaves the record; a refused one leaves the question standing", async () => {
    desk = await openRecord();
    desk.press(desk.asks);
    desk.doc.fire("htmx:beforeRequest", desk.question, { detail: { elt: desk.question } });
    desk.doc.fire("htmx:afterRequest", desk.question, {
      detail: { elt: desk.question, successful: false, xhr: { status: 409 } },
    });
    expect(desk.question.hidden).toBe(false);
    expect(named(desk.question, "button", "Delete record").disabled).toBe(false);
    expect(desk.left()).toEqual([]);

    desk.doc.fire("htmx:afterRequest", desk.question, {
      detail: { elt: desk.question, successful: true, xhr: { status: 200 } },
    });
    expect(desk.left()).toEqual([["GET", capabilityUrl(CAPABILITY.id), "innerHTML", desk.region]]);
  });

  test("the form beneath a standing question cannot be submitted", async () => {
    // A hidden submit button is still the form's default button, so Enter in any field
    // would save — and, mid-delete, race the delete it is answering.
    desk = await openRecord();
    // htmx's own listener, on the form itself: whatever reaches it goes on the wire.
    const sent: string[] = [];
    desk.form.addEventListener("submit", () => sent.push("sent"));
    expect(desk.doc.fire("submit", desk.form)).toEqual({ prevented: false, stopped: false });
    expect(sent).toEqual(["sent"]);
    desk.press(desk.asks);
    expect(desk.doc.fire("submit", desk.form)).toEqual({ prevented: true, stopped: true });
    expect(sent).toEqual(["sent"]);
  });

  test("Escape dismisses the question, the one exit a `<dialog>` used to supply", async () => {
    desk = await openRecord();
    desk.press(desk.asks);
    desk.doc.fire("keydown", desk.doc.activeElement as El, { key: "Enter" });
    expect(desk.question.hidden).toBe(false);
    desk.doc.fire("keydown", desk.doc.activeElement as El, { key: "Escape" });
    expect(desk.question.hidden).toBe(true);
  });

  test("a severed delete whose record went while it was out says so on the prompt bar", async () => {
    desk = await openRecord();
    const said = heard(desk.doc);
    desk.press(desk.asks);
    desk.doc.fire("htmx:beforeRequest", desk.question, { detail: { elt: desk.question } });
    releaseRegionContent(desk.view as never);
    desk.doc.fire("htmx:afterRequest", desk.question, {
      detail: { elt: desk.question, successful: false, xhr: { status: 0 } },
    });
    expect(said).toEqual([UNCONFIRMED_ON_THE_DESK]);
    expect(desk.question.querySelector('[aria-live="polite"]')?.textContent).toBe("");
  });

  test("a severed delete still standing says so in its own question", async () => {
    desk = await openRecord();
    const said = heard(desk.doc);
    desk.press(desk.asks);
    desk.doc.fire("htmx:beforeRequest", desk.question, { detail: { elt: desk.question } });
    desk.doc.fire("htmx:afterRequest", desk.question, {
      detail: { elt: desk.question, successful: false, xhr: { status: 0 } },
    });
    expect(said).toEqual([]);
    const notice = desk.question.querySelector('[aria-live="polite"] .notice') as El;
    expect(notice.getAttribute("data-error-code")).toBe(MUTATION_OUTCOME_UNKNOWN);
    expect(desk.left()).toEqual([]);
  });

  test("Escape does not take the question away while the delete is out", async () => {
    desk = await openRecord();
    desk.press(desk.asks);
    desk.doc.fire("htmx:beforeRequest", desk.question, { detail: { elt: desk.question } });
    desk.doc.fire("keydown", desk.question, { key: "Escape" });
    expect(desk.question.hidden).toBe(false);
  });
});
