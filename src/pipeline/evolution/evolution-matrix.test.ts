// Every change-fact matrix row, end to end (the normative "Total Diff
// Engine change-fact matrix" in the Module 4 PLAN; decisions 21, 22; ADR-0006).
//
// The fact→work *mapping* is table-tested pure in `builder/evolution/diff-engine.test.ts`.
// This battery proves the mapping's consequences: for each row, one complete run of the
// engine over a real committed capability, asserting the DDL the live table actually got,
// which units entered a generation prompt, which units' published bytes are identical to
// the committed snapshot's, and that the pointer moved exactly one version. Plus the
// monotone union — several facts at once must be the sum of their columns, never the
// intersection.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notesSpec } from "../../builder/gate/gate.test-support.ts";
import {
  type CapabilityGateResult,
  diffCapabilitySpec,
  type GeneratedUnitName,
  type PlatformWorkKind,
  verifyCapabilitySnapshot,
} from "../../builder/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  type CapabilityTool,
  FULL_CAPABILITY_TOOLS,
  getCapability,
} from "../../registry/index.ts";
import {
  activated,
  addCommittedDependency,
  committedGate,
  committedSpec,
  durableLifecycle,
  type EngineEnv,
  evolve,
  factKinds,
  HISTORICAL_TEXT,
  handlersFor,
  publishedUnit,
  setUpCommitted,
  tableColumns,
  tearDownCommitted,
  versionDirectory,
} from "./evolution-run.test-support.ts";

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

function withUiIntent(overrides: Partial<CapabilitySpec["ui_intent"]>): CapabilitySpec {
  return notesSpec({ ui_intent: { ...committedSpec().ui_intent, ...overrides } });
}

function withFields(fields: CapabilitySpec["schema"]["fields"]): CapabilitySpec {
  return notesSpec({ schema: { fields } });
}

interface MatrixCase {
  /** The matrix row this case is the end-to-end proof of. */
  readonly row: string;
  readonly intent: string;
  readonly candidate: () => CapabilitySpec;
  readonly facts: readonly string[];
  readonly platformWork: readonly PlatformWorkKind[];
  readonly regenerated: readonly GeneratedUnitName[];
  readonly ddl: readonly string[];
  /** The Action suites the tier-on column selects; omitted means none. */
  readonly tests?: readonly CapabilityTool[];
  readonly fullSuite?: boolean;
}

