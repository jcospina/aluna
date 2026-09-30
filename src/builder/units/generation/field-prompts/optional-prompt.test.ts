// What the item renderer is told about an optional field its card shows: the field's own line
// says so, and one rule asks the card to check it before drawing, so an empty one never reads
// "null". A file field says what it holds when empty by its own rule, so this one leaves it be.

import { describe, expect, test } from "bun:test";

import {
  addedLines,
  linesNaming,
} from "../../../../platform/provider/prompt-lines.test-support.ts";
import { PHOTO_FIELD } from "../../../../registry/fields/file.test-support.ts";
import type { SpecField } from "../../../../registry/index.ts";
import { notesSpec } from "../../../gate/gate.test-support.ts";
import { buildUnitPrompt, ITEM_OPTIONAL_FIELD_RULE } from "../unit-prompts.ts";

function cardPrompt(shows: string[], fields: readonly SpecField[] = notesSpec().schema.fields) {
  const base = notesSpec();
  return buildUnitPrompt(
    notesSpec({
      schema: { fields: [...fields] },
      ui_intent: { ...base.ui_intent, item: { ...base.ui_intent.item, shows } },
    }),
    { kind: "item-renderer", name: "item" },
  );
}

const MOOD: SpecField = {
  name: "mood",
  label: "Mood",
  type: "string",
  required: false,
  lifecycle: "active",
};
const WITH_MOOD = [...notesSpec().schema.fields, MOOD];

describe("an optional field the card shows", () => {
  test("moves its own line on the card and adds the rule for an empty one", () => {
    const required = WITH_MOOD.map((field) => ({ ...field, required: true }));
    const moved = addedLines(
      cardPrompt(["text", MOOD.name], required),
      cardPrompt(["text", MOOD.name], WITH_MOOD),
    );
    expect(moved).toHaveLength(2);
    expect(moved).toContain(ITEM_OPTIONAL_FIELD_RULE);
    expect(linesNaming(moved.join("\n"), [MOOD.name, MOOD.type])).toHaveLength(1);
  });

  test("teaches nothing about empty fields to a card that shows only required ones", () => {
    expect(cardPrompt(["text"], WITH_MOOD)).not.toContain(ITEM_OPTIONAL_FIELD_RULE);
  });

  test("teaches nothing about empty fields for a yes/no field, which is never empty", () => {
    expect(cardPrompt(["text", "pinned"])).not.toContain(ITEM_OPTIONAL_FIELD_RULE);
  });

  test("is left to its own rule when it holds a file", () => {
    const prompt = cardPrompt(
      ["text", PHOTO_FIELD.name],
      [...notesSpec().schema.fields, PHOTO_FIELD],
    );
    expect(prompt).not.toContain(ITEM_OPTIONAL_FIELD_RULE);
    expect(linesNaming(prompt, [PHOTO_FIELD.name, PHOTO_FIELD.label])).toHaveLength(1);
  });
});
