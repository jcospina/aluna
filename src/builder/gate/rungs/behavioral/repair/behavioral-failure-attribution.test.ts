// Runtime failure attribution.
//
// The whole rule, pinned as a table: which Handlers a failing frozen case licenses repair
// to rewrite, and on what grounds. Kept separate from the rung's own suite because it is a
// pure decision over four surfaces and one impact statement, and a decision that decides
// who gets rewritten deserves to be readable on its own.

import { describe, expect, test } from "bun:test";

import type { CapabilitySpec } from "../../../../../registry/index.ts";
import { notesSpec } from "../../../gate.test-support.ts";
import type { BehavioralExecutionImpact } from "../freeze/behavioral-execution-plan.ts";
import {
  attributeBehavioralFailure,
  BEHAVIORAL_ATTRIBUTION_REASONS,
  BEHAVIORAL_FAILURE_SURFACES,
  declaredHandlerSet,
} from "./behavioral-failure-attribution.ts";

const ALL_FIVE = ["create", "read", "update", "delete", "search"] as const;
const RENDERER_UNMOVED: BehavioralExecutionImpact = {
  regeneratedHandlers: ["create"],
  regeneratedItemRenderer: false,
};
const RENDERER_MOVED: BehavioralExecutionImpact = {
  regeneratedHandlers: ["create"],
  regeneratedItemRenderer: true,
};

function attribute(
  surface: (typeof BEHAVIORAL_FAILURE_SURFACES)[number],
  impact?: BehavioralExecutionImpact,
  spec: CapabilitySpec = notesSpec(),
) {
  return attributeBehavioralFailure({
    surface,
    action: "create",
    ...(impact ? { impact } : {}),
    declaredHandlers: declaredHandlerSet(spec),
  });
}

describe("behavioral failure attribution", () => {
  test("the conservative set is every Action the capability declares", () => {
    expect(declaredHandlerSet(notesSpec())).toEqual([...ALL_FIVE]);
    expect(declaredHandlerSet(notesSpec({ tools: ["create", "read", "update"] }))).toEqual([
      "create",
      "read",
      "update",
    ]);
  });

  test("a failure before any Handler ran repairs nothing at all", () => {
    // The platform seeded the scratch rows. Blaming a Handler for that would rewrite an
    // innocent unit, so the only honest answer is to fail the Gate closed.
    expect(attribute("setup", RENDERER_UNMOVED)).toEqual({
      total: false,
      reason: "no_handler_executed",
      handlers: [],
    });
    expect(attribute("setup")).toMatchObject({ handlers: [] });
  });

  test("a Handler-call or row-state failure is total: exactly the invoked Handler", () => {
    for (const surface of ["handler_invocation", "row_state"] as const) {
      for (const impact of [RENDERER_UNMOVED, RENDERER_MOVED, undefined]) {
        expect(attribute(surface, impact)).toEqual({
          total: true,
          reason: "single_handler_execution",
          handlers: ["create"],
        });
      }
    }
  });

  test("a fragment failure stays total while the shared item renderer is proven unmoved", () => {
    expect(attribute("fragment", RENDERER_UNMOVED)).toEqual({
      total: true,
      reason: "single_handler_execution",
      handlers: ["create"],
    });
    // An impact that never mentions the renderer is a stated impact that did not move it.
    expect(attribute("fragment", { regeneratedHandlers: ["create"] })).toMatchObject({
      total: true,
    });
  });

  test("a fragment failure alongside a moved renderer takes the conservative set", () => {
    // Decision 22: attribution that cannot be narrowed *without weakening a frozen test*
    // widens the code being rewritten — it never narrows the test.
    expect(attribute("fragment", RENDERER_MOVED)).toEqual({
      total: false,
      reason: "fragment_with_regenerated_item_renderer",
      handlers: [...ALL_FIVE],
    });
  });

  test("a fragment failure with no impact statement takes the conservative set", () => {
    expect(attribute("fragment")).toEqual({
      total: false,
      reason: "fragment_with_unstated_impact",
      handlers: [...ALL_FIVE],
    });
  });

  test("total is exactly `handlers.length === 1`, and every reason is in the closed set", () => {
    for (const surface of BEHAVIORAL_FAILURE_SURFACES) {
      for (const impact of [RENDERER_UNMOVED, RENDERER_MOVED, undefined]) {
        const attribution = attribute(surface, impact);
        expect(BEHAVIORAL_ATTRIBUTION_REASONS).toContain(attribution.reason);
        expect(attribution.total).toBe(attribution.handlers.length === 1);
      }
    }
  });
});
