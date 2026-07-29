// The evolution engine's one run — Module 4.6/05 (ARCH §6.2 "Capability Builder"
// steps 2–7; PLAN decisions 1, 2, 4, 21, 22, 24, 27, 37; ADR-0006).
//
// This is the whole engine end to end, and after 4.6/05 it is the *only* evolution
// path in the platform: freeze the dependency-generation catalog, author one complete
// candidate spec, validate it totally, diff it into typed change facts and a unioned
// work plan, then — for a real change — derive additive DDL, regenerate the proven
// impact set with admissibility-gated prior source, byte-copy everything else, Gate the
// assembled snapshot, publish it without overwrite, and activate it in one SQLite
// transaction that applies the additive DDL, compare-and-swaps the registry pointer, and
// finalizes `success/activated` together. Only after that commit may the caller swap the
// complete View.
//
// A zero-fact candidate is the canonical no-op (decision 37): no DDL, no unit work, no
// snapshot, no version, no `commit` — just a measured `success/no_change` row.
//
// TEMPORARY SEAM — the hand-supplied resolved intent. Epic 4.8 wires the real Intent
// Resolver (and stale-target admission) in front of this run; until then
// `handSuppliedEvolutionIntent` stands in for the classification. The catalog freeze is
// not temporary: the caller holds the exclusive build lease while this runs, so the
// dependency-generation catalog captured here is the immutable lease-frozen catalog
// decision 1 requires.

import {
  ActivationCancelledError,
  type ActivationFaultHooks,
  activatePublishedSnapshot,
  assertVerifiedDependencySnapshotCatalog,
  type BehavioralTestActionReport,
  type BehavioralTestFreezeProgress,
  BehavioralTestGenerationError,
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
  handSuppliedEvolutionIntent,
  nextCapabilityVersion,
  publishCapabilitySnapshot,
  reconcileCapabilityArtifacts,
  SnapshotVerificationError,
  UnitGenerationError,
  type VerifiedDependencySnapshot,
  type VerifiedPublishedSnapshot,
} from "../../builder/index.ts";
import { applyAdditiveCapabilityMigration } from "../../capability-data/index.ts";
import type { GenerationFailure } from "../../metrics/index.ts";
import type { PlatformDatabase } from "../../persistence/db.ts";
import type { Provider, TokenUsage } from "../../provider/index.ts";
import { type CapabilityRow, type CapabilitySpec, listCapabilities } from "../../registry/index.ts";
import { previewingProvider } from "../build/build-run.ts";
import type { SendBuildEvent } from "../jobs/build-jobs.ts";
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
} from "../metrics-recorder.ts";
import {
  buildBehavioralTestProgressPreview,
  buildEvolutionCandidateAcceptedPreview,
  buildGatePreview,
  type EvolutionAssemblySummary,
} from "../streaming/previews.ts";
import { createUnitPreviewStream } from "../streaming/unit-preview-stream.ts";
import {
  type AssembledEvolutionCandidate,
  type AssembleEvolutionCandidateInput,
  assembleEvolutionCandidate,
  type EvolutionAssemblyPlan,
} from "./evolution-assembly.ts";

