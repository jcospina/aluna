// Running the builder stages for one capability, end to end, against the live
// provider and the real db/disk.
//
// This is the shared engine both the production `/prompt` pipeline and the
// `/demo/spec-build` route drive: from a resolved `new_capability` intent it
// generates the spec, derives + applies the migration, generates the units, runs the
// fail-closed gate, publishes a verified snapshot, and commits — streaming developer previews and product-voice
// narration along the way, and filling the metrics accumulator as each stage lands.

import type { ZodType } from "zod";

import {
  CapabilityGateError,
  type CapabilityGateResult,
  type CommitCapabilityResult,
  commitCapability,
  FIRST_CAPABILITY_VERSION,
  type GeneratedUnit,
  generateCapabilityUnits,
  generateSpec,
  publishCapabilitySnapshot,
  runCapabilityGate,
  type UnitDescriptor,
  type UnitGenerationAttempt,
  type UnitGenerationObserver,
  withCapabilityMigrationTransaction,
} from "../builder/index.ts";
import type { PlatformDatabase } from "../db.ts";
import type { IntentClassification } from "../intent-resolver/index.ts";
import type { GenerateResult, Provider, TokenUsage } from "../provider/index.ts";
import type { CapabilitySpec } from "../registry/index.ts";
import type { Send } from "../sse/index.ts";
import {
  type DemoBuildAccumulator,
  recordGateMetrics,
  recordUnitMetrics,
  refreshUnitMetrics,
} from "./metrics-recorder.ts";
import {
  buildGatePreview,
  buildMigrationPreview,
  buildUnitsPreview,
  type DemoUnitPreview,
  type DemoUnitsPreview,
  finalUnitPreview,
  unitPreviewFilename,
  unitPreviewKey,
} from "./previews.ts";

/**
 * An aborted stream mid-build, thrown from inside the build's open transaction so it
 * rolls back (a half-built capability must never commit). Distinct from a build
 * failure: the caller rolls product work back and finalizes the admitted lifecycle as
 * cancelled, without attempting an apology because the client is already gone.
 */
export class AbortedBuildError extends Error {
  override readonly name = "AbortedBuildError";
}

/** Throw {@link AbortedBuildError} if the stream has been aborted. */
export function throwIfAborted(isAborted: () => boolean): void {
  if (isAborted()) throw new AbortedBuildError();
}

/**
 * Demo-only provider decorator: as the spec streams in, it forwards each partial
 * snapshot to the shell as a `spec-preview` event so the developer watches the spec
 * assemble live. This deliberately surfaces internals — that is the whole point of a
 * liveness check. `generateSpec` only awaits `object` (self-driven by the spine), so
 * consuming `partialStream` here for previews doesn't starve the stage. The returned
 * `settled` promise lets the route flush every preview before the warm confirmation,
 * keeping the wire order narration → preview* → confirmation.
 */
