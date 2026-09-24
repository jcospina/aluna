// A file field is not searchable (PLAN decision 36): its only text is a filename such as
// `IMG_4821.JPG`, and a match the card cannot show is worse than no match. So nothing that
// decides what search reads ever names one.

import { describe, expect, test } from "bun:test";

import { PHOTO_FIELD, photoSpec } from "../../../registry/fields/file.test-support.ts";
import {
  actionTestInputs,
  isSearchSchemaInput,
} from "../../gate/rungs/behavioral/freeze/behavioral-test-inputs.ts";
import { buildUnitPrompt } from "./unit-prompts.ts";

describe("search never reads a file field", () => {
  test("the search Handler is told about the caption and never about the photo", () => {
    const prompt = buildUnitPrompt(photoSpec(), { kind: "handler", name: "search" });
    expect(prompt).toContain('"caption"');
    expect(prompt).not.toContain(`"${PHOTO_FIELD.name}"`);
  });

  test("the behavioral search inputs leave it out, so its suite cannot expect a match", () => {
    const { schema } = actionTestInputs(photoSpec(), "search");
    if (!isSearchSchemaInput(schema)) throw new Error("search projects the q input shape");
    expect(schema.searchable_fields.map((field) => field.name)).toEqual(["caption"]);
  });
});

describe("the writing suites' inputs", () => {
  test("carry what a file field accepts, so a change to it moves their digest", () => {
    const { schema } = actionTestInputs(photoSpec(), "create");
    if (isSearchSchemaInput(schema)) throw new Error("create projects its writable fields");
    expect(schema.find((field) => field.name === PHOTO_FIELD.name)?.accepts).toEqual(
      PHOTO_FIELD.accepts,
    );
  });
});
