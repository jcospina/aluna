// The builder offers a file field since 7.1/06: the spec prompt names the type and says when to
// declare one, and a generated spec carrying one passes the stage.

import { describe, expect, test } from "bun:test";

import { CAPTION_FIELD, PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import { FILE_FIELD_TYPES, GENERATION_FIELD_TYPES } from "../../registry/index.ts";
import { FILE_FIELD_PROMPT_LINES } from "./file-field-guidance.ts";
import { makeSpecProvider, notesIntent, recordingSend } from "./spec-gen.test-support.ts";
import { buildSpecPrompt, generateSpec } from "./spec-gen.ts";
import { unofferedFieldTypeIssues } from "./unoffered-field-types.ts";

function stageInput(spec: unknown) {
  return {
    provider: makeSpecProvider(spec),
    prompt: "keep track of my photos",
    intent: notesIntent(),
    send: recordingSend().send,
  };
}

describe("the spec prompt", () => {
  test("offers the file type, says what it accepts, and says search never reads it", () => {
    for (const type of FILE_FIELD_TYPES) {
      expect(GENERATION_FIELD_TYPES as readonly string[]).toContain(type);
    }
    const prompt = buildSpecPrompt(stageInput(photoSpec()));
    expect(prompt).toContain(`- a field's type is one of: ${GENERATION_FIELD_TYPES.join(" | ")}.`);
    for (const line of FILE_FIELD_PROMPT_LINES) expect(prompt).toContain(line);
  });
});

describe("a generated spec carrying a file field", () => {
  test("passes the stage with its families", async () => {
    const second = { ...PHOTO_FIELD, name: "cover", label: "Cover" };
    const { spec } = await generateSpec(
      stageInput(photoSpec([CAPTION_FIELD, PHOTO_FIELD, second])),
    );
    const files = spec.schema.fields.filter((field) => field.type === "file");
    expect(files.map((field) => [field.name, field.accepts])).toEqual([
      ["photo", ["image"]],
      ["cover", ["image"]],
    ]);
  });

  test("passes the stage when it marks the file field required", async () => {
    const required = photoSpec([CAPTION_FIELD, { ...PHOTO_FIELD, required: true }]);
    const { spec } = await generateSpec(stageInput(required));
    expect(spec.schema.fields.find((field) => field.type === "file")?.required).toBe(true);
  });

  test("meets no refusal of an unoffered type, now the builder offers the whole pantry", () => {
    expect(unofferedFieldTypeIssues(photoSpec())).toEqual([]);
  });
});
