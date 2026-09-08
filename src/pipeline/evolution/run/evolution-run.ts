// The evolution engine's one run (ARCH §6.2 steps 2–7; PLAN decisions 1, 2, 4, 21, 22, 24, 27, 37;
// ADR-0006), and the only evolution path in the platform: freeze the dependency-generation catalog,
// author one candidate spec, validate it totally, diff it into typed change facts and a unioned
// work plan, then derive additive DDL, regenerate the proven impact set with admissibility-gated
// prior source, byte-copy the rest, Gate the snapshot, publish without overwrite, and activate.
//
// A zero-fact candidate is the canonical no-op: no DDL, no unit work, no snapshot, no version, no
// `commit`, just a measured `success/no_change` row.
//
// Every run carries the resolver's classification of the typed prompt. The caller holds the
// exclusive build lease while this runs, so the catalog captured here is the immutable
// lease-frozen catalog decision 1 requires.

import {
  ActivationCancelledError,
  type ActivationFaultHooks,
  activatePublishedSnapshot,
  assertVerifiedDependencySnapshotCatalog,
  type BehavioralTestActionReport,
  type BehavioralTestFreezeProgress,
  buildDependencyGenerationCatalog,
  buildVerifiedDependencySnapshotCatalog,
  type CapabilityDiff,
  CapabilityGateError,
  type CommitCapabilityResult,
  committedSpecView,
  type DependencyGenerationCatalogEntry,
  diffCapabilitySpec,
  expectedActiveCapability,
  type GeneratedUnit,
  generateCandidateSpec,
  nextCapabilityVersion,
  publishCapabilitySnapshot,
  reconcileCapabilityArtifacts,
  type VerifiedDependencySnapshot,
  type VerifiedPublishedSnapshot,
} from "../../../builder/index.ts";
import type { CarriedResolverMeasurement } from "../../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { Provider, TokenUsage } from "../../../platform/provider/index.ts";
import {
  type CapabilityRow,
  type CapabilitySpec,
  listCapabilities,
  listCapabilityDeletionTombstones,
} from "../../../registry/index.ts";
import { applyAdditiveCapabilityMigration } from "../../../runtime/data/index.ts";
import { previewingProvider } from "../../build/build-run.ts";
import type { IntentClassification } from "../../intent/index.ts";
import type { SendBuildEvent } from "../../jobs/build-jobs.ts";
import {
  type DemoBuildAccumulator,
  finalizeMeasuredNoChange,
  lifecycleFailureOutcome,
  lifecycleMeasurement,
  lifecycleStages,
  type RecordMetrics,
  recordGateFailureMetrics,
  recordGateMetrics,
  refreshUnitMetrics,
} from "../../metrics-recorder.ts";
import {
  buildBehavioralTestProgressPreview,
  buildEvolutionCandidateAcceptedPreview,
  buildGatePreview,
  type EvolutionAssemblySummary,
} from "../../streaming/previews.ts";
import { createUnitPreviewStream } from "../../streaming/unit-preview-stream.ts";
import {
  type AssembledEvolutionCandidate,
  type AssembleEvolutionCandidateInput,
  assembleEvolutionCandidate,
  type EvolutionAssemblyPlan,
} from "../assembly/evolution-assembly.ts";
import { assertStoredValuesFitMaxLengths } from "../assembly/length-scan.ts";
import {
  type EvolutionIntentClassification,
  resolveEvolutionIntent,
  validateEvolutionIntentScope,
} from "../intent/evolution-intent.ts";
import { classifyEvolutionFailure, type EvolutionStage } from "./evolution-failure.ts";

