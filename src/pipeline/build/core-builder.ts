// The core Builder: everything between "a request has been resolved" and "the platform
// has changed" — the bounded build ticket, the exclusive lease, the lease-head
// revalidation, the durable admission row, and the run itself, for a brand-new capability
// or an evolution of a committed one. Mutation, staging, Gate, activation and metrics all
// live behind this one entry point and behave identically no matter who called it.
//
// # The reuse seam
//
// This module owns no prompt route, no active DOM and no SSE vocabulary. It takes an
// already-classified {@link ResolvedBuildRequest} and a {@link CoreBuilderPresenter}, and
// emits the run's terminal lifecycle event into that presenter. Because the presenter is
// an interface rather than an SSE call, the Builder is invocable from a test with a
// recording fake, which is how identical mutation/Gate/activation behavior is proven
// without a transport.
//
// The split is real for the **terminal** and only the terminal. Three things still assume
// the explicit loop's shape:
//
//   - `send` is a liveness sink carrying SSE event names authored inside the stages, so a
//     non-browser presenter receives vocabulary it can only ignore.
//   - A `send` that fails is read as *the build was cancelled* — right for a person who
//     closed their tab, wrong for a background loop that never had a listener.
//   - The product-voice wording is written by the stages, not the presenter, so a quieter
//     presenter cannot reword or suppress it.
//
// # Staleness
//
// A resolved request binds a target expectation and the fingerprint of the one active
// registry catalog the resolver classified against. Both are revalidated *after* the lease
// is acquired, because only then is the registry stable. Any mismatch — a moved target, a
// colliding expected-absent id, or a catalog that has since changed — is a **stale
// refusal**: it starts no provider work, never opens a `running` row, and is never
// silently rebased, retargeted or reclassified against the newer catalog. While ownership
// is still held it writes one direct terminal `failed/stale` admission row with every
// generation stage skipped, and hands the presenter a `stale` terminal.
//
// The fingerprint covers *every* active row, not just the target's, so a queued build is
// refused even when the change that landed was about some other capability. That is
// intended: the resolver's answer is a judgment about the whole catalog, so a catalog that
// has moved invalidates the judgment, not merely the target. The price is false refusals
// under concurrency, paid deliberately, because the alternative is acting on a
// classification of a world that is gone.

import {
  type CommitCapabilityResult,
  createCapabilityIncarnationId,
  reconcileCapabilityArtifacts,
} from "../../builder/index.ts";
import {
  type MutationCoordinator,
  MutationReservationCancelledError,
} from "../../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../../persistence/db.ts";
import type { Provider } from "../../provider/index.ts";
import {
  type CapabilityRow,
  getCapability,
  isCapabilityIdReservedByDeletion,
  listCapabilityDeletionTombstones,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import {
  type CapabilityEvolutionOutcome,
  runCapabilityEvolution,
} from "../evolution/evolution-run.ts";
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
import { AbortedBuildError, runSpecBuildStages } from "./build-run.ts";
import type {
  ResolvedBuildRequest,
  ResolvedExistingCapabilityRequest,
  ResolvedNewCapabilityRequest,
} from "./resolved-request.ts";

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
 * The terminal lifecycle event of one core build. Exactly one is emitted per run, always
 * while the build lease is still held, so a presenter's work is bounded by the same
 * ownership the build had.
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
 * How a caller watches a build. `send` is the Builder's transport-agnostic liveness sink
 * (the developer previews and in-flight narration the stages already emit); `present`
 * receives the one terminal lifecycle event and owns everything user-facing about it.
 *
 * A presenter returns `"terminal-sent"` when it has delivered a complete terminal
 * response, or `undefined` when there is no longer anyone to deliver it to.
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
   * When the caller started measuring the job — for `/prompt`, before classification —
   * so `totalMs` is the whole wait the person actually experienced: resolution, the queue
   * behind the exclusive lease, and the build itself.
   */
  readonly builtAt: number;
  readonly signal?: AbortSignal;
}

/** What the lease-head check concluded: refuse, or proceed against this exact target. */
export type ResolvedRequestRevalidation =
  | { readonly kind: "stale"; readonly refusal: StaleBuildRefusal }
  | { readonly kind: "new_capability" }
  | { readonly kind: "existing_capability"; readonly active: CapabilityRow };

function proposedCapabilityIdIsUnavailable(
  proposed: string,
  database: PlatformDatabase["readonly"],
  catalog: ReturnType<typeof readActiveRegistryCatalog>,
): boolean {
  return (
    catalog.capabilities.some((row) => row.id === proposed) ||
    isCapabilityIdReservedByDeletion(proposed, database)
  );
}

