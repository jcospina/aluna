// The Hono application — the platform's one route file (ARCH §4: "no framework
// ceremony, one route file"). This is the thin wiring sheet: it assembles the
// injectable dependencies and attaches each route, delegating the work to the
// subsystems (sse transport, web presentation, greeting round-trip, build pipeline,
// capability router).
//
// It serves the fixed shell page at `/`, static assets under /static/*, the Module 1
// `/stream` provider-liveness endpoint, the production `/prompt` → `/build/:id/stream`
// build-job flow, and the remaining `/demo/spec-build` verification route.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";

import { type BuildJobQueue, createBuildJobQueue } from "./build-jobs.ts";
import { DEFAULT_ARTIFACTS_ROOT } from "./builder/index.ts";
import { db, dbReadonly, type PlatformDatabase } from "./db.ts";
import { handleStreamError, streamGreeting } from "./greeting.ts";
import { writeGenerationMetrics } from "./metrics/index.ts";
import {
  createPromptBuildPipeline,
  DEMO_SPEC_PROMPT,
  handleSpecBuildError,
  type RecordMetrics,
  streamSpecBuildDemo,
} from "./pipeline/index.ts";
import { createProvider, type Provider } from "./provider/index.ts";
import { type CapabilityRouterDeps, registerCapabilityRoutes } from "./router/index.ts";
import { DEFAULT_SSE_HEARTBEAT_MS, sseTransport, withSseHeartbeat } from "./sse/index.ts";
import {
  PROMPT_NOTICE_TARGET,
  readPrompt,
  renderBuildSubscriber,
  renderBusyNotice,
} from "./web/index.ts";

/**
 * Dependencies the app is built with. Everything is injected (defaulting to the real
 * spine, db singletons, and tracked artifacts root) so the route wiring is testable
 * through fakes with no network and no spend — the orchestrator depends on the
 * contracts, never the SDK or the real data file.
 */
export interface AppDeps {
  /**
   * Called once per stream. Defaults to the real provider, constructed lazily so a
   * missing key does not stop the server from booting — it surfaces in the stream.
   */
  readonly getProvider?: () => Provider;
  /**
   * Capability router wiring (Epic 2.3). Defaults to the platform db singletons and
   * the real file loader; tests inject a scratch db pair (and, where they assert load
   * ordering, a spy loader).
   */
  readonly capabilityRouter?: CapabilityRouterDeps;
  /**
   * Build-job queue (Epic 2.5). Defaults to the real prompt pipeline: classify on the
   * job stream, deflect unsupported intents, or build a new capability. Tests can
   * still inject deterministic ids and paused pipelines.
   */
  readonly buildJobs?: BuildJobQueue;
  /**
   * SSE transport heartbeat interval. Defaults below Bun's server idle timeout; tests
   * lower it to prove silent long-running stages keep the connection open.
   */
  readonly sseHeartbeatMs?: number;
  /**
   * Generation-metrics writer (Epic 2.7). Defaults to the real writer on the platform
   * read-write connection; tests inject a capturing stub so the demo's metrics wiring
   * is assertable without writing to the real data file.
   */
  readonly recordMetrics?: RecordMetrics;
  /**
   * The read-write/read-only pair the build's migration, gate, and commit ride (Epic
   * 2.5g). Defaults to the platform singletons; tests inject the same scratch pair
   * they hand the router, so a committed capability is immediately routable without
   * touching the real data file.
   */
  readonly buildDatabases?: PlatformDatabase;
  /**
   * Where commit writes a capability's version directory (Epic 2.5g). Defaults to the
   * tracked `capabilities/` root; tests point it at a throwaway directory so a
   * committed build's artifacts never land in the repo tree.
   */
  readonly artifactsRoot?: string;
}

/**
 * Build the Hono app from {@link AppDeps}, applying the production defaults for any
 * dependency a caller does not inject, then attaching every route.
 */
export function createApp(deps: AppDeps = {}): Hono {
  const getProvider = deps.getProvider ?? (() => createProvider());
  const sseHeartbeatMs = deps.sseHeartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
  const recordMetrics: RecordMetrics =
    deps.recordMetrics ?? ((metrics) => void writeGenerationMetrics(metrics, db));
  const buildDatabases = deps.buildDatabases ?? { readwrite: db, readonly: dbReadonly };
  const artifactsRoot = deps.artifactsRoot ?? DEFAULT_ARTIFACTS_ROOT;
  const buildJobs =
    deps.buildJobs ??
    createBuildJobQueue({
      pipeline: createPromptBuildPipeline({
        getProvider,
        recordMetrics,
        buildDatabases,
        artifactsRoot,
      }),
    });
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

  // The build demo (Module 2 §2.5; superseded by the production POST /prompt flow
  // in Epic 2.6). Runs the full pipeline through commit against the configured
  // provider and the real db/disk. User-initiated like /stream, so the provider is
  // never called on page load. The typed prompt rides a query param (EventSource is
  // GET-only), with a default so the bare button still works.
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
          await streamSpecBuildDemo(
            transport.send,
            isAborted,
            getProvider(),
            prompt,
            recordMetrics,
            buildDatabases,
            artifactsRoot,
          );
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