export interface RunCapabilityEvolutionInput {
  /** The live committed capability being evolved — re-checked under the lease. */
  readonly active: CapabilityRow;
  /** The typed text the resolver classified, retained for previews and narration. */
  readonly intentText: string;
  /**
   * The resolver's classification of {@link intentText}, narrowed to the two intent types an
   * evolution answers, so only the pairing with {@link active} is left to check at runtime.
   */
  readonly resolvedIntent: EvolutionIntentClassification;
  /** Resolver measurement carried into the durable running row. */
  readonly resolver?: CarriedResolverMeasurement & { readonly usage: TokenUsage };
  readonly provider: Provider;
  /** The build id this run's durable lifecycle row and published snapshot are keyed by. */
  readonly buildId: string;
  /** Registry reads freeze the catalog; the write connection carries DDL + the CAS. */
  readonly database: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly recordMetrics: RecordMetrics;
  /**
   * When the caller started measuring, so `totalMs` covers resolution and the queue behind the
   * lease as a v1 build's does. Defaults to the run's own start, for a caller with no clock.
   */
  readonly builtAt?: number;
  readonly send: SendBuildEvent;
  /**
   * True once the subscriber is gone or the run was cancelled: the liveness stream goes quiet, and
   * the abortable provider rejecting its in-flight call unwinds the work.
   */
  readonly isAborted?: () => boolean;
  /** Override the global `OMNI_BEHAVIORAL_TIER` toggle (tests pin both tiers). */
  readonly behavioralTierEnabled?: boolean;
  /** Test-only fault seam immediately after staging verification and before rename. */
  readonly beforePublish?: (stagingDirectory: string) => void;
  /** Test-only activation fault seams around the point of no return. */
  readonly faults?: ActivationFaultHooks;
  /**
   * Test-only seam forcing one regenerated Handler's first pass wrong, so the Gate has a real
   * failure to repair (`evolution-frozen-repair.test.ts`). No composition root supplies it.
   */
  readonly firstPassHandlerFixture?: AssembleEvolutionCandidateInput["firstPassHandlerFixture"];
}

interface EvolutionRunBase {
  /** The validated canonical candidate — exactly what the Diff stage compared. */
  readonly candidate: CapabilitySpec;
  /** The typed change facts and unioned work plan (or the no-op) the Diff produced. */
  readonly diff: CapabilityDiff;
  /** The lease-frozen catalog the candidate was generated and validated against. */
  readonly dependencyCatalog: readonly DependencyGenerationCatalogEntry[];
  /** The candidate authoring duration — the measured no-op's only real timing. */
  readonly durationMs: number;
  /** The candidate authoring token usage — the measured no-op's only real spend. */
  readonly usage: TokenUsage;
}

/**
 * The three terminal shapes of one evolution run. `cancelled` may arrive before the candidate
 * exists, so it carries nothing; only `activated` has a new live version, and only it swaps.
 */
export type CapabilityEvolutionOutcome =
  | { readonly kind: "cancelled" }
  | ({ readonly kind: "no_change" } & EvolutionRunBase)
  | ({
      readonly kind: "activated";
      /** The assembled + Gate-cleared candidate the publication carries. */
      readonly assembly: AssembledEvolutionCandidate;
      readonly publication: VerifiedPublishedSnapshot;
      readonly commit: CommitCapabilityResult;
    } & EvolutionRunBase);

/** The mutable measurement state one run threads through its stages. */
interface EvolutionRunState {
  stage: EvolutionStage;
  readonly acc: DemoBuildAccumulator;
  readonly builtAt: number;
}

/** Open the run's measurement state on the caller's clock, or on this run's own. */
function openEvolutionRunState(input: RunCapabilityEvolutionInput): EvolutionRunState {
  return {
    stage: "spec_gen",
    builtAt: input.builtAt ?? performance.now(),
    acc: {
      usages: input.resolver ? [input.resolver.usage] : [],
      timings: {},
      capabilityId: input.active.id,
      incarnationId: input.active.incarnation_id,
    },
  };
}

/**
 * Runs one complete evolution under the caller-held build lease, streaming `spec-preview`,
 * `candidate-preview`/`units-preview` and `gate-preview`; the caller owns the terminal.
 */
