// Running the builder stages for one capability, end to end, against the live
// provider and the real db/disk.
//
// This is the engine the core Builder drives on the `/prompt` pipeline's one admission
// path: from a resolved `new_capability` intent it
// generates the spec, derives + applies the migration, generates the units, runs the
// fail-closed gate, publishes a verified snapshot, and commits — streaming developer previews and product-voice
// narration along the way, and filling the metrics accumulator as each stage lands.

import { Database } from "bun:sqlite";
import type { ZodType } from "zod";
import {
  activatePublishedSnapshot,
  applyCapabilityMigration,
  type BehavioralExecutionImpact,
  type BehavioralTierInput,
  CapabilityGateError,
  type CapabilityGateResult,
  type CommitCapabilityResult,
  FIRST_CAPABILITY_VERSION,
  type FrozenBehavioralTestsResult,
  freezeBehavioralTests,
  type GeneratedUnit,
  generateCapabilityUnits,
  generateSpec,
  type HandlerUnitName,
  publishCapabilitySnapshot,
  resolveBehavioralTierEnabled,
  runCapabilityGate,
  type UnitGenerationAttempt,
} from "../../builder/index.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import type { GenerateResult, Provider, TokenUsage } from "../../platform/provider/index.ts";
import { sumTokenUsages } from "../../platform/provider/usage.ts";
import {
  CapabilityIdReservedError,
  type CapabilityRegistryExpectation,
  type CapabilitySpec,
  isCapabilityIdReservedByDeletion,
  listCapabilities,
} from "../../registry/index.ts";
import { deriveCapabilityTableDdl } from "../../runtime/data/index.ts";
import { renderProvisionalLogoName } from "../../server/http/index.ts";
import type { Send } from "../../server/sse/index.ts";
import type { IntentClassification } from "../intent/index.ts";
import {
  type DemoBuildAccumulator,
  recordBehavioralFreezeMetrics,
  recordGateFailureMetrics,
  recordGateMetrics,
  recordUnitMetrics,
  refreshUnitMetrics,
} from "../metrics-recorder.ts";
import {
  buildGatePreview,
  buildMigrationPreview,
  buildUnitsPreview,
  finalUnitPreview,
} from "../streaming/previews.ts";
import { createUnitPreviewStream } from "../streaming/unit-preview-stream.ts";
import {
  validateBuiltOverlapIdentity,
  validateProposedOverlapIdentity,
} from "./admission/overlap-identity.ts";

/**
 * An aborted stream mid-build, thrown before activation. The caller finalizes the lifecycle as
 * cancelled with no apology (the client is gone); a published candidate awaits reconciliation.
 */
export class AbortedBuildError extends Error {
  override readonly name = "AbortedBuildError";
}

/** Throw {@link AbortedBuildError} if the stream has been aborted. */
export function throwIfAborted(isAborted: () => boolean): void {
  if (isAborted()) throw new AbortedBuildError();
}

/**
 * Decorates the provider so each partial spec snapshot reaches the shell as a `spec-preview`.
 * `flushPreviews` drains them before the warm confirmation: narration → preview* → confirmation.
 */
export function previewingProvider(
  real: Provider,
  send: Send,
): { provider: Provider; flushPreviews: () => Promise<void> } {
  // `flushPreviews` is a function, not the promise itself: a stage can throw before the provider
  // is ever called, and awaiting a promise nothing settles hangs on the build lease and the SSE.
  let streaming = false;
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const provider: Provider = {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      // A throw here means no stream was ever opened — leave `streaming` false.
      const result = real.generate(prompt, schema);
      streaming = true;
      // `generateSpec` awaits only `object`, so draining `partialStream` here cannot starve it.
      void (async () => {
        try {
          for await (const partial of result.partialStream) {
            await send("spec-preview", JSON.stringify(partial));
          }
        } catch {
          // Best-effort preview; the real outcome surfaces through generateSpec.
        } finally {
          settle();
        }
      })();
      return result;
    },
  };

  return { provider, flushPreviews: () => (streaming ? settled : Promise.resolve()) };
}

