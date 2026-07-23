// The evolution-candidate dev tracer routes — Module 4.6/01–02 (PLAN decisions
// 1, 2, 4, 21, 22, 37; ADR-0006). The first visible half of evolution on the
// homepage: the developer-panel affordance posts a live capability id plus a
// hand-typed intent; the trace authors one complete candidate spec, validates it
// totally, and runs the Diff Engine over the committed and candidate specs. It
// shows the accepted candidate with its typed change facts and unioned work plan,
// the measured no-op when the Diff finds zero facts, or the warm rejection. A
// real change stops after the Diff (4.6/03 owns the additive DDL and unit work);
// the only durable effect here is the measured no-op's own `success/no_change`
// metrics row — still no DDL, publication, version bump, or View swap.
//
// The trace runs under the exclusive build lease: decision 1 freezes the
// dependency-generation catalog "while mutation ownership is held", and the
// lease is what makes that freeze real (and what the no-op's metrics row is
// finalized under). The resolved intent stays hand-supplied through this seam
// until epic 4.8 wires the real resolver in front; 4.6/05 owns removing what
// remains of the temporary tracer seams.

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import {
  type BuildJob,
  type BuildJobQueue,
  type BuildPipelineCompletion,
  createBuildJobQueue,
  type SendBuildEvent,
} from "./build-jobs.ts";
import { CandidateValidationError, type CapabilityDiff } from "./builder/index.ts";
import type { PlatformDatabase } from "./db.ts";
import type { MutationCoordinator } from "./mutation-coordinator/index.ts";
import { runEvolutionCandidateTracer } from "./pipeline/evolution-candidate-tracer.ts";
import { finalizeMeasuredNoChange, type RecordMetrics } from "./pipeline/index.ts";
import {
  buildEvolutionCandidateAcceptedPreview,
  buildEvolutionCandidateNoChangePreview,
  buildEvolutionCandidateRejectedPreview,
} from "./pipeline/previews.ts";
import { renderRestorationFragment } from "./pipeline/restoration.ts";
import {
  deliverCandidateNoChangePresentation,
  deliverCandidateOutcomePresentation,
  deliverFailedPresentation,
  deliverRestoredPresentation,
} from "./pipeline/terminal-presentation.ts";
import { abortableProvider, type Provider } from "./provider/index.ts";
import { type CapabilityRow, type CapabilitySpec, getCapability } from "./registry/index.ts";
import { sseTransport, withSseHeartbeat } from "./sse/index.ts";
import { renderBuildSubscriber } from "./web/index.ts";

/** The slice of the app's resolved dependency set this route group needs. */
export interface EvolutionCandidateTracerDeps {
  readonly buildDatabases: PlatformDatabase;
  readonly getProvider: () => Provider;
  readonly mutationCoordinator: MutationCoordinator;
  readonly sseHeartbeatMs: number;
  /** The lifecycle writer the measured no-op finalizes `success/no_change` through. */
  readonly recordMetrics: RecordMetrics;
}

/** One admitted evolution-candidate trace: the target row and the typed intent. */
interface EvolutionCandidateAdmission {
  readonly active: CapabilityRow;
  readonly intentText: string;
}

type EvolutionTraceOutcome =
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "accepted";
      readonly candidate: CapabilitySpec;
      readonly diff: CapabilityDiff;
    };

/** Register the tracer's admit/cancel/stream trio, mirroring the 4.5 tracer shape. */
export function registerEvolutionCandidateTracerRoutes(
  app: Hono,
  deps: EvolutionCandidateTracerDeps,
): void {
  const { buildDatabases, sseHeartbeatMs } = deps;
  const expected = new Map<string, EvolutionCandidateAdmission>();
  const jobs = createEvolutionCandidateTracerJobs(deps, expected);

  app.post("/demo/evolution-candidate/:id", async (c) => {
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
        streamPath: `/demo/evolution-candidate/build/${encodedJobId}/stream`,
        cancelPath: `/demo/evolution-candidate/build/${encodedJobId}/cancel`,
      }),
      200,
      { "cache-control": "no-store" },
    );
  });

  app.post("/demo/evolution-candidate/build/:id/cancel", (c) =>
    jobs.cancel(c.req.param("id")) ? c.body(null, 202) : c.body(null, 404),
  );
  app.get("/demo/evolution-candidate/build/:id/stream", (c) =>
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

function createEvolutionCandidateTracerJobs(
  deps: EvolutionCandidateTracerDeps,
  expectedByJob: Map<string, EvolutionCandidateAdmission>,
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
          () => traceEvolutionCandidate(deps, admitted, job.id, send, isAborted, signal),
          signal ? { signal } : {},
        );
        return await presentTraceOutcome(deps, admitted, job, send, canPresent, outcome);
      } catch (error) {
        return await presentTraceFailure(deps, admitted, job, send, canPresent, isAborted, error);
      }
    },
  });
}