export async function runCapabilityEvolution(
  input: RunCapabilityEvolutionInput,
): Promise<CapabilityEvolutionOutcome> {
  // `CandidateValidationError` (a rejected candidate) and `UnmappedChangeFactError` (decision 21's
  // fail-closed) both go up to the route, after the durable failure row is finalized.
  const { active, recordMetrics } = input;
  const isAborted = input.isAborted ?? (() => false);
  // Freeze the active dependency-generation catalog — every other capability's id, incarnation,
  // label, prompt_context and active_schema — while mutation ownership is held.
  const activeRows = listCapabilities(input.database.readonly);
  const dependencyRows = activeRows.filter((row) => row.id !== active.id);
  const dependencyCatalog = buildDependencyGenerationCatalog(activeRows, active.id);
  const intent = resolveEvolutionIntent(active, input.resolvedIntent);

  const state = openEvolutionRunState(input);
  // The durable lifecycle opens immediately before the first Builder-owned provider
  // call, exactly as a v1 build's does (ARCH §6.2 step 1).
  recordMetrics.start({
    buildId: input.buildId,
    incarnationId: active.incarnation_id,
    capabilityId: active.id,
    ...(input.resolver ? { resolver: input.resolver } : {}),
    stages: [],
  });

  try {
    const dependencySnapshots = buildVerifiedDependencySnapshotCatalog(activeRows, active.id);
    return await runEvolutionStages(
      input,
      state,
      dependencyCatalog,
      dependencyRows,
      dependencySnapshots,
      intent,
    );
  } catch (error) {
    // `afterCommit` is deliberately outside the transaction. Its success row is evidence
    // that the new version is authoritative, so never overwrite it as a failure.
    if (recordMetrics.get(input.buildId, active.incarnation_id)?.lifecycleStatus === "running") {
      if (isAborted()) cancel(input, state);
      else finalizeFailure(input, state, error);
    }
    throw error;
  }
}

/**
 * The stages themselves, from the first provider call to the activated pointer. Every
 * throw leaves the durable row to the caller's one finalization point above.
 */
async function runEvolutionStages(
  input: RunCapabilityEvolutionInput,
  state: EvolutionRunState,
  dependencyCatalog: readonly DependencyGenerationCatalogEntry[],
  dependencyRows: readonly CapabilityRow[],
  dependencySnapshots: readonly VerifiedDependencySnapshot[],
  intent: IntentClassification,
): Promise<CapabilityEvolutionOutcome> {
  const { active } = input;
  const isAborted = input.isAborted ?? (() => false);
  const generated = await authorCandidate(input, state, dependencyCatalog, intent);

  // The Diff Engine: the committed row's authored view against the validated
  // candidate. Total and monotone — an unmapped difference throws.
  state.stage = "diff";
  const diff = diffCapabilitySpec(committedSpecView(active), generated.candidate);
  validateEvolutionIntentScope(intent, diff);
  // The one check reading committed data rather than a spec (`length-scan.ts`). Under the held
  // lease, so no write lands before activation and no assembly is spent on a doomed candidate.
  assertStoredValuesFitMaxLengths(
    committedSpecView(active),
    generated.candidate,
    input.database.readonly,
  );
  const base: EvolutionRunBase = {
    candidate: generated.candidate,
    diff,
    dependencyCatalog,
    durationMs: generated.durationMs,
    usage: generated.usage,
  };
  if (isAborted()) return cancel(input, state);
  if (diff.isNoop) {
    // The measured no-op's one durable effect: a `success/no_change` row written under the held
    // lease, before presentation, so it survives a dropped client exactly as an activation does.
    finalizeMeasuredNoChange(input.recordMetrics, {
      buildId: input.buildId,
      incarnationId: active.incarnation_id,
      durationMs: generated.durationMs,
      usage: generated.usage,
      builtAt: state.builtAt,
    });
    return { kind: "no_change", ...base };
  }

  state.stage = "assembly";
  const assembly = await assembleCandidate(
    input,
    state.acc,
    generated.candidate,
    diff,
    dependencyRows,
    dependencySnapshots,
  );
  // The assembler measured initial unit generation before the Gate, so a thrown rung keeps it.
  // Refresh the history without re-adding that usage; `recordGateMetrics` takes repair usage.
  refreshUnitMetrics(state.acc, assembly.units);
  state.acc.copiedUnits = new Set(assembly.copiedUnits);
  recordGateMetrics(state.acc, assembly.gate);
  if (isAborted()) return cancel(input, state);
  // The Gate has passed; from here a throw is transport, not verification.
  state.stage = "delivery";
  await sendAssembledPreviews(input, generated.candidate, diff, assembly);
  if (isAborted()) return cancel(input, state);

  const activated = await publishAndActivate(
    input,
    state,
    assembly,
    dependencyRows,
    dependencySnapshots,
  );
  if (!activated) return cancel(input, state);
  const { publication, commit } = activated;
  return { kind: "activated", assembly, publication, commit, ...base };
}

