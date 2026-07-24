// Evolution candidate assembly — Module 4.6/03 (ARCH §6.2 "Capability Builder"
// steps 3–5; PLAN decisions 2, 21, 24 + the change-fact matrix; ADR-0006).
//
// This is the stage that turns the Diff Engine's work plan (4.6/02) into executed
// work: it derives the additive DDL, projects each unit's generation context, and
// assembles the complete candidate inventory — regenerating only the units the matrix
// positively selected and byte-copying the rest — then runs the fail-closed Gate over
// the *assembled* snapshot. It stops at a Gate-cleared candidate; publication, atomic
// activation, and the View swap are the closing engine issue (4.6/05), not this one.
//
// Two guarantees carry the matrix's promises into bytes:
//
//   - **Copy is proof, not model context.** A unit the work plan did not select is read
//     verbatim from the committed snapshot on disk and never enters a generation prompt,
//     so it was never exposed to the changed facts it is claimed not to depend on
//     (decision 21). Its dependency-generation provenance carries forward unchanged.
//   - **Regeneration sees only the active projection.** A selected unit is regenerated
//     against the candidate spec through the same per-unit prompt a v1 build uses, which
//     projects only active fields and each dependency's active schema (decisions 2, 21).
//     Its provenance is refreshed. Prior committed source is deliberately not fed in here
//     — admissibility-gated prior source is the next issue (4.6/04).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type CapabilityDiff,
  type CapabilityGateResult,
  DERIVED_UNIT_FILES,
  type DerivedUnitFile,
  evolutionUnitProvenance,
  GENERATED_UNITS,
  type GeneratedUnit,
  type GeneratedUnitName,
  generateCapabilityUnit,
  type HandlerUnitName,
  runCapabilityGate,
  type UnitDescriptor,
  type UnitGenerationObserver,
  type UnitProvenanceManifest,
  verifyCapabilitySnapshot,
} from "../builder/index.ts";
import {
  type AdditiveCapabilityMigration,
  deriveAdditiveCapabilityMigration,
  deriveCapabilityTableDdl,
} from "../capability-data/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import type { CapabilityRow, CapabilitySpec } from "../registry/index.ts";
import { applyGateFixes, throwIfAborted, unitsChanged } from "./build-run.ts";

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const NEVER_ABORTED = () => false;

export interface AssembleEvolutionCandidateInput {
  /** The live committed capability under evolution — the on-disk snapshot copies read from. */
  readonly committed: CapabilityRow;
  /** The validated candidate spec (4.6/01) the Diff compared. */
  readonly candidate: CapabilitySpec;
  /** The Diff Engine result whose work plan selects regeneration vs copy (4.6/02). */
  readonly diff: CapabilityDiff;
  readonly provider: Provider;
  /** Active dependency rows a regenerated Handler's projected context may reference. */
  readonly dependencyCatalog?: readonly CapabilityRow[];
  /** Tier-on evolution (frozen behavioral tests) is 4.6/05; this defaults to tier off. */
  readonly behavioralTierEnabled?: boolean;
  /**
   * True once the trace is cancelled or its subscriber is gone. Checked between units and
   * before the Gate so a cancel stops the work rather than only unwinding whatever model
   * call happens to be in flight — an evolution that regenerates nothing (a label or
   * ordering change) would otherwise run the whole Gate under a lease nobody is waiting on.
   */
  readonly isAborted?: () => boolean;
  readonly maxAttempts?: number;
  /** Per-unit generation liveness for the units the work plan regenerates. */
  readonly observer?: UnitGenerationObserver;
  /** Assembly-stage liveness: the derived plan, each byte-copy, and the Gate handover. */
  readonly progress?: EvolutionAssemblyProgress;
}

/**
 * The executed work, decided before a single model call runs: the additive DDL derives
 * deterministically from the two specs and the copy/regenerate split comes straight from
 * the Diff work plan. Reporting it up front is what lets a developer see the whole shape
 * of an evolution immediately, while the regenerated units are still being written.
 */
export interface EvolutionAssemblyPlan {
  readonly regeneratedUnits: readonly GeneratedUnitName[];
  readonly copiedUnits: readonly GeneratedUnitName[];
  readonly additiveMigration: AdditiveCapabilityMigration;
}

export interface EvolutionAssemblyProgress {
  /** The derived plan, before any unit work — the first thing an observer can show. */
  readonly onPlanned?: (plan: EvolutionAssemblyPlan) => void | Promise<void>;
  /**
   * A unit read verbatim off the committed snapshot. It is reported so the inventory a
   * developer watches is complete; the bytes still never enter a generation prompt.
   */
  readonly onUnitCopied?: (unit: GeneratedUnit) => void | Promise<void>;
  /** The complete inventory is assembled and the Gate is about to run over it. */
  readonly onGateStart?: () => void | Promise<void>;
  /** A Gate repair changed the assembled bytes — the reconciled inventory, post-fold. */
  readonly onUnitsFinalized?: (units: readonly GeneratedUnit[]) => void | Promise<void>;
}

