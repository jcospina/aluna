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
  /** Defaults to the platform db singletons and the real file loader. */
  readonly capabilityRouter?: CapabilityRouterDeps;
  /** Defaults to the real prompt pipeline: classify, deflect, or build. */
  readonly buildJobs?: BuildJobQueue;
  /** Defaults below Bun's server idle timeout, so a silent stage keeps the connection. */
  readonly sseHeartbeatMs?: number;
  /** Defaults to the real writer on the platform read-write connection. */
  readonly recordMetrics?: RecordMetrics;
  /**
   * The read-write/read-only pair the build's migration, Gate and commit ride. Tests
   * inject the same scratch pair they hand the router, so a committed capability is
   * immediately routable.
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
   * The hosted vector service one claimed logo attempt calls. Defaults to the real,
   * paid client — every test injects a fake, because no automated test may spend
   * credits (ADR-0007).
   */
  readonly logoProvider?: LogoGenerationProvider;
  /**
   * The logo attempts running in this process. Shared by the attempt route and the
   * desk load's recovery, which is the only way to tell a claim that is running from
   * one whose process died (ADR-0007).
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
      }),
    });
  // The capability router and the on-load shell rehydration read the same registry:
  // a `GET /` logo click hits `/capability/:id` on this very connection, so
  // resolving it once keeps the two views of the registry consistent. Tests inject a
  // scratch pair here and a committed build stands on the rehydrated desk.
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
 * A caller may hand the read gates in directly or through the capability router, and the
 * two have to be the same coordinator — deletion and a capability read that cannot see
 * each other's gates is the bug this resolution exists to prevent.
 */
function resolveReadGates(deps: AppDeps): ReadGateCoordinator {
  return deps.readGates ?? deps.capabilityRouter?.readGates ?? createReadGateCoordinator();
}

/**
 * The response headers every app page and fragment carries.
 *
 * The desk had none. The logo route sets its own strict policy because it hands out bytes
 * the platform did not author; the pages that *run* the product carried nothing at all, so
 * a script that reached the DOM by any route had the whole origin, and the desk was
 * framable by anyone.
 *
 * The policy is as tight as the shipped surface allows:
 *   - `script-src 'self' 'unsafe-eval'` — every script is a `<script src>` from this origin,
 *     so injected inline script is refused. `'unsafe-eval'` is Alpine's: the vendored build
 *     compiles `x-data`/`x-text` expressions with `new Function`. Dropping it means dropping
 *     Alpine, which is a bigger change than this fix; what matters here is that
 *     `'unsafe-inline'` is *not* granted, which is what makes an injected `<script>` inert.
 *   - `style-src 'self' 'unsafe-inline'` — the design contract's escape hatch is the inline
 *     `style` attribute, sanitized to token discipline rather than forbidden.
 *   - `img-src`/`media-src 'self' data:` — a capability's picture is served from this origin
 *     and an inline `data:image/*` is a legitimate record value. A remote host is not, which
 *     is the browser-side half of the exfiltration ban in `presentation/vocabulary.ts`.
 *   - `frame-ancestors 'none'` with `X-Frame-Options` beside it for browsers that predate it.
 *   - `base-uri 'none'` so injected markup cannot re-root every relative URL on the page.
 */
const APP_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
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
 * The fixed shell at `/` — rendered from the registry alone, so the provider is
 * never called on page load. The logo lifecycle is reconciled against the artifact tree
 * one step before the markup, which is also provider-free: it moves rows, never draws.
 */
