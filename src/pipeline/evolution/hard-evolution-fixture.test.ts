// The frozen-repair battery's forced-failure fixture. Test support, and tested anyway: it
// is what makes bounded repair deterministic, and a fixture that silently stopped
// forcing a failure would look exactly like a Gate that stopped repairing.

import { describe, expect, test } from "bun:test";
import { notesSpec } from "../../builder/gate/gate.test-support.ts";
import { checkGeneratedUnit } from "../../builder/units/unit-checks.ts";
import { defaultBehavioralErrorsForSchema } from "../../registry/index.ts";
import { hardEvolutionHandlerFixture } from "./hard-evolution-fixture.test-support.ts";

describe("the forced first-pass Handler", () => {
  test("replaces update only — never a test, never another unit", () => {
    const spec = notesSpec();
    expect(hardEvolutionHandlerFixture(spec, "update")).toContain("mutation.update");
    for (const unit of ["create", "read", "delete", "search", "item"] as const) {
      expect(hardEvolutionHandlerFixture(spec, unit)).toBeUndefined();
    }
  });

  test("is a structurally valid Handler that simply validates nothing", () => {
    const spec = notesSpec();
    const content = hardEvolutionHandlerFixture(spec, "update");
    if (!content) throw new Error("expected forced update bytes");

    // It must clear the same static contract any generated Handler clears: the failure it
    // creates has to reach the *behavioral* rung, not be caught as malformed a rung earlier.
    expect(checkGeneratedUnit(spec, { kind: "handler", name: "update" }, content)).toBeUndefined();
    // And the one thing it gets wrong is the one the frozen suite is about to catch.
    expect(content).not.toContain("missing_required_fields");
    expect(content).toContain('if ("text" in input.values) patch.text = input.values.text;');
  });

  test("does not replace healthy bytes when the spec has no required-field failure to catch", () => {
    const spec = notesSpec({
      schema: {
        fields: notesSpec().schema.fields.map((field) => ({ ...field, required: false })),
      },
    });
    spec.behavioral_errors = defaultBehavioralErrorsForSchema(spec.schema);

    expect(hardEvolutionHandlerFixture(spec, "update")).toBeUndefined();
  });
});