/** Author + totally validate one complete candidate spec, streaming it as it assembles. */
async function authorCandidate(
  input: RunCapabilityEvolutionInput,
  state: EvolutionRunState,
  dependencyCatalog: readonly DependencyGenerationCatalogEntry[],
  intent: IntentClassification,
): Promise<Awaited<ReturnType<typeof generateCandidateSpec>>> {
  // Mirror the v1 build's liveness view: the developer watches the candidate assemble in
  // the panel's Spec block while the stage itself runs unchanged.
  const { provider: observed, flushPreviews } = previewingProvider(input.provider, input.send);
  try {
    const generated = await generateCandidateSpec({
      provider: observed,
      committed: input.active,
      intent,
      dependencyCatalog,
      send: input.send,
    });
    state.acc.timings.specGenMs = generated.durationMs;
    state.acc.usages.push(generated.usage);
    return generated;
  } finally {
    // Every preview is on the wire before the terminal presentation either way.
    await flushPreviews();
  }
}

/**
 * Publishes the Gate-cleared snapshot without overwrite, then activates it (ARCH §6.2 steps 6–7,
 * decision 27). One transaction: DDL, registry CAS, success. Its COMMIT is the point of no return.
 */
async function publishAndActivate(
  input: RunCapabilityEvolutionInput,
  state: EvolutionRunState,
  assembly: AssembledEvolutionCandidate,
  dependencyRows: readonly CapabilityRow[],
  dependencySnapshots: readonly VerifiedDependencySnapshot[],
): Promise<{ publication: VerifiedPublishedSnapshot; commit: CommitCapabilityResult } | undefined> {
  const { active } = input;
  const { acc } = state;
  state.stage = "publication";
  // Verify every committed v1..vN before treating the pointer as an evolution base: a damaged
  // historical version is authoritative corruption, not a reason to publish another candidate.
  reconcileCapabilityArtifacts({
    database: input.database.readwrite,
    artifactsRoot: input.artifactsRoot,
    tombstonedIncarnations: listCapabilityDeletionTombstones(input.database.readonly).map(
      (tombstone) => ({
        capabilityId: tombstone.capabilityId,
        incarnationId: tombstone.incarnationId,
      }),
    ),
  });
  const expected = expectedActiveCapability({
    capabilityId: active.id,
    incarnationId: active.incarnation_id,
    version: active.version,
  });
  acc.publicationAttempted = true;
  const publication = publishCapabilitySnapshot({
    buildId: input.buildId,
    spec: assembly.spec,
    incarnationId: active.incarnation_id,
    version: nextCapabilityVersion(expected),
    units: assembly.units,
    gate: assembly.gate,
    // Copied units keep the provenance they were generated under; only the units this
    // evolution actually wrote get a fresh active-context digest.
    unitProvenance: assembly.unitProvenance,
    artifactsRoot: input.artifactsRoot,
    ...(input.beforePublish ? { beforePublish: input.beforePublish } : {}),
  });
  // Publication is still before the point of no return: a cancellation after the atomic rename
  // leaves a candidate for reconciliation but applies no DDL and moves no registry pointer.
  if (input.isAborted?.()) return undefined;

  state.stage = "activation";
  acc.activationAttempted = true;
  try {
    const commit = await activatePublishedSnapshot({
      database: input.database.readwrite,
      spec: assembly.spec,
      publication,
      expected,
      isAborted: input.isAborted,
      verifyBeforeCommit: () =>
        assertVerifiedDependencySnapshotCatalog(dependencyRows, active.id, dependencySnapshots),
      applyMigration: (database) => {
        const startedAt = performance.now();
        applyAdditiveCapabilityMigration(assembly.additiveMigration, database);
        acc.timings.migrationMs = performance.now() - startedAt;
      },
      finalizeMetrics: () =>
        input.recordMetrics.succeed({
          buildId: input.buildId,
          incarnationId: active.incarnation_id,
          outcome: "activated",
          stages: lifecycleStages(acc, "activated"),
          measurement: lifecycleMeasurement(acc, state.builtAt),
        }),
      ...(input.faults ? { faults: input.faults } : {}),
    });
    return { publication, commit };
  } catch (error) {
    if (error instanceof ActivationCancelledError) return undefined;
    throw error;
  }
}

/** Finalize a cancelled run's durable row once, then report the terminal shape. */
function cancel(
  input: RunCapabilityEvolutionInput,
  state: EvolutionRunState,
): CapabilityEvolutionOutcome {
  if (
    input.recordMetrics.get(input.buildId, input.active.incarnation_id)?.lifecycleStatus ===
    "running"
  ) {
    input.recordMetrics.fail({
      buildId: input.buildId,
      incarnationId: input.active.incarnation_id,
      outcome: "cancelled",
      stages: lifecycleStages(state.acc, "cancelled"),
      measurement: lifecycleMeasurement(state.acc, state.builtAt),
    });
  }
  return { kind: "cancelled" };
}

