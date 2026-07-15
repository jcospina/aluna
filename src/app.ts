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
import { renderFewShotGalleryPreviewPage } from "./builder/few-shot-gallery-preview.ts";
import { DEFAULT_ARTIFACTS_ROOT } from "./builder/index.ts";
import { db, dbReadonly, type PlatformDatabase } from "./db.ts";
import { handleStreamError, streamGreeting } from "./greeting.ts";
import { writeGenerationMetrics } from "./metrics/index.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "./mutation-coordinator/index.ts";
import {
  abortableDelay,
  DEFAULT_MUTATION_PREVIEW_HOLD_MS,
  renderMutationCoordinatorPreviewPage,
} from "./mutation-coordinator/preview.ts";
import {
  createPromptBuildPipeline,
  DEMO_SPEC_PROMPT,
  type RecordMetrics,
  streamSpecBuildDemo,
} from "./pipeline/index.ts";
import { renderDetailInteractionPreviewPage } from "./presentation/detail-interaction-preview.ts";
import { renderDetailModalPreviewPage } from "./presentation/detail-modal-preview.ts";
import { renderFieldRendererPreviewPage } from "./presentation/field-renderer-preview.ts";
import { renderListContainerPreviewPage } from "./presentation/list-container-preview.ts";
import { createProvider, type Provider } from "./provider/index.ts";
import { type CapabilityRouterDeps, registerCapabilityRoutes } from "./router/index.ts";
import { DEFAULT_SSE_HEARTBEAT_MS, sseTransport, withSseHeartbeat } from "./sse/index.ts";
import { readPrompt, renderBuildSubscriber, renderRehydratedShellPage } from "./web/index.ts";

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
  /** Atomic admission shared by builds, record routes, and platform writes. */
  readonly mutationCoordinator?: MutationCoordinator;
  /** Test-only override for the deliberately slow mutation preview lease. */
  readonly mutationPreviewHoldMs?: number;
}

/** The fully-resolved dependency set every route group below is wired from. */
interface ResolvedAppDeps {
  readonly getProvider: () => Provider;
  readonly sseHeartbeatMs: number;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly mutationCoordinator: MutationCoordinator;
  readonly mutationPreviewHoldMs: number;
  readonly buildJobs: BuildJobQueue;
  readonly capabilityRouter: CapabilityRouterDeps;
  readonly registryReadonly: PlatformDatabase["readonly"];
}

/**
 * Apply the production defaults for any dependency a caller does not inject, so the
 * route groups wire from one fully-resolved dependency set.
 */
function resolveAppDeps(deps: AppDeps): ResolvedAppDeps {
  const getProvider = deps.getProvider ?? (() => createProvider());
  const sseHeartbeatMs = deps.sseHeartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
  const recordMetrics: RecordMetrics =
    deps.recordMetrics ?? ((metrics) => void writeGenerationMetrics(metrics, db));
  const buildDatabases = deps.buildDatabases ?? { readwrite: db, readonly: dbReadonly };
  const artifactsRoot = deps.artifactsRoot ?? DEFAULT_ARTIFACTS_ROOT;
  const mutationCoordinator = deps.mutationCoordinator ?? createMutationCoordinator();
  const mutationPreviewHoldMs = deps.mutationPreviewHoldMs ?? DEFAULT_MUTATION_PREVIEW_HOLD_MS;
  const buildJobs =
    deps.buildJobs ??
    createBuildJobQueue({
      pipeline: createPromptBuildPipeline({
        getProvider,
        recordMetrics,
        buildDatabases,
        artifactsRoot,
        mutationCoordinator,
      }),
    });
  // The capability router and the on-load shell rehydration read the same registry:
  // a `GET /` toolbar entry click hits `/capability/:id` on this very connection, so
  // resolving it once keeps the two views of the registry consistent. Tests inject a
  // scratch pair here and a committed build shows up in the rehydrated toolbar.
  const capabilityRouter = deps.capabilityRouter ?? {};
  const registryReadonly = capabilityRouter.databases?.readonly ?? dbReadonly;
  return {
    getProvider,
    sseHeartbeatMs,
    recordMetrics,
    buildDatabases,
    artifactsRoot,
    mutationCoordinator,
    mutationPreviewHoldMs,
    buildJobs,
    capabilityRouter,
    registryReadonly,
  };
}

/**
 * The fixed shell at `/`, the Module 1 `/stream` liveness endpoint, and the legacy
 * `/demo/spec-build` verification route — the last two provider-driven and
 * user-initiated, so the provider is never called on page load.
 */
function registerShellAndLivenessRoutes(app: Hono, ctx: ResolvedAppDeps): void {
  const {
    getProvider,
    sseHeartbeatMs,
    recordMetrics,
    buildDatabases,
    artifactsRoot,
    mutationCoordinator,
    registryReadonly,
  } = ctx;

  // Root route — the fixed shell (ARCH §6.1), with its capability toolbar rehydrated
  // from the registry on load (Epic 2.1): one canonical entry per row, and the shell
  // flips to `has-capabilities` when at least one exists, so a refresh restores
  // "Aluna remembers you". A fresh user (empty registry) gets the untouched
  // cold-start page. The shell file is read per request (Bun file I/O is
  // microsecond-fast and stays live under `bun --watch`); content-type is set
  // explicitly because Hono's router drops Bun's lazily-inferred header. Kept as an
  // explicit route — not a serveStatic fall-through — so `/` stays greppable and
  // `app.request("/")`-testable.
  app.get(
    "/",
    () =>
      new Response(renderRehydratedShellPage(registryReadonly), {
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
        const abortController = new AbortController();
        stream.onAbort(() => {
          aborted = true;
          abortController.abort();
        });
        const isAborted = () => aborted;
        const typed = (c.req.query("prompt") ?? "").trim();
        const prompt = typed.length > 0 ? typed : DEMO_SPEC_PROMPT;

        await streamSpecBuildDemo(
          transport.send,
          isAborted,
          getProvider,
          prompt,
          recordMetrics,
          buildDatabases,
          artifactsRoot,
          mutationCoordinator,
          abortController.signal,
        );
      });
    }),
  );
}

