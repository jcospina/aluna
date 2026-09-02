// The engine tracer, end to end (Epic 4.6's acceptance battery; PLAN
// decisions 13, 21, 22, 24, 27, 37; ADR-0006).
//
// The flagship flow: "add a due date to my notes and make it stand out in the list", run
// through the whole engine over a real committed capability — candidate, validation,
// facts, union, additive DDL, projected regeneration, byte-copy, Gate, publication,
// atomic activation — with the behavioral tier both on and off. Then the two proofs that
// only an end-to-end run can give: a copied reader stays byte-identical yet returns
// complete new-column rows (decision 13's rehydration), and the two terminal shapes that
// publish nothing at all. Providers are fake: no network, no spend.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  actionTestInputDigest,
  actionTestInputs,
  type CapabilityGateResult,
  frozenBehavioralTestsSchema,
  UnmappedChangeFactError,
  verifyCapabilitySnapshot,
} from "../../builder/index.ts";
import {
  createCapabilityQueryPort,
  materializeCapabilityActionRecord,
} from "../../capability-data/index.ts";
import {
  createArtifactCleanupAdapter,
  destroyCapability,
} from "../../capability-deletion/index.ts";
import { renderEditForm } from "../../presentation/index.ts";
import { createReadGateCoordinator } from "../../read-gates/index.ts";
import {
  type CapabilitySpec,
  getCapability,
  listCapabilityDeletionTombstones,
  MIN_DECLARED_MAX_LENGTH,
} from "../../registry/index.ts";
import {
  activated,
  addCommittedDependency,
  behaviorNeutralDueDateCandidate,
  committedGate,
  committedSpec,
  dueDateCandidate,
  type EngineEnv,
  evolve,
  expectEveryFrozenSuiteSkipped,
  factKinds,
  HISTORICAL_TEXT,
  INCARNATION_ID,
  publishedUnit,
  setUpCommitted,
  tableColumns,
  tearDownCommitted,
  versionDirectory,
} from "./evolution-run.test-support.ts";
import { MaxLengthScanError } from "./length-scan.ts";

let gate: CapabilityGateResult;
let env: EngineEnv;

beforeAll(async () => {
  gate = await committedGate();
});

beforeEach(async () => {
  env = await setUpCommitted(gate);
});

afterEach(() => {
  tearDownCommitted(env);
});

