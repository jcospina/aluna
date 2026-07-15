import { describe, expect, test } from "bun:test";

import { type FieldType, fieldTypeSchema, type SpecField } from "../registry/index.ts";
import {
  capabilityCreateErrorId,
  capabilityRecordsRegionId,
  RECORD_CREATED_EVENT,
  type RenderableCapability,
  renderCreateForm,
  renderDetailFields,
} from "./field-renderer.ts";

// The centralized field renderer (epic 3.2/01) is the one platform module that turns
// a spec into create controls and read-only detail — exhaustive over the pantry
// (string | number | boolean | datetime | date | string[]). These tests cover every pantry type in
// both modes from one fixture, the platform-owned create-form wiring + close-on-
// success, and the data-safety invariants (escaping, absent-value placeholder). The
// schema-driven sweep ties the renderer to `fieldTypeSchema`, so a future pantry type
// that isn't handled here breaks a test, not a live view.

const SAMPLE: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  schema: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      { name: "priority", label: "Priority", type: "number", required: true, lifecycle: "active" },
      { name: "done", label: "Done", type: "boolean", required: true, lifecycle: "active" },
      {
        name: "due_date",
        label: "Due date",
        type: "datetime",
        required: true,
        lifecycle: "active",
      },
      { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
    ],
  },
};

function oneField(field: SpecField): RenderableCapability {
  return { id: "probe", label: "Probe", schema: { fields: [field] } };
}

function sampleDetailValue(type: FieldType): string | number | boolean | readonly string[] {
  switch (type) {
    case "string":
      return "a value";
    case "number":
      return 42.5;
    case "boolean":
      return true;
    case "datetime":
      return "2026-07-05T09:30:00.000Z";
    case "date":
      return "2026-07-05";
    case "string[]":
      return ["first", "second"];
  }
}

describe("create form — platform wiring + close-on-success", () => {
  const form = renderCreateForm(SAMPLE);

  test("posts to the capability's create action and prepends into its live region", () => {
    expect(form).toContain('hx-post="/capability/tasks/create"');
    expect(form).toContain(`hx-target="#${capabilityRecordsRegionId("tasks")}"`);
    expect(form).toContain('hx-swap="afterbegin"');
  });

  test("region id is derived from the capability id", () => {
    expect(capabilityRecordsRegionId("tasks")).toBe("tasks-records");
  });

  test("close-on-success resets the form and dispatches the record-created event", () => {
    expect(form).toContain("hx-on::after-request=");
    expect(form).toContain("event.detail.successful");
    expect(form).toContain("this.reset()");
    expect(form).toContain(RECORD_CREATED_EVENT);
  });

  test("reserves an aria-live target for structured create errors", () => {
    expect(form).toContain(`id="${capabilityCreateErrorId("tasks")}"`);
    expect(form).toContain('aria-live="polite"');
  });

  test("carries an accessible name and a primary submit affordance", () => {
    expect(form).toContain('aria-label="Add to Tasks"');
    expect(form).toContain('<button class="btn btn--primary" type="submit">Add</button>');
  });

  test("holds no record data — the create surface is data-free", () => {
    // Nothing but the spec goes in; there is no argument through which a value could.
    expect(renderCreateForm.length).toBe(1);
  });
});

