import { describe, expect, test } from "bun:test";

import { type UnitGenerationAttempt, UnitGenerationError } from "../builder/index.ts";
import { buildDemoErrorPreview } from "./previews.ts";

describe("build developer error preview", () => {
  test("preserves the unit and every strict-TypeScript attempt after generation exhausts", () => {
    const attempts: UnitGenerationAttempt[] = [1, 2].map((attempt) => ({
      attempt,
      durationMs: attempt,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      error: `/tmp/unit.ts:94:39 - 'candidate.fields' is of type 'unknown'.`,
    }));
    const error = new UnitGenerationError({ kind: "handler", name: "update" }, attempts);

    expect(buildDemoErrorPreview(error)).toEqual({
      kind: "build-error-preview",
      status: "failed",
      errorName: "UnitGenerationError",
      message: expect.stringContaining("'candidate.fields' is of type 'unknown'"),
      diagnostic: {
        unit: { kind: "handler", name: "update" },
        attempts,
      },
    });
  });
});
