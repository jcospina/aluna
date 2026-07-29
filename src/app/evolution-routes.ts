// The evolution dev tracer routes — Module 4.6/05 (PLAN decisions 1, 2, 4, 21, 22,
// 24, 27, 37; ADR-0006). The near-final evolution surface on the homepage: the
// content-area living-demo control posts a live capability id plus a hand-typed intent,
// while the read-only developer panel observes the streamed internals, and
// the whole engine runs on the real capability — candidate spec, total validation, the
// Diff Engine's typed change facts and unioned work plan, additive DDL, the
// copy/regenerate split with its prior-source admissibility decisions, the Gate over the
// assembled snapshot, publication, atomic activation, and one complete View swap.
//
// Three terminal shapes, and only one of them changes anything: an activated version
// (the `commit` swap), the measured no-op (`success/no_change`, decision 37), or the
// warm rejection. Both non-activating shapes restore the displaced View through
// `fragment` — `commit` is reserved for a real pointer activation.
//
// The run holds the exclusive build lease throughout: decision 1 freezes the
// dependency-generation catalog "while mutation ownership is held", and the lease is
// what makes that freeze real (and what activation's point of no return happens under).
// The resolved intent stays hand-supplied through this seam until epic 4.8 wires the
// real resolver in front of it.

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { CandidateValidationError } from "../builder/index.ts";
import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import {
  type CapabilityEvolutionOutcome,
  runCapabilityEvolution,
} from "../pipeline/evolution/evolution-run.ts";
import type { RecordMetrics } from "../pipeline/index.ts";
import {
  type BuildJob,
  type BuildJobQueue,
  type BuildPipelineCompletion,
  createBuildJobQueue,
  type SendBuildEvent,
} from "../pipeline/jobs/build-jobs.ts";
import { renderRestorationFragment } from "../pipeline/jobs/restoration.ts";
import {
  buildCommitPreview,
  buildEvolutionCandidateNoChangePreview,
  buildEvolutionCandidateRejectedPreview,
} from "../pipeline/streaming/previews.ts";
import {
  deliverActivatedPresentation,
  deliverActivatedRecoveryPresentation,
  deliverCandidateNoChangePresentation,
  deliverCandidateRejectedPresentation,
  deliverFailedPresentation,
  deliverRestoredPresentation,
} from "../pipeline/streaming/terminal-presentation.ts";
import { abortableProvider, type Provider } from "../provider/index.ts";
import { type CapabilityRow, getCapability } from "../registry/index.ts";
import { sseTransport, withSseHeartbeat } from "../sse/index.ts";
import { renderBuildSubscriber, renderCachedCapabilityCommitSwap } from "../web/index.ts";

/** The slice of the app's resolved dependency set this route group needs. */
export interface EvolutionTracerDeps {
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly getProvider: () => Provider;
  readonly mutationCoordinator: MutationCoordinator;
  readonly sseHeartbeatMs: number;
  /** The lifecycle writer every evolution's durable row is opened and finalized through. */
  readonly recordMetrics: RecordMetrics;
}

/** One admitted evolution: the target row and the typed intent. */
interface EvolutionAdmission {
  readonly active: CapabilityRow;
  readonly intentText: string;
}

