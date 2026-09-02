// Reading a capability written before this Module's form-intent collections existed.
// The point is that history parses forward without being rewritten: absence canonicalizes
// to empty, and explicit empty is the same value, so no Diff and no version follows.

import { describe, expect, test } from "bun:test";

import { canonicalizeStoredCapabilityShape, capabilitySpecSchema } from "../index.ts";
import { validSpec } from "./spec.test-support.ts";

/** One spec exactly as it was persisted before a given form collection was a key. */
function storedSpecWithout(...collections: readonly string[]): Record<string, unknown> {
  const spec = validSpec() as unknown as Record<string, unknown>;
  const uiIntent = spec.ui_intent as Record<string, unknown>;
  const form = { ...(uiIntent.form as Record<string, unknown>) };
  for (const collection of collections) delete form[collection];
  return { ...spec, ui_intent: { ...uiIntent, form } };
}

const preChoiceStoredSpec = () => storedSpecWithout("choice_inputs");

/** And as it was persisted before 5.10/03 added the form's two subset collections. */
const preFormSubsetsStoredSpec = () => storedSpecWithout("long_text", "guidance");

describe("older stored capabilities parse forward", () => {
  test("a snapshot written without choice_inputs fails the strict gate on its own", () => {
    expect(capabilitySpecSchema.safeParse(preChoiceStoredSpec()).success).toBe(false);
  });

  test("and parses once the storage boundary canonicalizes its shape", () => {
    const parsed = capabilitySpecSchema.parse(
      canonicalizeStoredCapabilityShape(preChoiceStoredSpec()),
    );
    expect(parsed.ui_intent.form.choice_inputs).toEqual([]);
  });

  test("absence and explicit empty canonicalize to the same value, so nothing diffs", () => {
    const absent = capabilitySpecSchema.parse(
      canonicalizeStoredCapabilityShape(preChoiceStoredSpec()),
    );
    const explicit = capabilitySpecSchema.parse(canonicalizeStoredCapabilityShape(validSpec()));
    expect(absent).toEqual(explicit);
  });

  test("canonicalizing does not mutate the stored value it was handed", () => {
    const stored = preChoiceStoredSpec();
    canonicalizeStoredCapabilityShape(stored);
    const form = (stored.ui_intent as Record<string, unknown>).form as Record<string, unknown>;
    expect("choice_inputs" in form).toBe(false);
  });

  test("a pre-choice field needs nothing: a non-choice field declares neither collection", () => {
    const parsed = capabilitySpecSchema.parse(
      canonicalizeStoredCapabilityShape(preChoiceStoredSpec()),
    );
    for (const field of parsed.schema.fields) {
      expect(field.values).toBeUndefined();
      expect(field.groups).toBeUndefined();
    }
  });

  test("a collection already present is left exactly as stored", () => {
    const stored = validSpec();
    expect(capabilitySpecSchema.parse(canonicalizeStoredCapabilityShape(stored))).toEqual(stored);
  });

  test("a snapshot written without long_text or guidance canonicalizes to empty too", () => {
    expect(capabilitySpecSchema.safeParse(preFormSubsetsStoredSpec()).success).toBe(false);
    const parsed = capabilitySpecSchema.parse(
      canonicalizeStoredCapabilityShape(preFormSubsetsStoredSpec()),
    );
    expect(parsed.ui_intent.form.long_text).toEqual([]);
    expect(parsed.ui_intent.form.guidance).toEqual([]);
  });

  test("a pre-limit field needs nothing: max_length is absent on a field that declared none", () => {
    const parsed = capabilitySpecSchema.parse(
      canonicalizeStoredCapabilityShape(preFormSubsetsStoredSpec()),
    );
    for (const field of parsed.schema.fields) expect(field.max_length).toBeUndefined();
  });

  test("every collection this Module added canonicalizes together, from one older shape", () => {
    const ancient = storedSpecWithout("choice_inputs", "long_text", "guidance");
    const parsed = capabilitySpecSchema.parse(canonicalizeStoredCapabilityShape(ancient));
    expect(parsed).toEqual(
      capabilitySpecSchema.parse(canonicalizeStoredCapabilityShape(validSpec())),
    );
  });
});
