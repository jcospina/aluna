// The Hono application — the platform's one route file (ARCH §4: "no framework
// ceremony, one route file"). Every later epic attaches its routes here: the
// shell page, the SSE channel, the capability router (/capability/:id/:action,
// now wired — Epic 2.3), and file serving (/files/:key).
//
// At this stage it serves the fixed shell page at `/`, static assets under
// /static/*, the Module 1 `/stream` provider-liveness endpoint, and the Module 2
// spec-generation demo stream. The home page now uses the real prompt bar to
// drive that spec-generation demo while later builder slices assemble the full
// prompt → built capability pipeline.

import { Database } from "bun:sqlite";
import { type Context, Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { SSEStreamingApi } from "hono/streaming";
import { streamSSE } from "hono/streaming";
import { type ZodType, z } from "zod";

import { type BuildJobQueue, createBuildJobQueue } from "./build-jobs.ts";
import {
  type GeneratedUnit,
  generateCapabilityUnits,
  generateSpec,
  hardcodedNewCapabilityIntent,
  type UnitDescriptor,
  type UnitGenerationAttempt,
  type UnitGenerationObserver,
  withCapabilityMigrationTransaction,
} from "./builder/index.ts";
import { createProvider, type GenerateResult, type Provider } from "./provider/index.ts";
import type { CapabilitySpec } from "./registry/index.ts";
import { type CapabilityRouterDeps, registerCapabilityRoutes } from "./router/index.ts";

// ── The greeting round-trip (Module-1 liveness content; zero domain logic) ────
// A tiny structured ask: the real provider returns a warm, product-voice hello and
// a one-line invitation. Streaming the `greeting` as it builds (from the contract's
// partialStream) and reading `invitation` off the validated final object exercises
// *both* halves of `generate(prompt, schema)` — the streamed partial and the
// schema-validated result — which is exactly the issue-02 round-trip, now shown in
// the shell instead of asserted in a (money-burning) test.
const GreetingSchema = z.object({
  greeting: z.string().describe("A warm, first-person hello, one or two sentences."),
  invitation: z
    .string()
    .describe("A short, gentle one-line nudge inviting them to share what they'd like to keep."),
});

// Product voice baked into the prompt (CONTEXT.md "Product voice", ARCH §9.7): warm,
// first person, addresses "you", no internals jargon. Kept here as demo content,
// the way the throwaway demo's fixed strings used to live here.
const GREETING_PROMPT =
  "You are Aluna — a warm, gently curious companion in a place where what someone " +
  "wants to keep track of becomes a little app that builds itself. Someone has just " +
  "opened Aluna for the first time. Speaking in the first person, directly to them " +
  'as "you", plainspoken and concise with a quiet thread of wonder, write a short ' +
  "greeting (one or two sentences) and a one-line invitation for them to tell you " +
  "what they would like to keep track of. Never mention anything technical.";

// Escape interpolated provider text before it is appended as HTML (the `fragment`
// event). The greeting streams as text nodes (safe by construction on the client);
// the invitation rides in an HTML fragment, so it is escaped here.
function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (ch) => replacements[ch] ?? ch);
}

const PROMPT_NOTICE_TARGET = "#prompt-notice";
const BUSY_NOTICE =
  "I'm already putting something together. Give me a moment and I'll be ready for the next one.";
const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readPromptFromJson(c: Context): Promise<string> {
  const body: unknown = await c.req.json().catch(() => ({}));
  return isRecord(body) && typeof body.prompt === "string" ? body.prompt.trim() : "";
}

async function readPromptFromForm(c: Context): Promise<string> {
  const body = await c.req.parseBody();
  const prompt = body.prompt;
  return typeof prompt === "string" ? prompt.trim() : "";
}

async function readPrompt(c: Context): Promise<string> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return readPromptFromJson(c);
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    return readPromptFromForm(c);
  }
  return (await c.req.text()).trim();
}

