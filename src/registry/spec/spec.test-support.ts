// Shared fixtures for the capability spec-shape test suite. `validSpec` is the
// single minimal valid spec every split test file builds on, so it lives here
// rather than being duplicated across siblings. This module is not run as a
// test by bun.

import { FULL_CAPABILITY_TOOLS } from "../tools.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  defaultBehavioralErrorsForSchema,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "./spec.ts";

/**
 * A minimal valid spec, fresh per call so tests can mutate freely. Overrides
 * merge shallowly — pass a whole `schema`/`ui_intent` object to change those.
 */
export function validSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  const spec: CapabilitySpec = {
    id: "notes",
    label: "Notes",
    subject: "an open notebook",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "note",
    plural_noun: "notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
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
    tools: [...FULL_CAPABILITY_TOOLS],
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
              choice_inputs: spec.schema.fields
                .filter((field) => field.lifecycle === "active" && field.type === "choice")
                .map((field) => ({ field: field.name, presentation: "picker" as const })),
              // Both subset collections stay empty: opting a field into a multi-line
              // control or giving it a hint is a choice, never something a shape implies.
              long_text: [],
              guidance: [],
            },
            item: {
              ...spec.ui_intent.item,
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

/**
 * The notes fixture every layer builds on: two fields, both behavioral errors, the full Action
 * inventory. Fresh per call, and overrides merge shallowly — unlike `validSpec`, nothing here
 * is re-derived from a replaced `schema`.
 */
export function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    subject: "an open notebook",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "note",
    plural_noun: "notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
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
    tools: [...FULL_CAPABILITY_TOOLS],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}
