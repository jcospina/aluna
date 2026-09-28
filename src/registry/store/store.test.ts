// Tests for the registry access module. Each case runs against a
// throwaway db (openDatabase + runMigrations) so the real data file is never
// touched. The headline guarantees: a valid row written through the access
// module reads back deep-equal — version and artifacts_path intact — through
// the read-only connection, for any valid row; and an invalid row writes nothing.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fc from "fast-check";

import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../platform/persistence/scratch-db.test-support.ts";
import {
  FIRST_INCARNATION_ID,
  FOURTH_INCARNATION_ID,
  SECOND_INCARNATION_ID,
  THIRD_INCARNATION_ID,
} from "../incarnations.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  capabilityRowSchema,
  defaultBehavioralErrorsForSchema,
  type FieldType,
  fieldTypeSchema,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../spec/spec.ts";
import { FULL_CAPABILITY_TOOLS } from "../tools.ts";
import {
  getCapability,
  insertCapability,
  listCapabilities,
  listCapabilityDependents,
  REGISTRY_TABLE,
  resolveActionReadDependencies,
} from "./store.ts";

const NOTES_INCARNATION_ID = FIRST_INCARNATION_ID;

// A complete, valid registry row — the M2 demo's notes capability. Fresh per
// call so tests can tweak copies without sharing state.
function notesRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    id: "notes",
    label: "Notes",
    subject: "an open notebook",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "note",
    plural_noun: "notes",
    incarnation_id: NOTES_INCARNATION_ID,
    version: 1,
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
      {
        action: "update",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: [...FULL_CAPABILITY_TOOLS],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    artifacts_path: `capabilities/notes/${NOTES_INCARNATION_ID}/v1/`,
    seed: 184206,
    logo: { status: "absent", attempts: 0 },
    display_label_override: null,
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the shared database lifecycle keeps store regressions in one suite.
describe("capability registry store", () => {
  let env: ScratchDbEnv;
  let conns: PlatformDatabase;

  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-registry-");
    conns = env.conns;
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  test("a valid row round-trips deep-equal, version and artifacts_path intact", () => {
    const row = notesRow();
    insertCapability(row, conns.readwrite);

    // Read back through the *read-only* connection — the write landed in the
    // shared file and the read path convention really serves it.
    const fetched = getCapability("notes", conns.readonly);
    expect(fetched).toEqual(row);
    expect(fetched?.version).toBe(1);
    expect(fetched?.incarnation_id).toBe(NOTES_INCARNATION_ID);
    expect(fetched?.artifacts_path).toBe(`capabilities/notes/${NOTES_INCARNATION_ID}/v1/`);
  });

  test("get-by-id returns null for an unknown capability", () => {
    expect(getCapability("recipes", conns.readonly)).toBeNull();
  });

  test("list-all returns every row, deterministically ordered by id", () => {
    const notes = notesRow();
    const recipes = notesRow({
      id: "recipes",
      label: "Recipes",
      subject: "an open notebook",
      ground: "grass_green",
      companion: "coral_orange",
      noun: "note",
      plural_noun: "notes",
      incarnation_id: SECOND_INCARNATION_ID,
      artifacts_path: `capabilities/recipes/${SECOND_INCARNATION_ID}/v1/`,
      seed: 184206,
      logo: { status: "absent", attempts: 0 },
      prompt_context: "Stores the user's recipes.",
    });

    // Insert out of order; the list comes back in id order regardless.
    insertCapability(recipes, conns.readwrite);
    insertCapability(notes, conns.readwrite);

    expect(listCapabilities(conns.readonly)).toEqual([notes, recipes]);
  });

  test("list-all on an empty registry is an empty list", () => {
    expect(listCapabilities(conns.readonly)).toEqual([]);
  });

  test("an invalid spec is rejected loudly and writes nothing", () => {
    const admitted: readonly string[] = fieldTypeSchema.options;
    const unadmitted = admitted.map((type) => `${type}[]`).find((type) => !admitted.includes(type));
    const valid = notesRow();
    const [text, pinned] = valid.schema.fields;
    if (unadmitted === undefined || text === undefined || pinned === undefined) {
      throw new Error("the fixture needs two fields and the pantry an unadmitted list type");
    }
    const invalid = notesRow({
      schema: { fields: [text, { ...pinned, type: unadmitted as FieldType }] },
    });
    expect(capabilityRowSchema.safeParse(valid).success).toBe(true);

    expect(() => insertCapability(invalid, conns.readwrite)).toThrow();
    expect(listCapabilities(conns.readonly)).toEqual([]);
  });

  test("stored rows fail closed instead of synthesizing a missing required-fields contract", () => {
    insertCapability(notesRow(), conns.readwrite);
    expect(getCapability("notes", conns.readonly)).toEqual(notesRow());
    conns.readwrite.run(`UPDATE ${REGISTRY_TABLE} SET behavioral_errors = '[]' WHERE id = 'notes'`);

    expect(() => getCapability("notes", conns.readonly)).toThrow();
  });

  test("a duplicate id throws — duplicates are the resolver's to deflect, not the store's", () => {
    insertCapability(notesRow(), conns.readwrite);
    expect(() => insertCapability(notesRow(), conns.readwrite)).toThrow();
  });

  test("dependency pairs must resolve to active rows and are reverse-indexed", () => {
    const notes = notesRow();
    const requiredError = notes.behavioral_errors[0];
    if (!requiredError) throw new Error("notes fixture requires one validation error");
    insertCapability(notes, conns.readwrite);
    const dependent = notesRow({
      id: "reading_list",
      label: "Reading list",
      subject: "an open notebook",
      ground: "grass_green",
      companion: "coral_orange",
      noun: "note",
      plural_noun: "notes",
      incarnation_id: SECOND_INCARNATION_ID,
      artifacts_path: `capabilities/reading_list/${SECOND_INCARNATION_ID}/v1/`,
      seed: 184206,
      logo: { status: "absent", attempts: 0 },
      tools: [...FULL_CAPABILITY_TOOLS],
      behavioral_errors: [requiredError, { ...requiredError, action: "update" }],
      read_dependencies: {
        create: [],
        read: [{ capability_id: notes.id, incarnation_id: notes.incarnation_id }],
        update: [],
        delete: [],
        search: [],
      },
    });
    insertCapability(dependent, conns.readwrite);

    expect(resolveActionReadDependencies(dependent, "read", conns.readonly)).toEqual([notes]);
    expect(listCapabilityDependents(notes, conns.readonly)).toEqual([dependent]);
    expect(() =>
      insertCapability(
        notesRow({
          id: "broken_reader",
          incarnation_id: THIRD_INCARNATION_ID,
          artifacts_path: `capabilities/broken_reader/${THIRD_INCARNATION_ID}/v1/`,
          seed: 184206,
          logo: { status: "absent", attempts: 0 },
          tools: [...FULL_CAPABILITY_TOOLS],
          behavioral_errors: [requiredError, { ...requiredError, action: "update" }],
          read_dependencies: {
            create: [],
            read: [
              {
                capability_id: "missing",
                incarnation_id: FOURTH_INCARNATION_ID,
              },
            ],
            update: [],
            delete: [],
            search: [],
          },
        }),
        conns.readwrite,
      ),
    ).toThrow(/does not resolve to one active registry row/);
  });

  test("any valid row round-trips through the store unchanged", () => {
    const phrase = fc
      .string({ unit: "grapheme", minLength: 1, maxLength: 24 })
      .filter((text) => text.trim().length > 0 && !/[\r\n]/.test(text));
    const draws = fc.record({
      label: phrase,
      fieldLabel: phrase,
      behavior: phrase,
      prompt_context: phrase,
      required: fc.boolean(),
      version: fc.integer({ min: 1, max: 10_000 }),
      seed: fc.nat(),
    });
    let admitted = 0;

    fc.assert(
      fc.property(draws, (draw) => {
        const schema: CapabilityRow["schema"] = {
          fields: [
            {
              name: "text",
              label: draw.fieldLabel,
              type: "string",
              required: draw.required,
              lifecycle: "active",
            },
          ],
        };
        const row = notesRow({
          label: draw.label,
          behavior: draw.behavior,
          prompt_context: draw.prompt_context,
          version: draw.version,
          seed: draw.seed,
          schema,
          behavioral_errors: defaultBehavioralErrorsForSchema(schema),
          artifacts_path: `capabilities/notes/${NOTES_INCARNATION_ID}/v${draw.version}/`,
        });
        if (!capabilityRowSchema.safeParse(row).success) return;
        admitted += 1;
        conns.readwrite.run(`DELETE FROM ${REGISTRY_TABLE}`);
        insertCapability(row, conns.readwrite);
        expect(getCapability("notes", conns.readonly)).toEqual(row);
      }),
      { seed: 20_260_926, numRuns: 200 },
    );
    expect(admitted).toBeGreaterThan(100);
  });
});