describe("the due-date tracer", () => {
  for (const tierOn of [false, true]) {
    test(`runs end to end with the behavioral tier ${tierOn ? "on" : "off"}`, async () => {
      const candidate = dueDateCandidate();
      const result = await evolve(
        env,
        candidate,
        "add a due date to my notes and make it stand out in the list",
        { behavioralTierEnabled: tierOn, buildId: `due-date-${tierOn ? "on" : "off"}` },
      );
      const outcome = activated(result);

      // The facts the flow produces: the nullable field (with its requiredness), the
      // item's dependency + direction and the behavior change.
      expect(factKinds(result)).toEqual(["new_active_field", "item_presentation", "behavior"]);
      // Unioned: free-text behavior takes all five Handlers, item.shows
      // takes the renderer — every unit is written, none copied.
      expect(outcome.assembly.regeneratedUnits).toEqual([
        "create",
        "read",
        "update",
        "delete",
        "search",
        "item",
      ]);
      expect(outcome.assembly.copiedUnits).toEqual([]);
      expect(outcome.diff.workPlan.platformWork).toEqual(["add_column", "platform_form_detail"]);
      expect(outcome.diff.workPlan.gate.behavioral.fullSuite).toBe(true);
      // Additive DDL only — one nullable column, so every historical row still reads.
      expect(outcome.assembly.additiveMigration.statements).toEqual([
        'ALTER TABLE "cap_notes" ADD COLUMN "due_date" TEXT;',
      ]);

      // Published, activated, pointed at: exactly one View swap's worth of change.
      expect(outcome.publication.version).toBe(2);
      const live = getCapability("notes", env.conns.readonly);
      expect(live).toMatchObject({ version: 2, label: "Notes" });
      expect(live?.artifacts_path).toContain("/v2/");
      expect(live?.schema.fields.map((field) => field.name)).toEqual([
        "text",
        "pinned",
        "due_date",
      ]);
      expect(tableColumns(env, "cap_notes")).toContain("due_date");
      // v1 stays committed immutable history.
      expect(verifyCapabilitySnapshot(versionDirectory(env, 1)).spec).toEqual(committedSpec());

      // The record written before the column existed is intact and readable, with the new
      // value absent — an empty input in the record's form, never a broken row.
      const stored = env.conns.readonly
        .query('SELECT "text", "due_date" FROM "cap_notes" WHERE "id" = ?')
        .get("note-1") as { text: string; due_date: string | null };
      expect(stored).toEqual({ text: HISTORICAL_TEXT, due_date: null });
      const recordForm = renderEditForm(
        {
          id: candidate.id,
          label: candidate.label,
          noun: candidate.noun,
          schema: candidate.schema,
          form: candidate.ui_intent.form,
          actions: candidate.tools,
          item: candidate.ui_intent.item,
        },
        { ...stored, id: "note-1", created_at: "2026-07-27T00:00:00Z" },
      );
      expect(recordForm).toContain("Due date");
      expect(recordForm).toContain('id="edit-notes-due_date" type="date" name="due_date" value=""');

      // The tier is honoured in both directions: tier-on freezes the behavioral artifact
      // into the snapshot, tier-off carries none by contract.
      expect(outcome.publication.files.includes("tests/behavioral.json")).toBe(tierOn);
      expect(outcome.publication.manifest.behavioral_tier).toBe(tierOn ? "on" : "off");
      expect(result.lifecycles.at(-1)).toMatchObject({
        lifecycleStatus: "success",
        outcome: "activated",
      });
    });
  }

  test("streams the plan, the units, and the Gate without leaking internals", async () => {
    const result = await evolve(env, dueDateCandidate(), "add a due date and make it stand out", {
      buildId: "due-date-stream",
    });
    activated(result);
    const names = result.events.map((event) => event.event);
    expect(names).toContain("candidate-preview");
    expect(names).toContain("units-preview");
    expect(names).toContain("gate-preview");
    // The Gate verdict lands before the terminal candidate preview replaces the running
    // plan, so the last candidate-preview is the complete one.
    expect(names.lastIndexOf("gate-preview")).toBeLessThan(names.lastIndexOf("candidate-preview"));
    const narration = result.events
      .filter((event) => event.event === "narration")
      .map((event) => event.data)
      .join(" ");
    expect(narration.length).toBeGreaterThan(0);
    expect(narration).not.toMatch(/handler|migration|schema|gate|snapshot|spec\b/i);
  });
});

describe("evolution during unrelated deletion cleanup", () => {
  test("evolves while another capability has durable cleanup pending", async () => {
    const archiveSpec: CapabilitySpec = {
      ...committedSpec(),
      id: "archive",
      label: "Archive",
      prompt_context: "Stores archived text entries.",
    };
    const archiveIncarnation = "66666666-6666-4666-8666-666666666666";
    await addCommittedDependency(env, archiveSpec, archiveIncarnation);
    const archive = getCapability(archiveSpec.id, env.conns.readonly);
    if (!archive) throw new Error("archive capability did not activate");

    const destruction = await destroyCapability({
      target: archive,
      database: env.conns.readwrite,
      readonlyDatabase: env.conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters: [
        {
          name: "pending_external_resource",
          collect: () => ["resource-key"],
          clean: () => {
            throw new Error("external cleanup is temporarily unavailable");
          },
        },
        createArtifactCleanupAdapter(env.artifactsRoot),
      ],
    });
    const archiveV1 = join(env.artifactsRoot, archiveSpec.id, archiveIncarnation, "v1");
    expect(destruction.status).toBe("cleanup_pending");
    expect(getCapability(archiveSpec.id, env.conns.readonly)).toBeNull();
    expect(listCapabilityDeletionTombstones(env.conns.readonly)).toHaveLength(1);
    expect(verifyCapabilitySnapshot(archiveV1).manifest.incarnation_id).toBe(archiveIncarnation);

    const result = await evolve(env, dueDateCandidate(), "add a due date to my notes", {
      buildId: "due-date-with-unrelated-cleanup-pending",
    });
    const outcome = activated(result);

    expect(outcome.publication.version).toBe(2);
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
    expect(listCapabilityDeletionTombstones(env.conns.readonly)).toHaveLength(1);
    expect(verifyCapabilitySnapshot(archiveV1).manifest.incarnation_id).toBe(archiveIncarnation);
  }, 30_000);
});

