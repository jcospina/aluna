import { describe, expect, test } from "bun:test";
import { fieldTypeSchema, isFileFieldType } from "../../registry/index.ts";
import { ADDING_LABEL, busyLabelAttribute } from "../controls/busy-label.ts";
import { oneField, probeField, SAMPLE, sampleFieldValue } from "./field-renderer.test-support.ts";
import {
  CREATE_CANCELLED_EVENT,
  capabilityCreateErrorId,
  capabilityRecordsRegionId,
  RECORD_CREATED_EVENT,
  type RenderableCapability,
  renderCreateForm,
  renderEditForm,
} from "./field-renderer.ts";

// Every pantry type in both modes from one fixture, the create-form wiring, and the escaping. The
// sweep ties the renderer to `fieldTypeSchema`, so a new type breaks a test, not a live view.

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

  test("carries an accessible name and puts add beside cancel, in that order", () => {
    // Save and cancel sit together on the left, save first, so a destructive action can
    // be kept away from them on the right (design/index.html, "The record form").
    expect(form).toContain('aria-label="Add to Tasks"');
    const cancel =
      `<button class="btn btn--outline" type="button" data-create-cancel` +
      ` @click="$el.ownerDocument.defaultView.HTMLFormElement.prototype.reset.call($el.form);` +
      ` $el.ownerDocument.getElementById('${capabilityCreateErrorId("tasks")}').replaceChildren();` +
      ` $dispatch('${CREATE_CANCELLED_EVENT}')">Cancel</button>`;
    expect(form).toContain(cancel);
    const add =
      `<button class="btn btn--primary" type="submit"` +
      `${busyLabelAttribute(ADDING_LABEL)}>Add</button>`;
    expect(form).toContain(add);
    expect(form.indexOf(add)).toBeLessThan(form.indexOf(cancel));
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
    // The arity alone proves nothing: a form could still bake values in over a closure. Assert
    // the rendered markup instead — nothing arrives pre-filled and no checkbox pre-checked.
    const form = renderCreateForm(SAMPLE);
    const prefilled = [...form.matchAll(/<(?:input|option)\b[^>]*>/g)]
      .map(([element]) => element)
      // The `__aluna_present` markers legitimately carry a value: the field's own name, telling
      // the server which controls the form submitted. Anything else with a value is record data.
      .filter((element) => !element.includes('name="__aluna_present"'))
      .filter((element) => /\svalue="[^"]+"/.test(element) || /\schecked\b/.test(element));

    expect(prefilled).toEqual([]);

    // Every control is an input today, but a textarea carries its value as a text node rather
    // than an attribute and would slip past the sweep above.
    const textareaBodies = [...form.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/g)].map(
      ([, body]) => body,
    );
    expect(textareaBodies.filter((body) => body !== "")).toEqual([]);
  });
});

describe("create form — one control per pantry type — scalar and list controls", () => {
  const form = renderCreateForm(SAMPLE);

  test("string renders a text input named for the field", () => {
    // The shell carries the boundary and the fill; the input carries the caret and the
    // text (`design/design-system.md`, "Forms").
    expect(form).toContain(
      '<span class="field__control"><input class="field__input" id="cap-tasks-title" type="text"',
    );
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
    expect(listForm).toContain("data-list-field-add>Add another</button>");
    expect(listForm).toContain("data-list-field-remove");
    expect(listForm).not.toContain('name="tags" required');
    // `syncListFieldRows` (list-field.js) reads both attributes to re-key every row's `input.id`
    // and `aria-label`. Drop either and rows fall back to "Value 1" and collide on their ids.
    expect(listForm).toContain('data-list-field-label="Tags"');
    expect(listForm).toContain('data-list-input-id="cap-probe-tags"');
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
    // The platform's own separator hint keeps an id of its own, so a field that also
    // declares `guidance` can carry both lines rather than one overwriting the other.
    expect(html).toContain(
      'name="tags" aria-describedby="cap-probe-tags-list-hint cap-probe-tags-guidance" required',
    );
    expect(html).toContain('id="cap-probe-tags-list-hint">Separate values with commas.</p>');
    expect(html).not.toContain("data-list-field-add");
    expect(html).not.toContain("data-list-field-remove");
  });
});

describe("create form — one control per pantry type — labels, lifecycle, and required semantics", () => {
  const form = renderCreateForm(SAMPLE);

  test("uses the authored field label and ties it to the stable field-name control", () => {
    expect(form).toContain(
      '<label class="field__label caps" for="cap-tasks-due_date">Due date</label>',
    );
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
      noun: "note",
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
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      actions: ["create", "read"],
    };
    const create = renderCreateForm(capability);
    expect(create).toContain("Entry");
    expect(create).not.toContain("retired_note");
    expect(create).not.toContain("Retired note");
  });

  /**
   * Everything the form draws, without the `<form>` open tag itself. The tag carries
   * `data-required-message`, so a question about a control saying "required" is asked past it.
   */
  const withoutFormTag = (html: string) => html.slice(html.indexOf(">") + 1);

  test("required fields carry the required attribute; optional ones do not", () => {
    expect(form).toContain('name="title" aria-describedby="cap-tasks-title-guidance" required>');
    // The lone optional field renders without the word on any control. The form's open tag is cut
    // off first, because `data-required-message` says nothing about this field.
    expect(
      withoutFormTag(
        renderCreateForm(
          oneField({
            name: "note",
            label: "Note",
            type: "string",
            required: false,
            lifecycle: "active",
          }),
        ),
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
    expect(withoutFormTag(booleanForm)).not.toContain("required");
  });
});

describe("centralization — exhaustive over the admitted pantry", () => {
  // Drives straight off the registry enum: a new pantry type is rendered in both modes here and
  // fails loudly unless the renderer's two total switches handle it. A file field's control is
  // drawn in the browser, so its markup is the host the control mounts on and the value it posts.
  test("every fieldTypeSchema option renders in both modes as a control", () => {
    for (const type of fieldTypeSchema.options) {
      const probe = oneField(probeField(type));
      const capability = { ...probe, actions: [...probe.actions, "update"] as const };
      const create = renderCreateForm(capability);
      const edit = renderEditForm(capability, { id: "probe-1", value: sampleFieldValue(type) });

      for (const form of [create, edit]) {
        expect(form).toContain('name="value"');
        if (isFileFieldType(type)) expect(form).toContain("data-file-field");
        else expect(form).toMatch(/<(?:input|select|textarea)\b[^>]*name="value"/);
      }
    }
  });
});