async function authorInitialSpec(input: {
  readonly send: Send;
  readonly provider: Provider;
  readonly prompt: string;
  readonly intent: IntentClassification;
  readonly acc: DemoBuildAccumulator;
  readonly database: PlatformDatabase;
}): Promise<Awaited<ReturnType<typeof generateSpec>>> {
  const { provider: observed, flushPreviews } = previewingProvider(input.provider, input.send);
  const overlapCatalog =
    input.intent.resolution === "namespace" ? listCapabilities(input.database.readonly) : [];
  if (input.intent.resolution === "namespace" && input.intent.proposed_identity) {
    validateProposedOverlapIdentity({
      proposed: input.intent.proposed_identity,
      targetCapabilityId: input.intent.target_capability ?? "",
      capabilities: overlapCatalog,
    });
  }

  let generated!: Awaited<ReturnType<typeof generateSpec>>;
  try {
    generated = await generateSpec({
      provider: observed,
      prompt: input.prompt,
      intent: input.intent,
      send: input.send,
    });
    input.acc.timings.specGenMs = generated.durationMs;
    input.acc.usages.push(generated.usage);
    if (input.intent.resolution === "namespace" && input.intent.proposed_identity) {
      validateBuiltOverlapIdentity({
        proposed: input.intent.proposed_identity,
        spec: generated.spec,
      });
    }
  } finally {
    await flushPreviews();
  }
  return generated;
}

/**
 * Runs the builder stages, filling `acc` with metrics. `undefined` means the stream aborted
 * mid-build with the transaction rolled back; a throw is a build failure the caller apologizes for.
 */
export async function runSpecBuildStages(
  send: Send,
  isAborted: () => boolean,
  provider: Provider,
  prompt: string,
  intent: IntentClassification,
  buildId: string,
  incarnationId: string,
  acc: DemoBuildAccumulator,
  buildDatabases: PlatformDatabase,
  artifactsRoot: string,
  onCapabilityIdentified: (capabilityId: string) => void,
  onActivated: () => void,
  targetExpectation: CapabilityRegistryExpectation = { state: "absent" },
): Promise<CommitCapabilityResult | undefined> {
  // Spec generation runs before the transaction opens, so a spec failure has nothing to roll back.
  const { spec, durationMs, usage } = await authorInitialSpec({
    send,
    provider,
    prompt,
    intent,
    acc,
    database: buildDatabases,
  });
  acc.capabilityId = spec.id;
  acc.incarnationId = incarnationId;
  // Admission assigns the incarnation before Builder provider work. Once the
  // validated authored spec supplies the semantic id, enrich the same durable row.
  onCapabilityIdentified(spec.id);
  // The lease-head check tests only an id the resolver named, which "build me a notes app" is not,
  // so a tombstone used to surface at the activation CAS with the whole build already paid for.
  if (isCapabilityIdReservedByDeletion(spec.id, buildDatabases.readonly)) {
    throw new CapabilityIdReservedError(spec.id);
  }
  if (isAborted()) return;
  // The first point at which a name exists for the blank tile on the desk. Sent as `fragment` to
  // ride the tile's own guarded listener, and it addresses the label span: the tile is mid-crawl.
  await send("fragment", renderProvisionalLogoName(buildId, spec.label));

  // Preview the deterministic migration plan against scratch SQLite. The real data
  // store must remain untouched until Gate success and filesystem publication.
  const database = buildDatabases.readwrite;
  const previewDatabase = new Database(":memory:");
  try {
    const migration = applyCapabilityMigration({ database: previewDatabase, spec });
    await send(
      "migration-preview",
      JSON.stringify(buildMigrationPreview(previewDatabase, migration)),
    );
  } finally {
    previewDatabase.close();
  }
  throwIfAborted(isAborted);

  // Behavioral intent freezes before the first Handler byte (PLAN decision 23, ADR-0006): tests
  // authored after code only describe it, authored before they are the contract the Gate enforces.
  const frozenTests = resolveBehavioralTierEnabled()
    ? await freezeBehavioralTests({ provider, spec })
    : undefined;
  // Measured where it happened, so a build that freezes five suites and then fails the Gate
  // still reports the generation it paid for.
  if (frozenTests) recordBehavioralFreezeMetrics(acc, frozenTests);
  throwIfAborted(isAborted);

  await send("narration", " I'm shaping it into something you can use.");
  const unitResult = await generateUnitsWithPreview(send, isAborted, provider, spec);
  throwIfAborted(isAborted);
  recordUnitMetrics(acc, unitResult.units);
  const finalUnits = unitResult.units.map(finalUnitPreview);
  await send("units-preview", JSON.stringify(buildUnitsPreview(finalUnits, "complete")));

  await send("narration", " I'm checking the first version now.");
  let gateResult: CapabilityGateResult;
  const plannedDdl = deriveCapabilityTableDdl(spec);
  try {
    gateResult = await runCapabilityGate({
      spec,
      ddl: plannedDdl,
      handlers: unitResult.handlers,
      itemRenderer: unitResult.itemRenderer,
      provider,
      realDatabase: database,
      behavioralTier: behavioralTierInput(frozenTests, firstBuildImpact(spec)),
    });
  } catch (error) {
    if (error instanceof CapabilityGateError) recordGateFailureMetrics(acc, error);
    throw error;
  }
  throwIfAborted(isAborted);
  const commitUnits = applyGateFixes(unitResult.units, gateResult);
  refreshUnitMetrics(acc, commitUnits);
  recordGateMetrics(acc, gateResult);
  if (unitsChanged(unitResult.units, commitUnits)) {
    await send(
      "units-preview",
      JSON.stringify(buildUnitsPreview(commitUnits.map(finalUnitPreview), "complete")),
    );
  }
  await send(
    "gate-preview",
    JSON.stringify(
      buildGatePreview(
        gateResult.durationMs,
        gateResult.outcomes,
        gateResult.structural,
        gateResult.smoke,
        gateResult.behavioral,
        frozenTests?.report,
      ),
    ),
  );

  logBuildVerification(spec, durationMs, usage, commitUnits, gateResult);

  // Publish first, then one short transaction: DDL, registry CAS, lifecycle success. Its COMMIT is
  // the sole point of no return; until it the old registry stays live and the candidate inert.
  acc.publicationAttempted = true;
  const publication = publishCapabilitySnapshot({
    buildId,
    spec,
    incarnationId,
    version: FIRST_CAPABILITY_VERSION,
    units: commitUnits,
    gate: gateResult,
    artifactsRoot,
  });
  throwIfAborted(isAborted);
  acc.activationAttempted = true;
  return activatePublishedSnapshot({
    database,
    spec,
    publication,
    expected: targetExpectation,
    isAborted,
    applyMigration: (activationDatabase) => {
      const migration = applyCapabilityMigration({ database: activationDatabase, spec });
      acc.timings.migrationMs = migration.durationMs;
    },
    finalizeMetrics: () => onActivated(),
  });
}