function renderBuildSubscriber(jobId: string): string {
  const streamPath = `/build/${encodeURIComponent(jobId)}/stream`;
  return [
    `<section class="build-stream" data-build-job-id="${escapeHtml(jobId)}" hx-ext="sse" sse-connect="${escapeHtml(streamPath)}">`,
    '  <div class="build-stream__narration" aria-live="polite" sse-swap="narration" hx-swap="beforeend"></div>',
    "</section>",
  ].join("\n");
}

function renderBusyNotice(): string {
  return `<p id="prompt-notice" role="status" aria-live="polite">${escapeHtml(BUSY_NOTICE)}</p>`;
}

// SSE transport owns app-level monotonic ids and id-less heartbeats (ADR-0002).
// The event vocabulary is the 1.3 seed — `narration` (product-voice text to
// append), `fragment` (HTML to place), `done` (terminal, server closes so
// EventSource does not reconnect). M2 owns finalizing that vocabulary and the
// channel topology; this reuses the seed.
type Send = (event: string, data: string) => Promise<void>;
interface SseTransport {
  readonly send: Send;
  readonly heartbeat: () => Promise<void>;
}

function sseTransport(stream: SSEStreamingApi): SseTransport {
  let id = 0;
  let writes: Promise<void> = Promise.resolve();
  const enqueue = (write: () => Promise<void>) => {
    const next = writes.then(write, write);
    writes = next.catch(() => {
      // Keep the write chain usable after an aborted stream; the route's main path
      // handles the actual abort/error state.
    });
    return next;
  };

  return {
    send: (event, data) => enqueue(() => stream.writeSSE({ id: String(id++), event, data })),
    heartbeat: () => enqueue(() => stream.writeSSE({ event: "heartbeat", data: "" })),
  };
}

async function withSseHeartbeat(
  transport: SseTransport,
  intervalMs: number,
  body: () => Promise<void>,
): Promise<void> {
  if (intervalMs <= 0) {
    await body();
    return;
  }

  let complete = false;
  const completion = body().finally(() => {
    complete = true;
  });

  while (!complete) {
    await Promise.race([
      completion.catch(() => {
        // Preserve the original rejection for the final await below.
      }),
      new Promise((resolve) => setTimeout(resolve, intervalMs)),
    ]);
    if (!complete) {
      await transport.heartbeat().catch(() => {
        // Best-effort transport keepalive; aborted streams are handled by the route.
      });
    }
  }

  await completion;
}

// Stream the real greeting: narrate the `greeting` as it builds, then reveal the
// invitation from the validated object, then close.
async function streamGreeting(send: Send, isAborted: () => boolean, provider: Provider) {
  const result = provider.generate(GREETING_PROMPT, GreetingSchema);

  let shown = 0;
  for await (const partial of result.partialStream) {
    if (isAborted()) return;
    const greeting = typeof partial.greeting === "string" ? partial.greeting : "";
    if (greeting.length > shown) {
      await send("narration", greeting.slice(shown)); // only the newly-arrived suffix
      shown = greeting.length;
    }
  }
  if (isAborted()) return;

  const { invitation } = await result.object; // schema-validated
  await send("fragment", `<p class="intro__invitation">${escapeHtml(invitation)}</p>`);
  await send("done", "ok");
}

// Any failure — a missing key (createProvider throws, naming OMNI_API_KEY) or a
// provider/transport error mid-stream — surfaces *clearly*: precise in the server
// log for the developer, warm and jargon-free in the UI (product voice, ARCH §9.7).
async function handleStreamError(send: Send, isAborted: () => boolean, err: unknown) {
  console.error("Aluna greeting stream failed:", err instanceof Error ? err.message : err);
  if (isAborted()) return;
  await send("narration", "Hmm, I couldn't quite find my words just now — mind trying again?");
  await send("done", "error");
}

