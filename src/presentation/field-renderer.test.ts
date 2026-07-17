import { describe, expect, test } from "bun:test";

import { fieldTypeSchema } from "../registry/index.ts";
import { oneField, SAMPLE, sampleDetailValue } from "./field-renderer.test-support.ts";
import {
  CREATE_CANCELLED_EVENT,
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
// that isn't handled here breaks a test, not a live view. Detail-display coverage lives
// in field-renderer.detail.test.ts; shared fixtures in field-renderer.test-support.ts.

describe("create form — platform wiring + close-on-success", () => {
  const form = renderCreateForm(SAMPLE);

  test("posts to create and declares the shared post-mutation region refresh", () => {
    expect(form).toContain('hx-post="/capability/tasks/create"');
    expect(form).toContain('hx-swap="none"');
    expect(form).toContain("data-post-mutation-refresh");
    expect(form).toContain('data-mutation-kind="create"');
    expect(form).toContain(`data-records-target-id="${capabilityRecordsRegionId("tasks")}"`);
    expect(form).toContain('data-read-url="/capability/tasks/read"');
  });

  test("adds the search refresh URL only when the committed Action set includes search", () => {
    expect(form).not.toContain('data-search-url="/capability/tasks/search"');
    expect(renderCreateForm({ ...SAMPLE, actions: [...SAMPLE.actions, "search"] })).toContain(
      'data-search-url="/capability/tasks/search"',
    );
  });

  test("region id is derived from the capability id", () => {
    expect(capabilityRecordsRegionId("tasks")).toBe("tasks-records");
  });

  test("exposes the capability id used by post-refresh close-on-success", () => {
    expect(form).toContain('data-capability-id="tasks"');
    expect(RECORD_CREATED_EVENT).toBe("aluna:record-created");
  });

  test("reserves an aria-live target for structured create errors", () => {
    expect(form).toContain(`id="${capabilityCreateErrorId("tasks")}"`);
    expect(form).toContain('aria-live="polite"');
  });

  test("carries an accessible name and adjacent cancel/add affordances", () => {
    expect(form).toContain('aria-label="Add to Tasks"');
    const cancel =
      `<button class="btn btn--ghost" type="button" data-create-cancel` +
      ` @click="$el.ownerDocument.defaultView.HTMLFormElement.prototype.reset.call($el.form);` +
      ` $el.ownerDocument.getElementById('${capabilityCreateErrorId("tasks")}').replaceChildren();` +
      ` $dispatch('${CREATE_CANCELLED_EVENT}')">Cancel</button>`;
    expect(form).toContain(cancel);
    expect(form).toContain('<button class="btn btn--primary" type="submit">Add</button>');
    expect(form.indexOf(cancel)).toBeLessThan(
      form.indexOf('<button class="btn btn--primary" type="submit">Add</button>'),
    );
  });

  test("cancel cannot be DOM-clobbered by a valid field named reset", () => {
    const resetFieldForm = renderCreateForm({
      ...SAMPLE,
      schema: {
        fields: [
          { name: "reset", label: "Reset", type: "string", required: false, lifecycle: "active" },
        ],
      },
    });

    expect(resetFieldForm).toContain('name="reset"');
    expect(resetFieldForm).toContain(
      "$el.ownerDocument.defaultView.HTMLFormElement.prototype.reset.call($el.form)",
    );
    expect(resetFieldForm).not.toContain("$el.form.reset()");
  });

  test("holds no record data — the create surface is data-free", () => {
    // Nothing but the spec goes in; there is no argument through which a value could.
    expect(renderCreateForm.length).toBe(1);
  });
});

describe("create form — one control per pantry type — scalar and list controls", () => {
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

  test("comma-separated string[] renders one accessible control with associated guidance", () => {
    const html = renderCreateForm(
      oneField(
        {
          name: "tags",
          label: "Tags",
          type: "string[]",
          required: true,
          lifecycle: "active",
        },
        "comma_separated",
      ),
    );
    expect(html).toContain('data-list-input-mode="comma_separated"');
    expect(html).toContain('name="tags" aria-describedby="cap-probe-tags-guidance" required');
    expect(html).toContain('id="cap-probe-tags-guidance">Separate values with commas.</p>');
    expect(html).not.toContain("data-list-field-add");
    expect(html).not.toContain("data-list-field-remove");
  });
});

describe("create form — one control per pantry type — labels, lifecycle, and required semantics", () => {
  const form = renderCreateForm(SAMPLE);

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
      form: { list_inputs: [] },
      actions: ["create", "read"],
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
