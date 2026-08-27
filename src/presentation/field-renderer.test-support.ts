// Shared fixtures for the field-renderer test files. One capability fixture plus the
// single-field probe and value sampler drive the create-form and edit-form suites.

import type { FieldType, SpecField } from "../registry/index.ts";
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
  form: { list_inputs: [] },
  actions: ["create", "read"],
};

export function oneField(
  field: SpecField,
  listMode: "comma_separated" | "repeatable" = "repeatable",
): RenderableCapability {
  return {
    id: "probe",
    label: "Probe",
    noun: "probe",
    schema: { fields: [field] },
    form: {
      list_inputs:
        field.lifecycle === "active" && field.type === "string[]"
          ? [{ field: field.name, mode: listMode }]
          : [],
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
    case "string[]":
      return ["first", "second"];
  }
}