/**
 * Load the *published* v2 `read.ts` and run it through the real query adapter, then
 * return the single record it handed to `present`. This is the only way to prove
 * rehydration: the handler's own SQL selects target ids and never names the new column,
 * so what matters is what the platform gives back — not what the source says.
 */
async function readOneRecordThroughPublishedHandler(
  spec: CapabilitySpec,
): Promise<Record<string, unknown>> {
  const module = (await import(pathToFileURL(join(versionDirectory(env, 2), "read.ts")).href)) as {
    default: (context: unknown) => Promise<string>;
  };
  const query = createCapabilityQueryPort(env.conns.readonly, { target: spec });
  const presented: Record<string, unknown>[] = [];
  const present = (record: Parameters<typeof materializeCapabilityActionRecord>[0]) => {
    presented.push(materializeCapabilityActionRecord(record));
    return "";
  };
  await module.default({ query, present });
  const record = presented[0];
  if (presented.length !== 1 || !record) {
    throw new Error(`expected exactly one presented record, received ${presented.length}`);
  }
  return record;
}

describe("a behavior-neutral additive change", () => {
  test("copies read/search byte-identically yet returns complete new-column rows", async () => {
    const candidate = behaviorNeutralDueDateCandidate();
    const result = await evolve(env, candidate, "add a due date", { buildId: "neutral" });
    const outcome = activated(result);

    // The matrix positively proves the readers unaffected: a non-text field takes the two
    // writing Handlers only, and `item` follows its own item.shows fact, which did not change.
    expect(factKinds(result)).toEqual(["new_active_field"]);
    expect(outcome.assembly.regeneratedUnits).toEqual(["create", "update"]);
    expect(outcome.assembly.copiedUnits).toEqual(["read", "delete", "search", "item"]);
    // Copied means bytes: the published v2 files are identical to v1's, and those units
    // never entered a generation prompt at all.
    for (const filename of ["read.ts", "delete.ts", "search.ts", "item.ts"]) {
      expect(publishedUnit(env, 2, filename)).toBe(publishedUnit(env, 1, filename));
    }
    expect([...result.generatedUnits].sort()).toEqual(["create", "update"]);
    expect(result.prompts.some((prompt) => prompt.startsWith("Generate the read.ts"))).toBe(false);

    // Decision 13: the copied `read` selects target ids and the platform rehydrates the
    // canonical row on the same snapshot — so an old explicit projection cannot omit the
    // new column even though its bytes never mention it. Proving that means *running*
    // the v2 handler, not reading its source: load the published bytes and drive them
    // through the real query adapter.
    const readHandler = publishedUnit(env, 2, "read.ts");
    expect(readHandler).toContain('"id" AS "target_id"');
    expect(readHandler).not.toContain("due_date");

    const record = await readOneRecordThroughPublishedHandler(candidate);
    expect(record).toMatchObject({ text: HISTORICAL_TEXT });
    // The column the copied handler never mentions is present in the rehydrated row,
    // carrying the honest `null` for a record written before it existed.
    expect(Object.keys(record)).toContain("due_date");
    expect(record.due_date).toBeNull();

    // …and the durable row says so too: a byte-copied unit is `copied`, never dressed up
    // as `generated`. "Copied" is a claim about bytes, and the measurement keeps it.
    expect(result.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "success",
      outcome: "activated",
    });
    expect(result.lifecycles.at(-1)?.stages).toEqual(
      expect.arrayContaining([
        { stage: "unit_generation", state: "generated", unit: { kind: "handler", name: "create" } },
        { stage: "unit_generation", state: "generated", unit: { kind: "handler", name: "update" } },
        { stage: "unit_generation", state: "copied", unit: { kind: "handler", name: "read" } },
        { stage: "unit_generation", state: "copied", unit: { kind: "handler", name: "search" } },
        { stage: "unit_generation", state: "copied", unit: { kind: "handler", name: "delete" } },
        {
          stage: "unit_generation",
          state: "copied",
          unit: { kind: "item-renderer", name: "item" },
        },
      ]),
    );

    // Copied units carry their committed provenance forward rather than acquiring a fresh
    // digest for bytes nothing regenerated.
    const before = verifyCapabilitySnapshot(versionDirectory(env, 1));
    const after = verifyCapabilitySnapshot(versionDirectory(env, 2));
    expect(after.manifest.unit_provenance["read.ts"]).toEqual(
      before.manifest.unit_provenance["read.ts"],
    );
    expect(after.manifest.unit_provenance["create.ts"]).not.toEqual(
      before.manifest.unit_provenance["create.ts"],
    );
  });
});

