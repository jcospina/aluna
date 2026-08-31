// What a generated unit is told about a length limit, and what the behavioral tier is.
//
// The asymmetry is the whole point. A limit is validation shape, so it belongs in the
// behavioral tier's total inputs — a suite written against a 240-character field is a suite
// that goes stale when the field becomes a 64-character one. It is deliberately absent from
// both Handler prompts, because a Handler receives an already-admitted string and never
// re-implements the bound; that absence is the positive proof ADR-0006 wants before the
// Diff copies a unit instead of rewriting it.

import { describe, expect, test } from "bun:test";

import type { CapabilitySpec } from "../../registry/index.ts";
import {
  actionTestInputDigest,
  actionTestInputs,
} from "../gate/behavioral/behavioral-test-inputs.ts";
import { notesSpec } from "../gate/gate.test-support.ts";
import { buildUnitPrompt } from "./unit-prompts.ts";

/** The notes capability with a bound on its text field, or without one. */
function boundedSpec(max_length?: number): CapabilitySpec {
  const base = notesSpec();
  return notesSpec({
    schema: {
      fields: base.schema.fields.map((field) =>
        field.name === "text" && max_length !== undefined ? { ...field, max_length } : field,
      ),
    },
  });
}

const HANDLERS = ["create", "update", "read", "delete", "search"] as const;

describe("a Handler is never told the limit", () => {
  test("no writing Handler's prompt carries the number, so none can go stale about it", () => {
    for (const name of ["create", "update"] as const) {
      const prompt = buildUnitPrompt(boundedSpec(240), { kind: "handler", name });
      expect(prompt).not.toContain("240");
      expect(prompt).not.toContain('max_length":');
    }
  });

  test("two specs differing only in a limit produce byte-identical unit prompts", () => {
    for (const name of HANDLERS) {
      expect(buildUnitPrompt(boundedSpec(240), { kind: "handler", name })).toBe(
        buildUnitPrompt(boundedSpec(), { kind: "handler", name }),
      );
    }
    expect(buildUnitPrompt(boundedSpec(240), { kind: "item-renderer", name: "item" })).toBe(
      buildUnitPrompt(boundedSpec(), { kind: "item-renderer", name: "item" }),
    );
  });

  test("every Handler is told the platform has already checked it, so none writes a second", () => {
    for (const name of HANDLERS) {
      expect(buildUnitPrompt(boundedSpec(240), { kind: "handler", name })).toContain(
        "already been checked against its declared max_length by the platform",
      );
    }
  });
});

describe("the behavioral tier is told, because it is validation shape", () => {
  test("adding a limit moves the create and update digests and nothing else", () => {
    const before = boundedSpec();
    const after = boundedSpec(240);
    for (const action of ["create", "update"] as const) {
      expect(actionTestInputDigest(actionTestInputs(before, action))).not.toBe(
        actionTestInputDigest(actionTestInputs(after, action)),
      );
    }
    for (const action of ["read", "delete", "search"] as const) {
      expect(actionTestInputDigest(actionTestInputs(before, action))).toBe(
        actionTestInputDigest(actionTestInputs(after, action)),
      );
    }
  });

  test("changing a limit moves them again — a suite is written against one number", () => {
    expect(actionTestInputDigest(actionTestInputs(boundedSpec(240), "create"))).not.toBe(
      actionTestInputDigest(actionTestInputs(boundedSpec(120), "create")),
    );
  });

  test("the key is absent, not zero, on a field with no limit — history digests as it did", () => {
    const projection = actionTestInputs(boundedSpec(), "create").schema;
    expect(JSON.stringify(projection)).not.toContain("max_length");
  });

  test("the number reaches the prompt as its own key on the field it bounds", () => {
    const projection = actionTestInputs(boundedSpec(240), "create").schema;
    expect(projection).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "text", max_length: 240 })]),
    );
  });
});
