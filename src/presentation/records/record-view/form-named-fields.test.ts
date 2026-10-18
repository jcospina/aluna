// A capability may name its fields after anything a form has. The browser puts a form's controls in
// front of its own properties, so the shipped scripts that handle a record's forms must never ask a
// form for `reset`, `dataset`, `elements` or `contains` the ordinary way. Each case runs the real
// modules on the markup the server renders for a capability whose fields take those names.

import { afterEach, describe, expect, test } from "bun:test";
import { registerRegionRelease, releaseRegionContent } from "#shell/core/region-scope.js";
import { BUSY_LABEL_ATTRIBUTE, formControl } from "#shell/core/shell-dom.js";
import { searchUrlWithQuery } from "#shell/records/records-region-status.js";
import { startAlpine } from "../../controls/double/alpine.test-support.ts";
import type { El } from "../../controls/double/choice-picker.test-support.ts";
import type { RenderableCapability } from "../../fields/field-renderer.ts";
import { named, shown } from "../collection/collection-page.test-support.ts";
import { renderCollection } from "../collection/list-container.ts";
import { recordDesk } from "./record-view.test-support.ts";
import { RECORD_VIEW_ATTR, renderRecordView } from "./record-view.ts";

/** Lowercase members of a form, which a field name can spell, and which a script might read. */
const FORM_MEMBERS = [
  "reset",
  "dataset",
  "id",
  "action",
  "elements",
  "submit",
  "method",
  "contains",
  "hidden",
] as const;

const CAPABILITY: RenderableCapability = {
  id: "ledger",
  label: "Ledger",
  noun: "entry",
  schema: {
    fields: [
      ...FORM_MEMBERS.map((name) => ({
        name,
        label: `The ${name}`,
        type: "string" as const,
        required: false,
        lifecycle: "active" as const,
      })),
      { name: "when", label: "When", type: "datetime", required: false, lifecycle: "active" },
    ],
  },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  actions: ["create", "read", "update", "delete", "search"],
};

const RECORD = {
  ...Object.fromEntries(FORM_MEMBERS.map((name) => [name, `kept ${name}`])),
  // The record's own id, which its card and its way back are named by, as a record id spells one.
  id: "6b0e3c1a-2f4d-4a8e-9c71-5d2f0a9b8e14",
  created_at: "2026-08-27T00:00:00.000Z",
  when: "2026-07-05T09:30:00.000Z",
};

/** htmx's two events for one request on `form`, bubbling as it sends them. */
function request(form: El, outcome: { successful: boolean; status: number }) {
  for (const type of ["htmx:beforeRequest", "htmx:afterRequest"]) {
    const detail = { elt: form, successful: outcome.successful, xhr: { status: outcome.status } };
    form.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}

describe("a create form whose fields are named after the form's own members", () => {
  const globals = globalThis as { fetch: unknown };
  const fetched = globals.fetch;
  let desk: Awaited<ReturnType<typeof recordDesk>>;
  afterEach(() => {
    globals.fetch = fetched;
    desk.restore();
  });

  test("a committed create still refreshes, empties the form, and closes it", async () => {
    desk = await recordDesk(renderCollection({ capability: CAPABILITY }), {
      capabilityId: CAPABILITY.id,
      modules: ["records/record-mutations.js"],
    });
    const read: string[] = [];
    globals.fetch = (url: string) => {
      read.push(url);
      return Promise.resolve(new Response(""));
    };
    startAlpine(desk.doc);
    const newButton = named(desk.doc, "button", `New ${CAPABILITY.label}`);
    const form = named(desk.doc, "form", `Add to ${CAPABILITY.label}`);
    const search = desk.doc.querySelector('input[type="search"]') as El;
    search.value = "oat";
    desk.press(newButton);
    await desk.settled();
    const controls = FORM_MEMBERS.map((name) => form.querySelector(`[name="${name}"]`) as El);
    for (const control of controls) control.value = "typed";

    request(form, { successful: true, status: 200 });
    await desk.settled();
    await desk.settled();

    const searchUrl = form.getAttribute("data-search-url") as string;
    expect(read).toEqual([searchUrlWithQuery(searchUrl, "oat")]);
    expect(controls.map((control) => control.value)).toEqual(FORM_MEMBERS.map(() => ""));
    expect(shown(form)).toBe(false);
    expect(desk.doc.activeElement).toBe(newButton);
  });
});

describe("a record whose fields are named after the form's own members", () => {
  let desk: Awaited<ReturnType<typeof recordDesk>>;
  afterEach(() => desk.restore());

  /** The record as its record address draws it into the window. */
  async function openRecord() {
    desk = await recordDesk(renderRecordView(CAPABILITY, RECORD), {
      capabilityId: CAPABILITY.id,
      modules: ["records/record-view.js", "records/record-mutations.js"],
    });
    const view = desk.doc.querySelector(`[${RECORD_VIEW_ATTR}]`) as El;
    return { view, form: named(view, "form", `Edit ${CAPABILITY.label}`) };
  }

  test("the form under a standing question still cannot be submitted", async () => {
    const { view, form } = await openRecord();
    const sent: string[] = [];
    form.addEventListener("submit", () => sent.push("sent"));
    desk.press(named(view, "button", "Delete"));
    expect(desk.doc.fire("submit", form)).toEqual({ prevented: true, stopped: true });
    expect(sent).toEqual([]);
  });

  test("a save says it is saving, and a committed one leaves the record", async () => {
    const { view, form } = await openRecord();
    // Save stands outside the form, found by the form's id, which a field named `id` shadows.
    const save = named(view, "button", "Save");
    desk.doc.fire("htmx:beforeRequest", form, { detail: { elt: form } });
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(save.textContent).toBe(save.getAttribute(BUSY_LABEL_ATTRIBUTE) as string);
    expect(save.disabled).toBe(true);
    desk.doc.fire("htmx:afterRequest", form, {
      detail: { elt: form, successful: true, xhr: { status: 200 } },
    });
    expect(desk.asked.requests.map(({ verb }) => verb)).toEqual(["GET"]);
  });

  test("its Save is found by the form's id while the form is on the page, and not once it is off", async () => {
    const { view, form } = await openRecord();
    const save = named(view, "button", "Save");
    expect(formControl(form as never, 'button[type="submit"]')).toBe(save as never);
    form.remove();
    expect(formControl(form as never, 'button[type="submit"]')).toBeNull();
  });

  test("the form's own removal still releases the work anchored inside it", async () => {
    // htmx cleans up every node it removes, the form among them, and releases each one's content.
    const { form } = await openRecord();
    const released: string[] = [];
    const field = form.querySelector('[name="contains"]') as El;
    registerRegionRelease(field as never, "probe", () => released.push("released"));
    releaseRegionContent(form as never);
    expect(released).toEqual(["released"]);
  });

  test("typing a time still writes the exact value the form posts", async () => {
    const { form } = await openRecord();
    const typed = form.querySelector("[data-edit-datetime-input]") as El;
    typed.value = "2026-07-06T10:00";
    desk.doc.fire("input", typed);
    const posted = form.querySelector('[name="when"][data-edit-datetime-value]') as El;
    expect(posted.value).toBe("2026-07-06T10:00");
  });
});
