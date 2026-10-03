// The file rows of the change-fact matrix, end to end through the engine (Module 7 PLAN decisions
// 5, 34 and 35). Adding a file field is one nullable column every older record reads as empty; a
// widened `accepts` redraws the card only where the card shows the field; a hide keeps the keys
// `owned`; and `file` ↔ `file[]` is a type change the candidate never gets past.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { notesSpec } from "../../../builder/gate/gate.test-support.ts";
import { CandidateValidationError, type CapabilityGateResult } from "../../../builder/index.ts";
import {
  requireFileLedgerRow,
  seedFileLedgerRow,
} from "../../../platform/files/store/ledger.test-support.ts";
import { PHOTO_FIELD } from "../../../registry/fields/file.test-support.ts";
import {
  type CapabilitySpec,
  defaultBehavioralErrorsForSchema,
  getCapability,
  type SpecField,
} from "../../../registry/index.ts";
import {
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  createCapabilityUpdateMutationPort,
  MissingRequiredFieldsError,
  selectCapabilityRows,
} from "../../../runtime/data/index.ts";
import { storedFileReference } from "../../../runtime/data/schema/file-values.ts";
import { noFiles } from "../../../runtime/data/tool.test-support.ts";
import {
  activated,
  committedGate,
  committedSpec,
  type EngineEnv,
  evolve,
  factKinds,
  INCARNATION_ID,
  setUpCommitted,
  tearDownCommitted,
} from "../run/evolution-run.test-support.ts";

const ATTACHMENTS: SpecField = {
  name: "attachments",
  label: "Attachments",
  type: "file[]",
  required: false,
  lifecycle: "active",
  accepts: ["document"],
};

/** Notes with `extra` after its committed fields, and the card showing `shows`. */
function notesWith(extra: readonly SpecField[], shows: readonly string[] = ["text"]) {
  const base = committedSpec();
  const schema = { fields: [...base.schema.fields, ...extra] };
  return notesSpec({
    schema,
    behavioral_errors: defaultBehavioralErrorsForSchema(schema),
    ui_intent: { ...base.ui_intent, item: { ...base.ui_intent.item, shows: [...shows] } },
  });
}

function rowsOf(env: EngineEnv, spec: CapabilitySpec) {
  return selectCapabilityRows(
    spec,
    createCapabilityQueryPort(env.conns.readonly, { target: spec }),
  );
}

