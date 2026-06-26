// Tests for the platform's one route file. The /stream channel calls the AI
// provider — so these drive it through a **fake** `Provider` injected into
// `createApp`, never the real one: no network, no spend, fully deterministic. (The
// real streamed round-trip is proven by running the app, not asserted here — that
// is the whole point of the rework: a test must not bill the BYO key on every run.)
// The fakeability is the contract's, by design (src/provider/contract.test.ts).
//
// Incrementality is asserted structurally (more than one narration event; the
// reassembled narration equals the greeting), not via wall-clock timing, to stay
// non-flaky. app.request() drives app.fetch without binding a port.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ZodType } from "zod";

import { createApp } from "./app.ts";
import { type BuildPipeline, createBuildJobQueue } from "./build-jobs.ts";
import { openDatabase, type PlatformDatabase } from "./db.ts";
import type { IntentClassification } from "./intent-resolver/index.ts";
import type { GenerationMetrics } from "./metrics/index.ts";
import { runMigrations } from "./migrations.ts";
import type { DeepPartial, GenerateResult, Provider } from "./provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  getCapability,
  insertCapability,
  listCapabilities,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "./registry/index.ts";

// A capturing metrics recorder: the demo path writes its generation-metrics row
// (Epic 2.7) through AppDeps.recordMetrics, so the demo tests inject this to assert
// the wiring without touching the real data file. Always injected on the demo path.
function makeMetricsRecorder(): {
  rows: GenerationMetrics[];
  recordMetrics: (m: GenerationMetrics) => void;
} {
  const rows: GenerationMetrics[] = [];
  return { rows, recordMetrics: (m) => void rows.push(m) };
}

interface SseEvent {
  readonly id: string;
  readonly event: string;
  readonly data: string;
}

setDefaultTimeout(15_000);

// A fake provider: streams `greeting` one character at a time (like the real
// partialStream building up), then resolves the validated object carrying both
// fields. No SDK, no network — it satisfies the same `Provider` contract the real
// spine does.
function makeFakeProvider(greeting: string, invitation: string): Provider {
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
function throwingProvider(message: string): () => Provider {
  return () => {
    throw new Error(message);
  };
}

// Drain an SSE response body to a single string.
async function readSse(res: Response): Promise<string> {
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

// Reassemble the text of every `narration` event, in order — the greeting as the
// client would see it typed in.
function collectNarration(payload: string): string {
  return payload
    .split("\n\n")
    .filter((block) => block.includes("event: narration"))
    .map(
      (block) =>
        block
          .split("\n")
          .find((line) => line.startsWith("data:"))
          // Strip the field name and the single optional separator space (SSE drops
          // one leading space from the value), keeping the value — including a value
          // that *is* a space.
          ?.replace(/^data: ?/, "") ?? "",
    )
    .join("");
}

function collectSseEvents(payload: string): SseEvent[] {
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

function createIdSequence(ids: readonly string[]): () => string {
  let index = 0;
  return () => {
    const id = ids[index];
    if (!id) throw new Error("test exhausted build ids");
    index += 1;
    return id;
  };
}

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function promptPost(prompt: string): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({ prompt }),
  };
}

async function postPrompt(app: ReturnType<typeof createApp>, prompt: string): Promise<Response> {
  return app.request("/prompt", promptPost(prompt));
}

async function responseText(res: Response): Promise<string> {
  return res.text();
}

function buildJobIdFromSubscriber(fragment: string): string {
  const match = fragment.match(/data-build-job-id="([^"]+)"/);
  if (!match) throw new Error(`missing build job id in fragment: ${fragment}`);
  return match[1] ?? "";
}

describe("GET / (shell)", () => {
  test("uses the prompt bar for the build-job flow and removes the old greeting button", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('id="spec-build-form"');
    expect(html).toContain('hx-post="/prompt"');
    expect(html).toContain('hx-target="#spec-build-output"');
    expect(html).toContain('hx-swap="innerHTML"');
    expect(html).not.toContain("@htmx:sseOpen.window");
    expect(html).not.toContain("@htmx:sseClose.window");
    expect(html).not.toContain("@htmx:sseError.window");
    expect(html).toContain("promptBusy ? 'Making it' : 'Make it'");
    expect(html).toContain('id="spec-build-prompt"');
    expect(html).toContain('placeholder="What would you like to keep track of?"');
    expect(html).not.toContain('value="I want to keep track of my notes"');
    expect(html).toContain('id="spec-build-trigger"');
    expect(html).toContain("Make it");
    expect(html).toContain('id="spec-build-preview"');
    expect(html).toContain('id="spec-migration-preview"');
    expect(html).toContain('id="spec-units-preview"');
    expect(html).toContain('id="spec-gate-preview"');
    expect(html).toContain('id="spec-commit-preview"');
    expect(html).toContain('id="spec-build-output"');
    expect(html).toContain('id="prompt-notice"');
    expect(html).not.toContain("Meet Aluna");
    expect(html).not.toContain('id="intro-trigger"');
    expect(html).not.toContain('id="intro-output"');
  });

  test("browser prompt glue leaves the prompt request and stream connection to HTMX", async () => {
    const app = createApp();
    const js = await responseText(await app.request("/static/app.js"));

    expect(js).toContain('document.addEventListener("htmx:sseBeforeMessage"');
    expect(js).toContain('document.addEventListener("htmx:sseOpen"');
    expect(js).toContain('document.addEventListener("htmx:sseClose"');
    expect(js).toContain('document.addEventListener("htmx:sseError"');
    expect(js).toContain('document.addEventListener("htmx:oobAfterSwap"');
    expect(js).toContain("syncCapabilityPresentationState");
    expect(js).toContain("dataset.previewTarget");
    expect(js).not.toContain("new EventSource");
    expect(js).not.toContain('fetch("/prompt"');
    expect(js).not.toContain('addEventListener("submit"');
  });

  test("loads the vendored htmx SSE extension after htmx", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/"));

    // The extension is vendored locally and its <script> is loaded after htmx's
    // (it calls htmx.defineExtension at load). Compare the full src attributes so
    // prose mentions of the filenames in nearby comments can't skew the order.
    expect(html).toContain('src="/static/vendor/htmx-ext-sse.min.js"');
    expect(html.indexOf('src="/static/vendor/htmx.min.js"')).toBeLessThan(
      html.indexOf('src="/static/vendor/htmx-ext-sse.min.js"'),
    );
  });

  test("serves the vendored htmx SSE extension as JavaScript at its static path", async () => {
    const app = createApp();
    const res = await app.request("/static/vendor/htmx-ext-sse.min.js");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("javascript");
    // It is the htmx SSE extension: it registers itself on htmx at load.
    expect(body).toContain('defineExtension("sse"');
  });
});

