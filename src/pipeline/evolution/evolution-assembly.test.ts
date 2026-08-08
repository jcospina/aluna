// Evolution candidate assembly. Proves the executed work the Diff
// work plan projects: additive DDL, per-unit context projection, byte-copy of
// positively-unaffected units, provenance carry-forward vs refresh, and the Gate over
// the assembled (copied + regenerated) snapshot. No publication/activation happens here
// (that is the engine's job); the assembler stops at a Gate-cleared candidate.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHandlerFor,
  DELETE_HANDLER,
  fullHandlersFor,
  generatedUnitsFor,
  itemRendererFor,
  makeSequenceProvider,
  notesSpec,
  READ_HANDLER,
  searchHandlerFor,
  updateHandlerFor,
} from "../../builder/gate/gate.test-support.ts";
import {
  activatePublishedSnapshot,
  type CapabilityDiff,
  type CapabilityGateResult,
  diffCapabilitySpec,
  expectedAbsentCapability,
  type GeneratedUnit,
  publishCapabilitySnapshot,
  runCapabilityGate,
  verifyCapabilitySnapshot,
} from "../../builder/index.ts";
import {
  applyAdditiveCapabilityMigration,
  applyCapabilityTableDdl,
  deriveCapabilityTableDdl,
} from "../../capability-data/index.ts";
import { openDatabase, type PlatformDatabase } from "../../persistence/db.ts";
import { runMigrations } from "../../persistence/migrations.ts";
import { type CapabilitySpec, getCapability } from "../../registry/index.ts";
import { AbortedBuildError } from "../build/build-run.ts";
import { assembleEvolutionCandidate } from "./evolution-assembly.ts";

const INCARNATION_ID = "44444444-4444-4444-8444-444444444444";

// The committed capability: two active fields plus one inactive field the projection
// test proves is never shown to a regenerated unit's generation context.
function committedSpec(): CapabilitySpec {
  return notesSpec({
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
        {
          name: "legacy_note",
          label: "Legacy note",
          type: "string",
          required: false,
          lifecycle: "inactive",
        },
      ],
    },
  });
}

// The hide-then-evolve candidate: `pinned` becomes inactive. Every committed Handler that
// wrote or read it now carries a name the candidate contract no longer declares, which is
// exactly the prior source admissibility must withhold.
function candidateHidingPinned(): CapabilitySpec {
  return notesSpec({
    schema: {
      fields: committedSpec().schema.fields.map((field) =>
        field.name === "pinned" ? { ...field, lifecycle: "inactive" as const } : field,
      ),
    },
  });
}

// A candidate whose only change is the item renderer's design direction — the one shape that
// regenerates `item` alone, and `item` is the one unit whose canonical order (last) differs
// from the snapshot file order (first).
function candidateWithNewItemDirection(): CapabilitySpec {
  return notesSpec({
    schema: { fields: committedSpec().schema.fields },
    ui_intent: {
      ...committedSpec().ui_intent,
      item: { direction: "A quieter card that leads with the note text.", shows: ["text"] },
    },
  });
}

// The candidate: the committed spec plus one new active string field. The new field is
// not in item.shows, so the item renderer is provably unaffected and copied.
function candidateWithMood(): CapabilitySpec {
  return notesSpec({
    schema: {
      fields: [
        ...committedSpec().schema.fields,
        { name: "mood", label: "Mood", type: "string", required: false, lifecycle: "active" },
      ],
    },
  });
}

// The regenerated units the provider returns, in the order the assembler requests them
// (canonical snapshot order, copies skipped): create, update, search for a new string field.
function newFieldProvider() {
  const candidate = candidateWithMood();
  return makeSequenceProvider([
    { content: createHandlerFor(candidate) },
    { content: updateHandlerFor(candidate) },
    { content: searchHandlerFor(candidate) },
  ]);
}

let committedGate: CapabilityGateResult;

beforeAll(async () => {
  committedGate = await runCapabilityGate({
    spec: committedSpec(),
    ddl: deriveCapabilityTableDdl(committedSpec()),
    handlers: fullHandlersFor(committedSpec(), { read: READ_HANDLER }),
    itemRenderer: itemRendererFor(committedSpec()),
    behavioralTier: { enabled: false },
  });
});

