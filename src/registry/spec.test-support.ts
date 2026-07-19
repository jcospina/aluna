// Shared fixtures for the capability spec-shape test suite. `validSpec` is the
// single minimal valid spec every split test file builds on, so it lives here
// rather than being duplicated across siblings. This module is not run as a
// test by bun.

import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  defaultBehavioralErrorsForSchema,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "./spec.ts";

// A minimal valid spec, fresh per call so tests can mutate freely. Overrides
// merge shallowly — pass a whole `schema`/`ui_intent` object to change those.
export function validSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  const spec: CapabilitySpec = {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
      {
        action: "update",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };

  const normalizedSpec = {
    ...spec,
    ...(overrides.schema && !("ui_intent" in overrides)
      ? {
          ui_intent: {
            ...spec.ui_intent,
            form: {
              list_inputs: spec.schema.fields
                .filter((field) => field.lifecycle === "active" && field.type === "string[]")
                .map((field) => ({ field: field.name, mode: "repeatable" as const })),
            },
            item: {
              ...spec.ui_intent.item,
              shows: spec.schema.fields
                .filter((field) => field.lifecycle === "active")
                .map((field) => field.name),
            },
            detail: {
              shows: spec.schema.fields
                .filter((field) => field.lifecycle === "active")
                .map((field) => field.name),
            },
          },
        }
      : {}),
    ...(overrides.schema && !("behavioral_errors" in overrides)
      ? { behavioral_errors: defaultBehavioralErrorsForSchema(spec.schema) }
      : {}),
  };

  if (overrides.schema || !("behavioral_errors" in overrides)) {
    return normalizedSpec;
  }

  return spec;
}