/** Register the tracer's admit/cancel/stream trio. */
export function registerEvolutionTracerRoutes(app: Hono, deps: EvolutionTracerDeps): void {
  const { buildDatabases, sseHeartbeatMs } = deps;
  const expected = new Map<string, EvolutionAdmission>();
  const jobs = createEvolutionTracerJobs(deps, expected);

  app.post("/demo/evolution/:id", async (c) => {
    const id = c.req.param("id");
    const active = getCapability(id, buildDatabases.readonly);
    if (!active) return c.html('<p class="notice">Hmm — I can\'t find that here.</p>', 404);
    const body = await c.req.parseBody();
    const intentText = typeof body.intent === "string" ? body.intent.trim() : "";
    if (intentText.length === 0) {
      return c.html('<p class="notice">Tell me what you\'d like to change first.</p>', 422);
    }
    const result = jobs.create(id, {
      kind: "capability",
      capabilityId: active.id,
      incarnationId: active.incarnation_id,
    });
    expected.set(result.job.id, { active, intentText });
    const encodedJobId = encodeURIComponent(result.job.id);
    return c.html(
      renderBuildSubscriber(result.job.id, {
        streamPath: `/demo/evolution/build/${encodedJobId}/stream`,
        cancelPath: `/demo/evolution/build/${encodedJobId}/cancel`,
      }),
      200,
      { "cache-control": "no-store" },
    );
  });

  app.post("/demo/evolution/build/:id/cancel", (c) =>
    jobs.cancel(c.req.param("id")) ? c.body(null, 202) : c.body(null, 404),
  );
  app.get("/demo/evolution/build/:id/stream", (c) =>
    streamSSE(c, async (stream) => {
      const transport = sseTransport(stream);
      await withSseHeartbeat(transport, sseHeartbeatMs, async () => {
        let aborted = false;
        const abortController = new AbortController();
        stream.onAbort(() => {
          aborted = true;
          abortController.abort();
        });
        await jobs.stream(c.req.param("id"), transport.send, () => aborted, abortController.signal);
      });
    }),
  );
}

function createEvolutionTracerJobs(
  deps: EvolutionTracerDeps,
  expectedByJob: Map<string, EvolutionAdmission>,
): BuildJobQueue {
  const { mutationCoordinator } = deps;
  return createBuildJobQueue({
    onExpiredPendingJob: (job) => expectedByJob.delete(job.id),
    pipeline: async ({ canPresent, isAborted, job, send, signal }) => {
      const admitted = expectedByJob.get(job.id);
      expectedByJob.delete(job.id);
      if (!admitted) throw new Error("Selected capability no longer exists.");
      const reservation = mutationCoordinator.reserveBuild();
      try {
        const outcome = await mutationCoordinator.withBuildLease(
          reservation,
          () => evolveCapability(deps, admitted, job.id, send, isAborted, signal),
          signal ? { signal } : {},
        );
        return await presentOutcome(deps, admitted, job, send, canPresent, isAborted, outcome);
      } catch (error) {
        return await presentFailure(deps, admitted, job, send, canPresent, isAborted, error);
      }
    },
  });
}

// The lease-held work: re-check the admitted target is unchanged, then run the whole
// engine. A rejected candidate throws CandidateValidationError; an unmapped difference
// throws UnmappedChangeFactError — both the failure path.
function evolveCapability(
  deps: EvolutionTracerDeps,
  admitted: EvolutionAdmission,
  buildId: string,
  send: SendBuildEvent,
  isAborted: () => boolean,
  signal: AbortSignal | undefined,
): Promise<CapabilityEvolutionOutcome> {
  const { buildDatabases, getProvider } = deps;
  if (isAborted()) return Promise.resolve({ kind: "cancelled" });
  const current = getCapability(admitted.active.id, buildDatabases.readonly);
  if (
    current?.incarnation_id !== admitted.active.incarnation_id ||
    current.version !== admitted.active.version
  ) {
    throw new Error("Selected capability changed before its evolution began.");
  }
  return runCapabilityEvolution({
    active: current,
    intentText: admitted.intentText,
    provider: abortableProvider(getProvider(), signal),
    buildId,
    database: buildDatabases,
    artifactsRoot: deps.artifactsRoot,
    recordMetrics: deps.recordMetrics,
    send,
    isAborted,
  });
}

