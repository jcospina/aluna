import { describe, expect, test } from "bun:test";

import { ALUNA_PRESENT_MARKER, ALUNA_RECORD_ID_MARKER } from "../router/wire-protocol.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { capabilityEditErrorId, renderEditForm } from "./field-renderer.ts";

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

describe("edit form — committed update wiring", () => {
  const form = EDIT_FORM;

  test("posts Save to update", () => {
    expect(form).toContain('hx-post="/capability/journal/update"');
    expect(form).toContain('hx-swap="none"');
    expect(form).toContain('<button class="btn btn--primary" type="submit">Save</button>');
    expect(form).not.toContain("aluna:record-updated");
  });

  test("carries no region-refresh wiring and no item marker: back is the fresh read", () => {
    // The record replaced the collection, so there is no records region on screen to
    // refresh into. Leaving the record asks for the collection again instead, and the
    // record view above the form is what names the item to give focus back to.
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
    expect(form).toContain('type="button" data-record-cancel>Cancel</button>');
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
    expect(form).toContain('name="entry" value="A quiet beginning" required');
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
      'name="tags" aria-describedby="edit-journal-tags-guidance" value="fantasy, classic"',
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

// Record deletion changes container and nothing else (PLAN decision 22). The trigger is
// part of the row this renderer draws; the confirmation it opens is the record view's, and
// is proved there.
describe("the record form's action row — the destructive control", () => {
  test("carries Delete after Save and Cancel, and it does not submit", () => {
    // Only the separately submitted confirmation can invoke the Action, so a misfired
    // press on this one can never destroy a record.
    expect(EDIT_FORM).toContain(
      '<button class="btn btn--danger capability-edit-form__delete" type="button"' +
        " data-record-delete>Delete</button>",
    );
    expect(EDIT_FORM.indexOf("data-record-cancel>")).toBeLessThan(
      EDIT_FORM.indexOf("data-record-delete>"),
    );
  });

  test("the confirmation is not the form's to render — a form cannot nest in a form", () => {
    expect(EDIT_FORM).not.toContain("capability-record-delete");
    expect(EDIT_FORM.trim().endsWith("</form>")).toBe(true);
    expect(EDIT_FORM.match(/<form/g)).toHaveLength(1);
  });

  test("a capability that cannot delete carries no destructive control", () => {
    const keepsEverything = renderEditForm(
      { ...CAPABILITY, actions: ["create", "read", "update"] },
      RECORD,
    );
    expect(keepsEverything).not.toContain("data-record-delete");
    expect(keepsEverything).not.toContain("btn--danger");
  });
});
