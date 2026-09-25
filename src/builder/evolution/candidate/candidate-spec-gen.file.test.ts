// The builder offers a file field since 7.1/06: the candidate prompt names the type, and a
// candidate that adds one passes the stage, required or not.

import { describe, expect, test } from "bun:test";

import { PHOTO_FIELD } from "../../../registry/fields/file.test-support.ts";
import { GENERATION_FIELD_TYPES } from "../../../registry/index.ts";
import { FILE_FIELD_PROMPT_LINES } from "../../spec/file-field-guidance.ts";
import { recordingSend } from "../../spec/spec-gen.test-support.ts";
import {
  type CandidateDraft,
  candidateFrom,
  evolutionDependencyCatalog,
  evolutionIntentFor,
  journalCapabilityRow,
  makeCandidateProvider,
} from "./candidate.test-support.ts";
import { buildCandidateSpecPrompt, generateCandidateSpec } from "./candidate-spec-gen.ts";
import { CandidateValidationError } from "./candidate-validation.ts";

function stageInput(authored: unknown) {
  const committed = journalCapabilityRow();
  return {
    provider: makeCandidateProvider(authored).provider,
    committed,
    intent: evolutionIntentFor(committed, "Add a photo to each entry"),
    dependencyCatalog: evolutionDependencyCatalog(),
    send: recordingSend().send,
  };
}

function withPhoto(): CandidateDraft {
  const authored = candidateFrom(journalCapabilityRow());
  authored.schema.fields.push({ ...PHOTO_FIELD, accepts: [...(PHOTO_FIELD.accepts ?? [])] });
  return authored;
}

async function rejectionOf(authored: CandidateDraft) {
  const error = await generateCandidateSpec(stageInput(authored)).catch((caught) => caught);
  expect(error).toBeInstanceOf(CandidateValidationError);
  return (error as CandidateValidationError).issues;
}

describe("the candidate prompt", () => {
  test("offers the file type and says what it accepts", () => {
    const prompt = buildCandidateSpecPrompt(stageInput(candidateFrom(journalCapabilityRow())));
    expect(prompt).toContain(`- a field's type is one of: ${GENERATION_FIELD_TYPES.join(" | ")}.`);
    for (const line of FILE_FIELD_PROMPT_LINES) expect(prompt).toContain(line);
  });
});

describe("a generated candidate that adds a file field", () => {
  test("passes the stage", async () => {
    const { candidate } = await generateCandidateSpec(stageInput(withPhoto()));
    expect(candidate.schema.fields.at(-1)).toMatchObject({ name: "photo", accepts: ["image"] });
  });

  test("passes the stage when it marks the new field required, as any field may be", async () => {
    const authored = withPhoto();
    const photo = authored.schema.fields.at(-1);
    if (photo) photo.required = true;
    for (const errorCase of authored.behavioral_errors) errorCase.fields.push(PHOTO_FIELD.name);
    const { candidate } = await generateCandidateSpec(stageInput(authored));
    expect(candidate.schema.fields.at(-1)).toMatchObject({ name: "photo", required: true });
  });

  test("adds no refusal of its own to a candidate refused for something else", async () => {
    const authored = withPhoto();
    authored.subject = "a different notebook";
    expect((await rejectionOf(authored)).map((issue) => issue.path)).toEqual(["subject"]);
  });
});