interface AssemblyEnv {
  root: string;
  conns: PlatformDatabase;
}

// Publish + activate the committed v1 on disk, then seed a record written before the
// new field so its added column must read back null.
async function setUpCommitted(
  handlerOverrides: Readonly<Partial<Record<string, string>>> = {},
): Promise<AssemblyEnv> {
  const root = mkdtempSync(join(tmpdir(), "omni-crud-evolution-assembly-"));
  const conns = openDatabase(join(root, "platform.db"));
  runMigrations(conns.readwrite);

  const publication = publishCapabilitySnapshot({
    buildId: "v1",
    spec: committedSpec(),
    incarnationId: INCARNATION_ID,
    version: 1,
    units: generatedUnitsFor(committedSpec(), {
      ...fullHandlersFor(committedSpec(), { read: READ_HANDLER }),
      ...handlerOverrides,
    }),
    gate: committedGate,
    artifactsRoot: join(root, "capabilities"),
  });
  await activatePublishedSnapshot({
    database: conns.readwrite,
    spec: committedSpec(),
    publication,
    expected: expectedAbsentCapability(),
    applyMigration: (database) => void applyCapabilityTableDdl(committedSpec(), database),
    finalizeMetrics: () => undefined,
  });
  conns.readwrite.run('INSERT INTO "cap_notes" ("id", "text") VALUES (?, ?)', [
    "note-1",
    "written before mood existed",
  ]);
  return { root, conns };
}

// Run one new-field evolution assembly against the committed capability.
async function assembleNewField(conns: PlatformDatabase) {
  const candidate = candidateWithMood();
  const diff = diffCapabilitySpec(committedSpec(), candidate);
  const active = getCapability("notes", conns.readonly);
  if (!active) throw new Error("committed capability did not activate");
  const { provider, prompts } = newFieldProvider();
  const assembled = await assembleEvolutionCandidate({
    committed: active,
    candidate,
    diff,
    provider,
    behavioralTierEnabled: false,
  });
  return { assembled, prompts, active, diff };
}

let env: AssemblyEnv;

// Every suite below evolves the same freshly-published committed capability.
function useCommittedCapability(): void {
  beforeEach(async () => {
    env = await setUpCommitted();
  });

  afterEach(() => {
    env.conns.readwrite.close();
    env.conns.readonly.close();
    rmSync(env.root, { recursive: true, force: true });
  });
}