describe("GET /stream (provider liveness, fake provider)", () => {
  const greeting = "Hi — I'm so glad you're here.";
  const invitation = "Tell me what you'd like to keep <3";

  test("responds with SSE headers", async () => {
    const app = createApp({ getProvider: () => makeFakeProvider(greeting, invitation) });
    const res = await app.request("/stream");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    await res.body?.cancel();
  });

  test("streams the greeting as narration, then the invitation fragment, then closes", async () => {
    const app = createApp({ getProvider: () => makeFakeProvider(greeting, invitation) });
    const payload = await readSse(await app.request("/stream"));

    // The greeting arrived incrementally and reassembles to the whole thing.
    expect((payload.match(/event: narration/g) ?? []).length).toBeGreaterThan(1);
    expect(collectNarration(payload)).toBe(greeting);

    // The invitation rides in an HTML fragment, with its dynamic text escaped — the
    // raw "<3" must not reach the page as markup.
    expect(payload).toContain("event: fragment");
    expect(payload).toContain('<p class="intro__invitation">');
    expect(payload).toContain("keep &lt;3");
    expect(payload).not.toContain("keep <3");

    // Terminal event, server closes cleanly.
    expect(payload).toContain("event: done");
  });
});

describe("GET /stream (failure surfaces clearly, not silently)", () => {
  test("a missing key streams a product-voice apology, never a crash", async () => {
    // createProvider would throw "Missing OMNI_API_KEY ..."; the route must turn
    // that into a warm, jargon-free message — and still close cleanly (HTTP 200,
    // an SSE stream, not a 500).
    const app = createApp({ getProvider: throwingProvider("Missing OMNI_API_KEY. ...") });
    const res = await app.request("/stream");
    expect(res.status).toBe(200);

    const payload = await readSse(res);
    expect(payload).toContain("event: narration");
    expect(payload).toMatch(/mind trying again/i);
    expect(payload).toContain("event: done");
    // No internals leak into the UI copy (ARCH §9.7).
    expect(payload).not.toMatch(/OMNI_API_KEY|api key|provider/i);
    // No proposal fragment on the error path.
    expect(payload).not.toContain("event: fragment");
  });
});

