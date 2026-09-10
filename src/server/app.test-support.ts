// Shared setup, fixtures, and helpers for the platform route (app.ts) tests. Split
// out of app.test.ts so the per-concern sibling test files can each import exactly
// what they use. Not a test file itself (no `*.test.ts`), so bun never runs it.
//
// The build paths call the AI provider — these helpers drive them through a **fake**
// `Provider`, never the real one: no network, no spend, fully deterministic. The real
// streamed round-trip is proven by running the app and typing a prompt, not asserted
// here — a test must not bill the BYO key on every run.

import type { ZodType } from "zod";
import {
  behavioralResponseFor,
  type FullBehavioralTestSuite,
} from "../builder/gate/gate.test-support.ts";
import {
  DELETE_HANDLER,
  ITEM_RENDERER,
  READ_HANDLER,
} from "../builder/units/generation/unit-fixtures.test-support.ts";
import type { RecordMetrics } from "../pipeline/index.ts";
import type { IntentClassification } from "../pipeline/intent/index.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../platform/persistence/scratch-db.test-support.ts";
import type { DeepPartial, GenerateResult, Provider } from "../platform/provider/index.ts";
import { FIRST_INCARNATION_ID } from "../registry/incarnations.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  FULL_CAPABILITY_TOOLS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import { createApp } from "./app.ts";

export interface SseEvent {
  readonly id: string;
  readonly event: string;
  readonly data: string;
}

export { wait } from "../platform/async.test-support.ts";
export { makeMetricsRecorder } from "../platform/metrics/metrics-test-recorder.ts";
export {
  createScratchDbEnv,
  DELETE_HANDLER,
  ITEM_RENDERER,
  READ_HANDLER,
  type ScratchDbEnv,
  teardownScratchDbEnv,
};

/**
 * A fake provider: streams `greeting` a character at a time, then resolves the validated object.
 * The greeting/invitation shape is a Module 1 leftover; no surviving caller reads the values.
 */
export function makeFakeProvider(greeting: string, invitation: string): Provider {
  return {
    generate<T>(_prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        let acc = "";
        for (const ch of greeting) {
          acc += ch;
          yield { greeting: acc } as DeepPartial<T>;
        }
        yield { greeting, invitation } as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve({ greeting, invitation } as T),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      };
    },
  };
}

/**
 * A provider factory that throws — stands in for a missing key (createProvider
 * throws, naming OMNI_API_KEY) without touching the environment.
 */
export function throwingProvider(message: string): () => Provider {
  return () => {
    throw new Error(message);
  };
}

/**
 * Drain an SSE response body to a single string.
 */
export async function readSse(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("expected a readable SSE body");
  const decoder = new TextDecoder();
  let payload = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    payload += decoder.decode(value, { stream: true });
  }
  return payload + decoder.decode();
}

export function collectSseEvents(payload: string): SseEvent[] {
  return payload
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const id = lines.find((line) => line.startsWith("id:"))?.replace(/^id: ?/, "") ?? "";
      const event = lines.find((line) => line.startsWith("event:"))?.replace(/^event: ?/, "") ?? "";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data: ?/, ""))
        .join("\n");
      return { id, event, data };
    });
}

/**
 * Join the data of every event of one type, in order — the per-type view the
 * build tests read (each test used to inline this as a local `dataFor`).
 */
export function eventData(events: SseEvent[], name: string): string {
  return events
    .filter((event) => event.event === name)
    .map((event) => event.data)
    .join("\n");
}

/** What `escapeHtml` did, undone, so a test reads back the sentence Aluna actually said. */
const unescapeHtml = (value: string): string =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/**
 * Every sentence a stream put on the prompt bar, in order. Aluna working out what the typed
 * sentence is rides here too (`renderResolvingNotice`), so a test asking what a *run* said reads
 * this rather than searching the fragments for the slot's id and finding the desk's own line.
 */
export function promptBarSentences(events: SseEvent[]): string[] {
  const slot = /<div id="prompt-notice" hx-swap-oob="innerHTML">([\s\S]*?)<\/div>/g;
  return [...eventData(events, "fragment").matchAll(slot)].map((match) =>
    unescapeHtml((match[1] ?? "").replace(/<[^>]*>/g, "")),
  );
}

/**
 * The data of the last event of one type — the terminal snapshot of a preview that streams
 * repeatedly. Joining those with `eventData` yields concatenated JSON no test can parse.
 */