describe("evolution candidate assembly", () => {
  useCommittedCapability();

  test("derives the additive column and selects the matrix's regenerated units", async () => {
    const { assembled } = await assembleNewField(env.conns);

    expect(assembled.additiveMigration.statements).toEqual([
      'ALTER TABLE "cap_notes" ADD COLUMN "mood" TEXT;',
    ]);
    expect(assembled.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect([...assembled.copiedUnits].sort()).toEqual(["delete", "item", "read"]);

    // Applying the derived migration leaves the historical row reading the new column null.
    applyAdditiveCapabilityMigration(assembled.additiveMigration, env.conns.readwrite);
    expect(
      env.conns.readonly.query('SELECT "mood" FROM "cap_notes" WHERE "id" = ?').get("note-1"),
    ).toEqual({ mood: null });
  });

  test("byte-copies unaffected units and never sends them to the model", async () => {
    const { assembled, prompts, active } = await assembleNewField(env.conns);

    const committedDir = verifyCapabilitySnapshot(active.artifacts_path).directory;
    for (const filename of ["read.ts", "delete.ts", "item.ts"] as const) {
      const copied = assembled.units.find((unit) => unit.filename === filename);
      expect(copied?.content).toBe(readFileSync(join(committedDir, filename), "utf8"));
    }

    expect(prompts).toHaveLength(3);
    expect(prompts.filter((p) => p.includes("Generate the create.ts handler"))).toHaveLength(1);
    expect(prompts.filter((p) => p.includes("Generate the update.ts handler"))).toHaveLength(1);
    expect(prompts.filter((p) => p.includes("Generate the search.ts handler"))).toHaveLength(1);
    expect(prompts.some((p) => p.includes("Generate the read.ts handler"))).toBe(false);
    expect(prompts.some((p) => p.includes("Generate the delete.ts handler"))).toBe(false);
    expect(prompts.some((p) => p.includes("item renderer"))).toBe(false);
  });

  test("projects the candidate's active context into regenerated units", async () => {
    const { prompts } = await assembleNewField(env.conns);

    const createPrompt = prompts.find((p) => p.includes("Generate the create.ts handler"));
    expect(createPrompt).toContain("mood");
    expect(createPrompt).toContain("text");
    // The inactive field is never shown to a regenerated unit's generation context.
    expect(createPrompt).not.toContain("legacy_note");
  });

  test("refreshes regenerated provenance and carries copied provenance forward", async () => {
    const { assembled, active, diff } = await assembleNewField(env.conns);

    const committed = verifyCapabilitySnapshot(active.artifacts_path).manifest.unit_provenance;
    for (const filename of ["read.ts", "delete.ts", "item.ts"] as const) {
      expect(assembled.unitProvenance[filename]).toEqual(committed[filename]);
    }
    for (const filename of ["create.ts", "update.ts", "search.ts"] as const) {
      expect(assembled.unitProvenance[filename]).not.toEqual(committed[filename]);
    }
    // Provenance is audit-only: it never drives copy/regenerate selection (that is the Diff).
    expect(assembled.regeneratedUnits).toEqual(diff.workPlan.regeneratedUnits);
  });

  test("runs structural + smoke over the assembled snapshot; design lint follows item", async () => {
    const { assembled, active, diff } = await assembleNewField(env.conns);

    const status = (rung: string) =>
      assembled.gate.outcomes.find((outcome) => outcome.rung === rung)?.status;
    expect(status("structural")).toBe("passed");
    expect(status("smoke")).toBe("passed");
    // The item was copied, so the matrix does not require design lint and no fix occurs.
    expect(diff.workPlan.gate.designLint).toBe(false);
    expect(assembled.gate.designLint.fixed).toBe(false);
    const committedItem = readFileSync(
      join(verifyCapabilitySnapshot(active.artifacts_path).directory, "item.ts"),
      "utf8",
    );
    expect(assembled.itemRenderer).toBe(committedItem);
  });
});

// The canonical snapshot order the assembler requests units in — `item.ts` first.
const SNAPSHOT_UNIT_ORDER = ["item", "create", "read", "update", "delete", "search"] as const;

function regeneratedInSnapshotOrder(diff: CapabilityDiff): readonly string[] {
  const regenerated: readonly string[] = diff.workPlan.regeneratedUnits;
  return SNAPSHOT_UNIT_ORDER.filter((unit) => regenerated.includes(unit));
}

/** A conforming unit per name, so any subset the work plan selects can be answered. */
function conformingUnitsFor(spec: CapabilitySpec): Readonly<Record<string, string>> {
  return {
    item: itemRendererFor(spec),
    create: createHandlerFor(spec),
    read: READ_HANDLER,
    update: updateHandlerFor(spec),
    delete: DELETE_HANDLER,
    search: searchHandlerFor(spec),
  };
}

// Prior source is optional regeneration context, not an entitlement (decision 21
// ¶2). A regenerated unit gets its old committed source back only when deterministic checks
// prove it references nothing outside the *candidate* unit's contract; otherwise it
// regenerates from the contract alone, exactly as a v1 build does.
describe("prior-source admissibility in an evolution", () => {
  useCommittedCapability();

  test("admits clean prior source into each regenerated unit's prompt", async () => {
    const { assembled, prompts, active } = await assembleNewField(env.conns);

    // Adding a field takes nothing away, so every regenerated unit's committed source still
    // fits its candidate contract.
    expect(assembled.priorSource).toEqual([
      { unit: "create", admitted: true },
      { unit: "update", admitted: true },
      { unit: "search", admitted: true },
    ]);

    const committedDir = verifyCapabilitySnapshot(active.artifacts_path).directory;
    for (const [unit, filename] of [
      ["create.ts", "create.ts"],
      ["update.ts", "update.ts"],
      ["search.ts", "search.ts"],
    ] as const) {
      const prompt = prompts.find((candidate) =>
        candidate.includes(`Generate the ${unit} handler`),
      );
      expect(prompt).toContain("Prior committed source");
      expect(prompt).toContain(readFileSync(join(committedDir, filename), "utf8"));
    }
  });

  // `item` sorts last in canonical unit order but is the *first* file the assembler walks,
  // so it is the only unit whose recorded position can disagree with the plan line.
  test("records the item renderer's decision in canonical unit order", async () => {
    const candidate = candidateWithNewItemDirection();
    const diff = diffCapabilitySpec(committedSpec(), candidate);
    const active = getCapability("notes", env.conns.readonly);
    if (!active) throw new Error("committed capability did not activate");
    const { provider, prompts } = makeSequenceProvider(
      regeneratedInSnapshotOrder(diff).map((unit) => ({
        content: conformingUnitsFor(candidate)[unit] ?? "",
      })),
    );

    const assembled = await assembleEvolutionCandidate({
      committed: active,
      candidate,
      diff,
      provider,
      behavioralTierEnabled: false,
    });

    // The committed item renderer reads only `text`, which the candidate still shows.
    expect(assembled.priorSource).toContainEqual({ unit: "item", admitted: true });
    expect(assembled.priorSource.at(-1)?.unit).toBe("item");
    const itemPrompt = prompts.find((prompt) => prompt.includes("item renderer"));
    expect(itemPrompt).toContain(
      readFileSync(
        join(verifyCapabilitySnapshot(active.artifacts_path).directory, "item.ts"),
        "utf8",
      ),
    );
  });

  test("withholds prior source that names a field the candidate hides, and says why", async () => {
    const candidate = candidateHidingPinned();
    const diff = diffCapabilitySpec(committedSpec(), candidate);
    const active = getCapability("notes", env.conns.readonly);
    if (!active) throw new Error("committed capability did not activate");
    // One response per regenerated unit, in canonical snapshot order (item first).
    const { provider, prompts } = makeSequenceProvider(
      regeneratedInSnapshotOrder(diff).map((unit) => ({
        content: conformingUnitsFor(candidate)[unit] ?? "",
      })),
    );

    const assembled = await assembleEvolutionCandidate({
      committed: active,
      candidate,
      diff,
      provider,
      behavioralTierEnabled: false,
    });

    // The committed create and update both write `pinned`; the candidate no longer declares
    // it, so their bytes are withheld and the reason names the field.
    const withheld = assembled.priorSource.filter((decision) => !decision.admitted);
    expect(withheld.map((decision) => decision.unit)).toEqual(["create", "update"]);
    for (const decision of withheld) expect(decision.reason).toContain("pinned");

    // …and not one byte of the withheld source reached the prompts.
    const committedDir = verifyCapabilitySnapshot(active.artifacts_path).directory;
    for (const filename of ["create.ts", "update.ts"] as const) {
      const priorSource = readFileSync(join(committedDir, filename), "utf8");
      expect(prompts.some((prompt) => prompt.includes(priorSource))).toBe(false);
      expect(prompts.some((prompt) => prompt.includes("pinned"))).toBe(false);
    }
  });
});

// The assembly stage is the long half of an evolution (several live regenerations plus the
// Gate), so it reports its progress rather than only its result — that reporting is what
// the developer panel streams. The plan half is derived, not generated, so it is
// reportable before the first model call.
describe("evolution assembly liveness", () => {
  useCommittedCapability();

  test("reports the derived plan before any model call, then each copy, then the Gate", async () => {
    const candidate = candidateWithMood();
    const diff = diffCapabilitySpec(committedSpec(), candidate);
    const active = getCapability("notes", env.conns.readonly);
    if (!active) throw new Error("committed capability did not activate");
    const { provider, prompts } = newFieldProvider();

    const log: string[] = [];
    let promptsWhenPlanned = -1;
    let plannedMigration: readonly string[] = [];
    await assembleEvolutionCandidate({
      committed: active,
      candidate,
      diff,
      provider,
      behavioralTierEnabled: false,
      observer: {
        onUnitGenerated: (unit) => void log.push(`regenerated:${unit.name}`),
      },
      progress: {
        onPlanned: (plan) => {
          promptsWhenPlanned = prompts.length;
          plannedMigration = plan.additiveMigration.statements;
          log.push(`planned:${plan.regeneratedUnits.join("+")}/${plan.copiedUnits.join("+")}`);
        },
        onUnitCopied: (unit) => void log.push(`copied:${unit.name}`),
        onGateStart: () => void log.push("gate"),
        onUnitsFinalized: () => void log.push("finalized"),
      },
    });

    // The plan — including the additive DDL — is known with zero model calls spent.
    expect(promptsWhenPlanned).toBe(0);
    expect(plannedMigration).toEqual(['ALTER TABLE "cap_notes" ADD COLUMN "mood" TEXT;']);
    // Then the inventory in canonical snapshot order, and only then the Gate. Nothing was
    // repaired, so the view a developer is left with is already the final one.
    expect(log).toEqual([
      // Both halves of the plan line are in canonical GENERATED_UNITS order (which puts
      // `item` last) — not the snapshot file order the copy events below follow.
      "planned:create+update+search/read+delete+item",
      "copied:item",
      "regenerated:create",
      "copied:read",
      "regenerated:update",
      "copied:delete",
      "regenerated:search",
      "gate",
    ]);
  });

  // A Gate repair rewrites bytes an observer has already been shown. Left unreported, the
  // panel would keep displaying source the candidate does not carry.
  test("reports the reconciled inventory when a Gate repair changes the bytes", async () => {
    const candidate = candidateWithMood();
    const diff = diffCapabilitySpec(committedSpec(), candidate);
    const active = getCapability("notes", env.conns.readonly);
    if (!active) throw new Error("committed capability did not activate");

    // The regenerated search Handler normalizes with `lower` instead of the platform's
    // search function: it passes every static check and fails the smoke rung, which
    // repairs exactly that Handler from the next provider response.
    const goodSearch = searchHandlerFor(candidate);
    const { provider } = makeSequenceProvider([
      { content: createHandlerFor(candidate) },
      { content: updateHandlerFor(candidate) },
      { content: goodSearch.replaceAll("platform_search_normalize", "lower") },
      { content: goodSearch },
    ]);

    const finalized: (readonly GeneratedUnit[])[] = [];
    const assembled = await assembleEvolutionCandidate({
      committed: active,
      candidate,
      diff,
      provider,
      behavioralTierEnabled: false,
      progress: { onUnitsFinalized: (units) => void finalized.push(units) },
    });

    expect(assembled.gate.smoke.fixed).toBe(true);
    expect(finalized).toHaveLength(1);
    expect(finalized[0]?.find((unit) => unit.name === "search")?.content).toBe(goodSearch);
    // And the reported inventory is the repaired one, not the first draft.
    expect(assembled.handlers.search).toBe(goodSearch);
    // The repair landed on a unit the plan already regenerated, so the split is unchanged —
    // a repair only ever moves a unit out of `copiedUnits`, never into it.
    expect(assembled.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect([...assembled.copiedUnits].sort()).toEqual(["delete", "item", "read"]);
    // The record covers every unit that entered model context, however it got there. A
    // repair that reclassifies a copied unit as written must bring a decision with it.
    expect(assembled.priorSource.map((decision) => decision.unit).toSorted()).toEqual(
      [...assembled.regeneratedUnits].sort(),
    );
  });

  test("a cancelled trace stops the assembly instead of running the Gate", async () => {
    const candidate = candidateWithMood();
    const diff = diffCapabilitySpec(committedSpec(), candidate);
    const active = getCapability("notes", env.conns.readonly);
    if (!active) throw new Error("committed capability did not activate");
    // No queued responses: any generation attempt would throw "sequence exhausted" instead,
    // so reaching the abort check is the only way this passes.
    const { provider, prompts } = makeSequenceProvider([]);
    const log: string[] = [];

    const assembling = assembleEvolutionCandidate({
      committed: active,
      candidate,
      diff,
      provider,
      behavioralTierEnabled: false,
      isAborted: () => true,
      progress: { onGateStart: () => void log.push("gate") },
    });

    await expect(assembling).rejects.toThrow(AbortedBuildError);
    expect(prompts).toHaveLength(0);
    expect(log).toEqual([]);
  });
});
