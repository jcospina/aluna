// Until the Gate can mint a scratch reference (7.1/06), a file field's only Gate-side value is
// `null`: the smoke never submits one, never expects one, and the search fixture never fills one.

import { describe, expect, test } from "bun:test";

import {
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../../registry/fields/file.test-support.ts";
import { buildSmokeInput, buildUpdateInputs } from "./gate-smoke-samples.ts";
import { fixtureFieldValue } from "./gate-smoke-search.ts";

describe("a file field in the smoke", () => {
  test("is not submitted on create, as the form's stand-in submits nothing, and stays empty", () => {
    const { input, expectedValues } = buildSmokeInput(photoSpec());
    expect(PHOTO_FIELD.name in input.values).toBe(false);
    expect([...input.submittedFields]).toEqual([CAPTION_FIELD.name]);
    expect(expectedValues[PHOTO_FIELD.name]).toBeNull();
  });

  test("is not submitted on update either, and stays empty", () => {
    const update = buildUpdateInputs(photoSpec()).find(
      ({ field }) => field.name === PHOTO_FIELD.name,
    );
    expect(update?.input.values).toEqual({});
    expect([...(update?.input.submittedFields ?? [])]).toEqual([]);
    expect(update?.expected).toBeNull();
  });

  test("holds nothing in any search fixture row", () => {
    for (const seed of [0, 1, 44]) expect(fixtureFieldValue(PHOTO_FIELD, seed)).toBeNull();
  });
});