/**
 * Revalidate a resolved request against the registry as it stands right now.
 *
 * All three bindings must hold and any one of them failing is the same refusal, so the
 * order affects only which reason the durable row records. The target expectation is
 * therefore checked first: "the capability you aimed at moved to v3" and "the id you
 * proposed was taken" are precise stories, while a catalog mismatch is the broad one —
 * the classification was made against a registry that no longer exists, whether or not
 * anything about this particular target changed.
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
    // Expected-absence over a resolver-proposed semantic id. When the resolver named no
    // id, absence is the activation CAS's to prove and there is nothing to check here.
    const proposed = request.expectedAbsentCapabilityId;
    if (proposed !== null && proposedCapabilityIdIsUnavailable(proposed, database, catalog)) {
      return refusal("expected_absent_collision");
    }
    if (catalog.fingerprint !== request.catalogFingerprint) return refusal("catalog_revision");
    return { kind: "new_capability" };
  }

  const target = request.targetExpectation;
  const current = getCapability(target.capabilityId, database);
  if (!current || current.incarnation_id !== target.incarnationId) return refusal("target_missing");
  // The expected-version comparison lives here, before any candidate is authored, so a
  // request aimed at a superseded version is refused as stale rather than reaching the
  // Diff Engine and being mistaken for a semantic no-op.
  if (current.version !== target.version) return refusal("target_version");
  if (catalog.fingerprint !== request.catalogFingerprint) return refusal("catalog_revision");
  return { kind: "existing_capability", active: current };
}

/**
 * Run one resolved request end to end under its own exclusive build lease, then emit the
 * terminal lifecycle event to the presenter while that lease is still held.
 */
export async function runCoreBuild(input: CoreBuildInput): Promise<BuildPipelineCompletion> {
  // "Exactly one terminal event per run" is a promise this module makes to every
  // presenter, and nested error paths would otherwise each be entitled to emit their own —
  // a presenter that threw while delivering a failure would be handed a second failure
  // describing its own delivery. The guard makes the promise structural.
  const presenter = emitOnce(input.presenter);
  const guarded: CoreBuildInput = { ...input, presenter };
  const reservation = input.mutationCoordinator.reserveBuild();
  try {
    return await input.mutationCoordinator.withBuildLease(
      reservation,
      () => runUnderBuildLease(guarded),
      input.signal ? { signal: input.signal } : {},
    );
  } catch (error) {
    // Reservation expiry or cancellation before the lease was ever granted. No durable
    // generation guarantee is claimed here — there is no row to close.
    //
    // A queued build the user cancelled is a cancellation, not a failure. Telling them it
    // failed would be false, and it is precisely the moment they are most likely to press
    // Cancel: nothing is visibly happening because another build owns the lease.
    const cancelled = error instanceof MutationReservationCancelledError || presenter.isAborted();
    return presenter.present(
      cancelled
        ? { kind: "cancelled", incarnationId: null }
        : { kind: "failed", error, incarnationId: null },
    );
  }
}

/**
 * Forward only the first terminal event; later ones resolve to the first delivery's own
 * result. A presenter whose delivery *rejects* keeps rejecting, so the failure surfaces to
 * the job queue's own safety net rather than being swallowed here.
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
  // Everything here runs inside the try, the refusal included: a store failure while
  // writing the refusal row must still be presented under the ownership this run holds,
  // not after `withBuildLease`'s `finally` has already released it.
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
 * Decision 28's direct terminal admission row. It is written while ownership is held, so
 * it survives a dropped client exactly as an activation does — and it is written *instead
 * of* `running`, never as an update to it, because nothing ever ran.
 */
async function refuseStaleAdmission(
  input: CoreBuildInput,
  refusal: StaleBuildRefusal,
): Promise<BuildPipelineCompletion> {
  input.recordMetrics.refuseStale({
    buildId: input.buildId,
    incarnationId: refusal.incarnationId,
    // The row's `capability_id` names a capability *this build owned*, because that is what
    // every per-capability reading of the lifecycle table means.
    //
    // An evolution owned its target and is named — including the reborn case, where the id
    // is live again under a different incarnation. That looks like the collision below, but
    // it is not: this build really did aim at that id, and the row carries the *expected*
    // incarnation, which says precisely which one it meant. Grouped by capability it reads
    // "a build of notes/incarnation-A was refused", which is true and complete.
    //
    // A new capability owned none. The id on its refusal is the one it asked to be *absent*,
    // which either does not exist or — on a collision — belongs to somebody else's committed
    // capability that this build never touched. And its incarnation is null, so there is no
    // disambiguator to save it: the row would read "a build of notes failed", charging a
    // capability whose own history is spotless. So it stays null exactly as the incarnation
    // does, and the id survives on the refusal itself, where it is a fact about the request
    // rather than a claim about the registry.
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
  // From here the row is open, so every exit must close it and must carry this
  // incarnation — a terminal filed under "no incarnation" would strand the `running` row
  // for boot reconciliation to find, and would show the presenter an empty measurement.
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
    // The subscriber is gone before the first provider call. Close the admitted row
    // rather than leaving it running, then let the presenter decide whether anyone is
    // still there to tell.
    finalizeCancelled(input, incarnationId, acc);
    if (input.presenter.canPresent()) {
      return input.presenter.present({ kind: "cancelled", incarnationId });
    }
    console.error(
      "Aluna initial build presentation did not complete:",
      error instanceof Error ? error.message : error,
    );
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
      // Measured on the caller's clock rather than the moment the engine happened to start,
      // so the row covers the resolution and queue wait that preceded it. That time is time
      // the person spent watching; a v1 build has always counted it, and an evolution must
      // not disagree. (The resolver's own leg stays separately visible on the row.)
      builtAt: input.builtAt,
      send: input.presenter.send,
      isAborted: input.presenter.isAborted,
    });
    return input.presenter.present({ kind: "evolved", active, outcome });
  } catch (error) {
    return input.presenter.present({ kind: "failed", error, incarnationId: active.incarnation_id });
  }
}
