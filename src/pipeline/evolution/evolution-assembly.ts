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
//     Its provenance is refreshed.
//
// On top of those, 4.6/04 adds the third: **prior source is proven, not assumed.** A
// regenerated unit's old committed source is offered to its prompt only when deterministic
// admissibility checks prove it references nothing outside that unit's *candidate* contract
// (decision 21 ¶2). The proof runs before any model call, so the whole copy/regenerate/
// admit/withhold shape of an evolution is decided — and reportable — with zero spend, and a
// withheld unit regenerates from the contract alone exactly as a v1 build does.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type BehavioralExecutionImpact,
  type BehavioralExecutionPlan,
  type BehavioralTestActionReport,
  type CapabilityDiff,
  type CapabilityGateResult,
  checkPriorSourceAdmissibility,
  DERIVED_UNIT_FILES,
  type DerivedUnitFile,
  evolutionUnitProvenance,
  type FrozenBehavioralTestsResult,
  freezeBehavioralTests,
  GENERATED_UNITS,
  type GeneratedUnit,
  type GeneratedUnitName,
  generateCapabilityUnit,
  type HandlerUnitName,
  type PriorSourceDecision,
  readFrozenBehavioralTests,
  resolveBehavioralTierEnabled,
  runCapabilityGate,
  type UnitDescriptor,
  type UnitGenerationObserver,
  type UnitProvenanceManifest,
  type VerifiedDependencySnapshot,
  verifyCapabilitySnapshot,
} from "../../builder/index.ts";
import {
  type AdditiveCapabilityMigration,
  deriveAdditiveCapabilityMigration,
  deriveCapabilityTableDdl,
} from "../../capability-data/index.ts";
import type { Provider, TokenUsage } from "../../provider/index.ts";
import {
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
} from "../../registry/index.ts";
import {
  applyGateFixes,
  behavioralTierInput,
  throwIfAborted,
  unitsChanged,
} from "../build/build-run.ts";
import { type DemoBuildAccumulator, recordBehavioralFreezeMetrics } from "../metrics-recorder.ts";
import {
  type BehavioralTierTransition,
  behavioralTierTransition,
} from "./behavioral-tier-transition.ts";

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
  /** Verified immutable identities for the same dependency rows, used only by provenance. */
  readonly dependencySnapshots?: readonly VerifiedDependencySnapshot[];
  /** Override the global `OMNI_BEHAVIORAL_TIER` toggle; omitted, the Gate resolves it. */
  readonly behavioralTierEnabled?: boolean;
  /**
   * The run's measurement accumulator. The freeze stage's timing and tokens are recorded
   * into it here, where the freeze happens — not by the caller after this returns, because
   * an assembly that dies in unit generation or at the Gate has already paid for the suites
   * it authored, and not through `progress`, which exists for the developer panel and may be
   * absent (4.7/03). A caller that measures nothing simply omits it.
   */
  readonly measurement?: DemoBuildAccumulator;
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
  /**
   * Per regenerated unit, whether its prior committed source was admitted into the
   * regeneration prompt and — when it was not — why (4.6/04). Copied units are absent:
   * they never enter model context at all, so there is nothing to admit or withhold.
   */
  readonly priorSource: readonly PriorSourceDecision[];
}

