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
import { deriveCapabilityTableDdl } from "../../capability-data/index.ts";
import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { PlatformDatabase } from "../../persistence/db.ts";
import type { GenerateResult, Provider, TokenUsage } from "../../provider/index.ts";
import {
  type CapabilityRegistryExpectation,
  type CapabilitySpec,
  listCapabilities,
} from "../../registry/index.ts";
import type { Send } from "../../sse/index.ts";
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
} from "./overlap-identity.ts";

/**
 * An aborted stream mid-build, thrown before activation. Distinct from a build
 * failure: the caller finalizes the admitted lifecycle as cancelled without an
 * apology because the client is already gone. If publication already landed, the
 * complete candidate remains for guarded reconciliation.
 */
export class AbortedBuildError extends Error {
  override readonly name = "AbortedBuildError";
}

/** Throw {@link AbortedBuildError} if the stream has been aborted. */
export function throwIfAborted(isAborted: () => boolean): void {
  if (isAborted()) throw new AbortedBuildError();
}

/**
 * Developer-preview provider decorator: as the spec streams in, it forwards each
 * partial snapshot to the shell as a `spec-preview` event so the developer watches the
 * spec assemble live. This deliberately surfaces internals — that is the whole point of
 * a liveness view. `generateSpec` only awaits `object` (self-driven by the spine), so
 * consuming `partialStream` here for previews doesn't starve the stage. The returned
 * `flushPreviews()` lets the route drain every preview before the warm confirmation,
 * keeping the wire order narration → preview* → confirmation.
 *
 * It is a function rather than a promise because a stage can throw *before* it ever calls
 * the provider (a rejected candidate, a failed prompt build). A promise settled only by
 * the streaming loop would never resolve on that path, and a caller draining it in a
 * `finally` would hang forever — holding the exclusive build lease and the SSE connection
 * with it. With nothing started there is nothing to drain, so this resolves immediately.
 */
export function previewingProvider(
  real: Provider,
  send: Send,
): { provider: Provider; flushPreviews: () => Promise<void> } {
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
 * Run the builder stages, streaming the developer previews and filling `acc` with the
 * metrics measurements. Returns the commit result on success, or `undefined` when the
 * stream was aborted mid-build (the transaction having rolled back). Throws on a build
 * failure; the caller records the failure metrics row and surfaces the warm apology.
 *
 * Unit generation and the fail-closed Gate finish before publication. Only after the
 * complete snapshot is atomically published does one short SQLite transaction apply
 * DDL, CAS the registry, and finalize success metrics. Its COMMIT is the sole point of
 * no return; any earlier throw leaves the prior registry state live plus, at most, a
 * complete never-activated candidate for reconciliation.
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
  // `generateSpec` narrates the intent's `user_facing_label` over `send` and returns
  // the validated spec plus the build's measurements. Spec generation runs before the
  // transaction opens — a spec failure has nothing to roll back.
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
  if (isAborted()) return;

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

  // Behavioral intent is frozen here, before the first Handler byte exists (PLAN decision
  // 23, ADR-0006). Tests authored after code could only describe it; authored before, they
  // are the contract the Gate holds the code to.
  const frozenTests = resolveBehavioralTierEnabled()
    ? await freezeBehavioralTests({ provider, spec })
    : undefined;
  // Measured where it happened, so a build that freezes five suites and then fails the Gate
  // still reports the generation it paid for (4.7/03).
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

  // Publish first. Activation then keeps only DDL + registry CAS + lifecycle success
  // inside SQLite's short transaction.
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
 * A first build authors every unit, so no suite is copied and none can be skipped. Stating
 * that plainly — rather than leaving impact unstated — keeps "the complete suite ran" a
 * reported consequence of the work, not the Gate's fallback for a caller that said nothing.
 */
function firstBuildImpact(spec: CapabilitySpec): BehavioralExecutionImpact {
  return { regeneratedHandlers: [...spec.tools], regeneratedItemRenderer: true };
}

/**
 * Hand a run's frozen behavioral tests to the Gate. The tier is decided — and the suite
 * authored — before Handler generation (PLAN decision 23), so by here the answer is simply
 * whether a frozen suite exists. Shared with the evolution assembler so both pipelines
 * report the same generated/carried split into the same metrics columns.
 *
 * `impact` states which Handlers this build authors, which is what lets the Gate skip a
 * copied suite nothing touched (4.7/02). A v1 build states the whole inventory; an
 * evolution states its Diff work plan. Omitted, the Gate runs the complete frozen suite.
 */
export function behavioralTierInput(
  frozen: FrozenBehavioralTestsResult | undefined,
  impact?: BehavioralExecutionImpact,
): BehavioralTierInput {
  if (!frozen) return { enabled: false };
  return {
    enabled: true,
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
 * Run unit generation with the live preview observer. The observer streams a
 * `units-preview` snapshot as each unit starts, streams partials, fixes, and lands —
 * the developer watches the item renderer and handlers assemble. The evolution
 * assembler (4.6/03) drives the same stream for the units it regenerates.
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
 * Fold Gate repairs back into the units the pipeline commits. Smoke may replace exactly
 * one failing Handler per bounded turn, design lint may replace item.ts, and the
 * behavioral rung may replace the Handler(s) a failing frozen assertion is attributed to
 * (4.7/04) — all of which land in `gate.handlers`, the bytes that actually cleared every
 * rung. Shared with the evolution assembler so a v1 build and an evolution reconcile Gate
 * repairs identically.
 */
export function applyGateFixes(
  units: readonly GeneratedUnit[],
  gate: CapabilityGateResult,
): readonly GeneratedUnit[] {
  return units.map((unit) => {
    const repairAttempts = gateRepairAttempts(unit, gate);
    const durationMs =
      unit.durationMs + repairAttempts.reduce((sum, attempt) => sum + attempt.durationMs, 0);
    const usage = addTokenUsage(
      unit.usage,
      repairAttempts.map((attempt) => attempt.usage),
    );
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
 * The behavioral rung's own repairs of one Handler (4.7/04), shaped like the smoke/design
 * attempts this function already folds. Each turn contributes at most one entry per
 * Handler, carrying that Handler's own cost rather than the whole conservative round's, and
 * the failing frozen assertion as the attempt's error so the unit's history reads as
 * "rewritten because this test said so".
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

function addTokenUsage(base: TokenUsage, additions: readonly TokenUsage[]): TokenUsage {
  return {
    inputTokens: sumOptional([base.inputTokens, ...additions.map((usage) => usage.inputTokens)]),
    outputTokens: sumOptional([base.outputTokens, ...additions.map((usage) => usage.outputTokens)]),
    totalTokens: sumOptional([base.totalTokens, ...additions.map((usage) => usage.totalTokens)]),
  };
}

function sumOptional(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

/**
 * Whether folding the Gate's repairs changed the bytes (or attempt record) a developer is
 * looking at. Both pipelines re-send their units view when it does, so the panel never
 * shows a "complete" unit whose source is not the one the candidate actually carries.
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
