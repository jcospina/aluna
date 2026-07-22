// Shared setup, fixtures, and helpers for the platform route (app.ts) tests. Split
// out of app.test.ts so the per-concern sibling test files can each import exactly
// what they use. Not a test file itself (no `*.test.ts`), so bun never runs it.
//
// The /stream + build paths call the AI provider — these helpers drive them through
// a **fake** `Provider`, never the real one: no network, no spend, fully
// deterministic. The real streamed round-trip is proven by running the app, not
// asserted here — a test must not bill the BYO key on every run.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZodType } from "zod";

import { createApp } from "./app.ts";
import { openDatabase, type PlatformDatabase } from "./db.ts";
import { runMigrations } from "./migrations.ts";
import type { RecordMetrics } from "./pipeline/index.ts";
import type { DeepPartial, GenerateResult, Provider } from "./provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "./registry/index.ts";

export interface SseEvent {
  readonly id: string;
  readonly event: string;
  readonly data: string;
}

export interface ScratchDbEnv {
  dir: string;
  conns: PlatformDatabase;
  artifactsRoot: string;
}

export { makeMetricsRecorder } from "./metrics-test-recorder.ts";

// A fake provider: streams `greeting` one character at a time (like the real
// partialStream building up), then resolves the validated object carrying both
// fields. No SDK, no network — it satisfies the same `Provider` contract the real
// spine does.
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

// A provider factory that throws — stands in for a missing key (createProvider
// throws, naming OMNI_API_KEY) without touching the environment.
export function throwingProvider(message: string): () => Provider {
  return () => {
    throw new Error(message);
  };
}

// Drain an SSE response body to a single string.
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

// Join the data of every event of one type, in order — the per-type view the
// build tests read (each test used to inline this as a local `dataFor`).
export function eventData(events: SseEvent[], name: string): string {
  return events
    .filter((event) => event.event === name)
    .map((event) => event.data)
    .join("\n");
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// The scratch db + temp artifacts lifecycle the build/rehydration describes share.
// setup/teardown preserve the exact temp-dir + database lifecycle the original
// describes' beforeEach/afterEach established, per test.
export function createScratchDbEnv(prefix: string): ScratchDbEnv {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const conns = openDatabase(join(dir, "test.db"));
  runMigrations(conns.readwrite);
  return { dir, conns, artifactsRoot: join(dir, "artifacts") };
}

export function teardownScratchDbEnv(env: ScratchDbEnv): void {
  env.conns.readwrite.close();
  env.conns.readonly.close();
  rmSync(env.dir, { recursive: true, force: true });
}

// Build the demo/prompt app wired to commit against the scratch db + temp artifacts
// root, sharing the scratch pair with the router so a committed capability is
// immediately routable in the same test.
export function makeScratchApp(
  env: ScratchDbEnv,
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
  schema: {
    fields: [{ name: "text", label: "Text", type: "string", required: true, lifecycle: "active" }],
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
};

export const NOTES_INCARNATION_ID = "11111111-1111-4111-8111-111111111111";

export function notesCapabilityRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    ...NOTES_SPEC,
    incarnation_id: NOTES_INCARNATION_ID,
    version: 1,
    artifacts_path: `capabilities/notes/${NOTES_INCARNATION_ID}/v1/`,
    ...overrides,
  } as CapabilityRow;
}

// The one generated presentation surface — record → inner markup, composed from the
// closed primitive vocabulary and escaping the field value.
export const ITEM_RENDERER = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  "  const text = escapeHtml(record.text);",
  '  return `<div class="stack"><span class="text-lg text-bold truncate">$' +
    "{text}</span></div>`;",
  "}",
  "",
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

// The handlers render records through the injected `present` adapter — no row markup of
// their own (ADR-0005 §2), so create and read cannot drift.
export const CREATE_HANDLER = [
  "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
  '  if (String(input.values.text ?? "").trim().length === 0) return \'<div data-role="error" data-error-code="missing_required_fields" data-error-fields="text">Tell me what to save.</div>\';',
  "  const note = mutation.create({ text: input.values.text });",
  "  return present(note);",
  "}",
].join("\n");

export const READ_HANDLER = [
  "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
  "  const notes = query.records({",
  '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
  "  });",
  '  return notes.map(({ record }) => present(record)).join("");',
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

export const DELETE_HANDLER = [
  "export default async function remove({ mutation }: CapabilityDeleteContext): Promise<string> {",
  "  mutation.delete();",
  '  return "";',
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

export const BEHAVIORAL_SUITE = {
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
      expectedError: NOTES_SPEC.behavioral_errors[0],
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
      expectedError: NOTES_SPEC.behavioral_errors[1],
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

// A fake provider that returns a valid capability spec and then the complete generated
// inventory (item renderer, then all five handlers), recording each prompt — so the
// builder-stage demo route is driven end-to-end without a real call.
export function makeSpecProvider(
  spec: unknown,
  behavioralSuite: unknown = BEHAVIORAL_SUITE,
  units: {
    readonly item?: string;
    readonly create?: string;
    readonly read?: string;
    readonly update?: string;
    readonly delete?: string;
    readonly search?: string;
    readonly searchRepair?: string;
  } = {},
): { provider: Provider; prompts: string[] } {
  const prompts: string[] = [];
  const responses = [
    spec,
    { content: units.item ?? ITEM_RENDERER },
    { content: units.create ?? CREATE_HANDLER },
    { content: units.read ?? READ_HANDLER },
    { content: units.update ?? UPDATE_HANDLER },
    { content: units.delete ?? DELETE_HANDLER },
    { content: units.search ?? SEARCH_HANDLER },
    ...(units.searchRepair ? [{ content: units.searchRepair }] : []),
    behavioralSuite,
  ];
  const provider: Provider = {
    generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      const response = responses.shift();
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