/**
 * A first build authors every unit, so stating the whole inventory makes "the complete suite ran"
 * a consequence of the work rather than the Gate's fallback for a caller that said nothing.
 */
function firstBuildImpact(spec: CapabilitySpec): BehavioralExecutionImpact {
  return { regeneratedHandlers: [...spec.tools], regeneratedItemRenderer: true };
}

/**
 * Hands a run's frozen behavioral tests to the Gate. Shared with the evolution assembler, so a v1
 * build and an evolution report the same generated/carried split into the same metrics columns.
 */
export function behavioralTierInput(
  frozen: FrozenBehavioralTestsResult | undefined,
  impact?: BehavioralExecutionImpact,
): BehavioralTierInput {
  // The tier is decided and the suite authored before Handler generation, so by here a frozen
  // suite's existence is the whole answer.
  if (!frozen) return { enabled: false };
  return {
    enabled: true,
    // `impact` names the Handlers this build authors — the whole inventory for a v1 build, the
    // Diff work plan for an evolution — so the Gate can skip a copied suite nothing touched.
    ...(impact ? { impact } : {}),
    frozen: {
      frozenTests: frozen.frozenTests,
      generation: {
        outcome: "passed",
        durationMs: frozen.durationMs,
        usage: frozen.usage,
        testCount: frozen.testCount,
        generatedActions: frozen.report
          .filter((entry) => entry.status === "generated")
          .map((entry) => entry.action),
        carriedActions: frozen.report
          .filter((entry) => entry.status === "carried")
          .map((entry) => entry.action),
      },
    },
  };
}

/**
 * The developer's verification surface: the full validated spec and the duration + token
 * usage the metrics row records. Console only.
 */