export function lastEventData(events: SseEvent[], name: string): string {
  return events.filter((event) => event.event === name).at(-1)?.data ?? "";
}

export function promptPost(prompt: string): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({ prompt }),
  };
}

export async function postPrompt(
  app: ReturnType<typeof createApp>,
  prompt: string,
): Promise<Response> {
  return app.request("/prompt", promptPost(prompt));
}

export async function responseText(res: Response): Promise<string> {
  return res.text();
}

export function buildJobIdFromSubscriber(fragment: string): string {
  const match = fragment.match(/data-build-job-id="([^"]+)"/);
  if (!match) throw new Error(`missing build job id in fragment: ${fragment}`);
  return match[1] ?? "";
}

export interface PromptBuildRun {
  readonly jobId: string;
  readonly payload: string;
  readonly events: SseEvent[];
}

/**
 * The production build in one call: submit the prompt, take the job id off the subscriber
 * fragment, then drain that job's stream. There is one admission path and it starts at `/prompt`.
 */
export async function runPromptBuild(
  app: ReturnType<typeof createApp>,
  prompt: string,
): Promise<PromptBuildRun> {
  const jobId = buildJobIdFromSubscriber(await responseText(await postPrompt(app, prompt)));
  const payload = await readSse(await app.request(`/build/${jobId}/stream`));
  return { jobId, payload, events: collectSseEvents(payload) };
}

/**
 * Build the prompt app wired to commit against the scratch db and temp artifacts root, sharing
 * the scratch pair with the router so a committed capability is routable in the same test.
 */
export function makeScratchApp(
  env: Partial<ScratchDbEnv> & Pick<ScratchDbEnv, "conns" | "artifactsRoot">,
  provider: Provider,
  recordMetrics: RecordMetrics,
) {
  return createApp({
    getProvider: () => provider,
    recordMetrics,
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    capabilityRouter: { databases: env.conns },
  });
}

export const NOTES_SPEC = {
  id: "notes",
  label: "Notes",
  subject: "an open notebook",
  ground: "grass_green",
  companion: "coral_orange",
  noun: "note",
  schema: {
    fields: [{ name: "text", label: "Text", type: "string", required: true, lifecycle: "active" }],
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
};

export const NOTES_INCARNATION_ID = FIRST_INCARNATION_ID;

/** A fixed seed: fixtures compare rows, so a random one would make them flaky. */
export const NOTES_LOGO_SEED = 184206;

export function notesCapabilityRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    ...NOTES_SPEC,
    incarnation_id: NOTES_INCARNATION_ID,
    version: 1,
    artifacts_path: `capabilities/notes/${NOTES_INCARNATION_ID}/v1/`,
    seed: NOTES_LOGO_SEED,
    logo: { status: "absent", attempts: 0 },
    display_label_override: null,
    ...overrides,
  } as CapabilityRow;
}

/**
 * The handlers render records through the injected `present` adapter — no row markup of their
 * own. Create, update and search stay local: these three answer a blank field with the route's
 * own refusal markup and search AND-across-terms, which the unit fixtures do not.
 */
export const CREATE_HANDLER = [
  "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
  '  if (String(input.values.text ?? "").trim().length === 0) return \'<div data-role="error" data-error-code="missing_required_fields" data-error-fields="text">Tell me what to save.</div>\';',
  "  const note = mutation.create({ text: input.values.text });",
  "  return present(note);",
  "}",
].join("\n");

export const UPDATE_HANDLER = [
  "export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {",
  '  if (input.submittedFields.has("text") && String(input.values.text ?? "").trim().length === 0) return \'<div data-role="error" data-error-code="missing_required_fields" data-error-fields="text">Tell me what to save.</div>\';',
  "  const patch: Record<string, unknown> = {};",
  '  if (input.submittedFields.has("text")) patch.text = input.values.text;',
  "  return present(mutation.update(patch));",
  "}",
].join("\n");