export interface EvolutionAssemblyProgress {
  /** The derived plan, before any unit work — the first thing an observer can show. */
  readonly onPlanned?: (plan: EvolutionAssemblyPlan) => void | Promise<void>;
  /**
   * Behavioral intent is frozen (4.7/01) — per Action, generated or carried forward, and
   * from which closed inputs. Reported before any unit is written, because that is the
   * guarantee: the tests existed before the code they judge.
   */
  readonly onTestsFrozen?: (frozen: FrozenBehavioralTestsResult) => void | Promise<void>;
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
  /**
   * The prior-source admissibility decision recorded for each unit the work plan
   * regenerated, in canonical unit order — the audit trail for what entered model context.
   * Audit-only, exactly like unit provenance: it never feeds equality, the Diff, or a
   * unit's `active_context_digest`, which stays a digest of the *contract* prompt.
   */
  readonly priorSource: readonly PriorSourceDecision[];
  /**
   * Per Action, whether this evolution generated that Action's behavioral tests or carried
   * the prior frozen ones forward on byte-identical inputs (4.7/01). Empty when the tier is
   * off, in which case the candidate carries no test artifact at all.
   */
  readonly behavioralTests: readonly BehavioralTestActionReport[];
  /**
   * Per Action, whether that frozen suite executed against this candidate's bytes or was
   * skipped because no Handler it covers moved — and why (4.7/02). Undefined when the tier
   * is off. Generation is about intent; this is about impact, and they are separate answers.
   */
  readonly behavioralExecution?: BehavioralExecutionPlan;
  /**
   * Which row of decision 24's transition table this version landed on, read off the
   * committed snapshot's tier and the two answers above (4.7/03). Always present — the
   * tier-off rows are exactly the ones a reader most needs named, since a tier-off version
   * carries nothing else to say why its behavioral artifacts are absent.
   */
  readonly behavioralTierTransition: BehavioralTierTransition;
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
  // The proof runs before the plan is reported, and therefore before any model call: a
  // developer sees which units will be regenerated *with* their old source and which
  // without, at the same moment they see the copy/regenerate split.
  const priorSource = proveRegenerationPriorSource(input, verified.directory, regenerated);
  await input.progress?.onPlanned?.({
    regeneratedUnits: diff.workPlan.regeneratedUnits,
    copiedUnits: copiedUnitNames(regenerated),
    additiveMigration,
    priorSource: priorSource.decisions,
  });

  // Freeze behavioral intent before a single Handler byte is written or repaired (PLAN
  // decision 23). An Action whose total inputs are byte-identical to the committed
  // version's carries its frozen cases forward untouched; only an Action whose own inputs
  // changed is regenerated. A label rename or a field reorder therefore regenerates no
  // tests at all — not by policy, but because it moves no digest.
  const frozenTests = await freezeEvolutionTests(input, verified);
  await reportFrozenTests(input, frozenTests);
  throwIfAborted(input.isAborted ?? NEVER_ABORTED);

  const units = await assembleUnits(input, verified.directory, regenerated, priorSource.admitted);
  throwIfAborted(input.isAborted ?? NEVER_ABORTED);
  await input.progress?.onGateStart?.();
  const gate = await runCapabilityGate({
    spec: candidate,
    ddl: deriveCapabilityTableDdl(candidate),
    handlers: handlersFrom(units),
    itemRenderer: itemRendererFrom(units),
    provider: input.provider,
    scratchCatalog: dependencyScratchCatalog(candidate, input.dependencyCatalog ?? []),
    behavioralTier: behavioralTierInput(
      frozenTests,
      evolutionImpact(input, verified.spec, regenerated),
    ),
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
    dependencyCatalog: input.dependencyCatalog ?? [],
    dependencySnapshots: input.dependencySnapshots ?? [],
    committedProvenance: verified.manifest.unit_provenance,
    regeneratedFilenames: regeneratedFilenamesOf(written),
  });

  return {
    spec: candidate,
    units: finalUnits,
    regeneratedUnits: orderedUnitNames(written),
    copiedUnits: copiedUnitNames(written),
    additiveMigration,
    priorSource: withGateRepairDecisions(priorSource.decisions, regenerated, written),
    behavioralTests: frozenTests?.report ?? [],
    ...(gate.behavioral.tier === "on" ? { behavioralExecution: gate.behavioral.execution } : {}),
    // Decision 24's row, named from the pair this evolution actually spans: the committed
    // snapshot's own recorded tier and the verdict the Gate just reached.
    behavioralTierTransition: behavioralTierTransition({
      prior: verified.manifest.behavioral_tier,
      candidate: gate.behavioral.tier,
      ...(gate.behavioral.tier === "on" ? { execution: gate.behavioral.execution } : {}),
    }),
    gate,
    unitProvenance,
    handlers: handlersFrom(finalUnits),
    itemRenderer: itemRendererFrom(finalUnits),
  };
}