/** Close the durable row at the exact stage the run stopped at ("failure is data"). */
function finalizeFailure(
  input: RunCapabilityEvolutionInput,
  state: EvolutionRunState,
  error: unknown,
): void {
  const failure = classifyEvolutionFailure(error, state.stage);
  input.recordMetrics.fail({
    buildId: input.buildId,
    incarnationId: input.active.incarnation_id,
    outcome: lifecycleFailureOutcome(failure),
    stages: lifecycleStages(state.acc, "failed", failure),
    measurement: lifecycleMeasurement(state.acc, state.builtAt, failure),
  });
}

/**
 * Assembles the Gate-cleared candidate with the panel's liveness wiring. A failed unit, a failed
 * Gate or a cancel leaves a running plan nothing is working on: close it out before the terminal.
 */
async function assembleCandidate(
  input: RunCapabilityEvolutionInput,
  acc: DemoBuildAccumulator,
  candidate: CapabilitySpec,
  diff: CapabilityDiff,
  dependencyRows: readonly CapabilityRow[],
  dependencySnapshots: readonly VerifiedDependencySnapshot[],
): Promise<AssembledEvolutionCandidate> {
  const stream = streamAssembly(input, candidate, diff);
  try {
    const assembly = await assembleEvolutionCandidate({
      committed: input.active,
      candidate,
      diff,
      // The freeze stage's durable measurement, taken by the assembler. Not on the optional
      // `progress.onTestsFrozen`, or a headless evolution would stop measuring the tier's tokens.
      measurement: acc,
      // The raw provider (not the spec-preview wrapper) generates regenerated units so
      // their partials are not mislabeled as spec previews.
      provider: input.provider,
      // The same freeze the candidate's catalog uses, minus this capability: a self-dependency is
      // implicit and never declared, so the dropped row must not reappear in unit context either.
      dependencyCatalog: dependencyRows,
      dependencySnapshots,
      // Absent, the assembled snapshot follows the global `OMNI_BEHAVIORAL_TIER` toggle,
      // exactly as a v1 build does — evolution is no longer pinned tier-off.
      ...(input.behavioralTierEnabled === undefined
        ? {}
        : { behavioralTierEnabled: input.behavioralTierEnabled }),
      ...(input.isAborted ? { isAborted: input.isAborted } : {}),
      ...(input.firstPassHandlerFixture
        ? { firstPassHandlerFixture: input.firstPassHandlerFixture }
        : {}),
      ...stream.hooks,
    });
    // The Gate is not abortable, so a cancel raised during it still lets the assembly resolve.
    // Close the plan out here too, or a developer who cancels mid-Gate stares at a running plan.
    if (input.isAborted?.()) await stream.reportAbandoned();
    return assembly;
  } catch (error) {
    // A failed rung is the only evidence of what this run gated. Without it the row reports every
    // rung skipped while its own failure names the one that failed, as the v1 path also records.
    if (error instanceof CapabilityGateError) recordGateFailureMetrics(acc, error);
    await stream.reportAbandoned();
    throw error;
  }
}

/**
 * The developer-panel previews for an assembled candidate: the Gate block, then the complete plan
 * replacing the running `candidate-preview`. Both land before publication.
 */
async function sendAssembledPreviews(
  input: RunCapabilityEvolutionInput,
  candidate: CapabilitySpec,
  diff: CapabilityDiff,
  assembly: AssembledEvolutionCandidate,
): Promise<void> {
  await input.send(
    "gate-preview",
    JSON.stringify(
      buildGatePreview(
        assembly.gate.durationMs,
        assembly.gate.outcomes,
        assembly.gate.structural,
        assembly.gate.smoke,
        assembly.gate.behavioral,
        assembly.behavioralTests,
      ),
    ),
  );
  await input.send(
    "candidate-preview",
    JSON.stringify(
      buildEvolutionCandidateAcceptedPreview(input.active, input.intentText, candidate, diff, {
        status: "complete",
        regeneratedUnits: assembly.regeneratedUnits,
        copiedUnits: assembly.copiedUnits,
        additiveMigration: assembly.additiveMigration.statements,
        priorSource: assembly.priorSource,
        behavioralTests: assembly.behavioralTests,
        // The run/skip half, settled by the Gate: which frozen suites this evolution had to
        // re-prove against new bytes, and which it left alone because nothing they cover moved.
        ...(assembly.behavioralExecution
          ? { behavioralExecution: assembly.behavioralExecution }
          : {}),
        // …and which row of decision 24's table the two halves together landed on.
        // The one line of the story a tier-off evolution can still tell.
        behavioralTierTransition: assembly.behavioralTierTransition,
        gate: assembly.gate.outcomes.map((outcome) => ({
          rung: outcome.rung,
          status: outcome.status,
        })),
      }),
    ),
  );
}

