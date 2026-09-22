// The Hono application — the platform's one route file (ARCH §4: "no framework
// ceremony, one route file"). This is the thin wiring sheet: it assembles the
// injectable dependencies and attaches each route, delegating the work to the
// subsystems (sse transport, web presentation, build pipeline, capability router).
//
// It serves the fixed shell page at `/`, static assets under /static/*, and the
// production `/prompt` → `/build/:id/stream` build-job flow — the one admission path
// for every build. Nothing here is a preview: the developer surfaces this file used to
// register came down with module 5, and every route below is one the product answers.

import type { Context } from "hono";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import { capabilityUrl } from "#shell/routes.js";
import { DEFAULT_ARTIFACTS_ROOT } from "../builder/index.ts";
import {
  alreadyGoneResponse,
  type CapabilityDestructionFaults,
  createDeletionCleanupSupervisor,
  createProductionCapabilityDeletionAdapters,
  DELETION_RECHECK_PARAM,
  type DeletionCleanupSupervisor,
  handleCapabilityDeletionConfirmation,
  type OwnedResourceCleanupAdapter,
  renderCapabilityDeletionConfirmation,
  resolveCapabilityDeletionRestoration,
} from "../lifecycle/deletion/index.ts";
import {
  createRunningLogoClaims,
  type LogoGenerationProvider,
  type RunningLogoClaims,
  recoverCapabilityLogos,
  registerCapabilityLogoRoutes,
} from "../lifecycle/logo/index.ts";
import { handleCapabilityRename } from "../lifecycle/rename/index.ts";
import {
  createMetricsRecorder,
  createPromptBuildPipeline,
  type RecordMetrics,
} from "../pipeline/index.ts";
import { type BuildJobQueue, createBuildJobQueue } from "../pipeline/jobs/build-jobs.ts";
import { captureRestorationDescriptor } from "../pipeline/jobs/restoration.ts";
import { errorDetail } from "../platform/errors.ts";
import { db, dbReadonly, type PlatformDatabase } from "../platform/persistence/db.ts";
import { createProvider, type Provider } from "../platform/provider/index.ts";
import { getCapability, listCapabilityDependents } from "../registry/index.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../runtime/concurrency/mutation-coordinator.ts";
import {
  createReadGateCoordinator,
  type ReadGateCoordinator,
} from "../runtime/concurrency/read-gates.ts";
import { type CapabilityRouterDeps, registerCapabilityRoutes } from "../runtime/router/index.ts";
import {
  BLANK_PROMPT_NOTICE,
  hasMeaningfulPromptContent,
  isCrossSitePrompt,
  LONG_PROMPT_NOTICE,
  MAX_PROMPT_LENGTH,
  readPromptSubmission,
  renderBuildSubscriber,
  renderCachedCapabilitySurface,
  renderPromptNotice,
  renderRehydratedShellPage,
} from "./http/index.ts";
import { DEFAULT_SSE_HEARTBEAT_MS, sseTransport, withSseHeartbeat } from "./sse/index.ts";

/**
 * Dependencies the app is built with. Everything is injected (defaulting to the real spine, db
 * singletons and tracked artifacts root), so route wiring is testable with no network and no spend.
 */