const MATRIX: readonly MatrixCase[] = [
  {
    row: "capability label → registry + logo/View copy, no units",
    intent: "call these my jottings",
    candidate: () => notesSpec({ label: "Jottings" }),
    facts: ["capability_label"],
    platformWork: ["registry_and_view_copy"],
    regenerated: [],
    ddl: [],
  },
  {
    row: "empty-state noun → platform copy, no units",
    intent: "call each one an entry",
    candidate: () => notesSpec({ noun: "entry" }),
    facts: ["empty_state_noun"],
    platformWork: ["platform_empty_state_copy"],
    regenerated: [],
    ddl: [],
  },
  {
    row: "prompt_context → resolver catalog, no units",
    intent: "describe these better",
    candidate: () => notesSpec({ prompt_context: "Stores the user's short written notes." }),
    facts: ["prompt_context"],
    platformWork: ["resolver_catalog"],
    regenerated: [],
    ddl: [],
  },
  {
    row: "field order only → platform form order, no units",
    intent: "show pinned before the text",
    candidate: () => withFields([...committedSpec().schema.fields].reverse()),
    facts: ["field_order"],
    platformWork: ["platform_field_order"],
    regenerated: [],
    ddl: [],
  },
  {
    row: "new active text field → ADD COLUMN, create/update, plus search for text",
    intent: "add a mood I can search",
    candidate: () =>
      withFields([
        ...committedSpec().schema.fields,
        { name: "mood", label: "Mood", type: "string", required: false, lifecycle: "active" },
      ]),
    facts: ["new_active_field"],
    platformWork: ["add_column", "platform_form_detail"],
    regenerated: ["create", "update", "search"],
    ddl: ['ALTER TABLE "cap_notes" ADD COLUMN "mood" TEXT;'],
    tests: ["create", "update", "search"],
  },
  {
    // Requiredness and its error contract are coupled by candidate validation: the
    // `missing_required_fields` cases must name exactly the active required fields. So a
    // requiredness change is always at least a two-fact evolution, and its unioned effect
    // is what the matrix's two rows add up to.
    row: "required change → resulting-record validation + error contract, create/update",
    intent: "let me start a note before I've written anything in it",
    candidate: () =>
      notesSpec({
        schema: {
          fields: committedSpec().schema.fields.map((field) =>
            field.name === "text" ? { ...field, required: false } : field,
          ),
        },
        // No active required field left, so the missing_required_fields contract is empty.
        behavioral_errors: [],
      }),
    facts: ["required_change", "behavioral_errors"],
    platformWork: ["resulting_record_validation", "behavioral_error_contract"],
    regenerated: ["create", "update"],
    ddl: [],
    tests: ["create", "update"],
  },
  {
    row: "field label → platform form/detail; item only when the field is shown",
    intent: "call the text the body",
    candidate: () =>
      withFields(
        committedSpec().schema.fields.map((field) =>
          field.name === "text" ? { ...field, label: "Body" } : field,
        ),
      ),
    facts: ["field_label"],
    platformWork: ["platform_form_detail"],
    // `text` is in item.shows, so the renderer — and only the renderer — follows.
    regenerated: ["item"],
    ddl: [],
  },
  {
    row: "hide a field → no destructive DDL, create/update",
    intent: "stop tracking whether a note is pinned",
    candidate: () =>
      withFields(
        committedSpec().schema.fields.map((field) =>
          field.name === "pinned" ? { ...field, lifecycle: "inactive" as const } : field,
        ),
      ),
    facts: ["field_lifecycle"],
    platformWork: ["platform_form_detail", "list_input_intent"],
    regenerated: ["create", "update"],
    // Soft-hide never drops a column, so there is no DDL at all.
    ddl: [],
    tests: ["create", "update"],
  },
  {
    row: "item direction / item.shows → the item renderer alone",
    intent: "make each note quieter in the list",
    candidate: () =>
      withUiIntent({
        item: { direction: "A quiet card that leads with the note text.", shows: ["text"] },
      }),
    facts: ["item_presentation"],
    platformWork: [],
    regenerated: ["item"],
    ddl: [],
  },
  {
    row: "collection feed|grid → platform list container + the item renderer",
    intent: "lay my notes out as a grid",
    candidate: () => withUiIntent({ collection: { layout: "grid" } }),
    facts: ["collection_layout"],
    platformWork: ["platform_list_container"],
    regenerated: ["item"],
    ddl: [],
  },
  {
    row: "free-text behavior → all five Handlers and the complete suite (decision 22)",
    intent: "keep the newest notes at the top and trim the text",
    candidate: () =>
      notesSpec({ behavior: "Text is required and trimmed. Newest notes appear first." }),
    facts: ["behavior"],
    platformWork: [],
    regenerated: ["create", "read", "update", "delete", "search"],
    ddl: [],
    fullSuite: true,
  },
  {
    row: "behavioral_errors → the named Actions only",
    intent: "tell me when I write the same note twice",
    candidate: () =>
      notesSpec({
        behavioral_errors: [
          ...committedSpec().behavioral_errors,
          {
            action: "create",
            trigger: "duplicate_text",
            code: "duplicate_text",
            fields: ["text"],
            expected_markers: BEHAVIORAL_ERROR_MARKERS,
          },
        ],
      }),
    facts: ["behavioral_errors"],
    platformWork: ["behavioral_error_contract"],
    regenerated: ["create"],
    ddl: [],
    tests: ["create"],
  },
];

/** The live registry row, or a loud failure — every case here has one by construction. */
function committedRow() {
  const row = getCapability("notes", env.conns.readonly);
  if (!row) throw new Error("the committed notes row is missing");
  return row;
}

