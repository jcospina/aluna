// A record's three mutations while they are out and once they answer, run through the real
// `public/records/record-mutations.js` (with `public/records/record-view.js`) on the collection and
// the record view the server renders: what each form says and holds while its request is out,
// where an outcome is said, and what a request that is not a record's own is left to.

import { afterEach, describe, expect, test } from "bun:test";

import { FILE_FIELD_HOOKS } from "#design/files/file-field.js";
import { regionScopeReport, releaseRegionContent } from "#shell/core/region-scope.js";
import {
  BUSY_LABEL_ATTRIBUTE,
  FIELD_ERROR_STASH_ATTRIBUTE,
  RECORD_CREATED_EVENT,
} from "#shell/core/shell-dom.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/desk/prompt-bar.js";
import {
  applyDeleteConfirmation,
  MUTATION_OUTCOME_UNKNOWN,
  UNCONFIRMED_AFTER_REFRESH,
  UNCONFIRMED_IN_THE_FORM,
  UNCONFIRMED_ON_THE_DESK,
} from "#shell/records/record-mutations.js";
import { BEHAVIORAL_ERROR_MARKERS } from "../../../registry/index.ts";
import { type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import { probeField } from "../../fields/field-renderer.test-support.ts";
import type { RenderableCapability } from "../../fields/field-renderer.ts";
import { named } from "../collection/collection-page.test-support.ts";
import { renderCollection } from "../collection/list-container.ts";
import { CAPABILITY, RECORD, recordDesk, standingWindow } from "./record-view.test-support.ts";
import { RECORD_VIEW_ATTR, renderRecordView } from "./record-view.ts";

const NOTES: RenderableCapability = {
  ...CAPABILITY,
  schema: {
    fields: [
      ...CAPABILITY.schema.fields,
      probeField("file", { name: "photo", label: "Photo", required: false }),
    ],
  },
};
const LIVE = '[aria-live="polite"]';

type Desk = Awaited<ReturnType<typeof recordDesk>>;
const globals = globalThis as { fetch: unknown };
const fetched = globals.fetch;
let desk: Desk;
afterEach(() => {
  globals.fetch = fetched;
  desk.restore();
});

/** What the window holds, both modules started on it, and every effect written down. */
async function stand(
  reply: () => Promise<Response> = () => Promise.resolve(new Response("")),
  content = renderCollection({ capability: NOTES }),
) {
  desk = await recordDesk(content, {
    capabilityId: NOTES.id,
    modules: ["records/record-view.js", "records/record-mutations.js"],
  });
  const reads: string[] = [];
  globals.fetch = (url: string) => {
    reads.push(url);
    return reply();
  };
  const reloads: string[] = [];
  const page = standingWindow();
  page.location.reload = () => void reloads.push("reload");
  const said: unknown[] = [];
  desk.doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
    said.push((event as unknown as CustomEvent).detail);
  });
  const created: unknown[] = [];
  desk.doc.addEventListener(RECORD_CREATED_EVENT, (event) => {
    created.push((event as unknown as CustomEvent).detail.capabilityId);
  });
  const create = desk.doc.querySelector(`form[aria-label="Add to ${NOTES.label}"]`) as El;
  return { reads, reloads, said, created, create };
}

/**
 * The record as its record address draws it into the window, and its edit form, its action row
 * and its delete question.
 */
async function openRecord() {
  const page = await stand(undefined, renderRecordView(NOTES, RECORD));
  const view = desk.doc.querySelector(`[${RECORD_VIEW_ATTR}]`) as El;
  const question = view.querySelector("[data-record-delete-form]") as El;
  const actions = view.querySelector(".capability-edit-form__actions") as El;
  return { page, view, edit: named(view, "form", `Edit ${NOTES.label}`), actions, question };
}

/** htmx's events for one request, each dispatched on the form and bubbling, as htmx sends them. */
const send = (form: El, type: string, detail: Record<string, unknown> = {}) =>
  form.dispatchEvent(new CustomEvent(type, { detail: { elt: form, ...detail }, bubbles: true }));
const answer = (form: El, status: number) =>
  send(form, "htmx:afterRequest", { successful: status >= 200 && status < 300, xhr: { status } });