export const SEARCH_HANDLER = [
  "export default async function search({ input, query, present }: CapabilityContext): Promise<string> {",
  "  const raw = input.values.q;",
  '  const terms = (typeof raw === "string" ? raw : "").trim().split(/\\s+/u).filter(Boolean);',
  "  const records = terms.length === 0",
  "    ? query.records({",
  '        sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
  "      })",
  "    : query.records({",
  '        sql: \'WITH "search_terms" AS (SELECT "value" AS "term" FROM json_each(?)) SELECT "target"."id" AS "target_id" FROM "cap_notes" AS "target" WHERE NOT EXISTS (SELECT 1 FROM "search_terms" AS "search_term" WHERE coalesce(instr(platform_search_normalize("target"."text"), platform_search_normalize("search_term"."term")), 0) = 0) ORDER BY "target"."created_at" DESC, "target"."id" DESC\',',
  "        parameters: [JSON.stringify(terms)],",
  "      });",
  '  return records.map(({ record }) => present(record)).join("");',
  "}",
].join("\n");

type BehavioralExpectedError = FullBehavioralTestSuite["cases"][number]["expectedError"];

/** The authored error at `index`, in the shape a behavioral case copies it into. */
function notesBehavioralError(index: number): BehavioralExpectedError {
  return NOTES_SPEC.behavioral_errors[index] as BehavioralExpectedError;
}

export const BEHAVIORAL_SUITE: FullBehavioralTestSuite = {
  cases: [
    {
      action: "create",
      name: "stores and renders note text",
      setupRows: [],
      target: null,
      input: [{ field: "text", value: "Behavioral note" }],
      expectedRows: [{ values: [{ field: "text", value: "Behavioral note" }] }],
      expectedRowCount: 1,
      expectFragmentIncludes: ["Behavioral note"],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: [],
      expectedError: null,
      expectedPlatformError: null,
    },
    {
      action: "read",
      name: "reads stored notes newest first",
      setupRows: [{ values: [{ field: "text", value: "Read me" }] }],
      target: null,
      input: [],
      expectedRows: [{ values: [{ field: "text", value: "Read me" }] }],
      expectedRowCount: 1,
      expectFragmentIncludes: ["Read me"],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: ["Read me"],
      expectedError: null,
      expectedPlatformError: null,
    },
    {
      action: "update",
      name: "updates the bound note",
      setupRows: [{ values: [{ field: "text", value: "Before" }] }],
      target: "first_setup_row",
      input: [{ field: "text", value: "After" }],
      expectedRows: [{ values: [{ field: "text", value: "After" }] }],
      expectedRowCount: 1,
      expectFragmentIncludes: ["After"],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: [],
      expectedError: null,
      expectedPlatformError: null,
    },
    {
      action: "delete",
      name: "deletes the bound note",
      setupRows: [{ values: [{ field: "text", value: "Delete me" }] }],
      target: "first_setup_row",
      input: [],
      expectedRows: [],
      expectedRowCount: 0,
      expectFragmentIncludes: [],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: [],
      expectedError: null,
      expectedPlatformError: null,
    },
    {
      action: "search",
      name: "searches note text",
      setupRows: [
        { values: [{ field: "text", value: "Matching note newest" }] },
        { values: [{ field: "text", value: "Matching note older" }] },
        { values: [{ field: "text", value: "Other entry" }] },
      ],
      target: null,
      input: [{ field: "q", value: "matching" }],
      expectedRows: [
        { values: [{ field: "text", value: "Matching note newest" }] },
        { values: [{ field: "text", value: "Matching note older" }] },
        { values: [{ field: "text", value: "Other entry" }] },
      ],
      expectedRowCount: 3,
      expectFragmentIncludes: ["Matching note newest", "Matching note older"],
      expectFragmentExcludes: ["Other entry"],
      expectFragmentIncludesInOrder: ["Matching note newest", "Matching note older"],
      expectedError: null,
      expectedPlatformError: null,
    },
    {
      action: "create",
      name: "create requires note text",
      setupRows: [],
      target: null,
      input: [],
      expectedRows: [],
      expectedRowCount: 0,
      expectFragmentIncludes: [],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: [],
      expectedError: notesBehavioralError(0),
      expectedPlatformError: null,
    },
    {
      action: "update",
      name: "update requires note text",
      setupRows: [{ values: [{ field: "text", value: "Preserved" }] }],
      target: "first_setup_row",
      input: [{ field: "text", value: "" }],
      expectedRows: [{ values: [{ field: "text", value: "Preserved" }] }],
      expectedRowCount: 1,
      expectFragmentIncludes: [],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: [],
      expectedError: notesBehavioralError(1),
      expectedPlatformError: null,
    },
    {
      action: "update",
      name: "missing update target is stable",
      setupRows: [{ values: [{ field: "text", value: "Unchanged" }] }],
      target: "missing_record",
      input: [{ field: "text", value: "After" }],
      expectedRows: [{ values: [{ field: "text", value: "Unchanged" }] }],
      expectedRowCount: 1,
      expectFragmentIncludes: [],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: [],
      expectedError: null,
      expectedPlatformError: { action: "update", code: "record_not_found" },
    },
    {
      action: "delete",
      name: "missing delete target is stable",
      setupRows: [{ values: [{ field: "text", value: "Unchanged" }] }],
      target: "missing_record",
      input: [],
      expectedRows: [{ values: [{ field: "text", value: "Unchanged" }] }],
      expectedRowCount: 1,
      expectFragmentIncludes: [],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: [],
      expectedError: null,
      expectedPlatformError: { action: "delete", code: "record_not_found" },
    },
  ],
};