describe("every change-fact matrix row, end to end", () => {
  for (const matrixCase of MATRIX) {
    test(matrixCase.row, async () => {
      const born = committedRow();
      // The tier is pinned off here: this battery is about the fact→work mapping, and
      // the tier itself is proven on *and* off end to end by the due-date tracer.
      const result = await evolve(env, matrixCase.candidate(), matrixCase.intent, {
        buildId: `matrix-${MATRIX.indexOf(matrixCase)}`,
        behavioralTierEnabled: false,
      });
      const outcome = activated(result);

      expect(factKinds(result)).toEqual([...matrixCase.facts]);
      expect([...outcome.diff.workPlan.platformWork]).toEqual([...matrixCase.platformWork]);
      expect([...outcome.assembly.regeneratedUnits]).toEqual([...matrixCase.regenerated]);
      expect([...outcome.assembly.additiveMigration.statements]).toEqual([...matrixCase.ddl]);
      // The behavioral-test column the matrix projects.
      expect(outcome.diff.workPlan.gate.behavioral.fullSuite).toBe(matrixCase.fullSuite ?? false);
      if (!matrixCase.fullSuite) {
        expect(outcome.diff.workPlan.gate.behavioral.actions).toEqual([
          ...(matrixCase.tests ?? []),
        ]);
      }

      // Only the selected units entered a generation prompt; every unaffected unit's
      // published bytes are identical to the committed snapshot's (decision 21's copy).
      expect([...result.generatedUnits].sort()).toEqual([...matrixCase.regenerated].sort());
      for (const unit of outcome.assembly.copiedUnits) {
        expect(publishedUnit(env, 2, `${unit}.ts`)).toBe(publishedUnit(env, 1, `${unit}.ts`));
      }

      // Every row activates exactly one version, and the record written under v1 survives
      // — evolution is additive, so no row here may cost the user data.
      expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
      // No matrix row moves a birth fact, the seed that drew the artwork, or the
      // logo's own state: evolution never reads or writes the logo.
      const { subject, ground, seed, logo } = born;
      expect(committedRow()).toMatchObject({ subject, ground, seed, logo });
      expect(tableColumns(env, "cap_notes")).toContain("pinned");
      expect(
        env.conns.readonly.query('SELECT "text" FROM "cap_notes" WHERE "id" = ?').get("note-1"),
      ).toEqual({ text: HISTORICAL_TEXT });
    });
  }

  test("reactivating a hidden field reuses its column and the values still in it", async () => {
    // The reactivate direction needs a hidden field to reactivate, so it is two runs:
    // hide (v2), then bring it back (v3). Soft-hide drops no column, so neither run
    // emits DDL and the value written under v1 is still there at v3 — that is the whole
    // point of "evolution never destroys".
    const hidden = withFields(
      committedSpec().schema.fields.map((field) =>
        field.name === "pinned" ? { ...field, lifecycle: "inactive" as const } : field,
      ),
    );
    const hide = await evolve(env, hidden, "stop tracking whether a note is pinned", {
      buildId: "lifecycle-hide",
      behavioralTierEnabled: false,
    });
    expect(factKinds(hide)).toEqual(["field_lifecycle"]);
    expect(activated(hide).publication.version).toBe(2);

    const reactivated = await evolve(env, committedSpec(), "start tracking pinned again", {
      buildId: "lifecycle-reactivate",
      behavioralTierEnabled: false,
    });
    const outcome = activated(reactivated);
    if (reactivated.outcome.kind !== "activated") throw new Error("unreachable");
    expect(reactivated.outcome.diff.facts).toEqual([
      { kind: "field_lifecycle", field: "pinned", transition: "reactivate" },
    ]);
    expect([...outcome.assembly.regeneratedUnits]).toEqual(["create", "update"]);
    expect([...outcome.assembly.additiveMigration.statements]).toEqual([]);
    expect(outcome.publication.version).toBe(3);
    // Reused, not re-added — and the v1 value survived being hidden.
    expect(tableColumns(env, "cap_notes").filter((name) => name === "pinned")).toEqual(["pinned"]);
    expect(
      env.conns.readonly.query('SELECT "pinned" FROM "cap_notes" WHERE "id" = ?').get("note-1"),
    ).toEqual({ pinned: 0 });
  });

  test("multiple facts union every column instead of narrowing each other", async () => {
    // A label change (no units), a new text field (create/update/search), and a collection
    // layout change (item): the union must be the sum, never the intersection.
    const base = committedSpec();
    const candidate = notesSpec({
      label: "Jottings",
      subject: "an open notebook",
      ground: "grass_green",
      companion: "coral_orange",
      noun: "note",
      schema: {
        fields: [
          ...base.schema.fields,
          { name: "mood", label: "Mood", type: "string", required: false, lifecycle: "active" },
        ],
      },
      ui_intent: { ...base.ui_intent, collection: { layout: "grid" } },
    });
    const result = await evolve(
      env,
      candidate,
      "call these jottings, add a mood, lay them out as a grid",
      { buildId: "union", behavioralTierEnabled: false },
    );
    const outcome = activated(result);

    expect(factKinds(result)).toEqual([
      "capability_label",
      "new_active_field",
      "collection_layout",
    ]);
    expect([...outcome.diff.workPlan.platformWork]).toEqual([
      "registry_and_view_copy",
      "add_column",
      "platform_form_detail",
      "platform_list_container",
    ]);
    expect(outcome.assembly.regeneratedUnits).toEqual(["create", "update", "search", "item"]);
    expect(outcome.assembly.copiedUnits).toEqual(["read", "delete"]);
    expect(publishedUnit(env, 2, "read.ts")).toBe(publishedUnit(env, 1, "read.ts"));
    expect(getCapability("notes", env.conns.readonly)?.label).toBe("Jottings");
    expect(tableColumns(env, "cap_notes")).toContain("mood");
  });
});