export interface AppDeps {
  /**
   * Called once per stream. Defaults to the real provider, constructed lazily so a
   * missing key does not stop the server from booting — it surfaces in the stream.
   */
  readonly getProvider?: () => Provider;
  /** Defaults to the platform db singletons and the real file loader. */
  readonly capabilityRouter?: CapabilityRouterDeps;
  /** Defaults to the real prompt pipeline: classify, deflect, or build. */
  readonly buildJobs?: BuildJobQueue;
  /** Defaults below Bun's server idle timeout, so a silent stage keeps the connection. */
  readonly sseHeartbeatMs?: number;
  /** Defaults to the real writer on the platform read-write connection. */
  readonly recordMetrics?: RecordMetrics;
  /**
   * The read-write/read-only pair the build's migration, Gate and commit ride. Tests inject the
   * same scratch pair they hand the router, so a committed capability is immediately routable.
   */
  readonly buildDatabases?: PlatformDatabase;
  /** Where commit writes a capability's version directory. Defaults to `capabilities/`. */
  readonly artifactsRoot?: string;
  /** Atomic admission shared by builds, record routes, and platform writes. */
  readonly mutationCoordinator?: MutationCoordinator;
  /** Per-incarnation read ownership shared by capability routes and deletion. */
  readonly readGates?: ReadGateCoordinator;
  /** Fault seams used to pin deletion's pre-/post-commit boundary. */
  readonly capabilityDestructionFaults?: CapabilityDestructionFaults;
  /** Bounded in-process retry for durable post-commit cleanup. */
  readonly deletionCleanup?: DeletionCleanupSupervisor;
  /**
   * The hosted vector service one claimed logo attempt calls. Defaults to the real, paid client;
   * every test injects a fake, because no automated test may spend credits (ADR-0007).
   */
  readonly logoProvider?: LogoGenerationProvider;
  /**
   * The logo attempts running in this process, shared by the attempt route and the desk load's
   * recovery — the only way to tell a running claim from one whose process died (ADR-0007).
   */
  readonly logoClaims?: RunningLogoClaims;
  /** Test seam for the bounded moment a claim loser watches the winner. */
  readonly logoClaimObservationMs?: number;
}

/** The fully-resolved dependency set every route group below is wired from. */
interface ResolvedAppDeps {
  readonly getProvider: () => Provider;
  readonly sseHeartbeatMs: number;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
  readonly buildJobs: BuildJobQueue;
  readonly capabilityRouter: CapabilityRouterDeps;
  readonly registryReadwrite: PlatformDatabase["readwrite"];
  readonly registryReadonly: PlatformDatabase["readonly"];
  readonly capabilityDeletionAdapters: readonly OwnedResourceCleanupAdapter[];
  readonly capabilityDestructionFaults?: CapabilityDestructionFaults;
  readonly deletionCleanup: DeletionCleanupSupervisor;
  readonly logoProvider?: LogoGenerationProvider;
  readonly logoClaims: RunningLogoClaims;
  readonly logoClaimObservationMs?: number;
}

function resolveRegistryDatabases(
  capabilityRouter: CapabilityRouterDeps,
  defaultDatabases: PlatformDatabase,
): PlatformDatabase {
  return capabilityRouter.databases ?? defaultDatabases;
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
  const readGates = resolveReadGates(deps);
  const buildJobs =
    deps.buildJobs ??
    createBuildJobQueue({
      pipeline: createPromptBuildPipeline({
        getProvider,
        recordMetrics,
        buildDatabases,
        artifactsRoot,
        mutationCoordinator,
        readGates,
      }),
    });
  // The capability router and the on-load shell rehydration read the same registry: a `GET /`
  // logo click hits `/capability/:id` on this connection, so resolving it once keeps them agreed.
  const capabilityRouter = deps.capabilityRouter ?? {};
  const capabilityDeletionAdapters = createProductionCapabilityDeletionAdapters(artifactsRoot);
  const registryDatabases = resolveRegistryDatabases(capabilityRouter, {
    readwrite: db,
    readonly: dbReadonly,
  });
  return {
    getProvider,
    sseHeartbeatMs,
    recordMetrics,
    buildDatabases,
    artifactsRoot,
    mutationCoordinator,
    readGates,
    buildJobs,
    capabilityRouter,
    registryReadwrite: registryDatabases.readwrite,
    registryReadonly: registryDatabases.readonly,
    capabilityDeletionAdapters,
    capabilityDestructionFaults: deps.capabilityDestructionFaults,
    logoProvider: deps.logoProvider,
    logoClaims: deps.logoClaims ?? createRunningLogoClaims(),
    logoClaimObservationMs: deps.logoClaimObservationMs,
    deletionCleanup:
      deps.deletionCleanup ??
      createDeletionCleanupSupervisor({
        database: registryDatabases.readwrite,
        adapters: capabilityDeletionAdapters,
        mutationCoordinator,
      }),
  };
}

/**
 * A caller may hand the read gates in directly or through the capability router, and the two have
 * to be the same coordinator: deletion and a capability read blind to each other's gates is a bug.
 */