// ── Spec-generation liveness demo (Module 2 §2.5b; demo scaffolding) ───────────
// A sibling to the greeting round-trip above, this one for the spec-generation
// stage (src/builder/spec-gen.ts). It runs that real stage against the configured
// provider from a hardcoded `new_capability` intent, streams the product-voice
// narration to the shell, and logs the resulting *validated* spec to the SERVER
// console — the spec is engineering data, never user-visible (ARCH §9.7).
//
// It is deliberately NOT the real build pipeline: the POST /prompt build lifecycle
// is what issues 03–07 grow, and Epic 2.6 wires the prompt bar to it. This route
// exists only so the spec-gen wiring is verifiable in the running app today — the
// way "Meet Aluna" proves the provider round-trip live — and is removed when 2.6
// lands the real flow. Keeping it separate means none of that later work has to
// unwind a demo.
const DEMO_SPEC_PROMPT = "I want to keep track of my notes";

// The one user-visible line confirming the round-trip produced a usable capability.
// Only the user-facing `label` crosses into the UI (escaped); everything else about
// the spec stays in the console (ARCH §9.7).
function renderSpecBuiltConfirmation(label: string): string {
  return `<p class="intro__invitation">All set — I've made a place for your ${escapeHtml(label)}.</p>`;
}

interface DemoMigrationColumnPreview {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly defaultValue: string | null;
  readonly primaryKey: boolean;
}

interface DemoMigrationPreview {
  readonly kind: "scratch-migration-preview";
  readonly tableName: string;
  readonly durationMs: number;
  readonly sql: string;
  readonly columns: readonly DemoMigrationColumnPreview[];
}

interface DemoUnitPreview {
  readonly kind: GeneratedUnit["kind"];
  readonly name: GeneratedUnit["name"];
  readonly filename: GeneratedUnit["filename"];
  readonly status: "generating" | "fixing" | "complete";
  readonly attempts: number;
  readonly durationMs?: number;
  readonly usage?: GeneratedUnit["usage"];
  readonly error?: string;
  readonly content: string;
}

interface DemoUnitsPreview {
  readonly kind: "unit-generation-preview";
  readonly status: "running" | "complete";
  readonly codeGenDurationMs: number;
  readonly htmlGenDurationMs: number;
  readonly units: readonly DemoUnitPreview[];
}

interface SqliteColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notnull: 0 | 1;
  readonly dflt_value: string | null;
  readonly pk: number;
}

function sqliteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tableCreateSql(database: Database, tableName: string): string {
  const row = database
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | null;
  if (!row) throw new Error(`missing migrated table ${tableName}`);
  return row.sql;
}

function tableColumns(database: Database, tableName: string): DemoMigrationColumnPreview[] {
  const columns = database
    .query(`PRAGMA table_xinfo(${sqliteIdentifier(tableName)})`)
    .all() as SqliteColumnInfo[];

  return columns.map((column) => ({
    name: column.name,
    type: column.type,
    required: column.notnull === 1,
    defaultValue: column.dflt_value,
    primaryKey: column.pk > 0,
  }));
}

async function buildScratchMigrationPreview(spec: CapabilitySpec): Promise<DemoMigrationPreview> {
  const database = new Database(":memory:");
  try {
    const result = await withCapabilityMigrationTransaction({ database, spec }, (migration) => ({
      kind: "scratch-migration-preview" as const,
      tableName: migration.tableName,
      durationMs: migration.durationMs,
      sql: tableCreateSql(database, migration.tableName),
      columns: tableColumns(database, migration.tableName),
    }));
    return result.value;
  } finally {
    database.close();
  }
}

function unitPreviewKey(unit: UnitDescriptor): string {
  return `${unit.kind}:${unit.name}`;
}

function unitPreviewFilename(unit: UnitDescriptor): GeneratedUnit["filename"] {
  return unit.kind === "handler" ? `${unit.name}.ts` : `${unit.name}.html`;
}

function buildUnitsPreview(
  units: readonly DemoUnitPreview[],
  status: DemoUnitsPreview["status"],
): DemoUnitsPreview {
  return {
    kind: "unit-generation-preview",
    status,
    codeGenDurationMs: units
      .filter((unit) => unit.kind === "handler")
      .reduce((sum, unit) => sum + (unit.durationMs ?? 0), 0),
    htmlGenDurationMs: units
      .filter((unit) => unit.kind === "view")
      .reduce((sum, unit) => sum + (unit.durationMs ?? 0), 0),
    units,
  };
}