describe("the canonical no-op", () => {
  test("a semantically identical candidate measures success/no_change and changes nothing", async () => {
    const before = verifyCapabilitySnapshot(versionDirectory(env, 1));
    const result = await evolve(env, committedSpec(), "keep it exactly as it is", {
      buildId: "noop",
    });

    expect(result.outcome.kind).toBe("no_change");
    expect(factKinds(result)).toEqual([]);
    // No DDL, no unit work, no snapshot, no version, no pointer move.
    expect(result.generatedUnits).toEqual([]);
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    expect(verifyCapabilitySnapshot(versionDirectory(env, 1)).manifest).toEqual(before.manifest);
    // The measurement is the whole durable effect.
    expect(result.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "success",
      outcome: "no_change",
    });
    expect(result.lifecycles.at(-1)?.stages).toEqual(
      expect.arrayContaining([
        { stage: "publication", state: "skipped" },
        { stage: "activation", state: "skipped" },
      ]),
    );
  });

  test("a key reorder is still the no-op — canonical equality, not raw JSON", async () => {
    // Serialization order is not a product fact: the same spec with its object keys
    // authored in a different order must not manufacture a version.
    const base = committedSpec();
    const reordered = {
      prompt_context: base.prompt_context,
      read_dependencies: { search: [], delete: [], update: [], read: [], create: [] },
      tools: base.tools,
      behavioral_errors: base.behavioral_errors,
      behavior: base.behavior,
      ui_intent: {
        collection: base.ui_intent.collection,
        item: { shows: base.ui_intent.item.shows, direction: base.ui_intent.item.direction },
        form: base.ui_intent.form,
      },
      schema: base.schema,
      noun: base.noun,
      companion: base.companion,
      ground: base.ground,
      subject: base.subject,
      label: base.label,
      id: base.id,
    } as unknown as CapabilitySpec;
    const result = await evolve(env, reordered, "keep it the same", { buildId: "reorder" });
    expect(result.outcome.kind).toBe("no_change");
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
  });
});

