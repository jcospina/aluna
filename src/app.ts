// The Hono application — the platform's one route file (ARCH §4: "no framework
// ceremony, one route file"). Every later epic attaches its routes here: the
// shell page, the SSE channel, the capability router (/capability/:id/:action,
// now wired — Epic 2.3), and file serving (/files/:key).
//
// At this stage it serves the fixed shell page at `/`, static assets under
// /static/*, and the SSE channel at /stream — which, for Module 1's finalization
// (Epic 1.5), proves the whole runtime spine end-to-end through the real shell:
// the shell triggers it, the server asks the **real AI provider** for a short
// greeting, and streams that structured response into the content area as it
// arrives. Zero domain logic — it builds, persists, and routes nothing; it only
// proves "the AI provider answers", live, in the UI. Wiring real intent (the
// prompt bar) → a built capability is Module 2.

import { type Context, Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { SSEStreamingApi } from "hono/streaming";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { type BuildJobQueue, createBuildJobQueue } from "./build-jobs.ts";
import { createProvider, type Provider } from "./provider/index.ts";
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

// An SSE writer that owns the monotonic `id` (ADR-0002). The event vocabulary is
// the 1.3 seed — `narration` (product-voice text to append), `fragment` (HTML to
// place), `done` (terminal, server closes so EventSource does not reconnect). M2
// owns finalizing that vocabulary and the channel topology (ADR-0002); this reuses
// the seed.
type Send = (event: string, data: string) => Promise<void>;
function sseWriter(stream: SSEStreamingApi): Send {
  let id = 0;
  return (event, data) => stream.writeSSE({ id: String(id++), event, data });
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
}

export function createApp(deps: AppDeps = {}): Hono {
  const getProvider = deps.getProvider ?? (() => createProvider());
  const buildJobs = deps.buildJobs ?? createBuildJobQueue();
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

  // The SSE channel (ARCH §4, §6.2). User-initiated from the shell — it is **not**
  // hit on page load, so it never spends against the BYO key unprompted. streamSSE
  // sets the SSE headers (text/event-stream, no-cache, keep-alive) and closes the
  // connection when the callback returns.
  app.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      const isAborted = () => aborted;
      const send = sseWriter(stream);

      try {
        await streamGreeting(send, isAborted, getProvider());
      } catch (err) {
        await handleStreamError(send, isAborted, err);
      }
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

  // Per-build ephemeral stream ("phone call", ADR-0002 update). Event ids are
  // monotonic per stream via sseWriter; the route always emits a terminal `done`
  // and returns, so unknown/completed jobs end cleanly instead of reconnecting.
  app.get("/build/:id/stream", (c) =>
    streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      await buildJobs.stream(c.req.param("id"), sseWriter(stream), () => aborted);
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