function resolveReadGates(deps: AppDeps): ReadGateCoordinator {
  return deps.readGates ?? deps.capabilityRouter?.readGates ?? createReadGateCoordinator();
}

/**
 * The response headers every app page and fragment carries. The desk had none, so a script that
 * reached the DOM by any route had the whole origin, and the desk was framable by anyone.
 */
const APP_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'", // 'unsafe-eval' is Alpine's; no 'unsafe-inline'
    "style-src 'self' 'unsafe-inline'", // the design contract's escape hatch is inline style
    "img-src 'self' data:", // an inline data:image is a legitimate record value
    "media-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'", // or injected markup re-roots every relative URL
    "frame-ancestors 'none'", // x-frame-options below repeats it for older browsers
  ].join("; "),
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

/**
 * Apply them to everything, without overwriting a route that states its own. The logo
 * route's `default-src 'none'; … ; sandbox` is stricter than this and must survive.
 */
function registerSecurityHeaders(app: Hono): void {
  app.use("*", async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(APP_SECURITY_HEADERS)) {
      if (!c.res.headers.has(name)) c.res.headers.set(name, value);
    }
  });
}

/**
 * The fixed shell at `/`, rendered from the registry alone, so the provider is never called on
 * page load. The logo sweep runs one step before the markup: it moves rows and never draws.
 */
