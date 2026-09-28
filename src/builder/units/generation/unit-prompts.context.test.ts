// The JSON context a unit is handed beside its instructions: structural payload, not wording, so it
// is compared as data. A Handler's declared dependencies are resolved against the frozen catalog.

import { describe, expect, test } from "bun:test";

import {
  FIRST_INCARNATION_ID,
  SECOND_INCARNATION_ID,
} from "../../../registry/incarnations.test-support.ts";
import { type CapabilityRow, presentationFieldDescriptors } from "../../../registry/index.ts";
import { notesSpec } from "../../gate/gate.test-support.ts";
import { buildUnitPrompt } from "./unit-prompts.ts";
import type { HandlerUnitName, UnitDescriptor } from "./units.ts";

const ITEM: UnitDescriptor = { kind: "item-renderer", name: "item" };
const handler = (name: HandlerUnitName): UnitDescriptor => ({ kind: "handler", name });

describe("the JSON context a unit is handed", () => {
  test("the item renderer's is the collection and the shown fields' descriptors", () => {
    const spec = notesSpec();
    const prompt = buildUnitPrompt(spec, ITEM);
    expect(JSON.parse(prompt.slice(prompt.lastIndexOf("\n{\n")))).toEqual({
      id: spec.id,
      collection: spec.ui_intent.collection,
      item: {
        direction: spec.ui_intent.item.direction,
        fields: presentationFieldDescriptors(spec, spec.ui_intent.item.shows),
      },
    });
  });

  function catalogRow(id: string, incarnation_id: string, label: string): CapabilityRow {
    return {
      ...notesSpec(),
      id,
      label,
      incarnation_id,
      version: 1,
      artifacts_path: `capabilities/${id}/${incarnation_id}/v1/`,
      seed: 1,
      logo: { status: "absent", attempts: 0 },
      display_label_override: null,
      prompt_context: `Stores ${label}.`,
    };
  }

  const reading = notesSpec({
    read_dependencies: {
      create: [],
      read: [{ capability_id: "recipes", incarnation_id: FIRST_INCARNATION_ID }],
      update: [],
      delete: [],
      search: [],
    },
  });

  test("a Handler gets the declared dependency at its own incarnation, and no look-alike", () => {
    const catalog = [
      catalogRow("journals", FIRST_INCARNATION_ID, "Journals"),
      catalogRow("recipes", SECOND_INCARNATION_ID, "Earlier recipes"),
      catalogRow("recipes", FIRST_INCARNATION_ID, "Recipes"),
    ];
    const prompt = buildUnitPrompt(reading, handler("read"), undefined, catalog);
    expect(prompt).toContain(JSON.stringify("Recipes"));
    for (const other of ["Journals", "Earlier recipes"]) expect(prompt).not.toContain(other);
    expect(buildUnitPrompt(reading, handler("create"), undefined, catalog)).not.toContain(
      JSON.stringify("Recipes"),
    );
  });

  test("a dependency is handed with its active fields, and without its inactive ones", () => {
    const recipes = catalogRow("recipes", FIRST_INCARNATION_ID, "Recipes");
    const [text] = recipes.schema.fields;
    if (text === undefined) throw new Error("the notes fixture has no field");
    const retired = { ...text, name: "retired_note", lifecycle: "inactive" as const };
    const withRetired = { ...recipes, schema: { fields: [text, retired] } };
    const prompt = buildUnitPrompt(reading, handler("read"), undefined, [withRetired]);
    const context = JSON.parse(prompt.slice(prompt.lastIndexOf("\n{\n")));

    expect(context.read_dependencies).toEqual([
      {
        capability_id: "recipes",
        incarnation_id: FIRST_INCARNATION_ID,
        label: "Recipes",
        prompt_context: recipes.prompt_context,
        active_schema: { fields: [text] },
      },
    ]);
  });

  test("a catalog without the declared dependency is refused, never quietly left out", () => {
    const catalog = [catalogRow("recipes", SECOND_INCARNATION_ID, "Earlier recipes")];
    expect(() => buildUnitPrompt(reading, handler("read"), undefined, catalog)).toThrow(
      FIRST_INCARNATION_ID,
    );
  });
});
