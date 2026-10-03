// What the spec-generation prompt says about a choice: the shape of an option and of a group,
// the three controls to reach for, and the refusals the platform answers itself.
//
// The wording of each clause is a person's to change. What a test owns is that every number and
// vocabulary the clauses quote is the registry's own, so the prompt cannot drift from the schema
// that gates the answer.

import { describe, expect, test } from "bun:test";
import { linesNaming } from "../../platform/provider/prompt-lines.test-support.ts";
import {
  CHOICE_PRESENTATIONS,
  MAX_CHOICE_GROUP_HEADING_LENGTH,
  MAX_CHOICE_GROUPS,
  MAX_CHOICE_OPTION_LABEL_LENGTH,
  MAX_CHOICE_OPTION_NOTE_LENGTH,
  MAX_CHOICE_OPTION_VALUE_LENGTH,
  MAX_CHOICE_OPTIONS,
  PLATFORM_OWNED_ERROR_CODES,
} from "../../registry/index.ts";
import {
  makeSpecProvider,
  notesIntent,
  notesSpec,
  recordingSend,
} from "./spec-gen.test-support.ts";
import { buildSpecPrompt } from "./spec-gen.ts";

function choicePrompt(): string {
  const { send } = recordingSend();
  return buildSpecPrompt({
    provider: makeSpecProvider(notesSpec()),
    prompt: "track my notes",
    intent: notesIntent(),
    send,
    incarnationId: "inc_spec_test",
  });
}

describe("spec generation stage — the choice contract in the prompt", () => {
  test("offers the three controls together, and speaks to each one beyond the list", () => {
    const prompt = choicePrompt();
    expect(linesNaming(prompt, CHOICE_PRESENTATIONS)).not.toEqual([]);
    for (const presentation of CHOICE_PRESENTATIONS) {
      expect(linesNaming(prompt, [presentation]).length, presentation).toBeGreaterThan(1);
    }
  });

  test("quotes the registry's bounds on an option and a group", () => {
    const prompt = choicePrompt();
    expect(
      linesNaming(prompt, [MAX_CHOICE_OPTION_VALUE_LENGTH, MAX_CHOICE_OPTION_LABEL_LENGTH]),
    ).not.toEqual([]);
    expect(linesNaming(prompt, [MAX_CHOICE_OPTIONS, MAX_CHOICE_GROUPS])).not.toEqual([]);
    expect(linesNaming(prompt, [MAX_CHOICE_OPTION_NOTE_LENGTH])).not.toEqual([]);
    expect(linesNaming(prompt, [MAX_CHOICE_GROUP_HEADING_LENGTH])).not.toEqual([]);
  });

  test("names every platform-owned refusal a capability must never author, on one line", () => {
    expect(linesNaming(choicePrompt(), PLATFORM_OWNED_ERROR_CODES)).toHaveLength(1);
  });
});