describe("create form — one control per pantry type", () => {
  const form = renderCreateForm(SAMPLE);

  test("string renders a text input named for the field", () => {
    expect(form).toContain('<input class="field__control" id="cap-tasks-title" type="text"');
    expect(form).toContain('name="title"');
  });

  test("emits one reserved presence marker for every rendered active field", () => {
    const markers = form.match(/name="__aluna_present" value="[^"]+"/g) ?? [];
    expect(markers).toEqual([
      'name="__aluna_present" value="title"',
      'name="__aluna_present" value="priority"',
      'name="__aluna_present" value="done"',
      'name="__aluna_present" value="due_date"',
      'name="__aluna_present" value="note"',
    ]);
  });

  test("number renders a decimal-capable number input", () => {
    expect(form).toContain('id="cap-tasks-priority" type="number"');
    expect(form).toContain('step="any"');
  });

  test("boolean renders an inline checkbox", () => {
    expect(form).toContain('<div class="field field--inline">');
    expect(form).toContain('<input class="field__checkbox" id="cap-tasks-done" type="checkbox"');
  });

  test("datetime renders a datetime-local input", () => {
    expect(form).toContain('id="cap-tasks-due_date" type="datetime-local"');
  });

  test("date renders a date-only input, distinct from datetime-local", () => {
    const dateForm = renderCreateForm(
      oneField({
        name: "due_on",
        label: "Due on",
        type: "date",
        required: true,
        lifecycle: "active",
      }),
    );
    expect(dateForm).toContain('id="cap-probe-due_on" type="date"');
    expect(dateForm).not.toContain("datetime-local");
  });

  test("string[] renders one repeated-value row plus add/remove controls", () => {
    const listForm = renderCreateForm(
      oneField({
        name: "tags",
        label: "Tags",
        type: "string[]",
        required: true,
        lifecycle: "active",
      }),
    );
    expect(listForm).toContain("data-list-field");
    expect(listForm).toContain('name="tags"');
    expect(listForm).toContain("data-list-field-add");
    expect(listForm).toContain("data-list-field-remove");
    expect(listForm).not.toContain('name="tags" required');
  });

  test("uses the authored field label and ties it to the stable field-name control", () => {
    expect(form).toContain('<label class="field__label" for="cap-tasks-due_date">Due date</label>');
    const custom = renderCreateForm(
      oneField({
        name: "due_date",
        label: "Finish by",
        type: "date",
        required: true,
        lifecycle: "active",
      }),
    );
    expect(custom).toContain('for="cap-probe-due_date">Finish by</label>');
    expect(custom).toContain('name="due_date"');
  });

  test("does not render inactive fields", () => {
    const capability: RenderableCapability = {
      id: "probe",
      label: "Probe",
      schema: {
        fields: [
          { name: "title", label: "Entry", type: "string", required: true, lifecycle: "active" },
          {
            name: "retired_note",
            label: "Retired note",
            type: "string",
            required: true,
            lifecycle: "inactive",
          },
        ],
      },
    };
    const create = renderCreateForm(capability);
    expect(create).toContain("Entry");
    expect(create).not.toContain("retired_note");
    expect(create).not.toContain("Retired note");
  });

  test("required fields carry the required attribute; optional ones do not", () => {
    expect(form).toContain('name="title" required>');
    // The lone optional field renders without a `required` attribute anywhere.
    expect(
      renderCreateForm(
        oneField({
          name: "note",
          label: "Note",
          type: "string",
          required: false,
          lifecycle: "active",
        }),
      ),
    ).not.toContain("required");
  });

  test("a required boolean is never forced checked — the checkbox carries no required", () => {
    // A checkbox always yields a definite value (checked/unchecked → true/false), so a
    // required boolean is already satisfied; forcing it checked would block create.
    const booleanForm = renderCreateForm(
      oneField({
        name: "done",
        label: "Done",
        type: "boolean",
        required: true,
        lifecycle: "active",
      }),
    );
    expect(booleanForm).toContain('type="checkbox"');
    expect(booleanForm).not.toContain("required");
  });
});

