// Evolution candidate assembly: the stage turning the Diff Engine's work plan into executed work.
// It derives the additive DDL, projects each unit's generation context, assembles the candidate
// inventory — regenerating only what the matrix selected, byte-copying the rest — then runs the
// fail-closed Gate. It stops at a Gate-cleared candidate; publication and activation come later.
//
// Three guarantees carry the matrix's promises into bytes. Copy is proof rather than model
// context: an unselected unit is read verbatim from the committed snapshot and never enters a
// prompt, so it was never exposed to the changed facts it is claimed not to depend on.
// Regeneration sees only the active projection, through a v1 build's per-unit prompt. And prior
// source is proven: a regenerated unit's old source reaches its prompt only when deterministic
// checks pass, before any model call, so the whole shape is decided with zero spend.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BehavioralExecutionImpact,
  type BehavioralExecutionPlan,
  type BehavioralTestActionReport,
  type BehavioralTestFreezeProgress,
  type CapabilityDiff,
  type CapabilityGateResult,
  checkPriorSourceAdmissibility,
  DERIVED_UNIT_FILES,
  type DerivedUnitFile,
  descriptorForFile,
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
  type UnitGenerationObserver,
  type UnitProvenanceManifest,
  type VerifiedDependencySnapshot,
  verifyCapabilitySnapshot,
} from "../../../builder/index.ts";
import type { Provider } from "../../../platform/provider/index.ts";
import { ZERO_TOKEN_USAGE } from "../../../platform/provider/usage.ts";
import {
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
  sameOrderedStrings,
} from "../../../registry/index.ts";
import {
  type AdditiveCapabilityMigration,
  deriveAdditiveCapabilityMigration,
  deriveCapabilityTableDdl,
} from "../../../runtime/data/index.ts";
import {
  applyGateFixes,
  behavioralTierInput,
  throwIfAborted,
  unitsChanged,
} from "../../build/build-run.ts";
import {
  type DemoBuildAccumulator,
  recordBehavioralFreezeMetrics,
  recordUnitMetrics,
} from "../../metrics-recorder.ts";
import {
  type BehavioralTierTransition,
  behavioralTierTransition,
} from "../tiers/behavioral-tier-transition.ts";

const NEVER_ABORTED = () => false;

export interface AssembleEvolutionCandidateInput {
  /** The live committed capability under evolution — the on-disk snapshot copies read from. */
  readonly committed: CapabilityRow;
  /** The validated candidate spec the Diff compared. */
  readonly candidate: CapabilitySpec;
  /** The Diff Engine result whose work plan selects regeneration vs copy. */
  readonly diff: CapabilityDiff;
  readonly provider: Provider;
  /** Active dependency rows a regenerated Handler's projected context may reference. */
  readonly dependencyCatalog?: readonly CapabilityRow[];
  /** Verified immutable identities for the same dependency rows, used only by provenance. */
  readonly dependencySnapshots?: readonly VerifiedDependencySnapshot[];
  /** Override the global `OMNI_BEHAVIORAL_TIER` toggle; omitted, the Gate resolves it. */
  readonly behavioralTierEnabled?: boolean;
  /**
   * The run's measurement accumulator. The freeze stage's timing and tokens are recorded here,
   * where the freeze happens, and not through the optional `progress`: a dying assembly has paid.
   */
  readonly measurement?: DemoBuildAccumulator;
  /**
   * True once the trace is cancelled or its subscriber is gone. Checked between units and before
   * the Gate, so an evolution regenerating nothing does not run the whole Gate for nobody.
   */
  readonly isAborted?: () => boolean;
  readonly maxAttempts?: number;
  /** Per-unit generation liveness for the units the work plan regenerates. */
  readonly observer?: UnitGenerationObserver;
  /** Assembly-stage liveness: the derived plan, each byte-copy, and the Gate handover. */
  readonly progress?: EvolutionAssemblyProgress;
  /**
   * Test-only seam substituting one already-selected Handler's first-pass bytes so the Gate has a
   * real failure to repair (`hard-evolution-fixture.test-support.ts`); fails closed without one.
   */
  readonly firstPassHandlerFixture?: (
    spec: CapabilitySpec,
    unit: GeneratedUnitName,
  ) => string | undefined;
}

/**
 * The executed work, decided before a single model call: the DDL derives from the two specs and
 * the copy/regenerate split comes from the Diff work plan, so it reports while units are written.
 */
