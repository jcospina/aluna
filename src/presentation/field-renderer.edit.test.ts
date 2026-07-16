import { describe, expect, test } from "bun:test";

import { ALUNA_PRESENT_MARKER, ALUNA_RECORD_ID_MARKER } from "../router/wire-protocol.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { capabilityEditErrorId, RECORD_UPDATED_EVENT, renderEditForm } from "./field-renderer.ts";

const CAPABILITY: RenderableCapability = {
  id: "journal",
  label: "Journal entry",
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
    ],
  },
  form: {
    list_inputs: [
      { field: "tags", mode: "comma_separated" },
      { field: "aliases", mode: "repeatable" },
    ],
  },
  detail: { shows: ["entry", "reflection", "created_at"] },
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
};

describe("edit form — committed update wiring", () => {
  const form = renderEditForm(CAPABILITY, RECORD, {
    itemTargetId: "detail-journal-record-1-item",
    sourceTemplateId: "detail-journal-record-1",
  });

  test("posts Save to update and declares the shared post-mutation region refresh", () => {
    expect(form).toContain('hx-post="/capability/journal/update"');
    expect(form).toContain('hx-swap="none"');
    expect(form).toContain('data-item-target-id="detail-journal-record-1-item"');
    expect(form).toContain("data-post-mutation-refresh");
    expect(form).toContain('data-mutation-kind="update"');
    expect(form).toContain('data-records-target-id="journal-records"');
    expect(form).toContain('data-read-url="/capability/journal/read"');
    expect(form).toContain('<button class="btn btn--primary" type="submit">Save</button>');
    expect(form).not.toContain(RECORD_UPDATED_EVENT);
  });

  test("adds the search refresh URL only for search-capable committed rows", () => {
    expect(form).not.toContain('data-search-url="/capability/journal/search"');
    expect(
      renderEditForm({ ...CAPABILITY, searchEnabled: true }, RECORD, {
        itemTargetId: "detail-journal-record-1-item",
        sourceTemplateId: "detail-journal-record-1",
      }),
    ).toContain('data-search-url="/capability/journal/search"');
  });

  test("reserves the warm structured-error target and keeps Cancel non-submitting", () => {
    expect(form).toContain(`id="${capabilityEditErrorId("journal")}"`);
    expect(form).toContain('aria-live="polite"');
    expect(form).toContain('type="button" data-detail-cancel-edit>Cancel</button>');
  });

  test("emits exactly one nonblank record target and one presence marker per active field", () => {
    const targets =
      form.match(new RegExp(`name="${ALUNA_RECORD_ID_MARKER}" value="[^"]+"`, "g")) ?? [];
    expect(targets).toEqual([`name="${ALUNA_RECORD_ID_MARKER}" value="record-1"`]);

    const presence =
      form.match(new RegExp(`name="${ALUNA_PRESENT_MARKER}" value="[^"]+"`, "g")) ?? [];
    expect(presence).toEqual([
      `name="${ALUNA_PRESENT_MARKER}" value="entry"`,
      `name="${ALUNA_PRESENT_MARKER}" value="reflection"`,
      `name="${ALUNA_PRESENT_MARKER}" value="published"`,
      `name="${ALUNA_PRESENT_MARKER}" value="tags"`,
      `name="${ALUNA_PRESENT_MARKER}" value="aliases"`,
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
    expect(() =>
      renderEditForm(
        CAPABILITY,
        { ...RECORD, id: "   " },
        {
          itemTargetId: "item",
          sourceTemplateId: "template",
        },
      ),
    ).toThrow(/nonblank record id/);
  });
});