// A fake provider that returns a valid capability spec and then the four generated
// units, recording each prompt — so the builder-stage demo route is driven
// end-to-end without a real call.
function makeSpecProvider(
  spec: unknown,
  behavioralSuite: unknown = BEHAVIORAL_SUITE,
  units: {
    readonly create?: string;
    readonly read?: string;
    readonly list?: string;
    readonly createView?: string;
  } = {},
): { provider: Provider; prompts: string[] } {
  const prompts: string[] = [];
  const responses = [
    spec,
    { content: units.create ?? CREATE_HANDLER },
    { content: units.read ?? READ_HANDLER },
    { content: units.list ?? LIST_VIEW },
    { content: units.createView ?? CREATE_VIEW },
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

function makePromptBuildProvider(
  intent: IntentClassification,
  spec: unknown = NOTES_SPEC,
  behavioralSuite: unknown = BEHAVIORAL_SUITE,
  units: {
    readonly create?: string;
    readonly read?: string;
    readonly list?: string;
    readonly createView?: string;
  } = {},
): { provider: Provider; prompts: string[] } {
  const prompts: string[] = [];
  const responses = [
    intent,
    spec,
    { content: units.create ?? CREATE_HANDLER },
    { content: units.read ?? READ_HANDLER },
    { content: units.list ?? LIST_VIEW },
    { content: units.createView ?? CREATE_VIEW },
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

function makeSpecProviderWithBehavioralError(
  spec: unknown,
  error: Error,
): { provider: Provider; prompts: string[] } {
  const prompts: string[] = [];
  const responses = [
    spec,
    { content: CREATE_HANDLER },
    { content: READ_HANDLER },
    { content: LIST_VIEW },
    { content: CREATE_VIEW },
  ];
  const provider: Provider = {
    generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      const response = responses.shift();

      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        if (response !== undefined) yield response as DeepPartial<T>;
      }

      if (response === undefined) {
        return {
          partialStream: stream(),
          object: Promise.reject(error),
          usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
        };
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

const NOTES_SPEC = {
  id: "notes",
  label: "Notes",
  schema: { fields: [{ name: "text", type: "string", required: true }] },
  ui_intent: { views: ["list", "create"] },
  behavior: "Text is required. Newest notes appear first.",
  behavioral_errors: [
    {
      action: "create",
      trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      fields: ["text"],
      expected_markers: BEHAVIORAL_ERROR_MARKERS,
    },
  ],
  tools: ["create", "read"],
  prompt_context: "Stores the user's text notes.",
};

const PERSONAL_NOTES_SPEC = {
  ...NOTES_SPEC,
  id: "personal_notes",
  label: "Personal Notes",
  prompt_context:
    "Stores personal notes with titles, content, optional tags, pinned status, and an optional note date for easy retrieval.",
};

function notesCapabilityRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    ...NOTES_SPEC,
    version: 1,
    artifacts_path: "capabilities/notes/v1/",
    ...overrides,
  } as CapabilityRow;
}

const CREATE_HANDLER = [
  "export default async function create({ input, data }: CapabilityContext): Promise<string> {",
  "  const note = data.insert({ text: input.text });",
  '  return `<article class="note"><p>$' + "{escapeHtml(note.text)}</p></article>`;",
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

const MISSING_MARKER_CREATE_HANDLER = [
  "export default async function create({ input, data }: CapabilityContext): Promise<string> {",
  '  if (String(input.text ?? "").trim().length === 0) {',
  "    return '<div class=\"error\">Any friendly copy can go here.</div>';",
  "  }",
  "  const note = data.insert({ text: input.text });",
  '  return `<article class="note"><p>$' + "{escapeHtml(note.text)}</p></article>`;",
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

const READ_HANDLER = [
  "export default async function read({ data }: CapabilityContext): Promise<string> {",
  "  const notes = data.select();",
  '  if (notes.length === 0) return \'<ul class="notes" data-empty="true"></ul>\';',
  "  const items = notes",
  '    .map((note) => `<li class="note">$' + "{escapeHtml(note.text)}</li>`)",
  '    .join("");',
  '  return `<ul class="notes">$' + "{items}</ul>`;",
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

const LIST_VIEW = `<section class="capability-view" aria-labelledby="notes-heading">
  <h2 id="notes-heading">Notes</h2>
  <div id="notes-records" hx-get="/capability/notes/read" hx-trigger="load" hx-swap="innerHTML"></div>
</section>`;

const CREATE_VIEW = `<form class="capability-form" hx-post="/capability/notes/create" hx-target="#notes-records" hx-swap="afterbegin">
  <label>
    <span>Text</span>
    <textarea name="text" required></textarea>
  </label>
  <button type="submit">Add</button>
</form>`;

const BEHAVIORAL_SUITE = {
  cases: [
    {
      name: "stores and renders note text",
      setupRows: [],
      input: [{ field: "text", value: "Behavioral note" }],
      expectedCreatedRow: [{ field: "text", value: "Behavioral note" }],
      expectedRowCount: 1,
      expectCreateFragmentIncludes: ["Behavioral note"],
      expectReadFragmentIncludes: ["Behavioral note"],
      expectReadFragmentIncludesInOrder: [],
      expectedError: null,
    },
  ],
};

const VALIDATION_ERROR_SUITE = {
  cases: [
    {
      name: "missing note text emits stable validation markers",
      setupRows: [],
      input: [],
      expectedCreatedRow: [],
      expectedRowCount: 0,
      expectCreateFragmentIncludes: [],
      expectReadFragmentIncludes: [],
      expectReadFragmentIncludesInOrder: [],
      expectedError: {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    },
  ],
};

describe("GET /demo/spec-build (builder-stage liveness, fake provider)", () => {
  // The demo now commits for real (Epic 2.5g): the migration, gate, and registry
  // insert ride a scratch db pair, and committed artifacts land in a throwaway
  // directory — never the real data file or the tracked capabilities/ tree. The
  // same scratch pair is handed to the capability router so a committed build is
  // immediately routable in the same test.
  let dir: string;
  let conns: PlatformDatabase;
  let artifactsRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-spec-build-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
    artifactsRoot = join(dir, "artifacts");
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Build the demo app wired to commit against the scratch db + temp artifacts root,
  // sharing the scratch pair with the router so a committed capability is routable.
  function committingApp(provider: Provider, recordMetrics: (m: GenerationMetrics) => void) {
    return createApp({
      getProvider: () => provider,
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
    });
  }

  test("narrates, previews stages, commit-swaps content and toolbar, and closes", async () => {
    const { provider, prompts } = makeSpecProvider(NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20my%20notes")),
    );
    const dataFor = (name: string) =>
      events
        .filter((event) => event.event === name)
        .map((event) => event.data)
        .join("\n");

    const eventNames = events.map((event) => event.event);
    expect(eventNames[0]).toBe("narration");
    expect(eventNames).toContain("spec-preview");
    expect(eventNames).toContain("migration-preview");
    expect(eventNames).toContain("units-preview");
    expect(eventNames).toContain("gate-preview");
    expect(eventNames).toContain("commit-preview");
    expect(eventNames.at(-2)).toBe("commit");
    expect(eventNames.at(-1)).toBe("done");
    expect(eventNames.indexOf("units-preview")).toBeGreaterThan(
      eventNames.indexOf("migration-preview"),
    );
    expect(eventNames.indexOf("gate-preview")).toBeGreaterThan(
      eventNames.lastIndexOf("units-preview"),
    );
    // Commit is the terminal stage: it lands strictly after the gate passes and just
    // before the stream closes.
    expect(eventNames.indexOf("commit-preview")).toBeGreaterThan(
      eventNames.indexOf("gate-preview"),
    );
    expect(eventNames.indexOf("commit-preview")).toBeLessThan(eventNames.indexOf("commit"));

    // The demo preview deliberately carries the raw spec (the developer's liveness
    // view) — internals here are the point.
    expect(dataFor("spec-preview")).toContain("schema");
    expect(dataFor("spec-preview")).toContain("notes");

    const migrationPreview = JSON.parse(dataFor("migration-preview")) as {
      kind: string;
      tableName: string;
      sql: string;
      columns: Array<{ name: string; type: string; required: boolean; primaryKey: boolean }>;
    };
    expect(migrationPreview.kind).toBe("migration-preview");
    expect(migrationPreview.tableName).toBe("cap_notes");
    expect(migrationPreview.sql).toContain('CREATE TABLE "cap_notes"');
    expect(migrationPreview.columns.slice(0, 3)).toMatchObject([
      { name: "id", type: "TEXT", required: true, primaryKey: true, defaultValue: null },
      {
        name: "created_at",
        type: "TEXT",
        required: true,
        primaryKey: false,
        defaultValue: "datetime('now')",
      },
      { name: "extra", type: "TEXT", required: true, primaryKey: false, defaultValue: "'{}'" },
    ]);
    expect(migrationPreview.columns.map((column) => column.name)).toContain("text");

    const unitPreviewEvents = events.filter((event) => event.event === "units-preview");
    expect(unitPreviewEvents.length).toBeGreaterThan(1);
    const firstUnitsPreview = JSON.parse(unitPreviewEvents[0]?.data ?? "") as {
      status: string;
      units: Array<{ kind: string; name: string; status: string; content: string }>;
    };
    expect(firstUnitsPreview.status).toBe("running");
    expect(firstUnitsPreview.units[0]).toMatchObject({
      kind: "handler",
      name: "create",
      status: "generating",
    });

    const unitsPreview = JSON.parse(unitPreviewEvents.at(-1)?.data ?? "") as {
      kind: string;
      status: string;
      codeGenDurationMs: number;
      htmlGenDurationMs: number;
      units: Array<{
        kind: string;
        name: string;
        filename: string;
        attempts: number;
        content: string;
      }>;
    };
    expect(unitsPreview.kind).toBe("unit-generation-preview");
    expect(unitsPreview.status).toBe("complete");
    expect(unitsPreview.codeGenDurationMs).toBeGreaterThanOrEqual(0);
    expect(unitsPreview.htmlGenDurationMs).toBeGreaterThanOrEqual(0);
    expect(unitsPreview.units.map((unit) => `${unit.kind}:${unit.name}:${unit.filename}`)).toEqual([
      "handler:create:create.ts",
      "handler:read:read.ts",
      "view:list:list.html",
      "view:create:create.html",
    ]);
    expect(unitsPreview.units.every((unit) => unit.attempts === 1)).toBe(true);
    expect(unitsPreview.units.find((unit) => unit.filename === "create.ts")?.content).toContain(
      "export default async function create",
    );
    expect(unitsPreview.units.find((unit) => unit.filename === "list.html")?.content).toContain(
      'hx-get="/capability/notes/read"',
    );

    const gatePreview = JSON.parse(dataFor("gate-preview")) as {
      kind: string;
      status: string;
      durationMs: number;
      rungs: Array<{ rung: string; status: string; durationMs: number }>;
      smoke: {
        tableName: string;
        rowCount: number;
        createFragmentLength: number;
        readFragmentLength: number;
        realDatabaseUnchanged: boolean;
      };
      behavioral: {
        tier: string;
        status: string;
        testGen: { outcome: string; testCount: number; usage: { totalTokens: number } };
        testRun: { outcome: string; cases: Array<{ name: string; status: string }> };
      };
    };
    expect(gatePreview.kind).toBe("gate-preview");
    expect(gatePreview.status).toBe("passed");
    expect(gatePreview.durationMs).toBeGreaterThanOrEqual(0);
    expect(gatePreview.rungs.map((rung) => `${rung.rung}:${rung.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
    ]);
    expect(gatePreview.rungs.every((rung) => rung.durationMs >= 0)).toBe(true);
    expect(gatePreview.smoke).toMatchObject({
      tableName: "cap_notes",
      rowCount: 1,
      realDatabaseUnchanged: true,
    });
    expect(gatePreview.smoke.createFragmentLength).toBeGreaterThan(0);
    expect(gatePreview.smoke.readFragmentLength).toBeGreaterThan(0);
    expect(gatePreview.behavioral).toMatchObject({
      tier: "on",
      status: "passed",
      testGen: { outcome: "passed", testCount: 1, usage: { totalTokens: 53 } },
      testRun: {
        outcome: "passed",
        cases: [{ name: "stores and renders note text", status: "passed" }],
      },
    });

    // The product-voice narration must NOT leak internals (ARCH §9.7). The commit
    // event carries generated HTML, including classes and HTMX attributes, so the
    // internals check stays scoped to visible narration copy.
    expect(dataFor("narration")).not.toMatch(/\bspec\b|\bschema\b|\bhandler\b|\bmigration\b/i);
    const commitSwap = dataFor("commit");
    expect(commitSwap).toContain('class="capability-surface"');
    expect(commitSwap).toContain('data-active-capability-id="notes"');
    expect(commitSwap).toContain('hx-get="/capability/notes/read"');
    expect(commitSwap).toContain('hx-post="/capability/notes/create"');
    expect(commitSwap).toContain('hx-target="#notes-records"');
    expect(commitSwap).toContain('hx-swap-oob="beforeend:#capability-toolbar"');
    expect(commitSwap).toContain("data-capability-entry");
    expect(commitSwap).toContain('hx-get="/capability/notes"');
    expect(commitSwap).toContain("Notes");
    expect(dataFor("done")).toBe("ok");

    // The typed prompt reached the provider, then the four unit-generation prompts
    // and the behavioral test-generation prompt followed — proof the demo runs the
    // current builder stages, not a canned string.
    expect(prompts).toHaveLength(6);
    expect(prompts[0]).toContain("track my notes");
    expect(prompts[0]).toContain("tools: only create, read.");
    expect(prompts[1]).toContain("Generate the create.ts handler");
    expect(prompts[4]).toContain("Generate the create.html view");
    expect(prompts[5]).toContain("Text is required. Newest notes appear first.");
    expect(prompts[5]).toContain('"schema"');
    expect(prompts[5]).toContain('"behavioral_errors"');
    expect(prompts[5]).toContain(MISSING_REQUIRED_FIELDS_ERROR_CODE);
    expect(prompts[5]).not.toContain("export default async function");

    // A successful build writes exactly one metrics row (Epic 2.7), before `done`,
    // carrying the PLAN step-8 fields: intent, the built capability, the full timing
    // breakdown including test-gen/test-run, the per-rung gate outcomes, and the
    // per-unit fix-loop attempts.
    expect(rows).toHaveLength(1);
    const metrics = rows[0];
    expect(metrics?.outcome).toBe("success");
    expect(metrics?.capabilityId).toBe("notes");
    expect(metrics?.intent.type).toBe("new_capability");
    expect(metrics?.failure).toBeUndefined();
    expect(metrics?.timings?.specGenMs).toBeGreaterThanOrEqual(0);
    expect(metrics?.timings?.codeGenMs).toBeGreaterThanOrEqual(0);
    expect(metrics?.timings?.htmlGenMs).toBeGreaterThanOrEqual(0);
    expect(metrics?.timings?.testGenMs).toBeGreaterThanOrEqual(0);
    expect(metrics?.timings?.testRunMs).toBeGreaterThanOrEqual(0);
    expect(metrics?.timings?.totalMs).toBeGreaterThanOrEqual(0);
    expect(metrics?.gateRungs?.map((rung) => rung.rung)).toEqual([
      "structural",
      "smoke",
      "behavioral",
    ]);
    expect(metrics?.unitAttempts?.map((unit) => `${unit.kind}:${unit.name}`)).toEqual([
      "handler:create",
      "handler:read",
      "view:list",
      "view:create",
    ]);

    // Commit is real: the developer commit-preview reports the committed capability,
    // its version, the pointer, and the files written to the version directory.
    const commitPreview = JSON.parse(dataFor("commit-preview")) as {
      kind: string;
      status: string;
      capabilityId: string;
      version: number;
      artifactsPath: string;
      files: string[];
    };
    expect(commitPreview.kind).toBe("commit-preview");
    expect(commitPreview.status).toBe("committed");
    expect(commitPreview.capabilityId).toBe("notes");
    expect(commitPreview.version).toBe(1);
    expect(commitPreview.artifactsPath).toBe(`${artifactsRoot}/notes/v1/`);
    expect(commitPreview.files).toEqual(["create.ts", "read.ts", "list.html", "create.html"]);

    // The registry row landed at v1 with the artifacts pointer (the pointer flip)…
    const committed = getCapability("notes", conns.readonly);
    expect(committed?.version).toBe(1);
    expect(committed?.artifacts_path).toBe(`${artifactsRoot}/notes/v1/`);
    expect(committed?.label).toBe("Notes");

    // …and the four artifacts are on disk in that version directory.
    for (const file of commitPreview.files) {
      expect(existsSync(resolve(artifactsRoot, "notes/v1", file))).toBe(true);
    }
  });

  test("commits a capability that immediately creates and reads through the router", async () => {
    // The headline end-to-end proof (issue 07): prompt → committed capability →
    // create/read through the deterministic router, all on a fake provider, no real
    // calls. The router shares the build's scratch db pair and resolves the committed
    // handler files from the temp artifacts directory.
    const { provider } = makeSpecProvider(NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const buildPayload = await readSse(
      await app.request("/demo/spec-build?prompt=track%20my%20notes"),
    );
    expect(buildPayload).toContain("event: commit-preview");
    expect(buildPayload).toContain("event: commit");
    expect(collectSseEvents(buildPayload).at(-1)).toEqual({
      id: expect.any(String),
      event: "done",
      data: "ok",
    });
    expect(rows[0]?.outcome).toBe("success");

    // create through the router: the committed handler persists the note and returns
    // a fragment carrying it.
    const created = await app.request("/capability/notes/create", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ text: "Buy milk" }).toString(),
    });
    expect(created.status).toBe(200);
    expect(await created.text()).toContain("Buy milk");

    // read through the router: a fragment carrying the persisted note.
    const read = await app.request("/capability/notes/read");
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("Buy milk");
  });

  test("falls back to the default prompt when the field is empty", async () => {
    const { provider, prompts } = makeSpecProvider(NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const payload = await readSse(await app.request("/demo/spec-build"));

    expect(payload).toContain("event: done");
    expect(prompts[0]).toContain("I want to keep track of my notes");
    expect(rows[0]?.outcome).toBe("success");
  });

  test("a missing key streams a warm apology, not a crash", async () => {
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: throwingProvider("Missing OMNI_API_KEY. ..."),
      recordMetrics,
    });
    const res = await app.request("/demo/spec-build?prompt=track%20notes");
    expect(res.status).toBe(200);

    const payload = await readSse(res);
    const events = collectSseEvents(payload);
    const dataFor = (name: string) =>
      events
        .filter((event) => event.event === name)
        .map((event) => event.data)
        .join("\n");

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("done")).toBe("error");
    expect(dataFor("build-error-preview")).toContain("Missing OMNI_API_KEY");
    expect(dataFor("build-error-preview")).toContain("Error");
    // No product commit/fragment on the failure path, and no internals leak through
    // product copy.
    expect(payload).not.toContain("event: fragment");
    expect(payload).not.toContain("event: commit");
    expect(dataFor("narration")).not.toMatch(/OMNI_API_KEY|api key|provider/i);
    // The build never started (the provider threw before any stage), so no metrics
    // row is written — the demo records generations, not failed admissions.
    expect(rows).toHaveLength(0);
  });

  test("a behavioral gate failure sends developer evidence without leaking into narration", async () => {
    const failingSuite = {
      cases: [
        {
          name: "expects text that read never returns",
          setupRows: [],
          input: [{ field: "text", value: "Behavioral note" }],
          expectedCreatedRow: [{ field: "text", value: "Behavioral note" }],
          expectedRowCount: 1,
          expectCreateFragmentIncludes: ["Behavioral note"],
          expectReadFragmentIncludes: ["Definitely absent"],
          expectReadFragmentIncludesInOrder: [],
          expectedError: null,
        },
      ],
    };
    const { provider } = makeSpecProvider(NOTES_SPEC, failingSuite);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20notes")),
    );
    const dataFor = (name: string) =>
      events
        .filter((event) => event.event === name)
        .map((event) => event.data)
        .join("\n");
    const preview = JSON.parse(dataFor("build-error-preview")) as {
      errorName: string;
      diagnostic: {
        failure: string;
        testCase: { name: string };
        scratchRows: Array<{ text: string }>;
        readFragment: string;
      };
    };

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("narration")).not.toMatch(/handler|behavioral|gate|scratch/i);
    expect(dataFor("done")).toBe("error");
    expect(preview.errorName).toBe("CapabilityGateError");
    expect(preview.diagnostic.testCase.name).toBe("expects text that read never returns");
    expect(preview.diagnostic.failure).toContain("Definitely absent");
    expect(preview.diagnostic.scratchRows).toEqual([
      expect.objectContaining({ text: "Behavioral note" }),
    ]);
    expect(preview.diagnostic.readFragment).toContain("Behavioral note");

    // Failure is data: one metrics row, outcome failure, pinpointing the rung that
    // failed (the behavioral gate), with the timings up to that point present.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("failure");
    expect(rows[0]?.failure).toMatchObject({ stage: "gate", rung: "behavioral" });
    expect(rows[0]?.capabilityId).toBe("notes");
    expect(rows[0]?.timings?.specGenMs).toBeGreaterThanOrEqual(0);

    // Commit is unreachable when a gate rung fails: the transaction rolled back, so
    // nothing committed — no registry row, no cap_<id> table, no artifacts on disk —
    // and no commit-preview or commit swap was streamed.
    expect(events.map((event) => event.event)).not.toContain("commit-preview");
    expect(events.map((event) => event.event)).not.toContain("fragment");
    expect(events.map((event) => event.event)).not.toContain("commit");
    expect(getCapability("notes", conns.readonly)).toBeNull();
    expect(
      conns.readwrite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cap_notes'")
        .get(),
    ).toBeNull();
    expect(existsSync(resolve(artifactsRoot, "notes/v1"))).toBe(false);
  });

  test("a commit-stage failure rolls back and records it, leaving the prior capability intact", async () => {
    // A capability is already registered at this id, so commit's registry insert
    // collides — the gate passes but the build fails at the terminal commit step.
    // (The resolver normally prevents id collisions; this forces the commit-stage
    // failure path directly.)
    insertCapability(
      { ...NOTES_SPEC, version: 1, artifacts_path: "capabilities/notes/v1/" } as CapabilityRow,
      conns.readwrite,
    );
    const { provider } = makeSpecProvider(NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20notes")),
    );
    const eventNames = events.map((event) => event.event);
    const dataFor = (name: string) =>
      events
        .filter((event) => event.event === name)
        .map((event) => event.data)
        .join("\n");

    // The gate was reached and passed, but commit failed: no committed capability is
    // announced, just the warm apology and a `done` error.
    expect(eventNames).toContain("gate-preview");
    expect(eventNames).not.toContain("commit-preview");
    expect(eventNames).not.toContain("fragment");
    expect(eventNames).not.toContain("commit");
    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("done")).toBe("error");

    // Failure is data: recorded as a commit-stage failure, carrying the full
    // pre-commit measurements (every gate rung passed).
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("failure");
    expect(rows[0]?.failure).toMatchObject({ stage: "commit" });
    expect(rows[0]?.gateRungs?.map((rung) => rung.rung)).toEqual([
      "structural",
      "smoke",
      "behavioral",
    ]);

    // The transaction rolled back: the prior capability is untouched (still its
    // original pointer), and the build committed nothing new.
    expect(getCapability("notes", conns.readonly)?.artifacts_path).toBe("capabilities/notes/v1/");
  });

  test("a behavioral test-generation provider error is captured in the developer preview", async () => {
    const { provider } = makeSpecProviderWithBehavioralError(
      NOTES_SPEC,
      new Error("Invalid schema for response_format 'response': Missing required expectedError."),
    );
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20notes")),
    );
    const dataFor = (name: string) =>
      events
        .filter((event) => event.event === name)
        .map((event) => event.data)
        .join("\n");
    const preview = JSON.parse(dataFor("build-error-preview")) as {
      errorName: string;
      message: string;
    };

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("narration")).not.toMatch(/response_format|schema|expectedError/i);
    expect(dataFor("done")).toBe("error");
    expect(preview.errorName).toBe("CapabilityGateError");
    expect(preview.message).toContain("Invalid schema for response_format");
    expect(preview.message).toContain("expectedError");
    // The behavioral test-generation failure is recorded as a gate/behavioral failure.
    expect(rows[0]?.outcome).toBe("failure");
    expect(rows[0]?.failure).toMatchObject({ stage: "gate", rung: "behavioral" });
  });

  test("a validation marker mismatch is visible in the developer-only demo diagnostic", async () => {
    const { provider } = makeSpecProvider(NOTES_SPEC, VALIDATION_ERROR_SUITE, {
      create: MISSING_MARKER_CREATE_HANDLER,
    });
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20notes")),
    );
    const dataFor = (name: string) =>
      events
        .filter((event) => event.event === name)
        .map((event) => event.data)
        .join("\n");
    const preview = JSON.parse(dataFor("build-error-preview")) as {
      errorName: string;
      diagnostic: {
        failure: string;
        testCase: { name: string; expectedError: { code: string; fields: string[] } };
        createFragment: string;
        scratchRows: unknown[];
      };
    };

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("narration")).not.toMatch(/handler|behavioral|gate|scratch/i);
    expect(dataFor("done")).toBe("error");
    expect(preview.errorName).toBe("CapabilityGateError");
    expect(preview.diagnostic.testCase.name).toBe(
      "missing note text emits stable validation markers",
    );
    expect(preview.diagnostic.testCase.expectedError).toMatchObject({
      code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      fields: ["text"],
    });
    expect(preview.diagnostic.failure).toContain('data-role="error"');
    expect(preview.diagnostic.createFragment).toContain("Any friendly copy");
    expect(preview.diagnostic.scratchRows).toEqual([]);
    // Recorded as a behavioral-gate failure.
    expect(rows[0]?.outcome).toBe("failure");
    expect(rows[0]?.failure).toMatchObject({ stage: "gate", rung: "behavioral" });
  });
});

describe("POST /prompt and GET /build/:id/stream (resolver-driven default pipeline)", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let artifactsRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-prompt-build-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
    artifactsRoot = join(dir, "artifacts");
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function defaultPipelineApp(provider: Provider, recordMetrics: (m: GenerationMetrics) => void) {
    return createApp({
      getProvider: () => provider,
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
    });
  }

  const newCapabilityIntent: IntentClassification = {
    type: "new_capability",
    confidence: 0.97,
    target_capability: null,
    proposed_action: "Create a notes capability.",
    user_facing_label: "Got it. I'm putting that together now.",
    requires_confirmation: false,
  };

  test("POST admits immediately; the stream classifies and proceeds to build new_capability", async () => {
    const { provider, prompts } = makePromptBuildProvider(newCapabilityIntent);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const postRes = await postPrompt(app, "track my notes");
    const fragment = await responseText(postRes);
    const jobId = buildJobIdFromSubscriber(fragment);

    expect(postRes.status).toBe(200);
    expect(fragment).toContain(`sse-connect="/build/${jobId}/stream"`);
    expect(prompts).toHaveLength(0);

    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const eventNames = events.map((event) => event.event);
    const dataFor = (name: string) =>
      events
        .filter((event) => event.event === name)
        .map((event) => event.data)
        .join("\n");

    expect(eventNames[0]).toBe("narration");
    expect(eventNames).toContain("spec-preview");
    expect(eventNames).toContain("migration-preview");
    expect(eventNames).toContain("units-preview");
    expect(eventNames).toContain("gate-preview");
    expect(eventNames).toContain("commit-preview");
    expect(eventNames.at(-2)).toBe("commit");
    expect(eventNames.at(-1)).toBe("done");
    expect(dataFor("done")).toBe("ok");
    expect(events[0]?.data).toContain("new place");
    expect(events[0]?.data).toContain("already started");
    expect(events[1]?.event).toBe("narration");
    expect(events[1]?.data).toBe(newCapabilityIntent.user_facing_label);

    expect(prompts).toHaveLength(7);
    expect(prompts[0]).toContain("Aluna's Intent Resolver");
    expect(prompts[0]).toContain("track my notes");
    expect(prompts[1]).toContain("Aluna's Capability Builder");
    expect(prompts[1]).toContain("Create a notes capability.");

    expect(dataFor("narration")).not.toMatch(/\bspec\b|\bschema\b|\bhandler\b|\bmigration\b/i);
    const commitSwap = dataFor("commit");
    expect(commitSwap).toContain('class="capability-surface"');
    expect(commitSwap).toContain('hx-get="/capability/notes/read"');
    expect(commitSwap).toContain('hx-post="/capability/notes/create"');
    expect(commitSwap).toContain('hx-swap-oob="beforeend:#capability-toolbar"');
    expect(commitSwap).toContain("data-capability-entry");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "success",
      capabilityId: "notes",
      intent: { type: "new_capability", confidence: 0.97, targetCapability: null },
    });
    expect(rows[0]?.usage?.totalTokens).toBe(371);
    expect(rows[0]?.timings?.specGenMs).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.gateRungs?.map((rung) => rung.rung)).toEqual([
      "structural",
      "smoke",
      "behavioral",
    ]);

    expect(getCapability("notes", conns.readonly)?.version).toBe(1);
    expect(existsSync(resolve(artifactsRoot, "notes/v1/create.ts"))).toBe(true);
  });

  test("non-new-capability intents stream a warm deflection, write metrics, and build nothing", async () => {
    const dataQueryIntent: IntentClassification = {
      type: "data_query",
      confidence: 0.89,
      target_capability: "notes",
      proposed_action: "Answer a question about saved notes.",
      user_facing_label: "I can look across your notes.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makePromptBuildProvider(dataQueryIntent);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "how many notes")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const narration = events
      .filter((event) => event.event === "narration")
      .map((event) => event.data)
      .join("");

    expect(events.map((event) => event.event)).toEqual(["narration", "narration", "done"]);
    expect(events[0]?.data).toContain("new place");
    expect(events[0]?.data).toContain("already started");
    expect(events.at(-1)).toEqual({ id: "2", event: "done", data: "ok" });
    expect(narration).toContain("what you've saved");
    expect(narration).not.toMatch(
      /capability|intent|data_query|registry|schema|migration|handler|artifact|metrics|provider/i,
    );

    expect(prompts).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "deflected",
      intent: { type: "data_query", confidence: 0.89, targetCapability: "notes" },
    });
    expect(rows[0]?.timings).toBeUndefined();
    expect(rows[0]?.gateRungs).toBeUndefined();
    expect(rows[0]?.unitAttempts).toBeUndefined();
    expect(listCapabilities(conns.readonly)).toEqual([]);
    expect(
      conns.readonly
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cap_notes'")
        .get(),
    ).toBeNull();
    expect(existsSync(artifactsRoot)).toBe(false);
  });

  test('the duplicate "track my notes" ask deflects via extend_capability when Notes exists', async () => {
    insertCapability(notesCapabilityRow(), conns.readwrite);
    const extendIntent: IntentClassification = {
      type: "extend_capability",
      confidence: 0.94,
      target_capability: "notes",
      proposed_action: "Add another way to track notes inside the existing Notes capability.",
      user_facing_label: "I can add that to your notes.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makePromptBuildProvider(extendIntent);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "track my notes")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const narration = events
      .filter((event) => event.event === "narration")
      .map((event) => event.data)
      .join("");

    expect(prompts).toHaveLength(0);
    expect(events.map((event) => event.event)).toEqual(["narration", "done"]);
    expect(narration).toContain("already started");
    expect(narration).toContain("soon");
    expect(narration).not.toMatch(
      /capability|intent|extend_capability|registry|schema|migration|handler|artifact/i,
    );
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "deflected",
      intent: { type: "extend_capability", confidence: 1, targetCapability: "notes" },
    });
    expect(listCapabilities(conns.readonly)).toHaveLength(1);
    expect(listCapabilities(conns.readonly)[0]?.id).toBe("notes");
    expect(existsSync(artifactsRoot)).toBe(false);
  });

  test("an existing registry row deflects before provider or builder work", async () => {
    insertCapability(
      notesCapabilityRow({
        id: "personal_notes",
        label:
          "We’ll set you up to capture and organize your notes so you can quickly find them later.",
        artifacts_path: "capabilities/personal_notes/v1/",
        prompt_context: PERSONAL_NOTES_SPEC.prompt_context,
      }),
      conns.readwrite,
    );
    const { provider, prompts } = makePromptBuildProvider(newCapabilityIntent, PERSONAL_NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "I want to keep track of my notes")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const narration = events
      .filter((event) => event.event === "narration")
      .map((event) => event.data)
      .join("");

    expect(events.map((event) => event.event)).toEqual(["narration", "done"]);
    expect(narration).toContain("already started");
    expect(prompts).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "deflected",
      intent: {
        type: "extend_capability",
        targetCapability: "personal_notes",
      },
    });
    expect(rows[0]?.timings).toBeUndefined();
    expect(rows[0]?.gateRungs).toBeUndefined();
    expect(rows[0]?.unitAttempts).toBeUndefined();
    expect(listCapabilities(conns.readonly)).toHaveLength(1);
    expect(
      conns.readonly
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cap_personal_notes'")
        .get(),
    ).toBeNull();
    expect(existsSync(artifactsRoot)).toBe(false);
  });

  test("a distinct recipe prompt is not caught by the deterministic Notes duplicate guard", async () => {
    insertCapability(
      notesCapabilityRow({
        id: "personal_notes",
        label:
          "We’ll set you up to capture and organize your notes so you can quickly find them later.",
        artifacts_path: "capabilities/personal_notes/v1/",
        prompt_context: PERSONAL_NOTES_SPEC.prompt_context,
      }),
      conns.readwrite,
    );
    const rejectIntent: IntentClassification = {
      type: "reject",
      confidence: 0.51,
      target_capability: null,
      proposed_action: "Do not build during this guard test.",
      user_facing_label: "I'm not quite sure what to make from that yet.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makePromptBuildProvider(rejectIntent);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "I want to keep track of my recipes")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("I want to keep track of my recipes");
    expect(events.map((event) => event.event)).toEqual(["narration", "narration", "done"]);
    expect(events[0]?.data).toContain("new place");
    expect(events[0]?.data).toContain("already started");
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "deflected",
      intent: { type: "reject", confidence: 0.51, targetCapability: null },
    });
    expect(existsSync(artifactsRoot)).toBe(false);
  });
});

describe("POST /prompt and GET /build/:id/stream (build jobs)", () => {
  test("POST returns the subscriber fragment immediately without touching the provider", async () => {
    let providerCalls = 0;
    const buildJobs = createBuildJobQueue({ createId: createIdSequence(["job-one"]) });
    const app = createApp({
      buildJobs,
      getProvider: () => {
        providerCalls += 1;
        return makeFakeProvider("unused", "unused");
      },
    });

    const res = await postPrompt(app, "I want to keep track of notes");
    const fragment = await responseText(res);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(fragment).toContain('data-build-job-id="job-one"');
    expect(fragment).toContain('sse-connect="/build/job-one/stream"');
    expect(fragment).toContain('sse-swap="narration"');
    expect(fragment).toContain('sse-swap="fragment"');
    expect(fragment).toContain('sse-swap="commit"');
    expect(fragment).toContain('sse-swap="spec-preview"');
    expect(fragment).toContain('data-preview-target="spec-build-preview"');
    expect(fragment).toContain('sse-swap="build-error-preview"');
    expect(fragment).toContain('data-preview-target="spec-gate-preview"');
    expect(fragment).toContain('id="prompt-notice" hx-swap-oob="innerHTML"');
    // Proven in Epic 2.6a: htmx-ext-sse wraps a native EventSource that auto-
    // reconnects on a server-closed stream, so the subscriber must close on `done`
    // (the htmx analogue of the raw path's source.close()) or the build re-runs.
    expect(fragment).toContain('sse-close="done"');
    expect(providerCalls).toBe(0);
  });

  test("the job stream emits typed monotonic SSE events and closes on done", async () => {
    let providerCalls = 0;
    const buildJobs = createBuildJobQueue({ createId: createIdSequence(["job-stream"]) });
    const app = createApp({
      buildJobs,
      getProvider: () => {
        providerCalls += 1;
        return makeFakeProvider("unused", "unused");
      },
    });

    await postPrompt(app, "track notes");
    const res = await app.request("/build/job-stream/stream");
    const payload = await readSse(res);
    const events = collectSseEvents(payload);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(events.map((event) => event.id)).toEqual(["0", "1"]);
    expect(events.map((event) => event.event)).toEqual(["narration", "done"]);
    expect(events[0]?.data).toMatch(/putting that together/i);
    expect(events[1]?.data).toBe("ok");
    expect(providerCalls).toBe(0);
  });

  test("the job stream sends transport heartbeats while a build stage is silent", async () => {
    const pipeline: BuildPipeline = async ({ send }) => {
      await send("narration", "Starting.");
      await wait(70);
      await send("narration", "Finished.");
    };
    const buildJobs = createBuildJobQueue({
      createId: createIdSequence(["job-heartbeat"]),
      pipeline,
    });
    const app = createApp({ buildJobs, sseHeartbeatMs: 20 });

    await postPrompt(app, "track notes");
    const events = collectSseEvents(
      await readSse(await app.request("/build/job-heartbeat/stream")),
    );
    const eventNames = events.map((event) => event.event);
    const heartbeatIndex = eventNames.indexOf("heartbeat");

    expect(heartbeatIndex).toBeGreaterThan(0);
    expect(heartbeatIndex).toBeLessThan(eventNames.lastIndexOf("narration"));
    expect(events[heartbeatIndex]).toEqual({ id: "", event: "heartbeat", data: "" });
    expect(events.at(-1)).toEqual({ id: "2", event: "done", data: "ok" });
  });

  test("a second prompt during an active job gets a transient busy notice and does not disturb the stream", async () => {
    let providerCalls = 0;
    const started = createDeferred();
    const unblock = createDeferred();
    const pipeline: BuildPipeline = async ({ send }) => {
      await send("narration", "First line.");
      started.resolve();
      await unblock.promise;
      await send("narration", "Last line.");
    };
    const buildJobs = createBuildJobQueue({
      createId: createIdSequence(["job-active", "job-after"]),
      pipeline,
    });
    const app = createApp({
      buildJobs,
      getProvider: () => {
        providerCalls += 1;
        return makeFakeProvider("unused", "unused");
      },
    });

    await postPrompt(app, "track notes");
    const streamPayload = readSse(await app.request("/build/job-active/stream"));
    await started.promise;

    const busyRes = await postPrompt(app, "track recipes");
    const busyFragment = await responseText(busyRes);

    expect(busyRes.status).toBe(200);
    expect(busyRes.headers.get("HX-Retarget")).toBe("#prompt-notice");
    expect(busyRes.headers.get("HX-Reswap")).toBe("innerHTML");
    expect(busyFragment).toContain('id="prompt-notice"');
    expect(busyFragment).toContain("Give me a moment");
    expect(busyFragment).not.toContain("job-after");
    expect(providerCalls).toBe(0);

    unblock.resolve();
    const payload = await streamPayload;
    const streamEvents = collectSseEvents(payload);
    expect(streamEvents.map((event) => event.event)).toEqual(["narration", "narration", "done"]);
    expect(streamEvents.map((event) => event.id)).toEqual(["0", "1", "2"]);
    expect(streamEvents.map((event) => event.data).join(" ")).toContain("First line. Last line.");

    const nextFragment = await responseText(await postPrompt(app, "track recipes"));
    expect(nextFragment).toContain('data-build-job-id="job-after"');
    expect(providerCalls).toBe(0);
  });

  test("unknown and completed job streams end cleanly with done", async () => {
    const buildJobs = createBuildJobQueue({ createId: createIdSequence(["job-complete"]) });
    const app = createApp({ buildJobs });

    const unknownEvents = collectSseEvents(
      await readSse(await app.request("/build/missing/stream")),
    );
    expect(unknownEvents).toEqual([{ id: "0", event: "done", data: "missing" }]);

    await postPrompt(app, "track notes");
    const firstRunEvents = collectSseEvents(
      await readSse(await app.request("/build/job-complete/stream")),
    );
    expect(firstRunEvents.at(-1)).toEqual({ id: "1", event: "done", data: "ok" });

    const completedEvents = collectSseEvents(
      await readSse(await app.request("/build/job-complete/stream")),
    );
    expect(completedEvents).toEqual([{ id: "0", event: "done", data: "missing" }]);
  });
});