export interface EvolutionAssemblyPlan {
  readonly regeneratedUnits: readonly GeneratedUnitName[];
  readonly copiedUnits: readonly GeneratedUnitName[];
  readonly additiveMigration: AdditiveCapabilityMigration;
  /**
   * Per regenerated unit, whether its prior committed source was admitted into the prompt, and if
   * not why. Copied units are absent: they never enter model context, so nothing is admitted.
   */
  readonly priorSource: readonly PriorSourceDecision[];
}

export interface EvolutionAssemblyProgress {
  /** The derived plan, before any unit work — the first thing an observer can show. */
  readonly onPlanned?: (plan: EvolutionAssemblyPlan) => void | Promise<void>;
  /**
   * Live, canonical-order progress while changed Action suites generate with bounded concurrency.
   * Observational only: no test bytes cross the hook, and admission still precedes any Handler.
   */
  readonly onTestsProgress?: (progress: BehavioralTestFreezeProgress) => void | Promise<void>;
  /**
   * Behavioral intent is frozen — per Action, generated or carried, and from which closed inputs.
   * Reported before any unit is written, because that is the guarantee.
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
   * The units this evolution wrote, and those byte-identical to the committed snapshot. Settled
   * against final bytes, not the plan: a Gate-repaired unit reads as written. "Copied" is bytes.
   */
  readonly regeneratedUnits: readonly GeneratedUnitName[];
  readonly copiedUnits: readonly GeneratedUnitName[];
  /** The nullable ADD COLUMN(s) this evolution derives (empty for a no-DDL change). */
  readonly additiveMigration: AdditiveCapabilityMigration;
  /**
   * The prior-source admissibility decision per regenerated unit, in canonical order: the audit
   * trail for model context. It never feeds equality, the Diff, or `active_context_digest`.
   */
  readonly priorSource: readonly PriorSourceDecision[];
  /**
   * Per Action, whether this evolution generated the behavioral tests or carried the prior frozen
   * ones on byte-identical inputs. Empty when the tier is off, where there is no test artifact.
   */
  readonly behavioralTests: readonly BehavioralTestActionReport[];
  /**
   * Per Action, whether that frozen suite ran against this candidate's bytes or was skipped, and
   * why. Undefined when the tier is off. Generation is intent; this is impact.
   */
  readonly behavioralExecution?: BehavioralExecutionPlan;
  /**
   * Which row of decision 24's transition table this version landed on, read off the committed
   * tier and the two answers above. Always present: a tier-off version says nothing else.
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
 * Assembles one evolution candidate from the Diff work plan and Gates it, reading the committed
 * snapshot from disk. It performs no publication, DDL application, activation or View swap.
 */
export async function assembleEvolutionCandidate(
  input: AssembleEvolutionCandidateInput,
): Promise<AssembledEvolutionCandidate> {
  const { committed, candidate, diff } = input;
  const verified = verifyEvolutionBase(committed);
  const additiveMigration = deriveAdditiveCapabilityMigration(verified.spec, candidate);
  const regenerated = new Set<GeneratedUnitName>(diff.workPlan.regeneratedUnits);
  // The proof runs before the plan is reported, and so before any model call: the with/without
  // old-source split reaches the developer at the same moment as the copy/regenerate split.
  const priorSource = proveRegenerationPriorSource(input, verified.directory, regenerated);
  await input.progress?.onPlanned?.({
    regeneratedUnits: diff.workPlan.regeneratedUnits,
    copiedUnits: copiedUnitNames(regenerated),
    additiveMigration,
    priorSource: priorSource.decisions,
  });

  // Freeze behavioral intent before a Handler byte is written or repaired (PLAN decision 23).
  // Only an Action whose own inputs changed is regenerated: a rename moves no digest.
  const frozenTests = await freezeEvolutionTests(input, verified);
  await reportFrozenTests(input, frozenTests);
  throwIfAborted(input.isAborted ?? NEVER_ABORTED);

  const fixtureUnits = new Set<GeneratedUnitName>();
  const units = await assembleUnits(
    input,
    verified.directory,
    regenerated,
    priorSource.admitted,
    fixtureUnits,
  );
  // Record the assembled inventory before the Gate can throw. Waiting for the assembler to return
  // made a failed Gate look as though no unit ran, and dropped its tokens from the durable row.
  if (input.measurement) {
    recordUnitMetrics(input.measurement, units);
    input.measurement.copiedUnits = new Set(copiedUnitNames(regenerated));
  }
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

  // Fold any bounded Gate repair back into the assembled bytes, as a v1 build does. A correctly
  // copied unit is behavior-neutral against the candidate schema, so its bytes stay identical.
  const finalUnits = applyGateFixes(units, gate);
  assertFixtureRepairsProven(fixtureUnits, units, finalUnits, gate);
  // A repair rewrote bytes an observer already shows as final, so report the reconciled inventory
  // — the same refresh a v1 build sends after its own Gate (`runSpecBuildStages`).
  if (unitsChanged(units, finalUnits)) await input.progress?.onUnitsFinalized?.(finalUnits);
  // A Gate repair — a smoke fix, a design-lint item rewrite — can land on a unit the plan copied.
  // "Copied" is a byte claim, so a repaired unit reads as regenerated and gets fresh provenance.
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
 * States this evolution's executable impact for behavioral execution selection. The run/skip
 * verdict reads off the work plan: a copied Handler is bytes the prior frozen suite already passed.
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

// The two widenings past the Handler list, stated in words rather than by silently growing the
// set. Both make a carried suite unprovable, so both run the full frozen one.
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
  // The renderer covers no Action, but every fragment assertion renders through it, so shrinking
  // `shows` breaks a carried assertion with no Handler and no digest moving. A rename still skips.
  if (!sameOrderedStrings(committedSpec.ui_intent.item.shows, input.candidate.ui_intent.item.shows))
    return {
      unnarrowableReason:
        "the fields the item renderer may show changed, so a copied fragment assertion could no longer be satisfiable by any renderer",
    };
  return {};
}

/**
 * Records and reports the freeze the moment it lands. The measurement comes first and does not
 * depend on the optional `progress`: an assembly that dies later has already paid for the suites.
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
 * Authors this candidate's frozen behavioral intent, or nothing when the tier is off. The committed
 * snapshot's frozen tests are the carry-forward source, absent on a tier-off prior (decision 24).
 */
function freezeEvolutionTests(
  input: AssembleEvolutionCandidateInput,
  verified: ReturnType<typeof verifyCapabilitySnapshot>,
): Promise<FrozenBehavioralTestsResult> | undefined {
  // The tier resolves here rather than in the Gate, because generation now precedes the Gate — but
  // through the same global toggle a v1 build reads, since the tier is one experiment-wide knob.
  const enabled = input.behavioralTierEnabled ?? resolveBehavioralTierEnabled();
  if (!enabled) return undefined;
  const priorFrozenTests = readFrozenBehavioralTests(verified);
  return freezeBehavioralTests({
    provider: input.provider,
    spec: input.candidate,
    ...(priorFrozenTests ? { priorFrozenTests } : {}),
    ...(input.progress?.onTestsProgress ? { onProgress: input.progress.onTestsProgress } : {}),
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
 * The units this evolution actually wrote: the work plan's regenerated set plus any the Gate
 * repaired. Everything else is byte-identical to the committed snapshot — the `copiedUnits` set.
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
 * Assembles the inventory in canonical snapshot order (item first): a selected unit regenerates
 * against the candidate's projection, an unaffected one is copied and never enters a prompt.
 */
async function assembleUnits(
  input: AssembleEvolutionCandidateInput,
  committedDirectory: string,
  regenerated: ReadonlySet<GeneratedUnitName>,
  admittedPriorSource: ReadonlyMap<GeneratedUnitName, string>,
  fixtureUnits: Set<GeneratedUnitName>,
): Promise<GeneratedUnit[]> {
  const units: GeneratedUnit[] = [];
  const isAborted = input.isAborted ?? NEVER_ABORTED;
  // Resolve the tier before any deliberately weak byte can be substituted: tier-off means
  // the fixture is never invoked, not merely that a later assertion prevents publication.
  const allowFirstPassFixture =
    input.firstPassHandlerFixture !== undefined &&
    (input.behavioralTierEnabled ?? resolveBehavioralTierEnabled());
  for (const filename of DERIVED_UNIT_FILES) {
    throwIfAborted(isAborted);
    const name = unitNameForFile(filename);
    if (regenerated.has(name)) {
      units.push(
        await regenerateUnit(
          input,
          filename,
          admittedPriorSource.get(name),
          allowFirstPassFixture ? fixtureUnits : undefined,
        ),
      );
      continue;
    }
    const copied = copiedUnit(committedDirectory, filename);
    units.push(copied);
    await input.progress?.onUnitCopied?.(copied);
  }
  return units;
}

async function regenerateUnit(
  input: AssembleEvolutionCandidateInput,
  filename: DerivedUnitFile,
  priorSource: string | undefined,
  fixtureUnits: Set<GeneratedUnitName> | undefined,
): Promise<GeneratedUnit> {
  const generated = await generateCapabilityUnit(unitGenerationInput(input, filename, priorSource));
  // Test-only seam substituting deliberately wrong first-pass bytes. It reaches only what this
  // build writes: copied units, frozen tests and the Gate's own repair are all past it.
  const forced = fixtureUnits
    ? input.firstPassHandlerFixture?.(input.candidate, generated.name)
    : undefined;
  if (forced !== undefined) fixtureUnits?.add(generated.name);
  return forced === undefined ? generated : { ...generated, content: forced };
}

/**
 * Synthetic first-pass bytes only trigger the real repair loop; they are never eligible candidate
 * bytes. Every injected Handler must be named in the repair evidence and end on provider bytes.
 */
function assertFixtureRepairsProven(
  fixtureUnits: ReadonlySet<GeneratedUnitName>,
  firstPassUnits: readonly GeneratedUnit[],
  finalUnits: readonly GeneratedUnit[],
  gate: CapabilityGateResult,
): void {
  if (fixtureUnits.size === 0) return;
  if (gate.behavioral.tier !== "on" || !gate.behavioral.repair.fixed) {
    throw new Error(
      "Guided repair bytes did not produce a proven frozen behavioral failure and repair.",
    );
  }
  for (const unit of fixtureUnits) {
    if (unit === "item") {
      throw new Error("Guided repair may only substitute Handler bytes.");
    }
    const firstPass = firstPassUnits.find((entry) => entry.name === unit)?.content;
    const final = finalUnits.find((entry) => entry.name === unit)?.content;
    if (
      !gate.behavioral.repair.repairedHandlers.includes(unit) ||
      firstPass === undefined ||
      final === undefined ||
      final === firstPass
    ) {
      throw new Error(
        `Guided repair bytes for ${unit} were not replaced by a proven provider repair.`,
      );
    }
  }
}

function unitGenerationInput(
  input: AssembleEvolutionCandidateInput,
  filename: DerivedUnitFile,
  priorSource: string | undefined,
) {
  return {
    provider: input.provider,
    spec: input.candidate,
    unit: descriptorForFile(filename),
    ...(input.dependencyCatalog ? { dependencyCatalog: input.dependencyCatalog } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.observer ? { observer: input.observer } : {}),
    // Present only for a unit whose prior source was proven admissible. A withheld unit's
    // prompt therefore carries no old bytes at all — not an emptied section, no section.
    ...(priorSource !== undefined ? { priorSource } : {}),
  };
}

/** The per-unit proof: what a developer is shown, and what a prompt is allowed to carry. */
interface RegenerationPriorSource {
  readonly decisions: readonly PriorSourceDecision[];
  readonly admitted: ReadonlyMap<GeneratedUnitName, string>;
}

/**
 * Decides, per regenerated unit, whether its committed source may go back to the model —
 * deterministically, against the candidate contract, with no model call and no execution.
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
 * Completes the record for a unit the Gate rewrote, which the plan may have copied and so left
 * with no decision. It reads as withheld truthfully: `generateUnitContent` takes no prior source.
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
 * Reads one committed unit off the verified snapshot. A failure here is unexpected, but prior
 * source is optional context: losing it is a withheld admission, never a failed evolution.
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
    attempts: [{ attempt: 1, durationMs: 0, usage: ZERO_TOKEN_USAGE }],
    durationMs: 0,
    usage: ZERO_TOKEN_USAGE,
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
 * The given units in the Diff's canonical order — `GENERATED_UNITS`, not the snapshot's file
 * order, which puts `item` first. Both halves of a preview must list them the same way.
 */
function orderedUnitNames(names: ReadonlySet<GeneratedUnitName>): readonly GeneratedUnitName[] {
  return GENERATED_UNITS.filter((name) => names.has(name));
}

function unitNameForFile(filename: DerivedUnitFile): GeneratedUnitName {
  return filename === "item.ts" ? "item" : (filename.slice(0, -3) as GeneratedUnitName);
}