// The lease-held work: re-check the admitted target is unchanged, then generate
// and validate the candidate and run the Diff Engine. A rejected candidate throws
// CandidateValidationError; an unmapped difference throws UnmappedChangeFactError —
// both the failure path. A zero-fact Diff is the measured no-op: it finalizes a
// `success/no_change` metrics row under this lease (decision 37) before presenting.
async function traceEvolutionCandidate(
  deps: EvolutionCandidateTracerDeps,
  admitted: EvolutionCandidateAdmission,
  buildId: string,
  send: SendBuildEvent,
  isAborted: () => boolean,
  signal: AbortSignal | undefined,
): Promise<EvolutionTraceOutcome> {
  const { buildDatabases, getProvider } = deps;
  if (isAborted()) return { kind: "cancelled" };
  const current = getCapability(admitted.active.id, buildDatabases.readonly);
  if (
    current?.incarnation_id !== admitted.active.incarnation_id ||
    current.version !== admitted.active.version
  ) {
    throw new Error("Selected capability changed before its evolution trace began.");
  }
  const traced = await runEvolutionCandidateTracer({
    active: current,
    intentText: admitted.intentText,
    provider: abortableProvider(getProvider(), signal),
    registry: buildDatabases.readonly,
    send,
  });
  if (isAborted()) return { kind: "cancelled" };
  // The measured no-op's durable effect: its own `success/no_change` row. It runs
  // under the held lease, before presentation, so the record survives a dropped
  // client exactly like an activation does.
  if (traced.diff.isNoop) {
    finalizeMeasuredNoChange(deps.recordMetrics, {
      buildId,
      incarnationId: current.incarnation_id,
      capabilityId: current.id,
      durationMs: traced.durationMs,
      usage: traced.usage,
    });
  }
  return { kind: "accepted", candidate: traced.candidate, diff: traced.diff };
}

async function presentTraceOutcome(
  deps: EvolutionCandidateTracerDeps,
  admitted: EvolutionCandidateAdmission,
  job: BuildJob,
  send: SendBuildEvent,
  canPresent: () => boolean,
  outcome: EvolutionTraceOutcome,
): Promise<BuildPipelineCompletion> {
  const restoration = renderRestorationFragment(job.restoration, deps.buildDatabases.readonly);
  if (outcome.kind === "cancelled") {
    if (canPresent()) await deliverRestoredPresentation(send, restoration, "cancelled");
    return "terminal-sent";
  }
  if (!canPresent()) return undefined;
  if (outcome.diff.isNoop) {
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
  await deliverCandidateOutcomePresentation(
    send,
    JSON.stringify(
      buildEvolutionCandidateAcceptedPreview(
        admitted.active,
        admitted.intentText,
        outcome.candidate,
        outcome.diff,
      ),
    ),
    restoration,
    "accepted",
  );
  return "terminal-sent";
}

// A CandidateValidationError is the warm-rejection path, never a crash; every
// other throw is the shared failed-build presentation. Either way the displaced
// View is restored — the trace changed nothing.
async function presentTraceFailure(
  deps: EvolutionCandidateTracerDeps,
  admitted: EvolutionCandidateAdmission,
  job: BuildJob,
  send: SendBuildEvent,
  canPresent: () => boolean,
  isAborted: () => boolean,
  error: unknown,
): Promise<BuildPipelineCompletion> {
  const restoration = renderRestorationFragment(job.restoration, deps.buildDatabases.readonly);
  if (isAborted()) {
    if (!canPresent()) return undefined;
    await deliverRestoredPresentation(send, restoration, "cancelled");
    return "terminal-sent";
  }
  if (!canPresent()) return undefined;
  if (error instanceof CandidateValidationError) {
    await deliverCandidateOutcomePresentation(
      send,
      JSON.stringify(
        buildEvolutionCandidateRejectedPreview(admitted.active, admitted.intentText, error.issues),
      ),
      restoration,
      "rejected",
    );
    return "terminal-sent";
  }
  await deliverFailedPresentation(send, error, restoration);
  return "terminal-sent";
}