// The list-input row needs an active `string[]` in the *committed* spec, so it brings its
// own committed shape rather than bending the shared notes fixture every other row uses.
function taggedSpec(mode: "comma_separated" | "repeatable"): CapabilitySpec {
  const base = committedSpec();
  return notesSpec({
    schema: {
      fields: [
        ...base.schema.fields,
        { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: { ...base.ui_intent, form: { list_inputs: [{ field: "tags", mode }] } },
  });
}

describe("the list-input mode row", () => {
  let taggedEnv: EngineEnv;
  let taggedGate: CapabilityGateResult;

  beforeAll(async () => {
    taggedGate = await committedGate(taggedSpec("comma_separated"));
  });

  beforeEach(async () => {
    taggedEnv = await setUpCommitted(taggedGate, taggedSpec("comma_separated"));
  });

  afterEach(() => {
    tearDownCommitted(taggedEnv);
  });

  test("a mode change is platform form/normalization work only — no DDL, no units", async () => {
    const result = await evolve(
      taggedEnv,
      taggedSpec("repeatable"),
      "let me type each tag on its own line, commas and all",
      { buildId: "list-input-mode", behavioralTierEnabled: false },
    );
    const outcome = activated(result);

    expect(factKinds(result)).toEqual(["list_input_mode"]);
    expect([...outcome.diff.workPlan.platformWork]).toEqual(["list_input_form_normalization"]);
    // The generated units never see the choice at all: every one is copied.
    expect([...outcome.assembly.regeneratedUnits]).toEqual([]);
    expect(result.generatedUnits).toEqual([]);
    expect([...outcome.assembly.additiveMigration.statements]).toEqual([]);
    expect([...outcome.diff.workPlan.gate.behavioral.actions]).toEqual([]);
    for (const unit of outcome.assembly.copiedUnits) {
      expect(publishedUnit(taggedEnv, 2, `${unit}.ts`)).toBe(
        publishedUnit(taggedEnv, 1, `${unit}.ts`),
      );
    }
    expect(getCapability("notes", taggedEnv.conns.readonly)?.version).toBe(2);
  });
});

describe("the read_dependencies row", () => {
  for (const action of ["create", "read", "update", "delete", "search"] as const) {
    test(`${action} regenerates, Gates, and activates exact dependency provenance`, async () => {
      const shelvesIncarnation = "66666666-6666-4666-8666-666666666666";
      const shelves = notesSpec({
        id: "shelves",
        label: "Shelves",
        prompt_context: "Stores named shelves that notes may organize against.",
      });
      const shelvesPublication = await addCommittedDependency(env, shelves, shelvesIncarnation);
      const readDependencies = {
        create: [],
        read: [],
        update: [],
        delete: [],
        search: [],
        [action]: [{ capability_id: "shelves", incarnation_id: shelvesIncarnation }],
      };
      const candidate = notesSpec({ read_dependencies: readDependencies });
      const dependencyAwareSource = withDependencyQuery(candidate, action);

      const result = await evolve(env, candidate, `let notes ${action} read my shelves`, {
        buildId: `${action}-dependency`,
        behavioralTierEnabled: false,
        unitOverrides: { [action]: dependencyAwareSource },
      });
      const outcome = activated(result);

      expect(outcome.diff.facts).toEqual([{ kind: "read_dependencies", action }]);
      expect([...outcome.diff.workPlan.platformWork]).toEqual(["read_catalog"]);
      expect([...outcome.diff.workPlan.regeneratedUnits]).toEqual([action]);
      expect([...outcome.diff.workPlan.gate.behavioral.actions]).toEqual([action]);
      expect(outcome.assembly.regeneratedUnits).toEqual([action]);
      expect(result.generatedUnits).toEqual([action]);
      expect(publishedUnit(env, 2, `${action}.ts`)).toBe(dependencyAwareSource);
      expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);

      const before = verifyCapabilitySnapshot(versionDirectory(env, 1));
      const after = verifyCapabilitySnapshot(versionDirectory(env, 2));
      expect(after.manifest.unit_provenance[`${action}.ts`].dependencies).toEqual([
        {
          capability_id: "shelves",
          incarnation_id: shelvesIncarnation,
          version: 1,
          snapshot_content_digest: shelvesPublication.manifest.snapshot_content_digest,
        },
      ]);
      expect(after.manifest.unit_provenance[`${action}.ts`].active_context_digest).not.toBe(
        before.manifest.unit_provenance[`${action}.ts`].active_context_digest,
      );
      expect(
        result.prompts.find((prompt) => prompt.startsWith(`Generate the ${action}.ts`)),
      ).toContain('"capability_id": "shelves"');
    });
  }

  test("dependency bytes changed before activation fail closed against frozen evidence", async () => {
    const shelvesIncarnation = "66666666-6666-4666-8666-666666666666";
    const shelves = notesSpec({
      id: "shelves",
      label: "Shelves",
      prompt_context: "Stores named shelves that notes may organize against.",
    });
    const shelvesPublication = await addCommittedDependency(env, shelves, shelvesIncarnation);
    const candidate = notesSpec({
      read_dependencies: {
        create: [],
        read: [{ capability_id: "shelves", incarnation_id: shelvesIncarnation }],
        update: [],
        delete: [],
        search: [],
      },
    });
    await expect(
      evolve(env, candidate, "let notes read my shelves", {
        buildId: "dependency-changed-before-activation",
        durableMetrics: true,
        behavioralTierEnabled: false,
        unitOverrides: { read: withDependencyQuery(candidate, "read") },
        beforePublish: () => {
          writeFileSync(join(shelvesPublication.directory, "read.ts"), "corrupted\n");
        },
      }),
    ).rejects.toThrow(/dependency|snapshot|verification/i);

    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(true);
    expect(durableLifecycle(env, "dependency-changed-before-activation")).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "activation_failed",
    });
    expect(() => verifyCapabilitySnapshot(shelvesPublication.directory)).toThrow();
  });
});