function registerShellRoute(
  app: Hono,
  ctx: ResolvedAppDeps,
  recoverLogos: () => Promise<void>,
): void {
  const { registryReadonly } = ctx;

  // The shell file is read per request: Bun file I/O is microsecond-fast and
  // `scripts/dev.ts` deliberately does not watch `public/`, so a browser reload picks up
  // an edit. Content-type is set explicitly because Hono's router drops Bun's lazily
  // inferred header. Kept as an explicit route rather than a serveStatic fall-through so
  // `/` stays greppable and `app.request("/")`-testable.
  // Never stored. The desk is a live view of the registry, and it is also the page that
  // *names* every logo's incarnation-keyed address. A stale copy would go on asking for a
  // deleted lifetime's picture, which the browser would then serve out of the year-long
  // immutable entry that address was granted — the one way decision 34's guarantee can be
  // defeated without the route being wrong (ADR-0007).
  //
  // The desk-load sweep starts here, one step before the markup. A fresh render is what
  // arms an attempt on every `absent` tile, and only `absent` arms — so a lifecycle left
  // dishonest by a crash has to be reconciled *before* the tiles are drawn or the row it
  // stranded would never be offered another one. Recovery makes no provider call and
  // moves no row that agrees with its artwork, so an ordinary load pays one `stat` for
  // each capability that has artwork or is mid-attempt, and renders exactly what it would
  // have rendered anyway.
  app.get("/", async () => {
    await recoverLogos();
    return new Response(renderRehydratedShellPage(registryReadonly), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  });
}

/**
 * The other full-page desk render. Direct navigation to `/capability/:id` rehydrates the
 * whole logo layer from the registry and arms every `absent` tile exactly as `/` does, so
 * it owes the same reconciliation first: a user who deep-links to one capability after a
 * crash is having a desk load, and the sweep is a property of the desk, not of one URL.
 *
 * A middleware rather than a hook inside the capability router, for two reasons. The
 * router is the generated-capability path and knows nothing of the logo layer, and its
 * view handler runs holding read tokens — where awaiting the queued coordinator write
 * recovery needs is the deadlock the coordinator's own doc names. Here it runs, and
 * finishes, before a single token is taken.
 *
 * An htmx logo click sends a fragment request and reconciles nothing: it is one tile
 * arriving in a desk that is already standing, not a desk being drawn.
 */
function registerCapabilityPageRecovery(app: Hono, recoverLogos: () => Promise<void>): void {
  const recover = async (c: Context, next: () => Promise<void>) => {
    if (c.req.method === "GET" && c.req.header("HX-Request") !== "true") {
      await recoverLogos();
    }
    await next();
  };
  // Both spellings of the one address (`CAPABILITY_VIEW_TRAILING_SLASH_ROUTE`): a desk
  // drawn for a bookmark carrying a trailing slash owes the same reconciliation as one
  // drawn for a bookmark without it.
  app.use("/capability/:id", recover);
  app.use("/capability/:id/", recover);
}

/**
 * Reconcile the logo lifecycle against what is on disk, and never let that stop a desk
 * from rendering. A capability whose tile is a placeholder one load longer is a small
 * thing; a desk that will not draw because a logo could not be reconciled is not.
 *
 * **One pass at a time.** Two tabs opening together would otherwise each walk the whole
 * registry and each take the coordinator, to reach the state the first one is already
 * reaching. A pass already running is the pass this load wants, so it waits for that one
 * — every transition is conditional, so joining is as correct as repeating and costs a
 * fraction of it.
 */
/**
 * Everything a desk load discharges before the tiles are drawn.
 *
 * The logo sweep is the half that has always been here. The other is the deletion-cleanup
 * supervisor's bounded backoff, which deliberately gives up after its last rung — and a
 * tombstone left standing reserves its capability id, so until it is discharged that
 * capability can be neither used nor rebuilt. Nothing a person could do reached that state;
 * only a process restart did. Now a desk load does, which makes refreshing the page the
 * recovery gesture. It costs nothing when nothing is owed: the supervisor schedules only
 * when a tombstone is actually outstanding, and never a second pass while one is running.
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
        error instanceof Error ? error.message : error,
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

  // Prompt submission enters the build-job lifecycle. The POST does
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
      return c.html(renderPromptNotice(BLANK_PROMPT_NOTICE, "refusal"), 200, {
        "cache-control": "no-store",
      });
    }

    // The other end of the same admission. Nothing bounded the length of a prompt, so a
    // body within the server's cap still reached the resolver and was paid for. Answered
    // the same way and for the same reason: on the bar, with no stream opened.
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
 * Platform-owned permanent-deletion chrome and admission. This is intentionally a
 * top-level route rather than a generated capability Action: it never loads a Handler,
 * asks the resolver, or constructs a provider.
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
      "HX-Replace-Url": row ? `/capability/${encodeURIComponent(row.id)}` : "/",
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
    // Even a target that has gone in the meantime owes back the capability the doorway
    // displaced; a deletion may never close a capability it was not about.
    //
    // *Why* it is gone decides what is true to say about it. An ordinary press on a tile a
    // second tab already deleted removed nothing, and says so. The client's recovery for a
    // Confirm whose reply never arrived marks itself, because there the same sentence would
    // tell somebody their destructive action did nothing when it may have done everything.
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
 * Renaming from the logo's own context menu. A top-level platform route for the reason
 * deletion's are: it loads no Handler, asks no resolver and constructs no provider, so
 * the path from the menu to the registry is deterministic and zero-AI end to end.
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

  // Every route here states its own cache policy; these two are what answers when no route
  // does. Hono's built-ins carry no directive at all, and a bare 404 is heuristically
  // cacheable (RFC 9111 §4.2.2) — so a mistyped or half-built address could be remembered
  // as missing. Nothing this platform serves is ever worth storing without being asked.
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

  // The logo's own two addresses. Registered before the generated capability router so
  // the four-segment paths are matched by their owner; they cannot collide with the
  // three-segment `/capability/:id/:action` convention, but the ordering says which
  // subsystem owns them without anyone having to work that out.
  registerCapabilityLogoRoutes(app, {
    registryDatabases: { readwrite: ctx.registryReadwrite, readonly: ctx.registryReadonly },
    mutationCoordinator: ctx.mutationCoordinator,
    readGates: ctx.readGates,
    artifactsRoot: ctx.artifactsRoot,
    logoProvider: ctx.logoProvider,
    logoClaims: ctx.logoClaims,
    logoClaimObservationMs: ctx.logoClaimObservationMs,
  });

  // The deterministic capability router: the fixed
  // `/capability/:id/:action` convention the generated UI targets. It validates the
  // action against the registry row's tools, loads the version-keyed handler, builds
  // the scoped context, and wraps the returned fragment — routing is never an AI
  // concern. Registered as its own subsystem (src/router) so this file stays the
  // thin wiring sheet.
  registerCapabilityRoutes(app, {
    ...ctx.capabilityRouter,
    mutationCoordinator: ctx.mutationCoordinator,
    readGates: ctx.readGates,
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

  // High Meadow ships directly from its source directory so the product and
  // handbook cannot drift into separate token or asset copies.
  app.use(
    "/design/*",
    serveStatic({
      root: "./design",
      rewriteRequestPath: (path) => path.replace(/^\/design/, ""),
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
 * The attempts running in this process. Exported so boot can reconcile the logo lifecycle
 * against the *same* registry the desk load consults — a boot pass holding its own would
 * be asking a set that is always empty, which is true at boot and a lie ever after.
 */
export const platformLogoClaims = createRunningLogoClaims();
export const app = createApp({
  readGates: platformReadGates,
  mutationCoordinator: platformMutationCoordinator,
  deletionCleanup: platformDeletionCleanup,
  logoClaims: platformLogoClaims,
});