export interface AssembledEvolutionCandidate {
  /** The candidate spec — the assembled snapshot's source of truth. */
  readonly spec: CapabilitySpec;
  /** The complete six-unit inventory in canonical order: copied + regenerated. */
  readonly units: readonly GeneratedUnit[];
  /**
   * The units this evolution wrote, and the units that are byte-identical to the committed
   * snapshot. Settled against the final bytes rather than the work plan, so a unit the Gate
   * repaired is reported as written even if the plan had copied it — "copied" is a claim
   * about bytes, and it stays true.
   */
  readonly regeneratedUnits: readonly GeneratedUnitName[];
  readonly copiedUnits: readonly GeneratedUnitName[];
  /** The nullable ADD COLUMN(s) this evolution derives (empty for a no-DDL change). */
  readonly additiveMigration: AdditiveCapabilityMigration;
  /** The fail-closed Gate result over the assembled snapshot (structural + smoke, …). */
  readonly gate: CapabilityGateResult;
  /** Per-unit provenance: refreshed for regenerated units, carried forward for copies. */
  readonly unitProvenance: UnitProvenanceManifest;
  readonly handlers: Readonly<Partial<Record<HandlerUnitName, string>>>;
  readonly itemRenderer: string;
}

/**
 * Assemble one evolution candidate from the Diff work plan and Gate it. Reads the
 * committed snapshot from disk to copy unaffected units, regenerates the selected units
 * against the candidate's active projection, derives the additive migration, computes
 * carry-forward/fresh provenance, and runs the Gate over the assembled snapshot.
 * Performs no publication, DDL application, activation, or View swap.
 */
export async function assembleEvolutionCandidate(
  input: AssembleEvolutionCandidateInput,
): Promise<AssembledEvolutionCandidate> {
  const { committed, candidate, diff } = input;
  const verified = verifyEvolutionBase(committed);
  const additiveMigration = deriveAdditiveCapabilityMigration(verified.spec, candidate);
  const regenerated = new Set<GeneratedUnitName>(diff.workPlan.regeneratedUnits);
  await input.progress?.onPlanned?.({
    regeneratedUnits: diff.workPlan.regeneratedUnits,
    copiedUnits: copiedUnitNames(regenerated),
    additiveMigration,
  });

  const units = await assembleUnits(input, verified.directory, regenerated);
  throwIfAborted(input.isAborted ?? NEVER_ABORTED);
  await input.progress?.onGateStart?.();
  const gate = await runCapabilityGate({
    spec: candidate,
    ddl: deriveCapabilityTableDdl(candidate),
    handlers: handlersFrom(units),
    itemRenderer: itemRendererFrom(units),
    provider: input.provider,
    behavioralTier: { enabled: input.behavioralTierEnabled ?? false },
  });

  // Fold any bounded Gate repair back into the assembled bytes, exactly as a v1 build
  // does. A correctly-copied unit is behavior-neutral against the candidate schema, so
  // the Gate does not repair it and its bytes stay byte-identical to the committed snapshot.
  const finalUnits = applyGateFixes(units, gate);
  // A repair rewrote bytes an observer is already showing as final. Report the reconciled
  // inventory so what a developer reads is the source the candidate actually carries —
  // the same refresh a v1 build sends after its own Gate (`runSpecBuildStages`).
  if (unitsChanged(units, finalUnits)) await input.progress?.onUnitsFinalized?.(finalUnits);
  // The Gate's own bounded repairs — a smoke Handler fix, a design-lint item rewrite — are
  // model work over the assembled snapshot, and they can in principle land on a unit the
  // work plan copied. "Copied" is a byte claim, so it is settled against the final bytes,
  // not the plan: a repaired unit is reported as regenerated and gets fresh provenance.
  const written = writtenUnitNames(regenerated, units, finalUnits);
  const unitProvenance = evolutionUnitProvenance({
    candidateSpec: candidate,
    committedProvenance: verified.manifest.unit_provenance,
    regeneratedFilenames: regeneratedFilenamesOf(written),
  });

  return {
    spec: candidate,
    units: finalUnits,
    regeneratedUnits: orderedUnitNames(written),
    copiedUnits: copiedUnitNames(written),
    additiveMigration,
    gate,
    unitProvenance,
    handlers: handlersFrom(finalUnits),
    itemRenderer: itemRendererFrom(finalUnits),
  };
}

/**
 * The units this evolution actually wrote: the ones the work plan regenerated, plus any the
 * Gate repaired on top. Everything else is byte-identical to the committed snapshot and is
 * the honest `copiedUnits` set.
 */
function writtenUnitNames(
  regenerated: ReadonlySet<GeneratedUnitName>,
  assembled: readonly GeneratedUnit[],
  final: readonly GeneratedUnit[],
): ReadonlySet<GeneratedUnitName> {
  const written = new Set(regenerated);
  final.forEach((unit, index) => {
    if (unit.content !== assembled[index]?.content) written.add(unit.name);
  });
  return written;
}

