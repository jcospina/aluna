// The Hono application — the platform's one route file (ARCH §4: "no framework
// ceremony, one route file"). This is the thin wiring sheet: it assembles the
// injectable dependencies and attaches each route, delegating the work to the
// subsystems (sse transport, web presentation, build pipeline, capability router).
//
// It serves the fixed shell page at `/`, static assets under /static/*, and the
// production `/prompt` → `/build/:id/stream` build-job flow — the one admission path
// for every build. The `/demo/*` surface no served fragment targets — now just the
// few-shot gallery — sits behind a single dev-only guard, so a production bundle does
// not answer it.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import { DEFAULT_ARTIFACTS_ROOT } from "../builder/index.ts";
import { renderFewShotGalleryPreviewPage } from "../builder/units/few-shot-gallery-preview.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../mutation-coordinator/index.ts";
import { db, dbReadonly, type PlatformDatabase } from "../persistence/db.ts";
import {
  createMetricsRecorder,
  createPromptBuildPipeline,
  type RecordMetrics,
} from "../pipeline/index.ts";
import { type BuildJobQueue, createBuildJobQueue } from "../pipeline/jobs/build-jobs.ts";
import { captureRestorationDescriptor } from "../pipeline/jobs/restoration.ts";
import { createProvider, type Provider } from "../provider/index.ts";
import { type CapabilityRouterDeps, registerCapabilityRoutes } from "../router/index.ts";
import { DEFAULT_SSE_HEARTBEAT_MS, sseTransport, withSseHeartbeat } from "../sse/index.ts";
import {
  BLANK_PROMPT_NOTICE,
  hasMeaningfulPromptContent,
  readPromptSubmission,
  renderBuildSubscriber,
  renderPromptNotice,
  renderRehydratedShellPage,
} from "../web/index.ts";

/**
 * Whether the developer-only `/demo/*` surfaces are registered. See {@link createApp}
 * for why this is one check rather than per-route configuration.
 *
 * Read per `createApp()` call, not once at import: a module-level constant would be
 * frozen before any test could set `NODE_ENV`, leaving the guard permanently unprovable
 * and free to be deleted under a green suite. `bun run build` defines NODE_ENV as
 * "production", so this still folds to `false` in the bundle.
 */
function demoSurfacesEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

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
   * read-write connection; tests inject a capturing stub so a build's metrics wiring
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
}

/** The fully-resolved dependency set every route group below is wired from. */
interface ResolvedAppDeps {
  readonly getProvider: () => Provider;
  readonly sseHeartbeatMs: number;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly mutationCoordinator: MutationCoordinator;
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
  const buildDatabases = deps.buildDatabases ?? { readwrite: db, readonly: dbReadonly };
  const recordMetrics: RecordMetrics =
    deps.recordMetrics ?? createMetricsRecorder(buildDatabases.readwrite);
  const artifactsRoot = deps.artifactsRoot ?? DEFAULT_ARTIFACTS_ROOT;
  const mutationCoordinator = deps.mutationCoordinator ?? createMutationCoordinator();
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
    buildJobs,
    capabilityRouter,
    registryReadonly,
  };
}

/**
 * The fixed shell at `/` — rendered from the registry alone, so the provider is
 * never called on page load.
 */
function registerShellRoute(app: Hono, ctx: ResolvedAppDeps): void {
  const { registryReadonly } = ctx;

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
}

/**
 * The one surviving deterministic preview surface (epic 3.5) — no provider and no db.
 *
 * The 3.2–3.3 platform-presentation previews it used to sit beside are gone (4.8/07):
 * every module they showed — field renderer, list container + item wrapper, shared
 * detail modal, click-to-open — is now on the live capability surface, which `/` serves
 * through the real `renderCollection`. The gallery stays because it is the only place
 * the *injected* item-renderer prompt section can be read; production shows the
 * generated output, never the input.
 */
function registerPreviewDemoRoutes(app: Hono): void {
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
}

/**
 * The production build-job lifecycle: prompt submission and the per-build ephemeral
 * stream it hands back.
 */
function registerBuildJobRoutes(app: Hono, ctx: ResolvedAppDeps): void {
  const { buildJobs, sseHeartbeatMs, registryReadonly } = ctx;

  // Prompt submission enters the build-job lifecycle (Epic 2.5). The POST does
  // only synchronous ephemeral job creation and returns the per-build SSE subscriber
  // fragment immediately; intent resolution and later builder stages run from
  // `/build/:id/stream`, never on the POST path.
  app.post("/prompt", async (c) => {
    const submission = await readPromptSubmission(c);

    // Nothing meaningful typed, nothing to build. `readPromptSubmission` normalizes every
    // encoding to one string, and the admission predicate also catches bodies made only
    // from invisible/default-ignorable or control characters. The guard is admission's,
    // not the parser's, and never the pipeline's: an empty-looking prompt must not reach
    // `runPromptJob`, where classification would spend a real provider call on it.
    // Answered as 200 carrying only the out-of-band notice,
    // the vocabulary every warm terminal already speaks: a non-2xx would leave HTMX
    // with nothing to swap, so a blank submit would look like nothing happened. No
    // subscriber fragment means no stream opens, so the prompt bar stays live.
    if (!hasMeaningfulPromptContent(submission.prompt)) {
      return c.html(renderPromptNotice(BLANK_PROMPT_NOTICE), 200, {
        "cache-control": "no-store",
      });
    }

    const restoration = captureRestorationDescriptor(submission.restoration, registryReadonly);
    const result = buildJobs.create(submission.prompt, restoration);

    return c.html(renderBuildSubscriber(result.job.id), 200, {
      "cache-control": "no-store",
    });
  });

  app.post("/build/:id/cancel", (c) =>
    buildJobs.cancel(c.req.param("id")) ? c.body(null, 202) : c.body(null, 404),
  );

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

  registerShellRoute(app, ctx);
  registerBuildJobRoutes(app, ctx);

  // The one guard over the `/demo/*` surfaces nothing in the served UI targets: they
  // are developer inspection routes, not product, so a production bundle must not
  // answer them. `bun run build` defines NODE_ENV as "production", which folds the
  // check to `false`; a source run — `bun run dev`, `bun test` — leaves it unset, so
  // the surfaces stay available where they are actually used. One guard, not a
  // framework: no per-route flags, no configuration machinery.
  if (demoSurfacesEnabled()) {
    registerPreviewDemoRoutes(app);
  }

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