/**
 * State this evolution's executable impact for behavioral execution selection (4.7/02,
 * decision 23). The work plan already names exactly which units this build authors, so the
 * run/skip verdict is read off the same plan the copy/regenerate split came from — a copied
 * Handler is bytes the prior version's frozen suite already passed against.
 *
 * Two things widen it beyond the Handler list, and both are stated in words rather than by
 * silently growing the set:
 *
 *   - A change fact that names no Action at all (a free-text `behavior` edit, decision 22).
 *   - A change to the fields the item renderer may show. The renderer is not a Handler and
 *     covers no Action, but every fragment assertion is rendered through it and may only
 *     name row values, so shrinking `ui_intent.item.shows` can make a carried assertion
 *     unsatisfiable by construction — with no Handler moving and no test digest moving. That
 *     is precisely "a valid test's Handler coverage cannot be narrowed", and it runs the full
 *     frozen suite. A rename or a reordering leaves the shown fields alone and still skips.
 */
function evolutionImpact(
  input: AssembleEvolutionCandidateInput,
  committedSpec: CapabilitySpec,
  regenerated: ReadonlySet<GeneratedUnitName>,
): BehavioralExecutionImpact {
  const { diff } = input;
  return {
    regeneratedHandlers: diff.workPlan.regeneratedUnits.filter(
      (unit): unit is HandlerUnitName => unit !== "item",
    ),
    regeneratedItemRenderer: regenerated.has("item"),
    ...unnarrowableEvolutionReason(input, committedSpec),
  };
}