export function previewingProvider(
  real: Provider,
  send: Send,
): { provider: Provider; settled: Promise<void> } {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const provider: Provider = {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      const result = real.generate(prompt, schema);
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

  return { provider, settled };
}

/**
 * Run the builder stages, streaming the developer previews and filling `acc` with the
 * metrics measurements. Returns the commit result on success, or `undefined` when the
 * stream was aborted mid-build (the transaction having rolled back). Throws on a build
 * failure; the caller records the failure metrics row and surfaces the warm apology.
 *
 * The terminal stages — migration, unit generation, the fail-closed Gate, publication,
 * and commit
 * — run inside ONE write transaction on the real connection (ARCH §6.2, db.ts
 * `withWriteTransaction`). The migration creates the `cap_<id>` table; publication
 * atomically lands only a verified final directory, then commit inserts the registry
 * row. The transaction's COMMIT makes the database state live. Any throw — a failed
 * Gate rung, a publication/commit error, an abort — rolls the
 * whole thing back, so a failed build leaves no `cap_<id>` table and no registry row,
 * with any post-publication files left as a complete never-activated candidate for
 * later reconciliation. Publication is sequenced strictly after the Gate.
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
): Promise<CommitCapabilityResult | undefined> {
  // Wrap the provider so the spec streams to the shell as it builds (demo preview),
  // while the stage itself runs unchanged.
  const { provider: observed, settled } = previewingProvider(provider, send);
  // `generateSpec` narrates the intent's `user_facing_label` over `send` and returns
  // the validated spec plus the build's measurements. Spec generation runs before the
  // transaction opens — a spec failure has nothing to roll back.
  const { spec, durationMs, usage } = await generateSpec({
    provider: observed,
    prompt,
    intent,
    send,
  });
  acc.capabilityId = spec.id;
  acc.incarnationId = incarnationId;
  // Admission assigns the incarnation before Builder provider work. Once the
  // validated authored spec supplies the semantic id, enrich the same durable row.
  onCapabilityIdentified(spec.id);
  acc.timings.specGenMs = durationMs;
  acc.usages.push(usage);
  await settled; // every spec-preview is on the wire before the confirmation
  if (isAborted()) return;

  // Migration → unit-gen → Gate → publication → commit, all inside the one rollbackable write
  // transaction on the real connection. `afterApply` runs after the migration is
  // applied; its return value (the commit result) is what becomes live when the
  // transaction commits.
  const database = buildDatabases.readwrite;
  const { value: commit } = await withCapabilityMigrationTransaction(
    { database, spec },
    async (migration) => {
      acc.timings.migrationMs = migration.durationMs;
      throwIfAborted(isAborted);
      await send("migration-preview", JSON.stringify(buildMigrationPreview(database, migration)));

      await send("narration", " I'm shaping it into something you can use.");
      const unitResult = await generateUnitsWithPreview(send, isAborted, provider, spec);
      throwIfAborted(isAborted);
      recordUnitMetrics(acc, unitResult.units);
      const finalUnits = unitResult.units.map(finalUnitPreview);
      await send("units-preview", JSON.stringify(buildUnitsPreview(finalUnits, "complete")));

      await send("narration", " I'm checking the first version now.");
      let gateResult: CapabilityGateResult;
      try {
        gateResult = await runCapabilityGate({
          spec,
          ddl: migration.ddl,
          handlers: unitResult.handlers,
          itemRenderer: unitResult.itemRenderer,
          provider,
          realDatabase: database,
        });
      } catch (error) {
        if (error instanceof CapabilityGateError) acc.gateRungs = error.outcomes;
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
          ),
        ),
      );

      // The developer's verification surface: the full validated spec and the
      // duration + token usage the metrics row records (Epic 2.7). Console only.
      console.log(`Aluna spec-build demo: generated "${spec.id}" in ${Math.round(durationMs)}ms`, {
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

      // Commit: write the version-1 artifacts and insert the registry row pointing at
      // them, inside this transaction (the pointer flip). Unreachable unless the gate
      // above passed every active rung. When the design-lint rung regenerated the item
      // renderer to clear a violation, `item.ts` must carry that fixed content.
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
      acc.activationAttempted = true;
      const committed = commitCapability({ spec, publication, database });
      // This update uses the already-open transaction: pointer activation and
      // success/activated metrics are one SQLite commit point.
      onActivated();
      return committed;
    },
  );

  return commit;
}

/**
 * Run unit generation with the demo's live preview observer. The observer streams a
 * `units-preview` snapshot as each unit starts, streams partials, fixes, and lands —
 * the developer watches the item renderer and handlers assemble.
 */
async function generateUnitsWithPreview(
  send: Send,
  isAborted: () => boolean,
  provider: Provider,
  spec: CapabilitySpec,
): Promise<Awaited<ReturnType<typeof generateCapabilityUnits>>> {
  const liveUnits = new Map<string, DemoUnitPreview>();
  let lastPreviewAt = 0;
  const sendUnitsPreview = async (status: DemoUnitsPreview["status"], force = false) => {
    if (isAborted()) return;
    const now = performance.now();
    if (!force && now - lastPreviewAt < 500) return;
    lastPreviewAt = now;
    await send("units-preview", JSON.stringify(buildUnitsPreview([...liveUnits.values()], status)));
  };
  const updateLiveUnit = (
    unit: UnitDescriptor,
    patch: Partial<Omit<DemoUnitPreview, "kind" | "name" | "filename">>,
  ) => {
    const key = unitPreviewKey(unit);
    const current = liveUnits.get(key);
    liveUnits.set(key, {
      kind: unit.kind,
      name: unit.name,
      filename: unitPreviewFilename(unit),
      status: current?.status ?? "generating",
      attempts: current?.attempts ?? 0,
      content: current?.content ?? "",
      ...patch,
    });
  };
  const recordAttempt = (unit: UnitDescriptor, attempt: UnitGenerationAttempt) => {
    updateLiveUnit(unit, {
      status: attempt.error ? "fixing" : "generating",
      attempts: attempt.attempt,
      durationMs: attempt.durationMs,
      usage: attempt.usage,
      ...(attempt.error ? { error: attempt.error } : {}),
    });
  };
  const observer: UnitGenerationObserver = {
    async onUnitStart({ unit, attempt }) {
      updateLiveUnit(unit, { status: "generating", attempts: attempt });
      await sendUnitsPreview("running", true);
    },
    async onUnitPartial({ unit, attempt, content }) {
      updateLiveUnit(unit, { status: "generating", attempts: attempt, content });
      await sendUnitsPreview("running");
    },
    async onUnitAttempt({ unit, attempt }) {
      recordAttempt(unit, attempt);
      await sendUnitsPreview("running", true);
    },
    async onUnitGenerated(unit) {
      liveUnits.set(unitPreviewKey(unit), finalUnitPreview(unit));
      await sendUnitsPreview("running", true);
    },
  };
  return generateCapabilityUnits({ provider, spec, observer });
}

/**
 * Fold Gate repairs back into the units the pipeline commits. Smoke may replace exactly
 * one failing Handler per bounded turn, and design lint may replace item.ts. Behavioral
 * execution has already consumed these repaired Handler bytes inside runCapabilityGate.
 */
function applyGateFixes(
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
      : gate.smoke.attempts.filter(
          (attempt) => (attempt.repairAction ?? attempt.action) === unit.name && attempt.usage,
        );
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

function unitsChanged(before: readonly GeneratedUnit[], after: readonly GeneratedUnit[]): boolean {
  return before.some(
    (unit, index) =>
      unit.content !== after[index]?.content ||
      unit.attempts.length !== after[index]?.attempts.length,
  );
}
