// Shared fixtures for the field-renderer test files. One capability fixture plus the
// single-field probe and value sampler drive the create-form and edit-form suites.

import type { ChoicePresentation, FieldType, SpecField } from "../registry/index.ts";
import type { RenderableCapability } from "./field-renderer.ts";

export const SAMPLE: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  noun: "task",
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
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  actions: ["create", "read"],
};

/** The options every choice probe declares, so a sampled value is always an admitted one. */
export const PROBE_CHOICE_OPTIONS = [
  { value: "first", label: "First" },
  { value: "second", label: "Second" },
] as const;

/** A well-formed field of any pantry type; a choice arrives carrying its declared options. */
export function probeField(type: FieldType, overrides: Partial<SpecField> = {}): SpecField {
  return {
    name: "value",
    label: "Value",
    type,
    required: true,
    lifecycle: "active",
    ...(type === "choice" ? { values: [...PROBE_CHOICE_OPTIONS], groups: [] } : {}),
    ...overrides,
  };
}

/** What the form may declare about the one field, beyond the two total collections. */
export interface OneFieldIntent {
  readonly longText?: boolean;
  readonly guidance?: string;
}

export function oneField(
  field: SpecField,
  listMode: "comma_separated" | "repeatable" = "repeatable",
  presentation: ChoicePresentation = "picker",
  intent: OneFieldIntent = {},
): RenderableCapability {
  const active = field.lifecycle === "active";
  return {
    id: "probe",
    label: "Probe",
    noun: "probe",
    schema: { fields: [field] },
    form: {
      list_inputs:
        active && field.type === "string[]" ? [{ field: field.name, mode: listMode }] : [],
      choice_inputs: active && field.type === "choice" ? [{ field: field.name, presentation }] : [],
      long_text: intent.longText === true ? [field.name] : [],
      guidance: intent.guidance === undefined ? [] : [{ field: field.name, text: intent.guidance }],
    },
    actions: ["create", "read"],
  };
}

export function sampleFieldValue(type: FieldType): string | number | boolean | readonly string[] {
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
    case "choice":
      return PROBE_CHOICE_OPTIONS[0].value;
    case "string[]":
      return ["first", "second"];
  }
}
