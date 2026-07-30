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
import { resolveBehavioralTierEnabled } from "../builder/index.ts";
import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import {
  type CapabilityEvolutionOutcome,
  type RunCapabilityEvolutionInput,
  runCapabilityEvolution,
} from "../pipeline/evolution/evolution-run.ts";
import {
  presentEvolutionFailure,
  presentEvolutionOutcome,
} from "../pipeline/evolution/explicit-presentation.ts";
import type { RecordMetrics } from "../pipeline/index.ts";
import {
  type BuildJobQueue,
  createBuildJobQueue,
  type SendBuildEvent,
} from "../pipeline/jobs/build-jobs.ts";
import { abortableProvider, type Provider } from "../provider/index.ts";
import { type CapabilityRow, getCapability } from "../registry/index.ts";
import { sseTransport, withSseHeartbeat } from "../sse/index.ts";
import { renderBuildSubscriber } from "../web/index.ts";

/** The slice of the app's resolved dependency set this route group needs. */
export interface EvolutionTracerDeps {
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly getProvider: () => Provider;
  readonly mutationCoordinator: MutationCoordinator;
  readonly sseHeartbeatMs: number;
  /** The lifecycle writer every evolution's durable row is opened and finalized through. */
  readonly recordMetrics: RecordMetrics;
  /**
   * TEMPORARY dev-only seam for 4.7/04's explicit hard-path checkbox. The route knows only
   * the evolution contract; the app composition root chooses the demo fixture.
   */
  readonly hardEvolutionHandlerFixture: NonNullable<
    RunCapabilityEvolutionInput["firstPassHandlerFixture"]
  >;
}

/** One admitted evolution: the target row and the typed intent. */
interface EvolutionAdmission {
  readonly active: CapabilityRow;
  readonly intentText: string;
  /** TEMPORARY (4.7/04 living demo): the explicit hard-path control was enabled. */
  readonly forceBehavioralFailure: boolean;
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
    // The hard-path checkbox is deliberately separate from the intent: the resolver, Diff,
    // and frozen suite must see exactly the text the developer typed (4.7/04).
    const intentText = typeof body.intent === "string" ? body.intent.trim() : "";
    const forceBehavioralFailure = body.force_behavioral_failure === "true";
    if (intentText.length === 0) {
      return c.html('<p class="notice">Tell me what you\'d like to change first.</p>', 422);
    }
    if (forceBehavioralFailure && !resolveBehavioralTierEnabled()) {
      return c.html(
        '<p class="notice">I can only show the guided repair while behavioral checks are on. Your current version is still live.</p>',
        422,
      );
    }
    const result = jobs.create(id, {
      kind: "capability",
      capabilityId: active.id,
      incarnationId: active.incarnation_id,
    });
    expected.set(result.job.id, { active, intentText, forceBehavioralFailure });
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
        return await presentEvolutionOutcome(
          {
            active: admitted.active,
            intentText: admitted.intentText,
            job,
            send,
            canPresent,
            isAborted,
            database: deps.buildDatabases.readonly,
            recordMetrics: deps.recordMetrics,
          },
          outcome,
        );
      } catch (error) {
        return await presentEvolutionFailure(
          {
            active: admitted.active,
            intentText: admitted.intentText,
            job,
            send,
            canPresent,
            isAborted,
            database: deps.buildDatabases.readonly,
            recordMetrics: deps.recordMetrics,
          },
          error,
        );
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
    // A requested guided repair is admitted only while the tier is on, then pinned on for
    // this run. A configuration change between POST and stream may never turn deliberately
    // weak demo bytes into a tier-off candidate.
    ...(admitted.forceBehavioralFailure ? { behavioralTierEnabled: true } : {}),
    ...(admitted.forceBehavioralFailure
      ? { firstPassHandlerFixture: deps.hardEvolutionHandlerFixture }
      : {}),
  });
}