// A property of the whole matrix, and the reason decision 24's fourth row ("unchanged
// inputs, Handler impacted") cannot be reached from the Diff alone. One test, not one per
// row: the file's `beforeEach` publishes and activates a committed v1, and this assertion
// needs none of it — running the real Diff over each row's candidate is pure.
describe("the Diff never regenerates a Handler without selecting that Action's tests", () => {
  test("every matrix row couples its Handler selection to its test selection", () => {
    const committed = committedSpec();
    for (const matrixCase of MATRIX) {
      const workPlan = diffCapabilitySpec(committed, matrixCase.candidate()).workPlan;
      const handlers = workPlan.regeneratedUnits.filter(
        (unit): unit is CapabilityTool => unit !== "item",
      );
      // Every Handler this fact rewrites is an Action whose suite the same fact selects for
      // regeneration — so a regenerated Handler always arrives with freshly authored tests,
      // and a *carried* suite re-run over changed bytes can only come from the Gate's own
      // bounded repair (pinned at the rung in `gate-behavioral-selection.test.ts`) or the
      // full-suite fallback. A future fact that broke that coupling fails here first.
      const selected = workPlan.gate.behavioral.fullSuite
        ? [...FULL_CAPABILITY_TOOLS]
        : workPlan.gate.behavioral.actions;
      expect({
        row: matrixCase.row,
        uncovered: handlers.filter((h) => !selected.includes(h)),
      }).toEqual({ row: matrixCase.row, uncovered: [] });
      // …and the full-suite fallback is not a way to be vacuously right: it selects every
      // Action, so it covers whatever the fact rewrote by construction.
      if (workPlan.gate.behavioral.fullSuite) expect(selected).toHaveLength(5);
    }
    // The property is only meaningful if some row actually regenerates a Handler.
    expect(
      MATRIX.filter((row) => row.regenerated.some((unit) => unit !== "item")).length,
    ).toBeGreaterThan(3);
  });
});

function withDependencyQuery(spec: CapabilitySpec, action: CapabilityTool): string {
  const source = handlersFor(spec)[action];
  const firstLineEnd = source.indexOf("\n");
  const signature = source
    .slice(0, firstLineEnd)
    .replace(
      action === "delete" ? "{ mutation }" : "{ input, mutation",
      action === "delete" ? "{ mutation, query }" : "{ input, query, mutation",
    );
  const dependencyRead = [
    "  query.all({",
    '    sql: \'SELECT "text" FROM "cap_shelves"\',',
    '    result: [{ alias: "text", type: "string" }],',
    "  });",
  ].join("\n");
  return `${signature}\n${dependencyRead}${source.slice(firstLineEnd)}`;
}
