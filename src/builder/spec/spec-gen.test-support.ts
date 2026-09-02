// Shared fixtures for the spec-generation suites. No test calls a real provider: a fake
// records the prompt + schema and returns a chosen object and usage through the same
// provider contract the real spine exposes, so these cover the happy path and the
// non-conforming-output path without spending against a key. The fake resolves `.object`
// to the raw value *unparsed* on purpose — it makes the stage's own Zod gate the thing
// under test.

import type { ZodType } from "zod";

import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { SendBuildEvent } from "../../pipeline/jobs/build-jobs.ts";
import type {
  DeepPartial,
  GenerateResult,
  Provider,
  TokenUsage,
} from "../../platform/provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  FULL_CAPABILITY_TOOLS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../registry/index.ts";

export interface RecordedCall {
  readonly prompt: string;
  readonly schema: ZodType<unknown>;
}

export interface RecordingProvider extends Provider {
  readonly calls: RecordedCall[];
}

export const STUB_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

// A fake provider: records the call, then resolves `.object` to `raw` exactly as
// given (no internal parse) so the stage's validation is what gates the output.
export function makeSpecProvider(raw: unknown, usage: TokenUsage = STUB_USAGE): RecordingProvider {
  const calls: RecordedCall[] = [];

  return {
    calls,
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      calls.push({ prompt, schema: schema as ZodType<unknown> });

      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield raw as DeepPartial<T>;
      }

      return {
        partialStream: stream(),
        object: Promise.resolve(raw as T),
        usage: Promise.resolve(usage),
      };
    },
  };
}

// Captures everything narrated over the job's stream, so a test can assert the
// product voice and that no internals leak.
export function recordingSend(): {
  events: Array<{ event: string; data: string }>;
  send: SendBuildEvent;
} {
  const events: Array<{ event: string; data: string }> = [];
  const send: SendBuildEvent = async (event, data) => {
    events.push({ event: String(event), data });
  };
  return { events, send };
}

export function notesIntent(overrides: Partial<IntentClassification> = {}): IntentClassification {
  return {
    type: "new_capability",
    confidence: 0.92,
    target_capability: null,
    resolution: "new",
    proposed_identity: null,
    proposed_action: "Create a place to keep the user's notes.",
    user_facing_label: "I'll make a place for your notes.",
    requires_confirmation: false,
    ...overrides,
  };
}

export function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    subject: "an open notebook",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "note",
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
}