export interface RunCapabilityEvolutionInput {
  /** The live committed capability being evolved — re-checked under the lease. */
  readonly active: CapabilityRow;
  /** The developer's hand-typed intent (the 4.8 resolver stand-in). */
  readonly intentText: string;
  readonly provider: Provider;
  /** The build id this run's durable lifecycle row and published snapshot are keyed by. */
  readonly buildId: string;
  /** Registry reads freeze the catalog; the write connection carries DDL + the CAS. */
  readonly database: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly recordMetrics: RecordMetrics;
  readonly send: SendBuildEvent;
  /**
   * True once the subscriber is gone or the run was cancelled. The liveness stream goes
   * quiet on it, exactly as a v1 build's does — the work itself is unwound by the
   * abortable provider rejecting its in-flight call.
   */
  readonly isAborted?: () => boolean;
  /** Override the global `OMNI_BEHAVIORAL_TIER` toggle (tests pin both tiers). */
  readonly behavioralTierEnabled?: boolean;
  /** Test-only fault seam immediately after staging verification and before rename. */
  readonly beforePublish?: (stagingDirectory: string) => void;
  /** Test-only activation fault seams around the point of no return. */
  readonly faults?: ActivationFaultHooks;
  /**
   * TEMPORARY (4.7/04 living demo): force one regenerated Handler's first pass to be
   * deliberately wrong, so the Gate has a real behavioral failure to repair. See
   * `pipeline/demo/hard-evolution-fixture.ts`; removed with the `/demo` surface.
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
 * The three terminal shapes of one evolution run. `cancelled` may arrive before the
 * candidate exists, so it carries nothing; `no_change` is the measured no-op; only
 * `activated` has a new live version, and therefore only it swaps the View.
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

// The progress marker the failure classifier reads. The generic `classifyBuildFailure`
// infers the stage from which timings are filled, which an evolution cannot use: its
// migration timing is only produced *inside* activation, so every post-Diff failure
// would be mislabelled as a migration failure. The run knows exactly where it is.
// `delivery` is the short window between a passing Gate and publication in which the
// run is only writing previews to the wire: a transport failure there is not a Gate
// failure, and the stage marker is what keeps the two apart.
type EvolutionStage = "spec_gen" | "diff" | "assembly" | "delivery" | "publication" | "activation";

/** The mutable measurement state one run threads through its stages. */
interface EvolutionRunState {
  stage: EvolutionStage;
  readonly acc: DemoBuildAccumulator;
  readonly builtAt: number;
}

/**
 * Run one complete evolution under the caller-held build lease, from hand-supplied
 * intent to activated version. Streams the authoring preview (`spec-preview`), the
 * derived work plan and regenerated units (`candidate-preview`/`units-preview`), and the
 * Gate verdict (`gate-preview`) as they land; the caller owns the terminal presentation.
 *
 * Throws `CandidateValidationError` on a rejected candidate (the warm rejection) and
 * `UnmappedChangeFactError` on a difference the matrix cannot map (fails closed,
 * decision 21) — both upward to the route, both after finalizing the durable failure
 * row. A throw from anywhere before the activation transaction commits leaves the prior
 * version live; a throw after it is rethrown without rewriting the authoritative
 * `success/activated` row.
 */
export async function runCapabilityEvolution(
  input: RunCapabilityEvolutionInput,
): Promise<CapabilityEvolutionOutcome> {
  const { active, recordMetrics } = input;
  const isAborted = input.isAborted ?? (() => false);
  // Freeze the immutable active dependency-generation catalog — every other
  // capability's { capability_id, incarnation_id, label, prompt_context,
  // active_schema } — while mutation ownership is held (decision 1).
  const activeRows = listCapabilities(input.database.readonly);
  const dependencyRows = activeRows.filter((row) => row.id !== active.id);
  const dependencyCatalog = buildDependencyGenerationCatalog(activeRows, active.id);
  const intent = handSuppliedEvolutionIntent(active, input.intentText);

  const state: EvolutionRunState = {
    stage: "spec_gen",
    builtAt: performance.now(),
    acc: {
      usages: [],
      timings: {},
      capabilityId: active.id,
      incarnationId: active.incarnation_id,
    },
  };
  // The durable lifecycle opens immediately before the first Builder-owned provider
  // call, exactly as a v1 build's does (ARCH §6.2 step 1).
  recordMetrics.start({
    buildId: input.buildId,
    incarnationId: active.incarnation_id,
    capabilityId: active.id,
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
  intent: ReturnType<typeof handSuppliedEvolutionIntent>,
): Promise<CapabilityEvolutionOutcome> {
  const { active } = input;
  const isAborted = input.isAborted ?? (() => false);
  const generated = await authorCandidate(input, state, dependencyCatalog, intent);

  // The Diff Engine (4.6/02): the committed row's authored view against the validated
  // candidate. Total and monotone — an unmapped difference throws.
  state.stage = "diff";
  const diff = diffCapabilitySpec(committedSpecView(active), generated.candidate);
  const base: EvolutionRunBase = {
    candidate: generated.candidate,
    diff,
    dependencyCatalog,
    durationMs: generated.durationMs,
    usage: generated.usage,
  };
  if (isAborted()) return cancel(input, state);
  if (diff.isNoop) {
    // The measured no-op's durable effect: its own `success/no_change` row. It runs
    // under the held lease, before presentation, so the record survives a dropped
    // client exactly like an activation does (decision 37).
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
  // Initial unit generation was measured inside the assembler before the Gate ran, so a
  // thrown rung keeps it. Refresh the final per-unit history here without adding the same
  // provider usage again; Gate repair usage is recorded by `recordGateMetrics`.
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
  intent: ReturnType<typeof handSuppliedEvolutionIntent>,
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
 * Publish the Gate-cleared snapshot without overwrite, then activate it. One SQLite
 * transaction applies the additive DDL, compare-and-swaps the registry pointer, and
 * finalizes `success/activated`; its COMMIT is the sole point of no return, so an
 * earlier throw leaves the prior version live plus a complete never-activated candidate
 * for guarded reconciliation (ARCH §6.2 steps 6–7, decision 27).
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
  // Verify every committed v1..vN before treating the selected pointer as an evolution
  // base. A damaged historical version is authoritative corruption, not a reason to try
  // publishing another candidate.
  reconcileCapabilityArtifacts({
    database: input.database.readwrite,
    artifactsRoot: input.artifactsRoot,
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
    // evolution actually wrote get a fresh active-context digest (decision 24).
    unitProvenance: assembly.unitProvenance,
    artifactsRoot: input.artifactsRoot,
    ...(input.beforePublish ? { beforePublish: input.beforePublish } : {}),
  });
  // Publication is still before the point of no return. A cancellation observed after
  // the atomic rename leaves a complete never-activated candidate for reconciliation,
  // but must not apply DDL, move the registry pointer, or finalize activated success.
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
 * Where an evolution stopped, in the metrics vocabulary. The structured build errors
 * carry a precise location of their own; everything else is the stage the run had
 * actually reached, which is exact rather than inferred.
 */
function classifyEvolutionFailure(error: unknown, stage: EvolutionStage): GenerationFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CapabilityGateError) {
    return { stage: "gate", rung: error.failedRung, message };
  }
  // Frozen before either Handler generation or the Gate (4.7/01); no rung ran yet.
  if (error instanceof BehavioralTestGenerationError) {
    return { stage: "behavioral_test_generation", message };
  }
  if (error instanceof UnitGenerationError) return { stage: "unit_generation", message };
  // A snapshot-verification failure means "publication" only once this run is actually
  // publishing. The same error type is also how a corrupt *committed* base fails closed
  // during assembly (decision 27), and calling that a publication fault would contradict
  // the row's own stage vector, which shows publication skipped.
  if (error instanceof SnapshotVerificationError && stage === "publication") {
    return { stage: "publication", message };
  }
  switch (stage) {
    case "spec_gen":
      return { stage: "spec_gen", message };
    // The Diff derives this evolution's schema work, so a difference the matrix cannot
    // map stops where a failed migration derivation would.
    case "diff":
      return { stage: "migration", message };
    // The assembly stage was running. A failed Gate rung and an exhausted unit loop are
    // already typed above, so what lands here is the base-verification/disk half of
    // assembly — the 4.5 failure vocabulary has no stage of its own for a corrupt
    // committed base, and the failure `message` carries the real reason.
    case "assembly":
      return { stage: "unit_generation", message };
    // The Gate already passed and only the wire failed; nothing was published, so the
    // row reads "never got published" rather than blaming a rung that succeeded.
    case "delivery":
      return { stage: "publication", message };
    case "publication":
      return { stage: "publication", message };
    case "activation":
      return { stage: "activation", message };
  }
}

/**
 * Assemble the Gate-cleared candidate with the panel's liveness wiring. A failed unit, a
 * failed Gate, or a cancel leaves a running plan on the panel that nothing is working on
 * any more — close it out before the terminal presentation replaces the View.
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
      // The durable measurement of the freeze stage, recorded by the assembler the moment it
      // authors the suite. It deliberately does not ride on `progress.onTestsFrozen`: that
      // hook exists for the developer panel and is optional, so a future headless evolution
      // would silently stop measuring the tokens the tier costs (4.7/03).
      measurement: acc,
      // The raw provider (not the spec-preview wrapper) generates regenerated units so
      // their partials are not mislabeled as spec previews.
      provider: input.provider,
      // The same freeze the candidate's catalog uses, minus this capability: a
      // self-dependency is implicit and is never declared, so the row the freeze
      // deliberately drops must not reappear in unit-generation context either.
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
    // The Gate is not abortable, so a cancel raised during it lets the assembly *resolve*
    // — the caller then discards the result and restores the View. Close the plan out
    // here too, or a developer who cancels mid-Gate is left staring at a running plan.
    if (input.isAborted?.()) await stream.reportAbandoned();
    return assembly;
  } catch (error) {
    // A failed rung is evidence, and it is the only evidence of what this run actually
    // gated. Without it the row would report every rung as skipped while its own failure
    // names the rung that failed — the v1 build path records the same thing the same way.
    if (error instanceof CapabilityGateError) recordGateFailureMetrics(acc, error);
    await stream.reportAbandoned();
    throw error;
  }
}

/**
 * The developer-panel previews for an assembled candidate: the Gate block, then the
 * complete plan carrying that verdict — the terminal `candidate-preview` replacing the
 * running one. Both land before publication, so the panel already shows the whole
 * candidate while the snapshot is written.
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
        // …and which row of decision 24's table the two halves together landed on (4.7/03).
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
 * The assembly stage's liveness wiring: the same `units-preview` stream a v1 build drives,
 * plus a `candidate-preview` carrying the running plan. A byte-copied unit is `record`ed
 * straight into the live inventory — it lands complete because it *was* complete, never
 * having entered a generation prompt — so the developer sees the copy/regenerate split as
 * bytes rather than only as a list at the end.
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
          // Already final in the `running` plan: admissibility is deterministic and is
          // decided before the first regeneration, so the developer watching the units
          // assemble already knows which of them are seeing their old source.
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
        // Frozen intent lands between the plan and the first generated byte, so the panel
        // shows which Actions' tests this evolution wrote — and from which inputs — before
        // any Handler it will judge exists.
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