/** Verify the committed on-disk snapshot before trusting it as an evolution base. */
function verifyEvolutionBase(
  committed: CapabilityRow,
): ReturnType<typeof verifyCapabilitySnapshot> {
  const verified = verifyCapabilitySnapshot(committed.artifacts_path);
  if (
    verified.manifest.capability_id !== committed.id ||
    verified.manifest.incarnation_id !== committed.incarnation_id ||
    verified.manifest.version !== committed.version
  ) {
    throw new Error("The committed capability pointer no longer matches its verified snapshot.");
  }
  return verified;
}

/**
 * Assemble the complete inventory in canonical snapshot order (item first): a selected
 * unit is regenerated against the candidate's active projection; an unaffected unit is
 * copied verbatim from the committed snapshot and never enters a generation prompt.
 */
async function assembleUnits(
  input: AssembleEvolutionCandidateInput,
  committedDirectory: string,
  regenerated: ReadonlySet<GeneratedUnitName>,
): Promise<GeneratedUnit[]> {
  const units: GeneratedUnit[] = [];
  const isAborted = input.isAborted ?? NEVER_ABORTED;
  for (const filename of DERIVED_UNIT_FILES) {
    throwIfAborted(isAborted);
    if (regenerated.has(unitNameForFile(filename))) {
      units.push(await regenerateUnit(input, filename));
      continue;
    }
    const copied = copiedUnit(committedDirectory, filename);
    units.push(copied);
    await input.progress?.onUnitCopied?.(copied);
  }
  return units;
}

function regenerateUnit(
  input: AssembleEvolutionCandidateInput,
  filename: DerivedUnitFile,
): Promise<GeneratedUnit> {
  return generateCapabilityUnit({
    provider: input.provider,
    spec: input.candidate,
    unit: descriptorForFile(filename),
    ...(input.dependencyCatalog ? { dependencyCatalog: input.dependencyCatalog } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.observer ? { observer: input.observer } : {}),
  });
}

function regeneratedFilenamesOf(
  regenerated: ReadonlySet<GeneratedUnitName>,
): ReadonlySet<DerivedUnitFile> {
  return new Set(
    DERIVED_UNIT_FILES.filter((filename) => regenerated.has(unitNameForFile(filename))),
  );
}

function copiedUnit(directory: string, filename: DerivedUnitFile): GeneratedUnit {
  const content = readFileSync(join(directory, filename), "utf8");
  // One zero-cost attempt records that the bytes exist without any model spend — the
  // unit was copied, not generated.
  const base = {
    content,
    attempts: [{ attempt: 1, durationMs: 0, usage: ZERO_USAGE }],
    durationMs: 0,
    usage: ZERO_USAGE,
  } as const;
  if (filename === "item.ts") {
    return { kind: "item-renderer", name: "item", filename, ...base };
  }
  return { kind: "handler", name: unitNameForFile(filename) as HandlerUnitName, filename, ...base };
}

function handlersFrom(units: readonly GeneratedUnit[]): Partial<Record<HandlerUnitName, string>> {
  return Object.fromEntries(
    units
      .filter(
        (unit): unit is Extract<GeneratedUnit, { kind: "handler" }> => unit.kind === "handler",
      )
      .map((unit) => [unit.name, unit.content]),
  );
}

function itemRendererFrom(units: readonly GeneratedUnit[]): string {
  const item = units.find((unit) => unit.kind === "item-renderer");
  if (!item) throw new Error("Assembled evolution candidate is missing item.ts.");
  return item.content;
}

function copiedUnitNames(
  regenerated: ReadonlySet<GeneratedUnitName>,
): readonly GeneratedUnitName[] {
  return GENERATED_UNITS.filter((name) => !regenerated.has(name));
}

/**
 * The given units in the Diff's canonical unit order — deliberately `GENERATED_UNITS` and
 * not the snapshot's file order, which puts `item` first. Both halves of one preview (the
 * plan the Diff work plan supplies, and the reconciled result computed here) must list the
 * same units the same way, or an evolution touching `item` alongside another unit reads as
 * if the plan changed under the developer.
 */
function orderedUnitNames(names: ReadonlySet<GeneratedUnitName>): readonly GeneratedUnitName[] {
  return GENERATED_UNITS.filter((name) => names.has(name));
}

function descriptorForFile(filename: DerivedUnitFile): UnitDescriptor {
  return filename === "item.ts"
    ? { kind: "item-renderer", name: "item" }
    : { kind: "handler", name: unitNameForFile(filename) as HandlerUnitName };
}

function unitNameForFile(filename: DerivedUnitFile): GeneratedUnitName {
  return filename === "item.ts" ? "item" : (filename.slice(0, -3) as GeneratedUnitName);
}
