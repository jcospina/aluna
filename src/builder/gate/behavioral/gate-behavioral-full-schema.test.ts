import { describe, expect, test } from "bun:test";

import { BEHAVIORAL_ERROR_MARKERS, capabilitySpecSchema } from "../../../registry/index.ts";
import { fullBehavioralSuiteFor, notesSpec } from "../gate.test-support.ts";
import { assertActionSuiteContract } from "./gate-behavioral-full-contract.ts";
import {
  actionBehavioralTestSuiteSchema,
  MAX_BEHAVIORAL_CASES_PER_ACTION,
} from "./gate-behavioral-full-schema.ts";

describe("per-Action behavioral suite capacity", () => {
  test("represents eight authored errors plus normal and record-not-found coverage", () => {
    const spec = capabilitySpecSchema.parse(
      notesSpec({
        schema: {
          fields: [
            {
              name: "text",
              label: "Text",
              type: "string",
              required: false,
              lifecycle: "active",
            },
          ],
        },
        behavioral_errors: Array.from({ length: 8 }, (_, index) => ({
          action: "update" as const,
          trigger: `rule_${index}`,
          code: `error_${index}`,
          fields: ["text"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        })),
      }),
    );
    const suite = fullBehavioralSuiteFor(spec, {
      createValues: { text: "Created" },
      updateValues: { text: "Updated" },
      readValues: { text: "Read" },
      searchMatchValues: { text: "Matching newest" },
      searchOlderMatchValues: { text: "Matching older" },
      searchMissValues: { text: "Other" },
      markerField: "text",
      searchQuery: "matching",
    });
    const cases = suite.cases.filter((testCase) => testCase.action === "update");

    expect(cases).toHaveLength(MAX_BEHAVIORAL_CASES_PER_ACTION);
    expect(() => actionBehavioralTestSuiteSchema.parse({ cases })).not.toThrow();
    expect(() => assertActionSuiteContract(spec, "update", cases)).not.toThrow();
    expect(actionBehavioralTestSuiteSchema.safeParse({ cases: [...cases, cases[0]] }).success).toBe(
      false,
    );
  });
});