function logBuildVerification(
  spec: CapabilitySpec,
  durationMs: number,
  usage: TokenUsage,
  commitUnits: readonly GeneratedUnit[],
  gateResult: CapabilityGateResult,
): void {
  console.log(`Aluna Builder: generated "${spec.id}" in ${Math.round(durationMs)}ms`, {
    usage,
    spec,
    units: commitUnits.map((unit) => ({
      kind: unit.kind,
      name: unit.name,
      attempts: unit.attempts.length,
      durationMs: Math.round(unit.durationMs),
      usage: unit.usage,
    })),
    gate: {
      durationMs: Math.round(gateResult.durationMs),
      rungs: gateResult.outcomes,
      smoke: gateResult.smoke,
      behavioral: gateResult.behavioral,
    },
  });
}

/**
 * Runs unit generation with the live preview observer: a `units-preview` snapshot as each unit
 * starts, streams, is fixed and lands. The evolution assembler drives the same stream.
 */
function generateUnitsWithPreview(
  send: Send,
  isAborted: () => boolean,
  provider: Provider,
  spec: CapabilitySpec,
): Promise<Awaited<ReturnType<typeof generateCapabilityUnits>>> {
  const { observer } = createUnitPreviewStream(send, isAborted);
  return generateCapabilityUnits({ provider, spec, observer });
}

/**
 * Folds Gate repairs into the committed units. Smoke, design lint and the behavioral rung each
 * replace units into `gate.handlers`, which holds the bytes that actually cleared every rung.
 */
export function applyGateFixes(
  units: readonly GeneratedUnit[],
  gate: CapabilityGateResult,
): readonly GeneratedUnit[] {
  return units.map((unit) => {
    const repairAttempts = gateRepairAttempts(unit, gate);
    const durationMs =
      unit.durationMs + repairAttempts.reduce((sum, attempt) => sum + attempt.durationMs, 0);
    const usage = sumTokenUsages([unit.usage, ...repairAttempts.map((attempt) => attempt.usage)]);
    if (unit.kind === "item-renderer") {
      return {
        ...unit,
        content: gate.designLint.fixed ? gate.designLint.itemRenderer : unit.content,
        attempts: [...unit.attempts, ...repairAttempts],
        durationMs,
        usage,
      };
    }
    const content = gate.handlers[unit.name];
    return {
      ...unit,
      content: content ?? unit.content,
      attempts: [...unit.attempts, ...repairAttempts],
      durationMs,
      usage,
    };
  });
}

function gateRepairAttempts(
  unit: GeneratedUnit,
  gate: CapabilityGateResult,
): UnitGenerationAttempt[] {
  const attempts =
    unit.kind === "item-renderer"
      ? gate.designLint.attempts.filter((attempt) => attempt.usage)
      : [
          ...gate.smoke.attempts.filter(
            (attempt) => (attempt.repairAction ?? attempt.action) === unit.name && attempt.usage,
          ),
          ...behavioralRepairAttempts(unit.name, gate),
        ];
  return attempts.map((attempt, index) => ({
    attempt: unit.attempts.length + index + 1,
    durationMs:
      "repairDurationMs" in attempt && typeof attempt.repairDurationMs === "number"
        ? attempt.repairDurationMs
        : attempt.durationMs,
    usage: attempt.usage ?? {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    },
    ...(attempt.error ? { error: attempt.error } : {}),
  }));
}

/**
 * The behavioral rung's repairs of one Handler, shaped like the smoke and design attempts. An
 * entry carries that Handler's own cost, not the round's, and the assertion that forced it.
 */
function behavioralRepairAttempts(
  name: HandlerUnitName,
  gate: CapabilityGateResult,
): readonly { durationMs: number; usage: TokenUsage; error?: string }[] {
  if (gate.behavioral.tier !== "on") return [];
  return gate.behavioral.repair.attempts.flatMap((attempt) => {
    const repair = attempt.repairs?.find((entry) => entry.action === name);
    if (!repair) return [];
    return [
      {
        durationMs: repair.durationMs,
        usage: repair.usage,
        ...(attempt.error ? { error: attempt.error } : {}),
      },
    ];
  });
}

/**
 * Whether folding the Gate's repairs changed the bytes or attempt record on screen. Both
 * pipelines re-send the units view then, so no "complete" unit shows source the candidate lacks.
 */
export function unitsChanged(
  before: readonly GeneratedUnit[],
  after: readonly GeneratedUnit[],
): boolean {
  return before.some(
    (unit, index) =>
      unit.content !== after[index]?.content ||
      unit.attempts.length !== after[index]?.attempts.length,
  );
}
