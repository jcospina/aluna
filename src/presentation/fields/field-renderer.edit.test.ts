import { describe, expect, test } from "bun:test";
import {
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
} from "../../runtime/router/wire/wire-protocol.ts";
import { busyLabelAttribute, SAVING_RECORD_LABEL } from "../controls/busy-label.ts";
import { renderEditActions } from "../records/record-view/record-view.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { capabilityEditErrorId, capabilityEditFormId, renderEditForm } from "./field-renderer.ts";

const CAPABILITY: RenderableCapability = {
  id: "journal",
  label: "Journal entry",
  noun: "note",
  schema: {
    fields: [
      {
        name: "entry",
        label: "What happened?",
        type: "string",
        required: true,
        lifecycle: "active",
      },
      {
        name: "reflection",
        label: "A small reflection",
        type: "string",
        required: false,
        lifecycle: "active",
      },
      {
        name: "published",
        label: "Published",
        type: "boolean",
        required: true,
        lifecycle: "active",
      },
      { name: "tags", label: "Tags", type: "string[]", required: true, lifecycle: "active" },
      {
        name: "aliases",
        label: "Other names",
        type: "string[]",
        required: false,
        lifecycle: "active",
      },
      {
        name: "retired_note",
        label: "Retired note",
        type: "string",
        required: true,
        lifecycle: "inactive",
      },
      {
        name: "remembered_at",
        label: "Remembered at",
        type: "datetime",
        required: false,
        lifecycle: "active",
      },
    ],
  },
  form: {
    list_inputs: [
      { field: "tags", mode: "comma_separated" },
      { field: "aliases", mode: "repeatable" },
    ],
    choice_inputs: [],
    long_text: [],
    guidance: [],
  },
  actions: ["create", "read", "update", "delete"],
};

const RECORD = {
  id: "record-1",
  created_at: "2026-07-16T10:30:00.000Z",
  entry: "A quiet beginning",
  reflection: null,
  published: false,
  tags: ["fantasy", "classic"],
  aliases: ["Doe, Jane", "J. Doe"],
  retired_note: "server only",
  extra: { preserved: true },
  remembered_at: "2000-02-29T23:59:59.999+14:00",
};

const EDIT_FORM = renderEditForm(CAPABILITY, RECORD);
/** The record view's action row, outside the form and joined to it by the form's id. */
const ACTIONS = renderEditActions(CAPABILITY);
const OWNER = ` form="${capabilityEditFormId(CAPABILITY.id)}"`;

