// The builder does not offer a file field yet: the Gate cannot mint a scratch reference for one
// until 7.1/06. The candidate prompt never names the type, and a candidate carrying one is refused
// by the stage in the same rejection as every other violation it carries.

import { describe, expect, test } from "bun:test";

import { PHOTO_FIELD } from "../../../registry/fields/file.test-support.ts";
import { GENERATION_FIELD_TYPES } from "../../../registry/index.ts";
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

const UNOFFERED = {
  path: "schema.fields.photo.type",
  message: 'field "photo" is a file field, which the builder does not offer yet',
};

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
  test("offers the builder's types and says accepts is always null", () => {
    const prompt = buildCandidateSpecPrompt(stageInput(candidateFrom(journalCapabilityRow())));
    expect(prompt).toContain(`- a field's type is one of: ${GENERATION_FIELD_TYPES.join(" | ")}.`);
    expect(prompt).toContain("every field sends accepts as null");
  });
});

describe("a generated candidate carrying a file field", () => {
  test("is refused by the stage, naming the field", async () => {
    expect(await rejectionOf(withPhoto())).toEqual([UNOFFERED]);
  });

  test("is refused for that and for everything else it gets wrong, in one rejection", async () => {
    const authored = withPhoto();
    authored.subject = "a different notebook";
    const issues = await rejectionOf(authored);
    expect(issues.map((issue) => issue.path)).toEqual(["subject", UNOFFERED.path]);
  });

  test("is named beside a shape error, not hidden behind it", async () => {
    const authored = withPhoto();
    const photo = authored.schema.fields.at(-1);
    if (photo) photo.required = true;
    const paths = (await rejectionOf(authored)).map((issue) => issue.path);
    expect(paths).toContain(`schema.fields.${authored.schema.fields.length - 1}.required`);
    expect(paths).toContain(UNOFFERED.path);
  });
});
