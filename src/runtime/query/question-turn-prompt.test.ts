// The statement's shape is a duty the turn's prompt owes whatever else it says: the rules are read
// off the module that writes them, so their wording stays a person's to change.

import { expect, test } from "bun:test";
import { linesNaming } from "../../platform/provider/prompt-lines.test-support.ts";
import { notesSpec } from "./question.test-support.ts";
import { buildQuestionTurnPrompt, QUESTION_STATEMENT_RULES } from "./question-turn-prompt.ts";

const prompt = buildQuestionTurnPrompt({
  question: "how many notes do I have?",
  specs: [notesSpec()],
  steps: [],
  budget: 5,
  openCapability: null,
});

test("the statement's shape: one read opened by SELECT or WITH, its values bound through ?", () => {
  expect(QUESTION_STATEMENT_RULES).not.toEqual([]);
  for (const rule of QUESTION_STATEMENT_RULES) {
    expect(rule.trim()).not.toBe("");
    expect(prompt.split("\n")).toContain(rule);
  }
  expect(linesNaming(prompt, ["SELECT", "WITH"])).not.toEqual([]);
  expect(
    QUESTION_STATEMENT_RULES.filter((rule) => linesNaming(rule, ["?", "parameters"]).length),
  ).not.toEqual([]);
});