describe("edit form — committed update wiring", () => {
  const form = EDIT_FORM;

  test("posts Save to update", () => {
    expect(form).toContain('hx-post="/capability/journal/update"');
    expect(form).toContain('hx-swap="none"');
    expect(form).toStartWith(`<form id="${capabilityEditFormId(CAPABILITY.id)}"`);
    expect(ACTIONS).toContain(
      `<button class="btn btn--primary" type="submit"${OWNER}` +
        `${busyLabelAttribute(SAVING_RECORD_LABEL)}>Save</button>`,
    );
    expect(form).not.toContain("aluna:record-updated");
  });

  test("carries no region-refresh wiring and no item marker: back is the fresh read", () => {
    // The record replaced the collection, so there is no records region on screen to refresh
    // into. Leaving asks for the collection again, and the record view above names the item.
    expect(form).not.toContain("data-post-mutation-refresh");
    expect(form).not.toContain("data-records-target-id");
    expect(form).not.toContain("data-read-url");
    expect(form).not.toContain("data-item-target-id");
    expect(form).not.toContain("data-mutation-kind");
    expect(
      renderEditForm({ ...CAPABILITY, actions: [...CAPABILITY.actions, "search"] }, RECORD),
    ).not.toContain("data-search-url");
  });

  test("reserves the warm structured-error target and keeps Cancel non-submitting", () => {
    expect(form).toContain(`id="${capabilityEditErrorId("journal")}"`);
    expect(form).toContain('aria-live="polite"');
    expect(ACTIONS).toContain(`type="button"${OWNER} data-record-cancel>Cancel</button>`);
  });

  test("emits exactly one nonblank record target and one presence marker per active field", () => {
    const targets =
      EDIT_FORM.match(new RegExp(`name="${ALUNA_RECORD_ID_MARKER}" value="[^"]+"`, "g")) ?? [];
    expect(targets).toEqual([`name="${ALUNA_RECORD_ID_MARKER}" value="record-1"`]);

    const presence =
      EDIT_FORM.match(new RegExp(`name="${ALUNA_PRESENT_MARKER}" value="[^"]+"`, "g")) ?? [];
    expect(presence).toEqual([
      `name="${ALUNA_PRESENT_MARKER}" value="entry"`,
      `name="${ALUNA_PRESENT_MARKER}" value="reflection"`,
      `name="${ALUNA_PRESENT_MARKER}" value="published"`,
      `name="${ALUNA_PRESENT_MARKER}" value="tags"`,
      `name="${ALUNA_PRESENT_MARKER}" value="aliases"`,
      `name="${ALUNA_PRESENT_MARKER}" value="remembered_at"`,
    ]);
  });

  test("prefills scalar and unchecked boolean values without exposing inactive or extra state", () => {
    expect(form).toContain(
      'name="entry" value="A quiet beginning" aria-describedby="edit-journal-entry-guidance"' +
        " required",
    );
    expect(form).toContain('name="reflection" value=""');
    expect(form).toContain('name="published"');
    expect(form).not.toContain('name="published" checked');
    expect(form).not.toContain("retired_note");
    expect(form).not.toContain("server only");
    expect(form).not.toContain("preserved");
    expect(form).not.toContain("created_at");
  });

  test("keeps the exact canonical datetime unless its local control changes", () => {
    expect(form).toContain(
      'name="remembered_at" value="2000-02-29T23:59:59.999+14:00" data-edit-datetime-value',
    );
    expect(form).toContain(
      'type="datetime-local" step="any" value="2000-02-29T23:59:59.999" data-edit-datetime-input="remembered_at"',
    );
  });

  test("reuses both authored list modes for exact prefill", () => {
    expect(form).toContain('data-list-input-mode="comma_separated"');
    expect(form).toContain(
      'name="tags" value="fantasy, classic"' +
        ' aria-describedby="edit-journal-tags-list-hint edit-journal-tags-guidance"',
    );

    expect(form).toContain('data-list-input-mode="repeatable"');
    expect(form).toContain('name="aliases" value="Doe, Jane"');
    expect(form).toContain('name="aliases" value="J. Doe"');
  });

  test("fails closed instead of emitting a blank record target", () => {
    expect(() => renderEditForm(CAPABILITY, { ...RECORD, id: "   " })).toThrow(
      /nonblank record id/,
    );
  });
});

// Record deletion changes container and nothing else. The trigger is part of the record view's
// action row, which stands outside the form below the records linking here; the confirmation it
// opens is the record view's, proved there.
describe("the record form's action row — the destructive control", () => {
  test("carries Delete after Save and Cancel, and it does not submit", () => {
    // Only the separately submitted confirmation can invoke the Action, so a misfired
    // press on this one can never destroy a record.
    expect(ACTIONS).toContain(
      `<button class="btn btn--danger capability-edit-form__delete" type="button"${OWNER}` +
        " data-record-delete>Delete</button>",
    );
    expect(ACTIONS.indexOf("data-record-cancel>")).toBeLessThan(
      ACTIONS.indexOf("data-record-delete>"),
    );
  });

  test("the form carries no row of its own, and the confirmation is not the form's to render", () => {
    // A form cannot nest in a form, and the row stands outside it, naming it.
    expect(EDIT_FORM).not.toContain("capability-edit-form__actions");
    expect(EDIT_FORM).not.toContain('type="submit"');
    expect(EDIT_FORM).not.toContain("capability-record-delete");
    expect(EDIT_FORM.trim().endsWith("</form>")).toBe(true);
    expect(EDIT_FORM.match(/<form/g)).toHaveLength(1);
  });

  test("a capability that cannot delete carries no destructive control", () => {
    const keepsEverything = renderEditActions({
      ...CAPABILITY,
      actions: ["create", "read", "update"],
    });
    expect(keepsEverything).not.toContain("data-record-delete");
    expect(keepsEverything).not.toContain("btn--danger");
  });
});