/** The one activation swap: the developer commit preview plus the complete View. */
async function presentActivated(
  deps: EvolutionTracerDeps,
  admitted: EvolutionAdmission,
  jobId: string,
  send: SendBuildEvent,
  canPresent: () => boolean,
  activation: Extract<CapabilityEvolutionOutcome, { kind: "activated" }>,
): Promise<BuildPipelineCompletion> {
  const commit = activation.commit;
  // Past the point of no return: the new version is live whether or not this lands.
  if (!canPresent()) return undefined;
  const delivered = await deliverActivatedPresentation(
    send,
    // The published-version pane carries the transition row too, so the answer to "why does
    // this version have (no) frozen tests?" is on the same panel as the version itself.
    JSON.stringify(buildCommitPreview(commit, activation.assembly.behavioralTierTransition)),
    renderCachedCapabilityCommitSwap(commit.row, commit.previousLabel),
    undefined,
    JSON.stringify(deps.recordMetrics.get(jobId, admitted.active.incarnation_id)),
  );
  if (!delivered) await deliverActivatedRecoveryPresentation(send);
  return "terminal-sent";
}

async function presentOutcome(
  deps: EvolutionTracerDeps,
  admitted: EvolutionAdmission,
  job: BuildJob,
  send: SendBuildEvent,
  canPresent: () => boolean,
  isAborted: () => boolean,
  outcome: CapabilityEvolutionOutcome,
): Promise<BuildPipelineCompletion> {
  if (outcome.kind === "activated") {
    if (isAborted()) {
      // Cancelled after the pointer moved: the version is real, so never restore the old
      // View over it — invite the refresh that recovers it from the registry.
      if (!canPresent()) return undefined;
      await deliverActivatedRecoveryPresentation(send);
      return "terminal-sent";
    }
    return presentActivated(deps, admitted, job.id, send, canPresent, outcome);
  }

  const restoration = renderRestorationFragment(job.restoration, deps.buildDatabases.readonly);
  if (outcome.kind === "cancelled") {
    if (canPresent()) await deliverRestoredPresentation(send, restoration, "cancelled");
    return "terminal-sent";
  }
  if (!canPresent()) return undefined;
  await deliverCandidateNoChangePresentation(
    send,
    JSON.stringify(
      buildEvolutionCandidateNoChangePreview(
        admitted.active,
        admitted.intentText,
        outcome.candidate,
        outcome.diff,
      ),
    ),
    restoration,
    JSON.stringify(deps.recordMetrics.get(job.id, admitted.active.incarnation_id)),
  );
  return "terminal-sent";
}

// A CandidateValidationError is the warm-rejection path, never a crash; every other
// throw is the shared failed-build presentation. Either way the displaced View is
// restored — nothing before activation changed anything. A throw *after* activation
// committed is the one exception: the new version is authoritative, so the user is told
// to refresh rather than shown a restored old View.
async function presentFailure(
  deps: EvolutionTracerDeps,
  admitted: EvolutionAdmission,
  job: BuildJob,
  send: SendBuildEvent,
  canPresent: () => boolean,
  isAborted: () => boolean,
  error: unknown,
): Promise<BuildPipelineCompletion> {
  // Did *this* run activate? The durable lifecycle row is the authority — a pointer
  // that merely moved could equally be another build's, which is a stale target and an
  // ordinary failure here. The outcome matters as much as the status: a measured no-op
  // is `success` too, and it must restore the committed View rather than send the user
  // to refresh for a version that does not exist.
  const lifecycle = deps.recordMetrics.get(job.id, admitted.active.incarnation_id);
  if (lifecycle?.lifecycleStatus === "success" && lifecycle.outcome === "activated") {
    if (!canPresent()) return undefined;
    await deliverActivatedRecoveryPresentation(send);
    return "terminal-sent";
  }
  if (!canPresent()) return undefined;
  const restoration = renderRestorationFragment(job.restoration, deps.buildDatabases.readonly);
  if (isAborted()) {
    await deliverRestoredPresentation(send, restoration, "cancelled");
    return "terminal-sent";
  }
  if (error instanceof CandidateValidationError) {
    await deliverCandidateRejectedPresentation(
      send,
      JSON.stringify(
        buildEvolutionCandidateRejectedPreview(admitted.active, admitted.intentText, error.issues),
      ),
      restoration,
    );
    return "terminal-sent";
  }
  await deliverFailedPresentation(
    send,
    error,
    restoration,
    undefined,
    JSON.stringify(deps.recordMetrics.get(job.id, admitted.active.incarnation_id)),
  );
  return "terminal-sent";
}