function finalUnitPreview(unit: GeneratedUnit): DemoUnitPreview {
  return {
    kind: unit.kind,
    name: unit.name,
    filename: unit.filename,
    status: "complete",
    attempts: unit.attempts.length,
    durationMs: unit.durationMs,
    usage: unit.usage,
    content: unit.content,
  };
}

// Demo-only provider decorator: as the spec streams in, it forwards each partial
// snapshot to the shell as a `spec-preview` event so the developer watches the spec
// assemble live. This deliberately surfaces internals — that is the whole point of a
// liveness check — and exists ONLY on this demo path; the real pipeline never emits
// it, and the product's no-internals rule (ARCH §9.7) still governs narration and
// the confirmation. `generateSpec` only awaits `object` (self-driven by the spine),
// so consuming `partialStream` here for previews doesn't starve the stage. The
// returned `settled` promise lets the route flush every preview before the warm
// confirmation, keeping the wire order narration → preview* → confirmation.
function previewingProvider(
  real: Provider,
  send: Send,
): { provider: Provider; settled: Promise<void> } {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const provider: Provider = {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      const result = real.generate(prompt, schema);
      void (async () => {
        try {
          for await (const partial of result.partialStream) {
            await send("spec-preview", JSON.stringify(partial));
          }
        } catch {
          // Best-effort preview; the real outcome surfaces through generateSpec.
        } finally {
          settle();
        }
      })();
      return result;
    },
  };

  return { provider, settled };
}

async function streamSpecBuildDemo(
  send: Send,
  isAborted: () => boolean,
  provider: Provider,
  prompt: string,
) {
  const intent = hardcodedNewCapabilityIntent(prompt);
  // Wrap the provider so the spec streams to the shell as it builds (demo preview),
  // while the stage itself runs unchanged.
  const { provider: observed, settled } = previewingProvider(provider, send);
  // `generateSpec` narrates the intent's `user_facing_label` over `send` and returns
  // the validated spec plus the build's measurements.
  const { spec, durationMs, usage } = await generateSpec({
    provider: observed,
    prompt,
    intent,
    send,
  });
  await settled; // every spec-preview is on the wire before the confirmation
  if (isAborted()) return;

  const migrationPreview = await buildScratchMigrationPreview(spec);
  if (isAborted()) return;
  await send("migration-preview", JSON.stringify(migrationPreview));

  await send("narration", " I'm shaping it into something you can use.");
  const liveUnits = new Map<string, DemoUnitPreview>();
  let lastPreviewAt = 0;
  const sendUnitsPreview = async (status: DemoUnitsPreview["status"], force = false) => {
    if (isAborted()) return;
    const now = performance.now();
    if (!force && now - lastPreviewAt < 500) return;
    lastPreviewAt = now;
    await send("units-preview", JSON.stringify(buildUnitsPreview([...liveUnits.values()], status)));
  };
  const updateLiveUnit = (
    unit: UnitDescriptor,
    patch: Partial<Omit<DemoUnitPreview, "kind" | "name" | "filename">>,
  ) => {
    const key = unitPreviewKey(unit);
    const current = liveUnits.get(key);
    liveUnits.set(key, {
      kind: unit.kind,
      name: unit.name,
      filename: unitPreviewFilename(unit),
      status: current?.status ?? "generating",
      attempts: current?.attempts ?? 0,
      content: current?.content ?? "",
      ...patch,
    });
  };
  const recordAttempt = (unit: UnitDescriptor, attempt: UnitGenerationAttempt) => {
    updateLiveUnit(unit, {
      status: attempt.error ? "fixing" : "generating",
      attempts: attempt.attempt,
      durationMs: attempt.durationMs,
      usage: attempt.usage,
      ...(attempt.error ? { error: attempt.error } : {}),
    });
  };
  const observer: UnitGenerationObserver = {
    async onUnitStart({ unit, attempt }) {
      updateLiveUnit(unit, { status: "generating", attempts: attempt });
      await sendUnitsPreview("running", true);
    },
    async onUnitPartial({ unit, attempt, content }) {
      updateLiveUnit(unit, { status: "generating", attempts: attempt, content });
      await sendUnitsPreview("running");
    },
    async onUnitAttempt({ unit, attempt }) {
      recordAttempt(unit, attempt);
      await sendUnitsPreview("running", true);
    },
    async onUnitGenerated(unit) {
      liveUnits.set(unitPreviewKey(unit), finalUnitPreview(unit));
      await sendUnitsPreview("running", true);
    },
  };
  const unitResult = await generateCapabilityUnits({ provider, spec, observer });
  if (isAborted()) return;
  const finalUnits = unitResult.units.map(finalUnitPreview);
  await send("units-preview", JSON.stringify(buildUnitsPreview(finalUnits, "complete")));

  // The developer's verification surface: the full validated spec and the duration +
  // token usage the metrics row will record (Epic 2.7). Console only.
  console.log(`Aluna spec-build demo: generated "${spec.id}" in ${Math.round(durationMs)}ms`, {
    usage,
    spec,
    units: unitResult.units.map((unit) => ({
      kind: unit.kind,
      name: unit.name,
      attempts: unit.attempts.length,
      durationMs: Math.round(unit.durationMs),
      usage: unit.usage,
    })),
  });

  await send("fragment", renderSpecBuiltConfirmation(spec.label));
  await send("done", "ok");
}

