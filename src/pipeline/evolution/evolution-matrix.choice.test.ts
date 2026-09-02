// The choice rows of the change-fact matrix, end to end through the engine.
//
// A choice is the one field type carrying data of its own, so it has the most rows: an
// appended option and a retired one are validation work that selects the writing Handlers,
// while a heading, a note, the order and which control draws them are View work that
// copies every unit. What each row must also prove is that no row moves storage and no row
// strands a committed record.
//
// Their own file rather than a section of `evolution-matrix.test.ts`: they bring a
// committed shape of their own — the shared notes fixture has no choice field — and the
// battery there is already at the file-size cap.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { notesSpec } from "../../builder/gate/gate.test-support.ts";
import type { CapabilityGateResult } from "../../builder/index.ts";
import {
  type CapabilitySpec,
  type ChoiceGroup,
  type ChoiceOption,
  type ChoicePresentation,
  getCapability,
} from "../../registry/index.ts";
import {
  ChoiceDisabledError,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  materializeCapabilityActionRecord,
  selectCapabilityRows,
} from "../../runtime/data/index.ts";
import {
  activated,
  committedGate,
  committedSpec,
  type EngineEnv,
  evolve,
  factKinds,
  publishedUnit,
  setUpCommitted,
  tearDownCommitted,
} from "./evolution-run.test-support.ts";

const COMMITTED_STAGES = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
];

/** The committed notes capability, plus one active choice field carrying `values`. */
function stagedSpec(
  values: readonly ChoiceOption[],
  declaration: { groups?: readonly ChoiceGroup[]; presentation?: ChoicePresentation } = {},
): CapabilitySpec {
  const base = committedSpec();
  return notesSpec({
    schema: {
      fields: [
        ...base.schema.fields,
        {
          name: "stage",
          label: "Stage",
          type: "choice",
          required: false,
          lifecycle: "active",
          values: [...values],
          groups: [...(declaration.groups ?? [])],
        },
      ],
    },
    ui_intent: {
      ...base.ui_intent,
      form: {
        ...base.ui_intent.form,
        choice_inputs: [{ field: "stage", presentation: declaration.presentation ?? "picker" }],
        long_text: [],
        guidance: [],
      },
    },
  });
}

let stagedEnv: EngineEnv;
let stagedGate: CapabilityGateResult;

beforeAll(async () => {
  stagedGate = await committedGate(stagedSpec(COMMITTED_STAGES));
});

beforeEach(async () => {
  stagedEnv = await setUpCommitted(stagedGate, stagedSpec(COMMITTED_STAGES));
});

afterEach(() => {
  tearDownCommitted(stagedEnv);
});

describe("the option set a choice admits", () => {
  test("appending an option is validation work: the writing Handlers, no DDL", async () => {
    const result = await evolve(
      stagedEnv,
      stagedSpec([...COMMITTED_STAGES, { value: "archived", label: "Archived" }]),
      "let me mark a note archived too",
      { buildId: "choice-values", behavioralTierEnabled: false },
    );
    const outcome = activated(result);

    expect(factKinds(result)).toEqual(["choice_values"]);
    expect([...outcome.diff.workPlan.platformWork]).toEqual(["choice_admitted_values"]);
    expect([...outcome.assembly.regeneratedUnits].sort()).toEqual(["create", "update"]);
    // An appended option is not a column change: storage is untouched.
    expect([...outcome.assembly.additiveMigration.statements]).toEqual([]);
    expect(getCapability("notes", stagedEnv.conns.readonly)?.version).toBe(2);
  });

  test("a record committed before the append is still valid after it", async () => {
    const spec = stagedSpec(COMMITTED_STAGES);
    const before = createCapabilityMutationPort(spec, stagedEnv.conns.readwrite).create({
      text: "Filed last week",
      pinned: false,
      stage: "draft",
    });
    const storedId = materializeCapabilityActionRecord(before).id;

    const grown = stagedSpec([...COMMITTED_STAGES, { value: "archived", label: "Archived" }]);
    activated(
      await evolve(stagedEnv, grown, "let me mark a note archived too", {
        buildId: "choice-values-preserved",
        behavioralTierEnabled: false,
      }),
    );

    const query = createCapabilityQueryPort(stagedEnv.conns.readonly, { target: grown });
    const row = selectCapabilityRows(grown, query).find((stored) => stored.id === storedId);
    // The stored value predates the appended option and is still exactly what it was.
    expect(row?.stage).toBe("draft");
  });
});