/**
 * Deterministic HITL preview surfaces (epic 3.2–3.5) plus the Module 4.2 mutation
 * coordinator admission demo — no provider, and no db beyond the coordinator lease.
 */
function registerPreviewDemoRoutes(app: Hono, ctx: ResolvedAppDeps): void {
  const { mutationCoordinator, mutationPreviewHoldMs } = ctx;

  // Dev preview for the centralized field renderer (epic 3.2/01) — the HITL visual
  // sign-off surface. Renders the live create form + read-only detail for a sample
  // spec so a reviewer confirms the controls are on-brand and complete on the running
  // app. No provider, no db: a deterministic render of the platform module, so it is
  // safe on page load (unlike the provider-driven demos above).
  app.get(
    "/demo/field-renderer",
    () =>
      new Response(renderFieldRendererPreviewPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );

  // Dev preview for the list scaffolding container + accessible item wrapper (epic
  // 3.2/02) — the HITL visual sign-off surface. Renders the live platform list in both
  // `feed` and `grid` from a hand-written item renderer round-tripped through the
  // wrapper, plus the empty state. Deterministic, no provider, no db — safe on page load.
  app.get(
    "/demo/list-container",
    () =>
      new Response(renderListContainerPreviewPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );

  // Dev preview for the shared read-only detail modal (epic 3.2/04) — the HITL visual
  // sign-off surface. Renders the one shared <dialog> plus dev triggers that open it
  // prefilled read-only (via the real controller), exercising focus trap/restore, Escape,
  // and backdrop dismiss. Deterministic, no provider, no db — safe on page load.
  app.get(
    "/demo/detail-modal",
    () =>
      new Response(renderDetailModalPreviewPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );

  // Dev preview for the item click-to-open → read-only detail modal (epic 3.3/02) — the
  // HITL visual sign-off surface. Renders a hand-written capability list through the real
  // wrapper + real modal + real controllers (detail-modal.js + item-detail.js): clicking or
  // key-activating an item opens the shared modal prefilled read-only, honoring the
  // capability's `detail.shows`. Deterministic, no provider, no db — safe on page load.
  app.get(
    "/demo/detail-interaction",
    () =>
      new Response(renderDetailInteractionPreviewPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );

  // Dev preview for the few-shot design gallery + item-renderer prompt injection
  // (epic 3.5) — the HITL surface for inspecting the repo-only exemplars and the exact
  // "vary, don't copy" prompt section. Deterministic, no provider, no db.
  app.get(
    "/demo/few-shot-gallery",
    () =>
      new Response(renderFewShotGalleryPreviewPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );

  app.get(
    "/demo/mutation-coordinator",
    () =>
      new Response(renderMutationCoordinatorPreviewPage(mutationPreviewHoldMs), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );

  app.get("/demo/mutation-coordinator/state", (c) => c.json(mutationCoordinator.snapshot()));

  app.post("/demo/mutation-coordinator/slow-build", async (c) => {
    const signal = c.req.raw.signal;
    const reservation = mutationCoordinator.reserveBuild();
    try {
      await mutationCoordinator.withBuildLease(
        reservation,
        () => abortableDelay(mutationPreviewHoldMs, signal),
        { signal },
      );
      return c.json({ status: "released" });
    } catch {
      return c.json({ status: "cancelled" }, 409);
    }
  });
}

/**
 * The production build-job lifecycle: prompt submission and the per-build ephemeral
 * stream it hands back.
 */
function registerBuildJobRoutes(app: Hono, ctx: ResolvedAppDeps): void {
  const { buildJobs, sseHeartbeatMs } = ctx;

  // Prompt submission enters the build-job lifecycle (Epic 2.5). The POST does
  // only synchronous ephemeral job creation and returns the per-build SSE subscriber
  // fragment immediately; intent resolution and later builder stages run from
  // `/build/:id/stream`, never on the POST path.
  app.post("/prompt", async (c) => {
    const prompt = await readPrompt(c);
    const result = buildJobs.create(prompt);

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
        const abortController = new AbortController();
        stream.onAbort(() => {
          aborted = true;
          abortController.abort();
        });

        await buildJobs.stream(
          c.req.param("id"),
          transport.send,
          () => aborted,
          abortController.signal,
        );
      });
    }),
  );
}

/**
 * Build the Hono app from {@link AppDeps}, applying the production defaults for any
 * dependency a caller does not inject, then attaching every route group.
 */
export function createApp(deps: AppDeps = {}): Hono {
  const ctx = resolveAppDeps(deps);
  const app = new Hono();

  registerShellAndLivenessRoutes(app, ctx);
  registerPreviewDemoRoutes(app, ctx);
  registerBuildJobRoutes(app, ctx);

  // The deterministic capability router (ARCH §6.2, ADR-0004): the fixed
  // `/capability/:id/:action` convention the generated UI targets. It validates the
  // action against the registry row's tools, loads the version-keyed handler, builds
  // the scoped context, and wraps the returned fragment — routing is never an AI
  // concern. Registered as its own subsystem (src/router) so this file stays the
  // thin wiring sheet.
  registerCapabilityRoutes(app, {
    ...ctx.capabilityRouter,
    mutationCoordinator: ctx.mutationCoordinator,
  });

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