function registerShellRoute(
  app: Hono,
  ctx: ResolvedAppDeps,
  recoverLogos: () => Promise<void>,
): void {
  const { registryReadonly } = ctx;

  // Read per request, so a reload picks up an edit; content-type is explicit because Hono drops
  // Bun's inferred one. Never stored: a stale desk names a deleted lifetime's picture (ADR-0007).
  app.get("/", async () => {
    await recoverLogos();
    return new Response(renderRehydratedShellPage(registryReadonly), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  });
}

/**
 * Direct navigation to `/capability/:id` draws the whole desk, so it owes the same reconciliation
 * `/` does. Middleware, not a router hook: the view handler holds read tokens and would deadlock.
 */
function registerCapabilityPageRecovery(app: Hono, recoverLogos: () => Promise<void>): void {
  const recover = async (c: Context, next: () => Promise<void>) => {
    if (c.req.method === "GET" && c.req.header("HX-Request") !== "true") {
      await recoverLogos();
    }
    await next();
  };
  // Both spellings of the one address (`CAPABILITY_VIEW_TRAILING_SLASH_ROUTE`): a desk drawn
  // for a bookmark with a trailing slash owes the same reconciliation as one without it.
  app.use("/capability/:id", recover);
  app.use("/capability/:id/", recover);
}

/**
 * What a desk load discharges before the tiles are drawn, never at the cost of the desk rendering.
 * One sweep pass at a time, and a forced cleanup retry: a stranded tombstone reserves its id.
 */
function createDeskLoadRecovery(ctx: ResolvedAppDeps): () => Promise<void> {
  const recoverLogos = createPlatformLogoRecovery(ctx);
  return () => {
    ctx.deletionCleanup.forceRetry();
    return recoverLogos();
  };
}

function createPlatformLogoRecovery(ctx: ResolvedAppDeps): () => Promise<void> {
  let running: Promise<void> | null = null;
  const pass = async (): Promise<void> => {
    try {
      await recoverCapabilityLogos({
        databases: { readwrite: ctx.registryReadwrite, readonly: ctx.registryReadonly },
        mutationCoordinator: ctx.mutationCoordinator,
        readGates: ctx.readGates,
        artifactsRoot: ctx.artifactsRoot,
        claims: ctx.logoClaims,
      });
    } catch (error) {
      console.error(
        "omni-crud could not reconcile capability logos on desk load:",
        errorDetail(error),
      );
    } finally {
      running = null;
    }
  };
  return () => {
    running ??= pass();
    return running;
  };
}

/**
 * The production build-job lifecycle: prompt submission and the per-build ephemeral
 * stream it hands back.
 */
function registerBuildJobRoutes(app: Hono, ctx: ResolvedAppDeps): void {
  const { buildJobs, sseHeartbeatMs, registryReadonly } = ctx;

  // Prompt submission enters the build-job lifecycle. The POST creates the ephemeral job and
  // returns the subscriber fragment; resolution and builder stages run from `/build/:id/stream`.
  app.post("/prompt", async (c) => {
    // Before the body is read, because reading it is the first thing that costs: a build spends
    // provider tokens and commits to the desk, and neither is another site's to trigger.
    if (isCrossSitePrompt(c)) {
      return c.text("Forbidden", 403, { "cache-control": "no-store" });
    }

    const submission = await readPromptSubmission(c);

    // Nothing meaningful typed, nothing to build: an empty-looking prompt must not reach
    // `runPromptJob` and spend a call. 200, or htmx has nothing to swap and the submit looks lost.
    if (!hasMeaningfulPromptContent(submission.prompt)) {
      return c.html(renderPromptNotice(BLANK_PROMPT_NOTICE, "refusal"), 200, {
        "cache-control": "no-store",
      });
    }

    // The other end of the same admission: nothing bounded a prompt's length, so a body within
    // the server's cap still reached the resolver and was paid for. Answered the same way.
    if (submission.prompt.length > MAX_PROMPT_LENGTH) {
      return c.html(renderPromptNotice(LONG_PROMPT_NOTICE, "refusal"), 200, {
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

  // Per-build ephemeral stream ("phone call", ADR-0002 update). App event ids are monotonic per
  // stream; heartbeats are id-less keepalives, so a silent builder stage keeps the connection.
  app.get("/build/:id/stream", (c) => {
    const answer = streamSSE(c, async (stream) => {
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
    });
    // `streamSSE` states `no-cache`, which permits a store; this body carries the user's own
    // question, and a disposable answer may not be left in a disk cache (ADR-0008).
    answer.headers.set("cache-control", "no-store");
    return answer;
  });
}

/**
 * Platform-owned permanent-deletion chrome and admission. A top-level route rather than a
 * generated capability Action: it loads no Handler, asks no resolver and constructs no provider.
 */
function registerCapabilityDeletionRoutes(app: Hono, ctx: ResolvedAppDeps): void {
  app.get("/capability-deletion-restoration", (c) => {
    const query = new URL(c.req.url).searchParams;
    const restoration = resolveCapabilityDeletionRestoration(
      query.getAll("restore_capability_id"),
      query.getAll("restore_incarnation_id"),
      ctx.registryReadonly,
      query.getAll("restore_surface"),
    );
    const row = restoration.kind === "capability" ? restoration.row : null;
    return c.html(row ? renderCachedCapabilitySurface(row) : "", 200, {
      "cache-control": "no-store",
      "HX-Replace-Url": row ? capabilityUrl(row.id) : "/",
    });
  });

  app.get("/capability-deletion/:id", (c) => {
    const capabilityId = c.req.param("id");
    const query = new URL(c.req.url).searchParams;
    const restoration = resolveCapabilityDeletionRestoration(
      query.getAll("restore_capability_id"),
      query.getAll("restore_incarnation_id"),
      ctx.registryReadonly,
      query.getAll("restore_surface"),
    );
    const target = getCapability(capabilityId, ctx.registryReadonly);
    // A target gone in the meantime still owes back the capability the doorway displaced. Why it
    // is gone decides the sentence: an unasked press removed nothing; a lost Confirm may not have.
    if (!target) {
      return alreadyGoneResponse(
        c,
        capabilityId,
        restoration,
        ctx.registryReadonly,
        query.get(DELETION_RECHECK_PARAM) === "1" ? "after-confirm" : "never-asked",
      );
    }
    const dependents = listCapabilityDependents(target, ctx.registryReadonly);
    return c.html(
      renderCapabilityDeletionConfirmation(
        target,
        dependents,
        restoration.kind === "capability"
          ? {
              kind: "capability",
              capabilityId: restoration.row.id,
              incarnationId: restoration.row.incarnation_id,
            }
          : { kind: "neutral" },
      ),
      200,
      { "cache-control": "no-store" },
    );
  });

  app.post("/capability-deletion/:id/confirm", (c) => handleCapabilityDeletionConfirmation(c, ctx));
}

/**
 * Renaming from the logo's own context menu. A top-level platform route for the reason deletion's
 * are: no Handler, no resolver and no provider, so menu to registry is zero-AI end to end.
 */
function registerCapabilityRenameRoutes(app: Hono, ctx: ResolvedAppDeps): void {
  app.post("/capability-rename/:id", (c) => handleCapabilityRename(c, ctx));
}

/**
 * Build the Hono app from {@link AppDeps}, applying the production defaults for any
 * dependency a caller does not inject, then attaching every route group.
 */
export function createApp(deps: AppDeps = {}): Hono {
  const ctx = resolveAppDeps(deps);
  const app = new Hono();

  // Every route here states its own cache policy; these two are what answers when no route does.
  // A bare 404 is heuristically cacheable (RFC 9111 §4.2.2), so a half-built address would stick.
  app.notFound((c) => c.text("404 Not Found", 404, { "cache-control": "no-store" }));
  app.onError((error, c) => {
    console.error("omni-crud request failed:", error);
    return c.text("Internal Server Error", 500, { "cache-control": "no-store" });
  });

  registerSecurityHeaders(app);

  const recoverOnDeskLoad = createDeskLoadRecovery(ctx);
  registerShellRoute(app, ctx, recoverOnDeskLoad);
  registerCapabilityPageRecovery(app, recoverOnDeskLoad);
  registerBuildJobRoutes(app, ctx);
  registerCapabilityDeletionRoutes(app, ctx);
  registerCapabilityRenameRoutes(app, ctx);

  // The logo's own two addresses, registered before the generated capability router so the
  // four-segment paths are matched by their owner and the ordering says who owns them.
  registerCapabilityLogoRoutes(app, {
    registryDatabases: { readwrite: ctx.registryReadwrite, readonly: ctx.registryReadonly },
    mutationCoordinator: ctx.mutationCoordinator,
    readGates: ctx.readGates,
    artifactsRoot: ctx.artifactsRoot,
    logoProvider: ctx.logoProvider,
    logoClaims: ctx.logoClaims,
    logoClaimObservationMs: ctx.logoClaimObservationMs,
  });

  // The deterministic capability router: the fixed `/capability/:id/:action` convention the
  // generated UI targets. Its own subsystem (src/router), so this file stays the wiring sheet.
  registerCapabilityRoutes(app, {
    ...ctx.capabilityRouter,
    mutationCoordinator: ctx.mutationCoordinator,
    readGates: ctx.readGates,
  });

  // Static assets live in ./public, served under /static/*, a prefix that keeps the asset
  // namespace clear of root-level routes. rewriteRequestPath strips it before the lookup.
  app.use(
    "/static/*",
    serveStatic({
      root: "./public",
      rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
    }),
  );

  // High Meadow ships directly from its source directory so the product and
  // handbook cannot drift into separate token or asset copies.
  app.use(
    "/design/*",
    serveStatic({
      root: "./design",
      rewriteRequestPath: (path) => path.replace(/^\/design/, ""),
    }),
  );

  // The architecture tour ships the same way, from its own top-level folder: its scripts
  // reach design/styles and design/scripts by relative path, so neither can drift.
  app.get("/architecture", (c) => c.redirect("/architecture/", 301));
  app.use(
    "/architecture/*",
    serveStatic({
      root: "./architecture",
      rewriteRequestPath: (path) => path.replace(/^\/architecture/, ""),
    }),
  );

  return app;
}

/**
 * The default app, wired to the real provider. src/index.ts serves this.
 */
export const platformReadGates = createReadGateCoordinator();
export const platformMutationCoordinator = createMutationCoordinator();
export const platformDeletionCleanup = createDeletionCleanupSupervisor({
  database: db,
  adapters: createProductionCapabilityDeletionAdapters(DEFAULT_ARTIFACTS_ROOT),
  mutationCoordinator: platformMutationCoordinator,
});
/**
 * The attempts running in this process. Exported so boot reconciles the logo lifecycle against
 * the same registry the desk load consults; a boot pass with its own set would always be empty.
 */
export const platformLogoClaims = createRunningLogoClaims();
export const app = createApp({
  readGates: platformReadGates,
  mutationCoordinator: platformMutationCoordinator,
  deletionCleanup: platformDeletionCleanup,
  logoClaims: platformLogoClaims,
});
