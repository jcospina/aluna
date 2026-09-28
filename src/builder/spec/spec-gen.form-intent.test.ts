// What the two spec-generation prompts say about long text, guidance and a length limit.
//
// All three are declarations a model has to reach for on its own, and none of them can be
// inferred from a field's type. The clauses' wording is a person's to change; a test owns that
// both prompts name each declaration's key and quote the registry's own bounds for it.

import { describe, expect, test } from "bun:test";

import { linesNaming } from "../../platform/provider/prompt-lines.test-support.ts";
import {
  MAX_DECLARED_MAX_LENGTH,
  MAX_FIELD_GUIDANCE_LENGTH,
  MAX_LENGTH_EXCEEDED_ERROR_CODE,
  MIN_DECLARED_MAX_LENGTH,
  PLATFORM_OWNED_ERROR_CODES,
} from "../../registry/index.ts";
import {
  candidateFrom,
  evolutionDependencyCatalog,
  evolutionIntentFor,
  journalCapabilityRow,
  makeCandidateProvider,
} from "../evolution/candidate/candidate.test-support.ts";
import { buildCandidateSpecPrompt } from "../evolution/candidate/candidate-spec-gen.ts";
import {
  makeSpecProvider,
  notesIntent,
  notesSpec,
  recordingSend,
} from "./spec-gen.test-support.ts";
import { buildSpecPrompt } from "./spec-gen.ts";

function birthPrompt(): string {
  const { send } = recordingSend();
  return buildSpecPrompt({
    provider: makeSpecProvider(notesSpec()),
    prompt: "track my notes",
    intent: notesIntent(),
    send,
  });
}

function evolutionPrompt(): string {
  const committed = journalCapabilityRow();
  return buildCandidateSpecPrompt({
    provider: makeCandidateProvider(candidateFrom(committed)).provider,
    committed,
    intent: evolutionIntentFor(committed, "Give the journal room for longer entries"),
    dependencyCatalog: evolutionDependencyCatalog(),
    send: recordingSend().send,
  });
}

const PROMPTS = [["birth", birthPrompt] as const, ["evolution", evolutionPrompt] as const];

describe("both prompts describe the three declarations", () => {
  for (const [name, build] of PROMPTS) {
    test(`${name}: names each declaration's key`, () => {
      const prompt = build();
      for (const key of ["long_text", "guidance", "max_length"]) expect(prompt).toContain(key);
    });

    test(`${name}: quotes the registry's bounds on a limit and on a hint`, () => {
      const prompt = build();
      expect(linesNaming(prompt, [MIN_DECLARED_MAX_LENGTH, MAX_DECLARED_MAX_LENGTH])).not.toEqual(
        [],
      );
      expect(linesNaming(prompt, [MAX_FIELD_GUIDANCE_LENGTH])).not.toEqual([]);
    });

    test(`${name}: the platform owns the over-length refusal, so nobody authors it`, () => {
      expect(linesNaming(build(), PLATFORM_OWNED_ERROR_CODES)).toHaveLength(1);
      expect(PLATFORM_OWNED_ERROR_CODES).toContain(MAX_LENGTH_EXCEEDED_ERROR_CODE);
    });
  }
});