describe("detail display — one formatting per pantry type", () => {
  test("renders a definition list with a labeled row per field", () => {
    const detail = renderDetailFields(SAMPLE, {
      title: "Buy milk",
      priority: 2,
      done: true,
      due_date: "2026-07-05T09:30:00.000Z",
      note: "before noon",
    });
    expect(detail.startsWith('<dl class="detail-fields">')).toBe(true);
    expect([...detail.matchAll(/<dt class="detail-field__label">/g)]).toHaveLength(5);
    expect(detail).toContain('<dt class="detail-field__label">Due date</dt>');
  });

  test("string values are shown as escaped text", () => {
    const detail = renderDetailFields(
      oneField({
        name: "title",
        label: "Title",
        type: "string",
        required: true,
        lifecycle: "active",
      }),
      {
        title: "Buy milk",
      },
    );
    expect(detail).toContain('<dd class="detail-field__value">Buy milk</dd>');
  });

  test("number values are shown verbatim", () => {
    const detail = renderDetailFields(
      oneField({
        name: "priority",
        label: "Priority",
        type: "number",
        required: true,
        lifecycle: "active",
      }),
      {
        priority: 42.5,
      },
    );
    expect(detail).toContain('<dd class="detail-field__value">42.5</dd>');
  });

  test("boolean values read as Yes / No", () => {
    const field: SpecField = {
      name: "done",
      label: "Done",
      type: "boolean",
      required: true,
      lifecycle: "active",
    };
    expect(renderDetailFields(oneField(field), { done: true })).toContain(
      '<dd class="detail-field__value">Yes</dd>',
    );
    expect(renderDetailFields(oneField(field), { done: false })).toContain(
      '<dd class="detail-field__value">No</dd>',
    );
  });

  test("datetime values ride a semantic <time>, tidied timezone-free", () => {
    const detail = renderDetailFields(
      oneField({
        name: "due_date",
        label: "Due date",
        type: "datetime",
        required: true,
        lifecycle: "active",
      }),
      {
        due_date: "2026-07-05T09:30:00.000Z",
      },
    );
    expect(detail).toContain('<time datetime="2026-07-05T09:30:00.000Z">2026-07-05 09:30</time>');
  });

  test("date values ride a semantic <time>, date-only", () => {
    const detail = renderDetailFields(
      oneField({
        name: "due_on",
        label: "Due on",
        type: "date",
        required: true,
        lifecycle: "active",
      }),
      {
        due_on: "2026-07-05",
      },
    );
    expect(detail).toContain('<time datetime="2026-07-05">2026-07-05</time>');
  });

  test("string[] values render as an escaped ordered list; null and [] render empty", () => {
    const field: SpecField = {
      name: "tags",
      label: "Tags",
      type: "string[]",
      required: false,
      lifecycle: "active",
    };
    const detail = renderDetailFields(oneField(field), {
      tags: ["first", "one,two", "<last>"],
    });
    expect(detail).toContain(
      '<ul class="detail-field__list"><li>first</li><li>one,two</li><li>&lt;last&gt;</li></ul>',
    );
    for (const absent of [null, []]) {
      const empty = renderDetailFields(oneField(field), { tags: absent });
      expect(empty).toContain("detail-field__value--empty");
      expect(empty).toContain(">—</dd>");
    }
  });

  test("absent values show the placeholder and an empty modifier", () => {
    const field: SpecField = {
      name: "note",
      label: "Note",
      type: "string",
      required: false,
      lifecycle: "active",
    };
    for (const absent of [null, undefined, ""]) {
      const detail = renderDetailFields(oneField(field), { note: absent });
      expect(detail).toContain("detail-field__value detail-field__value--empty");
      expect(detail).toContain("—");
    }
  });

  test("a historical null in a required field renders as the platform empty value", () => {
    const detail = renderDetailFields(
      oneField({
        name: "title",
        label: "Entry",
        type: "string",
        required: true,
        lifecycle: "active",
      }),
      { title: null },
    );
    expect(detail).toContain(">Entry</dt>");
    expect(detail).toContain("detail-field__value--empty");
    expect(detail).toContain("—");
  });

  test("renders the immutable created_at descriptor only when detail intent names it", () => {
    const capability: RenderableCapability = {
      ...SAMPLE,
      detail: { shows: ["created_at", "title"] },
    };
    const detail = renderDetailFields(capability, {
      created_at: "2026-07-14T10:30:00.000Z",
      title: "Visible",
    });
    expect(detail).toContain(">Created</dt>");
    expect(detail).toContain('<time datetime="2026-07-14T10:30:00.000Z">2026-07-14 10:30</time>');
    expect(renderCreateForm(capability)).not.toContain("created_at");
  });
});