describe("an unmapped difference fails closed", () => {
  test("a committed region no matrix row covers stops the engine before any work", async () => {
    // Today's candidate and registry schemas are jointly total, so this difference cannot
    // be *stored* — which is exactly why decision 21's guard is a residual check rather
    // than an enumerated denylist. Handing the engine a committed row from outside that
    // vocabulary (here the reset-bounded pre-4.4 two-Action shape) is the reachable
    // simulation of a future admitted region arriving without a matrix row.
    const active = getCapability("notes", env.conns.readonly);
    if (!active) throw new Error("committed capability did not activate");
    const legacy = { ...active, tools: ["create", "read"] } as typeof active;

    await expect(
      evolve(env, committedSpec(), "add a due date", { active: legacy, buildId: "unmapped" }),
    ).rejects.toThrow(UnmappedChangeFactError);

    // Nothing was derived, generated, published, or activated.
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    expect(tableColumns(env, "cap_notes")).not.toContain("due_date");
    expect(existsSync(join(env.artifactsRoot, "notes", INCARNATION_ID, "v1"))).toBe(true);
  });
});

// The one check in the engine that reads committed *data* rather than a spec: a candidate
// may only add or lower a `max_length` once the stored rows have been proved to fit it. The
// unit test proves the scan; this proves it is wired — that a real `runCapabilityEvolution`
// reaches it, refuses there, and leaves everything as it was.
describe("a limit the stored rows cannot fit fails closed", () => {
  test("the engine refuses before publishing, and nothing about v1 moves", async () => {
    const base = committedSpec();
    const bounded: CapabilitySpec = {
      ...base,
      schema: {
        fields: base.schema.fields.map((field) =>
          field.name === "text" ? { ...field, max_length: MIN_DECLARED_MAX_LENGTH } : field,
        ),
      },
    };
    // The row written under v1 is longer than the candidate says the field holds.
    env.conns.readwrite.run('UPDATE "cap_notes" SET "text" = ? WHERE "id" = ?', [
      "x".repeat(MIN_DECLARED_MAX_LENGTH + 1),
      "note-1",
    ]);

    await expect(
      evolve(env, bounded, "keep the note short", { buildId: "over-length" }),
    ).rejects.toThrow(MaxLengthScanError);

    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    // And the value the scan refused on is still there, untouched.
    expect(
      env.conns.readonly.query('SELECT "text" FROM "cap_notes" WHERE "id" = ?').get("note-1"),
    ).toEqual({ text: "x".repeat(MIN_DECLARED_MAX_LENGTH + 1) });
  });
});

// ── Frozen behavioral intent ─────────────────────────────

function assertBehavioralProgressBeforeUnits(
  events: readonly { readonly event: string; readonly data: string }[],
): void {
  const progressEvents = events.flatMap((event, index) =>
    event.event === "behavioral-tests-preview"
      ? [
          {
            index,
            progress: JSON.parse(event.data) as {
              status: string;
              completedActions: number;
              actions: readonly { action: string; status: string }[];
            },
          },
        ]
      : [],
  );
  expect(progressEvents[0]?.progress).toMatchObject({
    status: "running",
    completedActions: 0,
  });
  expect(
    progressEvents.some(
      ({ progress }) =>
        progress.actions.filter((entry) => entry.status === "generating").length === 2,
    ),
  ).toBe(true);
  expect(progressEvents.at(-1)?.progress).toMatchObject({
    status: "complete",
    completedActions: 5,
  });
  const firstUnitsEvent = events.findIndex((event) => event.event === "units-preview");
  expect(progressEvents.at(-1)?.index).toBeLessThan(firstUnitsEvent);
}