/** The one control of the page matching `selector` whose form is `form`, inside it or not. */
const owned = (form: El, selector: string) => {
  const controls = desk.doc.querySelectorAll(selector).filter((control) => control.form === form);
  expect(controls).toHaveLength(1);
  return controls[0] as El;
};

/** What a form's controls say about the request right now, wherever they stand. */
function holding(form: El) {
  const submit = owned(form, 'button[type="submit"]');
  // The window holds one surface at a time, and its bar is the only way back on it.
  const back = desk.region.querySelector("[data-record-form-back]") as El;
  const file = form.querySelector(`[${FILE_FIELD_HOOKS.field}]`) as El | null;
  return {
    busy: form.getAttribute("aria-busy"),
    submit: [submit.disabled, submit.textContent.trim()],
    back: back.disabled,
    frozen: (file as unknown as { inert?: boolean } | null)?.inert ?? null,
  };
}

const settled = async () => {
  for (let turn = 0; turn < 4; turn += 1) await desk.settled();
};

const notice = (form: El) => form.querySelector(`${LIVE} .notice`);

describe("a create while it is out, and once it is refused", () => {
  test("says what it is doing, holds every way out, and gives each back when refused", async () => {
    const page = await stand();
    const submit = page.create.querySelector('button[type="submit"]') as El;
    const idle = submit.textContent.trim();
    (page.create.querySelector('[name="text"]') as El).value = "typed";
    send(page.create, "htmx:beforeRequest");
    expect(holding(page.create)).toEqual({
      busy: "true",
      submit: [true, submit.getAttribute(BUSY_LABEL_ATTRIBUTE) as string],
      back: true,
      frozen: true,
    });
    send(page.create, "htmx:beforeSwap", { xhr: { status: 400 } });
    expect(holding(page.create).frozen).toBe(false);
    answer(page.create, 422);
    await settled();
    expect(holding(page.create)).toEqual({
      busy: "false",
      submit: [false, idle],
      back: false,
      frozen: false,
    });
    expect((page.create.querySelector('[name="text"]') as El).value).toBe("typed");
    expect([page.reads, page.created, notice(page.create)]).toEqual([[], [], null]);
  });

  test("a request sent twice holds one claim, and says its own words again when it ends", async () => {
    const page = await stand();
    const idle = (page.create.querySelector('button[type="submit"]') as El).textContent.trim();
    const claims = () =>
      regionScopeReport().filter(({ label }) => label === "record mutation").length;
    const before = claims();
    send(page.create, "htmx:beforeRequest");
    send(page.create, "htmx:beforeRequest");
    expect(claims()).toBe(before + 1);
    answer(page.create, 422);
    await settled();
    expect(holding(page.create).submit).toEqual([false, idle]);
    expect(claims()).toBe(before);
  });
});

describe("a create the server committed", () => {
  test("re-reads the records, has them processed, and puts the form back as it was drawn", async () => {
    const page = await stand();
    (page.create.querySelector('[name="text"]') as El).value = "typed";
    send(page.create, "htmx:beforeRequest");
    answer(page.create, 200);
    await settled();
    expect(page.reads).toEqual([page.create.getAttribute("data-read-url") as string]);
    const records = desk.doc.getElementById(
      page.create.getAttribute("data-records-target-id") as string,
    );
    expect(desk.asked.processed).toContain(records as El);
    expect(holding(page.create).busy).toBe("false");
    expect((page.create.querySelector('[name="text"]') as El).value).toBe("");
    expect(page.created).toEqual([NOTES.id]);
  });

  test("still finishes with no htmx on the page, and with no records region to re-read", async () => {
    for (const missing of ["htmx", "region"]) {
      const page = await stand();
      if (missing === "htmx") standingWindow().htmx = undefined;
      else page.create.removeAttribute("data-records-target-id");
      send(page.create, "htmx:beforeRequest");
      answer(page.create, 200);
      await settled();
      expect([page.created, page.reloads]).toEqual([[NOTES.id], []]);
      desk.restore();
    }
    await stand();
  });

  test("whose re-read fails reloads the page rather than claim a state it cannot show", async () => {
    const page = await stand(() => Promise.reject(new Error("severed")));
    send(page.create, "htmx:beforeRequest");
    answer(page.create, 200);
    await settled();
    expect([page.reloads, page.created]).toEqual([["reload"], []]);
  });
});

