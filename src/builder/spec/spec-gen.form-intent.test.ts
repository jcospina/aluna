// What the two spec-generation prompts say about long text, guidance and a length limit.
//
// All three are declarations a model has to reach for on its own, and none of them can be
// inferred from a field's type — a title and three paragraphs of notes are both a `string`.
// So the clauses have to say what the declaration is *for*, not only what its shape is; a
// model told only the key name leaves every one of them empty.

import { describe, expect, test } from "bun:test";

import { MAX_DECLARED_MAX_LENGTH, MIN_DECLARED_MAX_LENGTH } from "../../registry/index.ts";
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
    test(`${name}: long_text is a list of names, and says which fields belong on it`, () => {
      const prompt = build();
      expect(prompt).toContain("ui_intent.form.long_text lists the active string fields");
      expect(prompt).toContain("in schema-field order");
      expect(prompt).toContain("notes, descriptions, summaries, reviews, journal entries");
      expect(prompt).toContain("leave out titles, names, codes");
    });

    test(`${name}: guidance carries the default sentence, and there is no placeholder key`, () => {
      const prompt = build();
      expect(prompt).toContain("ui_intent.form.guidance lists { field, text } hints");
      expect(prompt).toContain('the sentence announcing a default ("Defaults to today.")');
      expect(prompt).toContain("There is no placeholder key");
    });

    test(`${name}: max_length is string-only, bounded at both ends, and drives all three`, () => {
      const prompt = build();
      expect(prompt).toContain("a field declares max_length only when its type is string");
      expect(prompt).toContain(`between ${MIN_DECLARED_MAX_LENGTH} and ${MAX_DECLARED_MAX_LENGTH}`);
      expect(prompt).toContain("the character counter under the control");
      expect(prompt).toContain("omit it (send null) everywhere else");
    });

    test(`${name}: the platform owns the over-length refusal, so nobody authors it`, () => {
      expect(build()).toContain("max_length_exceeded are platform-owned");
    });
  }
});

describe("the evolution prompt says the two things only an evolution can get wrong", () => {
  test("a hidden field's limit is frozen until it is reactivated", () => {
    expect(evolutionPrompt()).toContain(
      "Preserve a hidden field's max_length exactly; only a reactivation may change it",
    );
  });

  test("a limit the committed data cannot fit is refused, so it says so before the attempt", () => {
    expect(evolutionPrompt()).toContain("refused when any record already holds a longer value");
  });

  test("a hidden field leaves both subset collections, and may rejoin long_text", () => {
    const prompt = evolutionPrompt();
    expect(prompt).toContain("A hidden field loses its entry; a reactivated one may gain it back");
    expect(prompt).toContain("A hidden field loses its entry.");
  });
});