describe("frozen behavioral intent under evolution", () => {
  beforeEach(async () => {
    env = await setUpCommitted(gate);
  });

  afterEach(() => {
    tearDownCommitted(env);
  });

  test("freezes per-Action tests before any Handler byte and content-addresses them", async () => {
    const candidate = dueDateCandidate();
    const result = await evolve(env, candidate, "add a due date to my notes", {
      behavioralTierEnabled: true,
      buildId: "frozen-intent",
    });
    const outcome = activated(result);

    // The ordering *is* the guarantee: every behavioral prompt precedes every unit prompt,
    // so no test in this snapshot can have been written to fit a Handler.
    const isBehavioral = (prompt: string) => prompt.includes("Action under test:");
    const isUnit = (prompt: string) => /^Generate the \w+\.ts/u.test(prompt);
    const behavioralIndexes = result.prompts.flatMap((prompt, index) =>
      isBehavioral(prompt) ? [index] : [],
    );
    const unitIndexes = result.prompts.flatMap((prompt, index) => (isUnit(prompt) ? [index] : []));
    expect(behavioralIndexes).toHaveLength(5);
    expect(unitIndexes.length).toBeGreaterThan(0);
    expect(Math.max(...behavioralIndexes)).toBeLessThan(Math.min(...unitIndexes));

    // The published artifact is per Action and addressed to that Action's closed inputs.
    const frozen = frozenBehavioralTestsSchema.parse(
      JSON.parse(
        readFileSync(join(outcome.publication.directory, "tests/behavioral.json"), "utf8"),
      ),
    );
    expect(frozen.actions.map((entry) => entry.action)).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "search",
    ]);
    for (const entry of frozen.actions) {
      expect(entry.input_digest).toBe(
        actionTestInputDigest(actionTestInputs(candidate, entry.action)),
      );
    }

    // The build story shows, per Action, that tests were generated and from which inputs.
    expect(
      outcome.assembly.behavioralTests.map((entry) => `${entry.action}:${entry.status}`),
    ).toEqual([
      "create:generated",
      "read:generated",
      "update:generated",
      "delete:generated",
      "search:generated",
    ]);
    const preview = JSON.parse(
      result.events.filter((event) => event.event === "candidate-preview").at(-1)?.data ?? "null",
    ) as { assembly?: { behavioralTests?: readonly { action: string; inputs: unknown }[] } };
    expect(preview.assembly?.behavioralTests).toHaveLength(5);
    expect(preview.assembly?.behavioralTests?.[0]?.inputs).toMatchObject({
      behavior: true,
      schemaFields: ["due_date", "pinned", "text"],
    });

    assertBehavioralProgressBeforeUnits(result.events);
  });

  test("a following label-only evolution regenerates no tests and carries the frozen bytes", async () => {
    const first = dueDateCandidate();
    const firstOutcome = activated(
      await evolve(env, first, "add a due date to my notes", {
        behavioralTierEnabled: true,
        buildId: "frozen-intent-v2",
      }),
    );
    const frozenV2 = readFileSync(
      join(firstOutcome.publication.directory, "tests/behavioral.json"),
      "utf8",
    );

    // Only user-facing wording moves: no field name, type, requiredness, lifecycle,
    // behavior, error, or dependency identity changes.
    const relabelled: CapabilitySpec = {
      ...first,
      label: "Reminders",
      schema: {
        fields: first.schema.fields.map((field) => ({ ...field, label: `${field.label} ` })),
      },
    };
    const second = await evolve(env, relabelled, "rename the labels", {
      behavioralTierEnabled: true,
      buildId: "frozen-intent-v3",
    });
    const secondOutcome = activated(second);

    expect(second.prompts.filter((prompt) => prompt.includes("Action under test:"))).toEqual([]);
    expect(
      secondOutcome.assembly.behavioralTests.every((entry) => entry.status === "carried"),
    ).toBe(true);
    // Byte-identical frozen intent carried into the new version's snapshot.
    expect(
      readFileSync(join(secondOutcome.publication.directory, "tests/behavioral.json"), "utf8"),
    ).toBe(frozenV2);

    // …and nothing ran. A label rename regenerates `item.ts` alone; the renderer covers no
    // Action and no Handler moved, so there is no code any frozen assertion has not already
    // judged. This is the living-demo case: an item-only change runs none.
    expect(secondOutcome.assembly.regeneratedUnits).toEqual(["item"]);
    expectEveryFrozenSuiteSkipped(second, secondOutcome, versionDirectory(env, 3));
  });
});