interface AssemblyStream {
  /** The liveness wiring handed to the assembler. */
  readonly hooks: Pick<AssembleEvolutionCandidateInput, "observer" | "progress">;
  /** Close out the plan the panel is showing when the assembly does not finish. */
  reportAbandoned(): Promise<void>;
}

/**
 * The assembly stage's liveness wiring: a v1 build's `units-preview` stream plus a
 * `candidate-preview` carrying the running plan. A byte-copied unit is `record`ed complete.
 */
function streamAssembly(
  input: RunCapabilityEvolutionInput,
  candidate: CapabilitySpec,
  diff: CapabilityDiff,
): AssemblyStream {
  const unitPreviews = createUnitPreviewStream(input.send, input.isAborted);
  let planned: EvolutionAssemblyPlan | undefined;
  let behavioralTests: readonly BehavioralTestActionReport[] | undefined;
  let behavioralTestProgress: BehavioralTestFreezeProgress | undefined;
  const sendPlan = (plan: EvolutionAssemblyPlan, status: EvolutionAssemblySummary["status"]) =>
    input.send(
      "candidate-preview",
      JSON.stringify(
        buildEvolutionCandidateAcceptedPreview(input.active, input.intentText, candidate, diff, {
          status,
          regeneratedUnits: plan.regeneratedUnits,
          copiedUnits: plan.copiedUnits,
          additiveMigration: plan.additiveMigration.statements,
          // Already final in the `running` plan: admissibility is deterministic and decided
          // before the first regeneration, so the developer knows which units see old source.
          priorSource: plan.priorSource,
          ...(behavioralTests ? { behavioralTests } : {}),
          gate: [],
        }),
      ),
    );

  const recordFinal = async (units: readonly GeneratedUnit[]) => {
    for (const unit of units) unitPreviews.record(unit);
    await unitPreviews.flush("complete", true);
  };

  return {
    hooks: {
      observer: unitPreviews.observer,
      progress: {
        onPlanned: async (plan) => {
          planned = plan;
          await sendPlan(plan, "running");
          await input.send(
            "narration",
            " I'm establishing what this change needs to preserve before I build it.",
          );
        },
        onTestsProgress: async (progress) => {
          behavioralTestProgress = progress;
          await input.send(
            "behavioral-tests-preview",
            JSON.stringify(buildBehavioralTestProgressPreview(progress, "running")),
          );
        },
        // Frozen intent lands between the plan and the first generated byte, so the panel shows
        // which Actions' tests this evolution wrote, and from which inputs, before any Handler.
        onTestsFrozen: async (frozen) => {
          behavioralTests = frozen.report;
          if (planned) await sendPlan(planned, "running");
          if (behavioralTestProgress) {
            await input.send(
              "behavioral-tests-preview",
              JSON.stringify(
                buildBehavioralTestProgressPreview(behavioralTestProgress, "complete"),
              ),
            );
          }
          await input.send("narration", " I'm shaping that into something you can use.");
        },
        onUnitCopied: async (unit) => {
          unitPreviews.record(unit);
          await unitPreviews.flush("running", true);
        },
        // The inventory is whole and the Gate is next: freeze the units view at complete
        // so the remaining wait is visibly the Gate's, not a stalled generation.
        onGateStart: async () => {
          await unitPreviews.flush("complete", true);
          await input.send("narration", " I'm checking it over now.");
        },
        // …and re-send it if the Gate's repairs changed the bytes underneath that view.
        onUnitsFinalized: recordFinal,
      },
    },
    reportAbandoned: async () => {
      // A developer who pressed Cancel stopped this on purpose; that is not a failure.
      if (planned) await sendPlan(planned, input.isAborted?.() ? "cancelled" : "failed");
      planned = undefined;
    },
  };
}