describe("a create whose outcome is unknown", () => {
  test("re-reads, and says so in the form in the platform's own error markers", async () => {
    const page = await stand();
    send(page.create, "htmx:beforeRequest");
    answer(page.create, 0);
    await settled();
    expect(page.reads).toHaveLength(1);
    const said = notice(page.create) as El;
    expect(said.textContent).toBe(UNCONFIRMED_AFTER_REFRESH);
    expect(said.getAttribute(BEHAVIORAL_ERROR_MARKERS.role_attribute)).toBe(
      BEHAVIORAL_ERROR_MARKERS.role,
    );
    expect(said.getAttribute(BEHAVIORAL_ERROR_MARKERS.code_attribute)).toBe(
      MUTATION_OUTCOME_UNKNOWN,
    );
    expect(holding(page.create).busy).toBe("false");
    expect(page.said).toEqual([]);
  });

  test("whose re-read fails reloads the page and says nothing more", async () => {
    const page = await stand(() => Promise.reject(new Error("severed")));
    send(page.create, "htmx:beforeRequest");
    answer(page.create, 0);
    await settled();
    expect([page.reloads, notice(page.create)]).toEqual([["reload"], null]);
  });

  test("whose collection went while it was out says so on the prompt bar; a refusal says nothing", async () => {
    for (const [status, heard] of [
      [0, [{ sentence: UNCONFIRMED_ON_THE_DESK, refused: false }]],
      [422, []],
    ] as const) {
      const page = await stand();
      send(page.create, "htmx:beforeRequest");
      releaseRegionContent(desk.region as never);
      answer(page.create, status);
      await settled();
      expect([page.said, notice(page.create), page.reads]).toEqual([[...heard], null, []]);
      desk.restore();
    }
    const sentences = [UNCONFIRMED_ON_THE_DESK, UNCONFIRMED_AFTER_REFRESH, UNCONFIRMED_IN_THE_FORM];
    expect(new Set([...sentences, MUTATION_OUTCOME_UNKNOWN, ""]).size).toBe(5);
    await stand();
  });
});

// The action row stands outside the edit form, below the records
// linking here, so what a save holds is found by the form the row names.
describe("an edit while it is out, its action row outside the form", () => {
  test("Save says it is saving, Save, Cancel and Back are held, and a refusal gives each back", async () => {
    const { view, edit, actions } = await openRecord();
    const save = named(actions, "button", "Save");
    const cancel = named(actions, "button", "Cancel");
    expect(edit.contains(save)).toBe(false);
    const idle = save.textContent.trim();
    send(edit, "htmx:beforeRequest");
    expect(holding(edit)).toEqual({
      busy: "true",
      submit: [true, save.getAttribute(BUSY_LABEL_ATTRIBUTE) as string],
      back: true,
      frozen: true,
    });
    expect(cancel.disabled).toBe(true);
    send(edit, "htmx:beforeSwap", { xhr: { status: 422 } });
    answer(edit, 422);
    expect(holding(edit)).toEqual({
      busy: "false",
      submit: [false, idle],
      back: false,
      frozen: false,
    });
    expect(cancel.disabled).toBe(false);
    expect(view.isConnected).toBe(true);
  });
});

