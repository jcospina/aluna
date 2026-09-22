// The core Builder: everything between *a request has been resolved* and *the platform has
// changed* — the bounded ticket, the exclusive lease, lease-head revalidation, the durable
// admission row, and the run itself, for a new capability or an evolution of a committed one.
//
// It owns no prompt route, no DOM and no SSE vocabulary: it takes a resolved request and a
// presenter and emits the run's one terminal lifecycle event, so a test drives it with a fake.
// The split is real for the terminal only — `send` still carries SSE names authored in the
// stages, a failing `send` reads as *cancelled*, and the wording is the stages', not a presenter's.
//
// The catalog fingerprint covers every active row, not the target's, so a queued build is refused
// even when the change that landed was about something else: false refusals under concurrency,
// paid deliberately against acting on a classification of a world that is gone.

import {
  type CommitCapabilityResult,
  createCapabilityIncarnationId,
  reconcileCapabilityArtifacts,
} from "../../builder/index.ts";
import { errorDetail } from "../../platform/errors.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import { abortableProvider, type Provider } from "../../platform/provider/index.ts";
import {
  type CapabilityRow,
  getCapability,
  isCapabilityIdAvailable,
  listCapabilityDeletionTombstones,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import {
  type MutationCoordinator,
  MutationReservationCancelledError,
} from "../../runtime/concurrency/mutation-coordinator.ts";
import {
  type CapabilityEvolutionOutcome,
  runCapabilityEvolution,
} from "../evolution/run/evolution-run.ts";
import type { BuildPipelineCompletion, SendBuildEvent } from "../jobs/build-jobs.ts";
import {
  classifyBuildFailure,
  type DemoBuildAccumulator,
  lifecycleFailureOutcome,
  lifecycleMeasurement,
  lifecycleStages,
  type RecordMetrics,
  staleAdmissionMeasurement,
  staleAdmissionStages,
} from "../metrics-recorder.ts";
import type {
  ResolvedBuildRequest,
  ResolvedExistingCapabilityRequest,
  ResolvedNewCapabilityRequest,
} from "./admission/resolved-request.ts";
import { AbortedBuildError, runSpecBuildStages } from "./build-run.ts";

/**
 * Why the lease-head check refused. Every reason is the same refusal with the same
 * consequences — the distinction exists for measurement, not behavior.
 */
export type StaleRefusalReason =
  /** The active registry moved between resolution and the lease head. */
  | "catalog_revision"
  /** The evolution target is gone, or the id has been reborn under a new incarnation. */
  | "target_missing"
  /** The evolution target is still there, but at a version this request did not read. */
  | "target_version"
  /** The proposed semantic id for a new capability was taken in the meantime. */
  | "expected_absent_collision";

export interface StaleBuildRefusal {
  readonly reason: StaleRefusalReason;
  /**
   * The expected incarnation for an evolution. Null only for a new-capability refusal,
   * which is refused before any incarnation is assigned.
   */
  readonly incarnationId: string | null;
  readonly capabilityId: string | null;
  /** The fingerprint the request was resolved against. */
  readonly expectedCatalogFingerprint: string;
  /** The fingerprint found at the head of the lease. */
  readonly actualCatalogFingerprint: string;
}

/**
 * The terminal lifecycle event of one core build. Exactly one per run, emitted while the build
 * lease is still held, so a presenter's work is bounded by the ownership the build had.
 */
export type CoreBuildTerminal =
  | { readonly kind: "stale"; readonly refusal: StaleBuildRefusal }
  | {
      readonly kind: "built";
      readonly commit: CommitCapabilityResult;
      readonly incarnationId: string;
    }
  | {
      readonly kind: "evolved";
      readonly active: CapabilityRow;
      readonly outcome: CapabilityEvolutionOutcome;
    }
  | { readonly kind: "cancelled"; readonly incarnationId: string | null }
  | { readonly kind: "failed"; readonly error: unknown; readonly incarnationId: string | null };

/**
 * How a caller watches a build. `send` is the transport-agnostic liveness sink the stages emit
 * into; `present` takes the one terminal event and returns `undefined` when nobody is left.
 */
export interface CoreBuilderPresenter {
  readonly send: SendBuildEvent;
  /** True while a terminal response can still reach the caller. */
  readonly canPresent: () => boolean;
  /** True for either transport disconnect or an explicit cancellation. */
  readonly isAborted: () => boolean;
  present(terminal: CoreBuildTerminal): Promise<BuildPipelineCompletion>;
}

export interface CoreBuildInput {
  /** The id this run's durable lifecycle row and published snapshot are keyed by. */
  readonly buildId: string;
  readonly request: ResolvedBuildRequest;
  readonly presenter: CoreBuilderPresenter;
  readonly provider: Provider;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly mutationCoordinator: MutationCoordinator;
  /**
   * When the caller started measuring — for `/prompt`, before classification — so `totalMs` is
   * the whole wait: resolution, the queue behind the exclusive lease, and the build.
   */
  readonly builtAt: number;
  readonly signal?: AbortSignal;
}

/**
 * How long one mid-build write may take before the reader is treated as gone. Unbounded, a
 * client that opened the stream and never drained it held the exclusive build lease behind it.
 */
export const DEFAULT_BUILD_EVENT_TIMEOUT_MS = 10_000;

/**
 * The build's own `send`, bounded by the lease's signal and a per-write deadline. The stages read
 * a rejection as *the build was cancelled*, which is what a reader who stopped reading is.
 */
function sendBeforeAbort(
  send: SendBuildEvent,
  signal: AbortSignal,
  timeoutMs = DEFAULT_BUILD_EVENT_TIMEOUT_MS,
): SendBuildEvent {
  return (event, data) => {
    if (signal.aborted) return Promise.reject(signal.reason);
    const pending = Promise.resolve(send(event, data));
    if (signal.aborted) {
      void pending.catch(() => undefined);
      return Promise.reject(signal.reason);
    }
    return new Promise<void>((resolve, reject) => {
      // Ten seconds, over the terminal write's two: these run throughout carrying preview
      // payloads, so cutting off a slow-but-real reader would end a build about to succeed.
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Build event "${event}" was not read within ${timeoutMs}ms.`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      pending.then(
        () => {
          cleanup();
          resolve();
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  };
}

/** What the lease-head check concluded: refuse, or proceed against this exact target. */
export type ResolvedRequestRevalidation =
  | { readonly kind: "stale"; readonly refusal: StaleBuildRefusal }
  | { readonly kind: "new_capability" }
  | { readonly kind: "existing_capability"; readonly active: CapabilityRow };

/**
 * Revalidates a resolved request against the registry, stable only once the lease is held. Order
 * picks only the recorded reason, and the target expectation goes first because it is precise.
 */
export function revalidateResolvedRequest(
  request: ResolvedBuildRequest,
  buildDatabases: PlatformDatabase,
): ResolvedRequestRevalidation {
  const database = buildDatabases.readonly;
  const catalog = readActiveRegistryCatalog(database);
  const refusal = (reason: StaleRefusalReason): ResolvedRequestRevalidation => ({
    kind: "stale",
    refusal: {
      reason,
      incarnationId:
        request.kind === "existing_capability" ? request.targetExpectation.incarnationId : null,
      capabilityId:
        request.kind === "existing_capability"
          ? request.targetExpectation.capabilityId
          : request.expectedAbsentCapabilityId,
      expectedCatalogFingerprint: request.catalogFingerprint,
      actualCatalogFingerprint: catalog.fingerprint,
    },
  });

  if (request.kind === "new_capability") {
    // Expected-absence over a resolver-proposed semantic id. An id the Builder authors is not known
    // yet: the Builder checks it once the spec names it, and the activation CAS after that.
    const proposed = request.expectedAbsentCapabilityId;
    if (proposed !== null && !isCapabilityIdAvailable(proposed, database)) {
      return refusal("expected_absent_collision");
    }
    if (catalog.fingerprint !== request.catalogFingerprint) return refusal("catalog_revision");
    return { kind: "new_capability" };
  }

  const target = request.targetExpectation;
  const current = getCapability(target.capabilityId, database);
  if (!current || current.incarnation_id !== target.incarnationId) return refusal("target_missing");
  // Compared before any candidate is authored, so a request aimed at a superseded version is
  // refused as stale instead of reaching the Diff Engine and reading as a semantic no-op.
  if (current.version !== target.version) return refusal("target_version");
  if (catalog.fingerprint !== request.catalogFingerprint) return refusal("catalog_revision");
  return { kind: "existing_capability", active: current };
}

/**
 * Run one resolved request end to end under its own exclusive build lease, then emit the
 * terminal lifecycle event to the presenter while that lease is still held.
 */
export async function runCoreBuild(input: CoreBuildInput): Promise<BuildPipelineCompletion> {
  // One terminal event per run, structurally: without the guard a presenter that threw while
  // delivering a failure would be handed a second failure describing its own delivery.
  const presenter = emitOnce(input.presenter);
  const guarded: CoreBuildInput = { ...input, presenter };
  const reservation = input.mutationCoordinator.reserveBuild();
  try {
    return await input.mutationCoordinator.withBuildLease(
      reservation,
      (lease) => {
        const signal = input.signal ? AbortSignal.any([input.signal, lease.signal]) : lease.signal;
        const ownedPresenter: CoreBuilderPresenter = {
          ...guarded.presenter,
          send: sendBeforeAbort(guarded.presenter.send, lease.signal),
          isAborted: () => guarded.presenter.isAborted() || signal.aborted,
        };
        return runUnderBuildLease({
          ...guarded,
          presenter: ownedPresenter,
          provider: abortableProvider(guarded.provider, signal),
          signal,
        });
      },
      input.signal ? { signal: input.signal } : {},
    );
  } catch (error) {
    // Expiry or cancellation before the lease was granted: no row to close. A queued build the
    // user cancelled is a cancellation, and they cancel while another build is holding the lease.
    const cancelled = error instanceof MutationReservationCancelledError || presenter.isAborted();
    return presenter.present(
      cancelled
        ? { kind: "cancelled", incarnationId: null }
        : { kind: "failed", error, incarnationId: null },
    );
  }
}

/**
 * Forwards only the first terminal event; later ones resolve to the first delivery's result. A
 * rejecting delivery keeps rejecting, so the failure reaches the job queue's safety net.
 */
function emitOnce(presenter: CoreBuilderPresenter): CoreBuilderPresenter {
  let delivery: Promise<BuildPipelineCompletion> | undefined;
  return {
    send: presenter.send,
    canPresent: presenter.canPresent,
    isAborted: presenter.isAborted,
    present(terminal) {
      delivery ??= presenter.present(terminal);
      return delivery;
    },
  };
}

async function runUnderBuildLease(input: CoreBuildInput): Promise<BuildPipelineCompletion> {
  // The refusal is inside the try too: a store failure writing the refusal row must be presented
  // under this run's ownership, not after `withBuildLease`'s `finally` released it.
  try {
    const revalidation = revalidateResolvedRequest(input.request, input.buildDatabases);
    if (revalidation.kind === "stale")
      return await refuseStaleAdmission(input, revalidation.refusal);
    if (input.request.kind === "new_capability") {
      return await runAdmittedNewCapability(input, input.request);
    }
    // `revalidateResolvedRequest` derives its kind from the request's own, so this branch
    // is the existing-capability one by construction.
    if (revalidation.kind !== "existing_capability") {
      throw new Error("Revalidation did not resolve a live target for an evolution.");
    }
    return await runAdmittedEvolution(input, input.request, revalidation.active);
  } catch (error) {
    // Whatever escaped did so before any incarnation this function knows of was assigned;
    // the admitted paths below close their own rows and present with their own identity.
    return input.presenter.present({ kind: "failed", error, incarnationId: null });
  }
}

/**
 * Decision 28's direct terminal admission row, written while ownership is held so it survives a
 * dropped client. It replaces `running` rather than updating it, because nothing ever ran.
 */
async function refuseStaleAdmission(
  input: CoreBuildInput,
  refusal: StaleBuildRefusal,
): Promise<BuildPipelineCompletion> {
  input.recordMetrics.refuseStale({
    buildId: input.buildId,
    incarnationId: refusal.incarnationId,
    // `capability_id` names a capability this build owned. A new capability owned none, and the
    // id it asked to be absent may be someone else's, so naming it charges a spotless history.
    capabilityId: input.request.kind === "existing_capability" ? refusal.capabilityId : null,
    resolver: input.request.resolver,
    measurement: staleAdmissionMeasurement(input.builtAt),
    stages: staleAdmissionStages(),
  });
  return input.presenter.present({ kind: "stale", refusal });
}

async function runAdmittedNewCapability(
  input: CoreBuildInput,
  request: ResolvedNewCapabilityRequest,
): Promise<BuildPipelineCompletion> {
  // Lease-head recovery cannot race this process's next publication. It validates
  // every committed version before removing any proven never-activated candidate.
  reconcileCapabilityArtifacts({
    database: input.buildDatabases.readwrite,
    artifactsRoot: input.artifactsRoot,
    tombstonedIncarnations: listCapabilityDeletionTombstones(input.buildDatabases.readonly).map(
      (tombstone) => ({
        capabilityId: tombstone.capabilityId,
        incarnationId: tombstone.incarnationId,
      }),
    ),
  });
  // Revalidation has passed, so the incarnation may now be assigned (ARCH §6.2 step 1).
  const incarnationId = createCapabilityIncarnationId();
  const acc: DemoBuildAccumulator = { usages: [request.resolver.usage], timings: {} };
  input.recordMetrics.start({
    buildId: input.buildId,
    incarnationId,
    resolver: request.resolver,
    stages: [],
  });
  // From here the row is open, so every exit closes it carrying this incarnation: a terminal
  // filed under "no incarnation" strands the `running` row for boot reconciliation to find.
  try {
    return await runOpenNewCapability(input, request, incarnationId, acc);
  } catch (error) {
    if (input.recordMetrics.get(input.buildId, incarnationId)?.lifecycleStatus === "running") {
      const failure = classifyBuildFailure(error, acc);
      input.recordMetrics.fail({
        buildId: input.buildId,
        incarnationId,
        outcome: lifecycleFailureOutcome(failure),
        stages: lifecycleStages(acc, "failed", failure),
        measurement: lifecycleMeasurement(acc, input.builtAt, failure),
      });
    }
    return input.presenter.present({ kind: "failed", error, incarnationId });
  }
}

/** The admitted run itself, once the durable row is open. */
async function runOpenNewCapability(
  input: CoreBuildInput,
  request: ResolvedNewCapabilityRequest,
  incarnationId: string,
  acc: DemoBuildAccumulator,
): Promise<BuildPipelineCompletion> {
  try {
    await input.presenter.send(
      "metrics-preview",
      JSON.stringify(input.recordMetrics.get(input.buildId, incarnationId)),
    );
  } catch (error) {
    // The subscriber is gone before the first provider call, so close the admitted row rather
    // than leaving it running and let the presenter decide whether anyone is left to tell.
    finalizeCancelled(input, incarnationId, acc);
    if (input.presenter.canPresent()) {
      return input.presenter.present({ kind: "cancelled", incarnationId });
    }
    console.error("Aluna initial build presentation did not complete:", errorDetail(error));
    return undefined;
  }

  let commit: CommitCapabilityResult | undefined;
  try {
    commit = await runSpecBuildStages(
      input.presenter.send,
      input.presenter.isAborted,
      input.provider,
      request.prompt,
      request.intent,
      input.buildId,
      incarnationId,
      acc,
      input.buildDatabases,
      input.artifactsRoot,
      (capabilityId) => input.recordMetrics.identify(input.buildId, incarnationId, capabilityId),
      () =>
        input.recordMetrics.succeed({
          buildId: input.buildId,
          incarnationId,
          outcome: "activated",
          stages: lifecycleStages(acc, "activated"),
          measurement: lifecycleMeasurement(acc, input.builtAt),
        }),
      request.targetExpectation,
    );
  } catch (error) {
    if (error instanceof AbortedBuildError || input.presenter.isAborted()) {
      finalizeCancelled(input, incarnationId, acc);
      return input.presenter.present({ kind: "cancelled", incarnationId });
    }
    const failure = classifyBuildFailure(error, acc);
    input.recordMetrics.fail({
      buildId: input.buildId,
      incarnationId,
      outcome: lifecycleFailureOutcome(failure),
      stages: lifecycleStages(acc, "failed", failure),
      measurement: lifecycleMeasurement(acc, input.builtAt, failure),
    });
    return input.presenter.present({ kind: "failed", error, incarnationId });
  }

  if (commit === undefined) {
    finalizeCancelled(input, incarnationId, acc);
    return input.presenter.present({ kind: "cancelled", incarnationId });
  }
  return input.presenter.present({ kind: "built", commit, incarnationId });
}

function finalizeCancelled(
  input: CoreBuildInput,
  incarnationId: string,
  acc: DemoBuildAccumulator,
): void {
  input.recordMetrics.fail({
    buildId: input.buildId,
    incarnationId,
    outcome: "cancelled",
    stages: lifecycleStages(acc, "cancelled"),
    measurement: lifecycleMeasurement(acc, input.builtAt),
  });
}

async function runAdmittedEvolution(
  input: CoreBuildInput,
  request: ResolvedExistingCapabilityRequest,
  active: CapabilityRow,
): Promise<BuildPipelineCompletion> {
  try {
    const outcome = await runCapabilityEvolution({
      active,
      intentText: request.prompt,
      resolvedIntent: request.intent,
      resolver: request.resolver,
      provider: input.provider,
      buildId: input.buildId,
      database: input.buildDatabases,
      artifactsRoot: input.artifactsRoot,
      recordMetrics: input.recordMetrics,
      // The caller's clock, not the engine's start, so the row covers the resolution and queue
      // wait the person spent watching — as a v1 build has always counted it.
      builtAt: input.builtAt,
      send: input.presenter.send,
      isAborted: input.presenter.isAborted,
    });
    return input.presenter.present({ kind: "evolved", active, outcome });
  } catch (error) {
    return input.presenter.present({ kind: "failed", error, incarnationId: active.incarnation_id });
  }
}