describe("adding file fields to Notes", () => {
  let gate: CapabilityGateResult;
  let env: EngineEnv;
  beforeAll(async () => {
    gate = await committedGate();
  });
  beforeEach(async () => {
    env = await setUpCommitted(gate);
  });
  afterEach(() => tearDownCommitted(env));

  test("keeps every record, which reads no file and an empty list of them", async () => {
    const committed = committedSpec();
    const port = createCapabilityMutationPort(committed, noFiles(committed, env.conns.readwrite));
    port.create({ text: "Second note", pinned: false });
    port.create({ text: "Third note", pinned: true });
    const attachment: SpecField = { ...PHOTO_FIELD, name: "cover", label: "Cover" };
    const grown = notesWith([attachment, ATTACHMENTS]);

    const result = await evolve(env, grown, "let my notes hold a cover and attachments", {
      buildId: "add-files",
      behavioralTierEnabled: false,
    });
    const outcome = activated(result);

    expect(factKinds(result)).toEqual(["new_active_field", "new_active_field"]);
    expect(outcome.assembly.additiveMigration.statements).toHaveLength(2);
    const rows = rowsOf(env, grown);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect([row.cover, row.attachments]).toEqual([null, []]);
  });

  test("a required file field arrives, and an older record refuses a save until it has one", async () => {
    const cover: SpecField = { ...PHOTO_FIELD, name: "cover", label: "Cover", required: true };
    const grown = notesWith([cover]);
    activated(
      await evolve(env, grown, "every note needs a cover photo", {
        buildId: "add-required-file",
        behavioralTierEnabled: false,
      }),
    );

    expect(rowsOf(env, grown).map((row) => row.cover)).toEqual([null]);
    const edit = createCapabilityUpdateMutationPort(
      grown,
      "note-1",
      new Set(["text"]),
      noFiles(grown, env.conns.readwrite),
    );
    let refused: unknown;
    try {
      edit.update({ text: "Fixed a typo" });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(MissingRequiredFieldsError);
    expect((refused as MissingRequiredFieldsError).fields).toEqual(["cover"]);
  });
});

describe("a committed file field on Notes", () => {
  const PHOTO_ON_CARD = () => notesWith([PHOTO_FIELD], ["text", "photo"]);
  const PHOTO_OFF_CARD = () => notesWith([PHOTO_FIELD]);
  const widened: SpecField = { ...PHOTO_FIELD, accepts: ["image", "document"] };

  for (const [where, committed, widenedSpec, redraws] of [
    ["on the card", PHOTO_ON_CARD, () => notesWith([widened], ["text", "photo"]), true],
    ["off the card", PHOTO_OFF_CARD, () => notesWith([widened]), false],
  ] as const) {
    describe(where, () => {
      let gate: CapabilityGateResult;
      let env: EngineEnv;
      beforeAll(async () => {
        gate = await committedGate(committed());
      });
      beforeEach(async () => {
        env = await setUpCommitted(gate, committed());
      });
      afterEach(() => tearDownCommitted(env));

      test(`widening from photos to photos and documents ${redraws ? "redraws" : "keeps"} the card`, async () => {
        const result = await evolve(env, widenedSpec(), "let the photo be a PDF too", {
          buildId: "widen",
          behavioralTierEnabled: false,
        });
        const outcome = activated(result);

        expect(factKinds(result)).toEqual(["file_families"]);
        expect(outcome.assembly.regeneratedUnits.includes("item")).toBe(redraws);
        expect(result.generatedUnits.includes("item")).toBe(redraws);
        expect(outcome.assembly.additiveMigration.statements).toEqual([]);
      });
    });
  }

  describe("hidden by evolution", () => {
    let gate: CapabilityGateResult;
    let env: EngineEnv;
    beforeAll(async () => {
      gate = await committedGate(PHOTO_OFF_CARD());
    });
    beforeEach(async () => {
      env = await setUpCommitted(gate, PHOTO_OFF_CARD());
    });
    afterEach(() => tearDownCommitted(env));

    test("keeps the file it held owned, in its column", async () => {
      const key = seedFileLedgerRow(env.conns.readwrite, {
        capabilityId: "notes",
        incarnationId: INCARNATION_ID,
        field: "photo",
        state: "owned",
        recordId: "note-1",
      });
      const ledgerRow = requireFileLedgerRow(env.conns.readwrite, key);
      const stored = storedFileReference(ledgerRow);
      env.conns.readwrite.run(`UPDATE "cap_notes" SET "photo" = ? WHERE "id" = 'note-1'`, [stored]);

      const hidden = notesWith([{ ...PHOTO_FIELD, lifecycle: "inactive" }]);
      activated(
        await evolve(env, hidden, "stop keeping a photo on my notes", {
          buildId: "hide-photo",
          behavioralTierEnabled: false,
        }),
      );

      expect(requireFileLedgerRow(env.conns.readwrite, key)).toEqual(ledgerRow);
      const column = env.conns.readwrite
        .query(`SELECT "photo" FROM "cap_notes" WHERE "id" = 'note-1'`)
        .get() as { photo: string };
      expect(column.photo).toBe(stored);
    });
  });
});

describe("a file field's shape", () => {
  const PHOTOS = (): SpecField => ({ ...PHOTO_FIELD, name: "cover", label: "Cover" });
  for (const [committedField, retyped] of [
    [PHOTOS(), { ...PHOTOS(), type: "file[]" }],
    [ATTACHMENTS, { ...ATTACHMENTS, type: "file" }],
  ] as const) {
    describe(`from ${committedField.type}`, () => {
      let gate: CapabilityGateResult;
      let env: EngineEnv;
      beforeAll(async () => {
        gate = await committedGate(notesWith([committedField]));
      });
      beforeEach(async () => {
        env = await setUpCommitted(gate, notesWith([committedField]));
      });
      afterEach(() => tearDownCommitted(env));

      test(`to ${retyped.type} is refused, and Notes stays as it was`, async () => {
        const refused = await evolve(env, notesWith([retyped as SpecField]), "change its shape", {
          buildId: "retype",
          behavioralTierEnabled: false,
        }).catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(CandidateValidationError);
        expect((refused as CandidateValidationError).issues.map((issue) => issue.path)).toEqual([
          `schema.fields.${retyped.name}.type`,
        ]);
        expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
      });
    });
  }
});
