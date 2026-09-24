// The builder does not offer a file field yet: the Gate cannot mint a scratch reference for one
// until 7.1/06. The spec prompt never names the type, and a spec carrying one is refused by the
// stage itself, whatever a lax provider hands back.

import { describe, expect, test } from "bun:test";

import { CAPTION_FIELD, PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import { FILE_FIELD_TYPES, GENERATION_FIELD_TYPES } from "../../registry/index.ts";
import { makeSpecProvider, notesIntent, recordingSend } from "./spec-gen.test-support.ts";
import { buildSpecPrompt, generateSpec } from "./spec-gen.ts";
import { unofferedFieldTypeIssues } from "./unoffered-field-types.ts";

function stageInput(spec: unknown) {
  return {
    provider: makeSpecProvider(spec),
    prompt: "keep my photos",
    intent: notesIntent(),
    send: recordingSend().send,
  };
}

describe("the spec prompt", () => {
  test("offers the builder's types, which name no file type, and says accepts is always null", () => {
    for (const type of FILE_FIELD_TYPES) {
      expect(GENERATION_FIELD_TYPES as readonly string[]).not.toContain(type);
    }
    const prompt = buildSpecPrompt(stageInput(photoSpec()));
    expect(prompt).toContain(`- a field's type is one of: ${GENERATION_FIELD_TYPES.join(" | ")}.`);
    expect(prompt).toContain("every field sends accepts as null");
  });
});

describe("a generated spec carrying a file field", () => {
  test("is refused by the stage, naming every such field", async () => {
    const second = { ...PHOTO_FIELD, name: "cover", label: "Cover" };
    await expect(
      generateSpec(stageInput(photoSpec([CAPTION_FIELD, PHOTO_FIELD, second]))),
    ).rejects.toThrow(
      'Generated spec refused: field "photo" is a file field, which the builder does not ' +
        'offer yet; field "cover" is a file field, which the builder does not offer yet.',
    );
  });
});

describe("the refusal of an unoffered type", () => {
  test("names each file field, and the offered pantry passes clean", () => {
    expect(unofferedFieldTypeIssues(photoSpec())).toEqual([
      {
        path: "schema.fields.photo.type",
        message: 'field "photo" is a file field, which the builder does not offer yet',
      },
    ]);
    expect(unofferedFieldTypeIssues(photoSpec([CAPTION_FIELD]))).toEqual([]);
  });

  test("reads a spec as it arrived, so a shape error cannot hide it", async () => {
    const malformed = photoSpec([CAPTION_FIELD, { ...PHOTO_FIELD, required: true }]);
    expect(unofferedFieldTypeIssues(malformed)).toHaveLength(1);
    for (const shapeless of [null, "spec", { schema: null }, { schema: { fields: [7] } }]) {
      expect(unofferedFieldTypeIssues(shapeless)).toEqual([]);
    }
    await expect(generateSpec(stageInput(malformed))).rejects.toThrow(
      'Generated spec refused: field "photo" is a file field',
    );
  });
});