describe("an edit's outcome", () => {
  test("severed after its record went is said on the prompt bar", async () => {
    const { page, view, edit } = await openRecord();
    send(edit, "htmx:beforeRequest");
    releaseRegionContent(view as never);
    answer(edit, 0);
    expect(page.said).toEqual([{ sentence: UNCONFIRMED_ON_THE_DESK, refused: false }]);
  });

  test("unknown is said in its form, refused says nothing, and either way it stops being busy", async () => {
    const { edit } = await openRecord();
    send(edit, "htmx:beforeRequest");
    answer(edit, 422);
    expect([holding(edit).busy, notice(edit)]).toEqual(["false", null]);
    send(edit, "htmx:beforeRequest");
    answer(edit, 0);
    expect(notice(edit)?.textContent).toBe(UNCONFIRMED_IN_THE_FORM);
    expect(holding(edit).busy).toBe("false");
  });

  test("an answer with no request claimed is still said where the form stands", async () => {
    const { edit } = await openRecord();
    const words = holding(edit).submit;
    answer(edit, 0);
    expect(notice(edit)?.textContent).toBe(UNCONFIRMED_IN_THE_FORM);
    expect(holding(edit).submit).toEqual(words);
  });

  test("refused, it goes back to the top unless the person is standing on a field it marked", async () => {
    // The record view's body scrolls the form with the records linking here below it. A field a
    // refusal marked holds its slot's own words aside, as `field-errors.js` leaves them.
    const { view, edit } = await openRecord();
    const body = view.querySelector(".capability-record-view__body") as El;
    const marked = edit.querySelector('[name="text"]') as El;
    marked
      .closest(".field")
      ?.querySelector("[data-field-guidance]")
      ?.setAttribute(FIELD_ERROR_STASH_ATTRIBUTE, "");
    for (const [standing, top] of [
      [named(view, "button", `Back to ${NOTES.label}`), 0],
      [edit.querySelector('[name="due_on"]') as El, 0],
      [marked, 50],
    ] as const) {
      body.scrollTop = 50;
      standing.focus();
      expect(desk.doc.activeElement).toBe(standing);
      send(edit, "htmx:beforeRequest");
      answer(edit, 422);
      expect(body.scrollTop).toBe(top);
    }
  });
});

describe("the delete question", () => {
  test("stands in for the action row outside the form, and Cancel puts the row back", async () => {
    const { edit, actions, question } = await openRecord();
    const remove = named(actions, "button", "Delete");
    desk.press(remove);
    expect([actions.hidden, question.hidden]).toEqual([true, false]);
    expect(edit.contains(question)).toBe(false);
    expect(question.parent).toBe(actions.parent);
    desk.press(named(question, "button", "Cancel"));
    expect([actions.hidden, question.hidden]).toEqual([false, true]);
    expect(desk.doc.activeElement).toBe(remove);
  });

  test("asking lands on Cancel visibly, and asking again clears the last answer", async () => {
    const { view, question } = await openRecord();
    desk.press(named(view, "button", "Delete"));
    const cancel = named(question, "button", "Cancel");
    expect(desk.doc.activeElement).toBe(cancel);
    expect(cancel.focusOptions).toEqual({ focusVisible: true });
    send(question, "htmx:beforeRequest");
    answer(question, 0);
    expect(notice(question)?.textContent).toBe(UNCONFIRMED_IN_THE_FORM);
    desk.press(cancel);
    desk.press(named(view, "button", "Delete"));
    expect(question.querySelector(LIVE)?.textContent).toBe("");
  });

  test("a refused delete stands the question without saying anything", async () => {
    const { view, question } = await openRecord();
    desk.press(named(view, "button", "Delete"));
    send(question, "htmx:beforeRequest");
    answer(question, 409);
    expect(notice(question)).toBeNull();
  });

  test("the question's own submission is never refused by the guard over the form", async () => {
    const { view, question } = await openRecord();
    desk.press(named(view, "button", "Delete"));
    expect(desk.doc.fire("submit", question)).toEqual({ prevented: false, stopped: false });
  });

  test("Escape with no record open, or no question standing, does nothing", async () => {
    await stand();
    expect(() => desk.doc.fire("keydown", desk.doc.body, { key: "Escape" })).not.toThrow();
    desk.restore();
    const { question } = await openRecord();
    expect(() => desk.doc.fire("keydown", desk.doc.body, { key: "Escape" })).not.toThrow();
    expect(question.hidden).toBe(true);
  });

  test("with nothing to land on, asking moves no focus", () => {
    const focused: unknown[] = [];
    applyDeleteConfirmation({
      confirming: false,
      actions: { hidden: true, trigger: null },
      question: { hidden: false, cancel: null, clearError: () => {} },
      focus: (control) => void focused.push(control),
    });
    expect(focused).toEqual([]);
  });
});

describe("a request that is not a record's own", () => {
  test("is left alone from the moment it goes out to the moment it answers", async () => {
    const page = await stand();
    const other = parseHtml('<form class="elsewhere"></form>', desk.doc.body).querySelector(
      ".elsewhere",
    ) as El;
    expect(() => {
      send(other, "htmx:beforeRequest");
      send(other, "htmx:beforeSwap", { xhr: { status: 422 } });
      answer(other, 200);
    }).not.toThrow();
    await settled();
    expect([page.reloads, page.said, page.created]).toEqual([[], [], []]);
  });
});