function unnarrowableEvolutionReason(
  input: AssembleEvolutionCandidateInput,
  committedSpec: CapabilitySpec,
): { unnarrowableReason?: string } {
  if (input.diff.workPlan.gate.behavioral.fullSuite) {
    return {
      unnarrowableReason:
        "a changed fact scoped to no single Action (PLAN decision 22's conservative fallback), so no copied suite can be proven unaffected",
    };
  }
  if (!sameOrderedStrings(committedSpec.ui_intent.item.shows, input.candidate.ui_intent.item.shows))
    return {
      unnarrowableReason:
        "the fields the item renderer may show changed, so a copied fragment assertion could no longer be satisfiable by any renderer",
    };
  return {};
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/**
 * Record and report the freeze the moment it lands. The measurement comes first and does not
 * depend on `progress`: an assembly that dies in unit generation or at the Gate has already
 * paid for the suites it authored, and the panel hook is optional (4.7/03).
 */
async function reportFrozenTests(
  input: AssembleEvolutionCandidateInput,
  frozen: FrozenBehavioralTestsResult | undefined,
): Promise<void> {
  if (!frozen) return;
  if (input.measurement) recordBehavioralFreezeMetrics(input.measurement, frozen);
  await input.progress?.onTestsFrozen?.(frozen);
}

/**
 * Author this candidate's frozen behavioral intent, or nothing when the tier is off. The
 * committed snapshot's own frozen tests are offered as the carry-forward source; they are
 * absent when the prior version was built tier-off, in which case every Action generates
 * from the current candidate inputs (decision 24's off→on row).
 *
 * The tier resolves here rather than inside the Gate because generation now happens before
 * the Gate exists — but it resolves through the same global `OMNI_BEHAVIORAL_TIER` toggle a
 * v1 build uses, since the tier is one experiment-wide knob, not a per-path default.
 */
function freezeEvolutionTests(
  input: AssembleEvolutionCandidateInput,
  verified: ReturnType<typeof verifyCapabilitySnapshot>,
): Promise<FrozenBehavioralTestsResult> | undefined {
  const enabled = input.behavioralTierEnabled ?? resolveBehavioralTierEnabled();
  if (!enabled) return undefined;
  const priorFrozenTests = readFrozenBehavioralTests(verified);
  return freezeBehavioralTests({
    provider: input.provider,
    spec: input.candidate,
    ...(priorFrozenTests ? { priorFrozenTests } : {}),
  });
}

function dependencyScratchCatalog(spec: CapabilitySpec, catalog: readonly CapabilityRow[]) {
  const declared = new Set(
    Object.values(spec.read_dependencies)
      .flat()
      .map((dependency) => `${dependency.capability_id}/${dependency.incarnation_id}`),
  );
  return catalog
    .filter((row) => declared.has(`${row.id}/${row.incarnation_id}`))
    .map((row) => ({
      spec: capabilitySpecFromRow(row),
      incarnationId: row.incarnation_id,
      rows: [],
    }));
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
  admittedPriorSource: ReadonlyMap<GeneratedUnitName, string>,
): Promise<GeneratedUnit[]> {
  const units: GeneratedUnit[] = [];
  const isAborted = input.isAborted ?? NEVER_ABORTED;
  for (const filename of DERIVED_UNIT_FILES) {
    throwIfAborted(isAborted);
    const name = unitNameForFile(filename);
    if (regenerated.has(name)) {
      units.push(await regenerateUnit(input, filename, admittedPriorSource.get(name)));
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
  priorSource: string | undefined,
): Promise<GeneratedUnit> {
  return generateCapabilityUnit({
    provider: input.provider,
    spec: input.candidate,
    unit: descriptorForFile(filename),
    ...(input.dependencyCatalog ? { dependencyCatalog: input.dependencyCatalog } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.observer ? { observer: input.observer } : {}),
    // Present only for a unit whose prior source was proven admissible. A withheld unit's
    // prompt therefore carries no old bytes at all — not an emptied section, no section.
    ...(priorSource !== undefined ? { priorSource } : {}),
  });
}

/** The per-unit proof: what a developer is shown, and what a prompt is allowed to carry. */
interface RegenerationPriorSource {
  readonly decisions: readonly PriorSourceDecision[];
  readonly admitted: ReadonlyMap<GeneratedUnitName, string>;
}

/**
 * Decide, for each unit the work plan regenerates, whether its committed source may be
 * offered back to the model — deterministically, against the *candidate* contract, with no
 * model call and no execution (decision 21 ¶2). A unit whose source fails the proof is
 * simply absent from `admitted`, and its recorded decision carries the reason.
 */
function proveRegenerationPriorSource(
  input: AssembleEvolutionCandidateInput,
  committedDirectory: string,
  regenerated: ReadonlySet<GeneratedUnitName>,
): RegenerationPriorSource {
  const decisions: PriorSourceDecision[] = [];
  const admitted = new Map<GeneratedUnitName, string>();

  for (const filename of DERIVED_UNIT_FILES) {
    const name = unitNameForFile(filename);
    if (!regenerated.has(name)) continue;
    const source = readPriorSource(committedDirectory, filename);
    if (source === undefined) {
      decisions.push({ unit: name, admitted: false, reason: "its committed source is unreadable" });
      continue;
    }
    const verdict = checkPriorSourceAdmissibility({
      spec: input.candidate,
      unit: descriptorForFile(filename),
      source,
      ...(input.dependencyCatalog ? { dependencyCatalog: input.dependencyCatalog } : {}),
    });
    if (!verdict.admitted) {
      decisions.push({ unit: name, admitted: false, reason: verdict.reason });
      continue;
    }
    admitted.set(name, source);
    decisions.push({ unit: name, admitted: true });
  }

  return { decisions: inCanonicalUnitOrder(decisions), admitted };
}

/**
 * Complete the record for a unit the *Gate* rewrote. A repair can land on a unit the work
 * plan copied, which makes it a written unit with no admissibility decision — and the
 * record has to cover every unit that entered model context. It always reads as withheld,
 * and truthfully: the repair rungs regenerate from the contract plus the failure through
 * `generateUnitContent`, which has no prior-source parameter at all.
 */
function withGateRepairDecisions(
  decisions: readonly PriorSourceDecision[],
  planned: ReadonlySet<GeneratedUnitName>,
  written: ReadonlySet<GeneratedUnitName>,
): readonly PriorSourceDecision[] {
  const repaired = [...written].filter((unit) => !planned.has(unit));
  if (repaired.length === 0) return decisions;
  return inCanonicalUnitOrder([
    ...decisions,
    ...repaired.map((unit) => ({
      unit,
      admitted: false,
      reason: "it was rewritten by a Gate repair, which regenerates from the contract alone",
    })),
  ]);
}

/** Canonical unit order, matching both halves of the plan line the panel shows. */
function inCanonicalUnitOrder(
  decisions: readonly PriorSourceDecision[],
): readonly PriorSourceDecision[] {
  return [...decisions].sort(
    (a, b) => GENERATED_UNITS.indexOf(a.unit) - GENERATED_UNITS.indexOf(b.unit),
  );
}

/**
 * Read one committed unit off the verified snapshot. The snapshot was verified before this
 * point, so a failure here is not expected — but prior source is optional context, and
 * losing it is a withheld admission, never a failed evolution.
 */
function readPriorSource(directory: string, filename: DerivedUnitFile): string | undefined {
  try {
    return readFileSync(join(directory, filename), "utf8");
  } catch {
    return undefined;
  }
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