// A non-conforming model output (the spec-gen gate throwing) or a missing key both
// surface the same way the greeting does: precise in the server log, warm and
// jargon-free in the UI (the build-failure voice, build-jobs.ts).
async function handleSpecBuildError(send: Send, isAborted: () => boolean, err: unknown) {
  console.error("Aluna spec-build demo failed:", err instanceof Error ? err.message : err);
  if (isAborted()) return;
  await send("narration", "Hmm, that didn't work. Mind trying again?");
  await send("done", "error");
}

// Dependencies the app is built with. The provider is injected (defaulting to the
// real spine) so the route's wiring is testable through a fake `Provider` with no
// network and no spend — the orchestrator depends on the contract, never the SDK.
export interface AppDeps {
  // Called once per stream. Defaults to the real provider, constructed lazily so a
  // missing key does not stop the server from booting — it surfaces in the stream.
  readonly getProvider?: () => Provider;
  // Capability router wiring (Epic 2.3). Defaults to the platform db singletons and
  // the real file loader; tests inject a scratch db pair (and, where they assert
  // load ordering, a spy loader).
  readonly capabilityRouter?: CapabilityRouterDeps;
  // Build-job queue (Epic 2.5). Defaults to an in-memory single-flight queue with a
  // placeholder pipeline; tests inject deterministic ids and paused pipelines.
  readonly buildJobs?: BuildJobQueue;
  // SSE transport heartbeat interval. Defaults below Bun's server idle timeout;
  // tests lower it to prove silent long-running stages keep the connection open.
  readonly sseHeartbeatMs?: number;
}

