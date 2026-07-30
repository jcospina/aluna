import { expect, test } from "bun:test";
import { resolvedNewCapabilityRequest } from "./resolved-request.ts";

test("a resolved build request binds target expectation, catalog fingerprint, and resolver data", () => {
  const catalogFingerprint = `sha256:${"c".repeat(64)}`;
  const request = resolvedNewCapabilityRequest({
    prompt: "track my notes",
    intent: {
      type: "new_capability",
      confidence: 0.97,
      target_capability: null,
      resolution: "new",
      proposed_identity: null,
      proposed_action: "Create a notes capability.",
      user_facing_label: "Got it. I'm putting that together now.",
      requires_confirmation: false,
    },
    catalogFingerprint,
    resolver: {
      intent: { type: "new_capability", confidence: 0.97, targetCapability: null },
      model: "gpt-5",
      durationMs: 15,
      usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
      catalogFingerprint,
    },
  });

  expect(request).toMatchObject({
    kind: "new_capability",
    targetExpectation: { state: "absent" },
    catalogFingerprint,
    resolver: { durationMs: 15, catalogFingerprint },
  });
  expect(Object.isFrozen(request)).toBe(true);
  expect(Object.isFrozen(request.targetExpectation)).toBe(true);
});