describe("the wording, the arrangement and the control", () => {
  test("relabelling an option is View work only — every unit is copied", async () => {
    const result = await evolve(
      stagedEnv,
      stagedSpec([
        { value: "draft", label: "Rough draft" },
        { value: "sent", label: "Sent" },
      ]),
      "call a draft a rough draft",
      { buildId: "choice-labels", behavioralTierEnabled: false },
    );
    const outcome = activated(result);

    expect(factKinds(result)).toEqual(["choice_option_labels"]);
    expect([...outcome.diff.workPlan.platformWork]).toEqual(["choice_option_presentation"]);
    expect([...outcome.assembly.regeneratedUnits]).toEqual([]);
    expect([...outcome.assembly.additiveMigration.statements]).toEqual([]);
    for (const unit of outcome.assembly.copiedUnits) {
      expect(publishedUnit(stagedEnv, 2, `${unit}.ts`)).toBe(
        publishedUnit(stagedEnv, 1, `${unit}.ts`),
      );
    }
  });
});

describe("an option taken out of use", () => {
  test("retiring an option is validation work, and the row already holding it keeps it", async () => {
    const spec = stagedSpec(COMMITTED_STAGES);
    const before = createCapabilityMutationPort(spec, stagedEnv.conns.readwrite).create({
      text: "Filed last week",
      pinned: false,
      stage: "sent",
    });
    const storedId = materializeCapabilityActionRecord(before).id;

    const retired = stagedSpec([
      { value: "draft", label: "Draft" },
      { value: "sent", label: "Sent", disabled: true },
    ]);
    const outcome = activated(
      await evolve(stagedEnv, retired, "stop letting me mark a note sent", {
        buildId: "choice-disabled",
        behavioralTierEnabled: false,
      }),
    );

    expect([...outcome.diff.facts.map((fact) => fact.kind)]).toEqual(["choice_option_disabled"]);
    expect([...outcome.diff.workPlan.platformWork]).toEqual(["choice_admitted_values"]);
    // Both writing suites are generated again, and neither Handler: a retired option is
    // still an admitted one, so it never reached the code that writes it.
    expect([...outcome.assembly.regeneratedUnits]).toEqual([]);
    expect([...outcome.diff.workPlan.gate.behavioral.actions].sort()).toEqual(["create", "update"]);
    // Nothing about storage moved, and the row that was standing on the option still is.
    expect([...outcome.assembly.additiveMigration.statements]).toEqual([]);
    const query = createCapabilityQueryPort(stagedEnv.conns.readonly, { target: retired });
    expect(selectCapabilityRows(retired, query).find((row) => row.id === storedId)?.stage).toBe(
      "sent",
    );
    // But nobody may arrive at it again.
    expect(() =>
      createCapabilityMutationPort(retired, stagedEnv.conns.readwrite).create({
        text: "A new one",
        pinned: false,
        stage: "sent",
      }),
    ).toThrow(ChoiceDisabledError);
  });
});

describe("headings, notes and which control draws them", () => {
  test("headings, notes, order and the control are View work only — every unit is copied", async () => {
    const result = await evolve(
      stagedEnv,
      stagedSpec(
        [
          { value: "sent", label: "Sent", group: "closed" },
          { value: "draft", label: "Draft", group: "open", note: "not sent yet" },
        ],
        {
          groups: [
            { id: "open", heading: "Open" },
            { id: "closed", heading: "Closed" },
          ],
          presentation: "radio",
        },
      ),
      "group the stages and show them as radio buttons",
      { buildId: "choice-presentation", behavioralTierEnabled: false },
    );
    const outcome = activated(result);

    expect(factKinds(result)).toEqual([
      "choice_option_notes",
      "choice_option_order",
      "choice_option_groups",
      "choice_presentation",
    ]);
    expect([...outcome.diff.workPlan.platformWork].sort()).toEqual([
      "choice_input_form_control",
      "choice_option_grouping",
      "choice_option_presentation",
    ]);
    expect([...outcome.assembly.regeneratedUnits]).toEqual([]);
    expect([...outcome.assembly.additiveMigration.statements]).toEqual([]);
    for (const unit of outcome.assembly.copiedUnits) {
      expect(publishedUnit(stagedEnv, 2, `${unit}.ts`)).toBe(
        publishedUnit(stagedEnv, 1, `${unit}.ts`),
      );
    }
  });
});