export function createApp(deps: AppDeps = {}): Hono {
  const getProvider = deps.getProvider ?? (() => createProvider());
  const buildJobs = deps.buildJobs ?? createBuildJobQueue();
  const sseHeartbeatMs = deps.sseHeartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
  const app = new Hono();

  // Root route — the fixed shell (ARCH §6.1). Returns the authored static page
  // public/index.html via Bun.file, read per request (Bun file I/O is
  // microsecond-fast and stays live under `bun --watch`). Content-Type is set
  // explicitly: Bun infers it from the file, but that lazily-computed header is
  // dropped when the Response passes through Hono's router. Kept as an explicit
  // route — rather than a serveStatic fall-through — so `/` stays greppable for
  // later epics and `app.request("/")`-testable.
  app.get(
    "/",
    () =>
      new Response(Bun.file("./public/index.html"), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );

  // Module 1 provider-liveness endpoint. It remains testable directly even though
  // the home page no longer shows the old "Meet Aluna" trigger. streamSSE sets the
  // SSE headers (text/event-stream, no-cache, keep-alive) and closes the connection
  // when the callback returns.
  app.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      const transport = sseTransport(stream);
      await withSseHeartbeat(transport, sseHeartbeatMs, async () => {
        let aborted = false;
        stream.onAbort(() => {
          aborted = true;
        });
        const isAborted = () => aborted;

        try {
          await streamGreeting(transport.send, isAborted, getProvider());
        } catch (err) {
          await handleStreamError(transport.send, isAborted, err);
        }
      });
    }),
  );

  // Spec-generation liveness demo (Module 2 §2.5b; demo scaffolding, removed when
  // Epic 2.6 wires the real prompt bar). User-initiated like /stream, so the
  // provider is never called on page load. The typed prompt rides a query param
  // (EventSource is GET-only), with a default so the bare button still works.
  app.get("/demo/spec-build", (c) =>
    streamSSE(c, async (stream) => {
      const transport = sseTransport(stream);
      await withSseHeartbeat(transport, sseHeartbeatMs, async () => {
        let aborted = false;
        stream.onAbort(() => {
          aborted = true;
        });
        const isAborted = () => aborted;
        const typed = (c.req.query("prompt") ?? "").trim();
        const prompt = typed.length > 0 ? typed : DEMO_SPEC_PROMPT;

        try {
          await streamSpecBuildDemo(transport.send, isAborted, getProvider(), prompt);
        } catch (err) {
          await handleSpecBuildError(transport.send, isAborted, err);
        }
      });
    }),
  );

  // Prompt submission enters the build-job lifecycle (Epic 2.5). The POST does
  // only synchronous queue admission and returns the per-build SSE subscriber
  // fragment immediately; intent resolution and later builder stages run from
  // `/build/:id/stream`, never on the POST path.
  app.post("/prompt", async (c) => {
    const prompt = await readPrompt(c);
    const result = buildJobs.create(prompt);

    if (!result.accepted) {
      return c.html(renderBusyNotice(), 200, {
        "cache-control": "no-store",
        "HX-Reswap": "innerHTML",
        "HX-Retarget": PROMPT_NOTICE_TARGET,
      });
    }

    return c.html(renderBuildSubscriber(result.job.id), 200, {
      "cache-control": "no-store",
    });
  });

  // Per-build ephemeral stream ("phone call", ADR-0002 update). App event ids are
  // monotonic per stream via the transport writer; heartbeat events are id-less
  // transport keepalives so a silent long-running builder stage does not let the
  // connection go idle.
  app.get("/build/:id/stream", (c) =>
    streamSSE(c, async (stream) => {
      const transport = sseTransport(stream);
      await withSseHeartbeat(transport, sseHeartbeatMs, async () => {
        let aborted = false;
        stream.onAbort(() => {
          aborted = true;
        });

        await buildJobs.stream(c.req.param("id"), transport.send, () => aborted);
      });
    }),
  );

  // The deterministic capability router (ARCH §6.2, ADR-0004): the fixed
  // `/capability/:id/:action` convention the generated UI targets. It validates the
  // action against the registry row's tools, loads the version-keyed handler, builds
  // the scoped context, and wraps the returned fragment — routing is never an AI
  // concern. Registered as its own subsystem (src/router) so this file stays the
  // thin wiring sheet.
  registerCapabilityRoutes(app, deps.capabilityRouter ?? {});

  // Static assets live in ./public and are served under the /static/* prefix
  // (e.g. the shell's CSS/JS will be referenced as /static/<file>). A dedicated
  // prefix keeps the asset namespace clear of the root-level route conventions
  // that arrive later (/capability/:id/:action, /files/:key, the SSE channel).
  // rewriteRequestPath strips the prefix so /static/app.css resolves to
  // ./public/app.css rather than ./public/static/app.css.
  app.use(
    "/static/*",
    serveStatic({
      root: "./public",
      rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
    }),
  );

  return app;
}

// The default app, wired to the real provider. src/index.ts serves this.
export const app = createApp();