/** The resolver answer a new-capability build suite hands back for "track my notes". */
export const NEW_CAPABILITY_INTENT: IntentClassification = {
  type: "new_capability",
  confidence: 0.97,
  target_capability: null,
  resolution: "new",
  proposed_identity: null,
  proposed_action: "Create a notes capability.",
  user_facing_label: "Got it. I'm putting that together now.",
  requires_confirmation: false,
};

/** The resolver answer for a sentence Aluna will not act on: no build, and no window. */
export const REJECT_INTENT: IntentClassification = {
  type: "reject",
  confidence: 0.91,
  target_capability: null,
  resolution: "none",
  proposed_identity: null,
  proposed_action: "Refuse a sentence with nothing to make in it.",
  user_facing_label: "I'm not sure what to make from that.",
  requires_confirmation: false,
};

/** The resolver answer for a question: a read across what the user already keeps. */
export const DATA_QUERY_INTENT: IntentClassification = {
  type: "data_query",
  confidence: 0.89,
  target_capability: "notes",
  resolution: "none",
  proposed_identity: null,
  proposed_action: "Answer a question about saved notes.",
  user_facing_label: "I can look across your notes.",
  requires_confirmation: false,
};

/** The generated units a build suite may override, plus the Gate's repair answers. */
export interface PromptBuildUnits {
  readonly item?: string;
  readonly create?: string;
  readonly read?: string;
  readonly update?: string;
  readonly delete?: string;
  readonly search?: string;
  readonly updateRepair?: string;
  readonly searchRepair?: string;
  /** Additional Gate repair responses in provider-call order. */
  readonly repairs?: readonly string[];
}

/**
 * A fake provider for the whole production build: classification, then the capability spec, then
 * the generated inventory, recording each prompt. The intent leads; no build starts without one.
 */
export function makePromptBuildProvider(
  intent: IntentClassification,
  spec: unknown = NOTES_SPEC,
  behavioralSuite: unknown = BEHAVIORAL_SUITE,
  units: PromptBuildUnits = {},
): { provider: Provider; prompts: string[] } {
  const prompts: string[] = [];
  const responses = [
    intent,
    spec,
    { content: units.item ?? ITEM_RENDERER },
    { content: units.create ?? CREATE_HANDLER },
    { content: units.read ?? READ_HANDLER },
    { content: units.update ?? UPDATE_HANDLER },
    { content: units.delete ?? DELETE_HANDLER },
    { content: units.search ?? SEARCH_HANDLER },
    ...(units.updateRepair ? [{ content: units.updateRepair }] : []),
    ...(units.searchRepair ? [{ content: units.searchRepair }] : []),
    ...(units.repairs ?? []).map((content) => ({ content })),
  ];
  const provider: Provider = {
    generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      // Behavioral tests are generated per Action and before the units, so they are answered by
      // prompt rather than by queue position; the queue keeps the spec and unit order it had.
      const response = prompt.startsWith("Generate deterministic black-box behavioral tests")
        ? behavioralResponseFor(prompt, behavioralSuite)
        : responses.shift();
      if (response === undefined) {
        throw new Error(`fake provider exhausted after ${prompts.length} prompt(s)`);
      }
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield response as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(response as T),
        usage: Promise.resolve({ inputTokens: 41, outputTokens: 12, totalTokens: 53 }),
      };
    },
  };
  return { provider, prompts };
}