describe("detail display — hostile record data cannot become markup", () => {
  test("a script-shaped string value is escaped, not injected", () => {
    const detail = renderDetailFields(
      oneField({
        name: "title",
        label: "Title",
        type: "string",
        required: true,
        lifecycle: "active",
      }),
      {
        title: "<script>alert(1)</script>",
      },
    );
    expect(detail).not.toContain("<script");
    expect(detail).toContain("&lt;script&gt;");
  });

  test("a hostile datetime value cannot break out of the time element", () => {
    const detail = renderDetailFields(
      oneField({ name: "at", label: "At", type: "datetime", required: true, lifecycle: "active" }),
      {
        at: '"><img src=x onerror=alert(1)>',
      },
    );
    // The `">` that would close the attribute and the `<img` that would open a new
    // element are both escaped, so nothing new is parsed — in attribute and text alike.
    expect(detail).not.toContain("<img");
    expect(detail).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("detail display — honors ui_intent.detail.shows (fields + order)", () => {
  const RECORD = {
    title: "Buy oat milk",
    priority: 2,
    done: true,
    due_date: "2026-07-05T09:30:00.000Z",
    note: "later",
  };

  test("without detail.shows, renders every field in spec order (the fallback)", () => {
    const detail = renderDetailFields(SAMPLE, RECORD);
    const order = ["Title", "Priority", "Done", "Due date", "Note"];
    const positions = order.map((label) => detail.indexOf(`>${label}</dt>`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("shows exactly the named fields, in the named order — dropping the rest", () => {
    const scoped: RenderableCapability = {
      ...SAMPLE,
      detail: { shows: ["note", "title", "done"] },
    };
    const detail = renderDetailFields(scoped, RECORD);

    const shown = ["Note", "Title", "Done"].map((label) => detail.indexOf(`>${label}</dt>`));
    expect(shown.every((p) => p >= 0)).toBe(true);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));

    for (const dropped of ["Priority", "Due date"]) {
      expect(detail).not.toContain(`>${dropped}</dt>`);
    }
    expect([...detail.matchAll(/<dt class="detail-field__label">/g)]).toHaveLength(3);
  });

  test("inactive stored values never render, even in a defensive hand-built detail list", () => {
    const capability: RenderableCapability = {
      id: "probe",
      label: "Probe",
      schema: {
        fields: [
          { name: "title", label: "Entry", type: "string", required: true, lifecycle: "active" },
          {
            name: "retired_note",
            label: "Retired note",
            type: "string",
            required: true,
            lifecycle: "inactive",
          },
        ],
      },
      detail: { shows: ["title", "retired_note"] },
    };
    const detail = renderDetailFields(capability, {
      title: "Visible",
      retired_note: "still stored",
    });
    expect(detail).toContain("Visible");
    expect(detail).not.toContain("Retired note");
    expect(detail).not.toContain("still stored");
  });

  test("an empty detail.shows falls back to spec order rather than an empty <dl>", () => {
    // Spec validation forbids an empty shows, so this only guards a hand-built capability;
    // it renders the whole record rather than nothing.
    const empty: RenderableCapability = { ...SAMPLE, detail: { shows: [] } };
    expect(renderDetailFields(empty, RECORD)).toBe(renderDetailFields(SAMPLE, RECORD));
  });

  test("a detail.shows naming an unknown field skips it (defensive), keeps the known ones", () => {
    const scoped: RenderableCapability = {
      ...SAMPLE,
      detail: { shows: ["title", "ghost", "done"] },
    };
    const detail = renderDetailFields(scoped, RECORD);
    expect(detail).toContain(">Title</dt>");
    expect(detail).toContain(">Done</dt>");
    expect([...detail.matchAll(/<dt class="detail-field__label">/g)]).toHaveLength(2);
  });
});

describe("centralization — exhaustive over the admitted pantry", () => {
  // Drives straight off the registry enum: if the pantry gains a type, this sweep
  // renders it in both modes and fails loudly unless the renderer's two total
  // switches handle it — proof that adding a type is a single-location change.
  test("every fieldTypeSchema option renders a create control and a detail value", () => {
    for (const type of fieldTypeSchema.options) {
      const capability = oneField({
        name: "value",
        label: "Value",
        type,
        required: true,
        lifecycle: "active",
      });

      const create = renderCreateForm(capability);
      expect(create).toMatch(/<input[^>]*\btype="[^"]+"/);
      expect(create).toContain('name="value"');

      const detail = renderDetailFields(capability, { value: sampleDetailValue(type) });
      expect(detail).toContain('class="detail-field__value"');
      expect(detail).not.toContain("detail-field__value--empty");
    }
  });
});
