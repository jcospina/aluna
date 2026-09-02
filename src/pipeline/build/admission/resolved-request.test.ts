import { expect, test } from "bun:test";
import {
  resolvedExistingCapabilityRequest,
  resolvedNewCapabilityRequest,
} from "./resolved-request.ts";

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

test("a new-capability request over a resolver-proposed id carries that id as its expected absence", () => {
  const catalogFingerprint = `sha256:${"d".repeat(64)}`;
  const request = resolvedNewCapabilityRequest({
    prompt: "keep my work notes apart from the rest",
    intent: {
      type: "new_capability",
      confidence: 0.88,
      target_capability: "notes",
      // The overlap the resolver named a separate capability for.
      resolution: "namespace",
      proposed_identity: { id: "work-notes", label: "Work Notes" },
      proposed_action: "Create a separate Work Notes capability.",
      user_facing_label: "I'll keep those separate.",
      requires_confirmation: false,
    },
    catalogFingerprint,
    resolver: {
      intent: { type: "new_capability", confidence: 0.88, targetCapability: "notes" },
      model: "gpt-5",
      durationMs: 21,
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      catalogFingerprint,
    },
  });

  // The expected absence is asserted over a *named* id, so the lease head can prove it
  // rather than deferring to the activation CAS.
  expect(request.expectedAbsentCapabilityId).toBe("work-notes");
  expect(request.targetExpectation).toEqual({ state: "absent" });
});

test("an existing-capability request binds the exact incarnation and version it read", () => {
  const catalogFingerprint = `sha256:${"e".repeat(64)}`;
  const incarnationId = "33333333-3333-4333-8333-333333333333";
  const request = resolvedExistingCapabilityRequest({
    prompt: "add a due date to my notes",
    intent: {
      type: "extend_capability",
      confidence: 0.95,
      target_capability: "notes",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Add a due date to notes.",
      user_facing_label: "I'll add a due date.",
      requires_confirmation: false,
    },
    target: { capabilityId: "notes", incarnationId, version: 3 },
    catalogFingerprint,
    resolver: {
      intent: { type: "extend_capability", confidence: 0.95, targetCapability: "notes" },
      model: "gpt-5",
      durationMs: 18,
      usage: { inputTokens: 22, outputTokens: 6, totalTokens: 28 },
      catalogFingerprint,
    },
  });

  // All three coordinates travel together: an id alone would not survive a rebirth, and an
  // id plus incarnation would not survive somebody else's v4.
  expect(request).toMatchObject({
    kind: "existing_capability",
    targetExpectation: { state: "active", capabilityId: "notes", incarnationId, version: 3 },
    catalogFingerprint,
    resolver: { durationMs: 18 },
  });
  expect(Object.isFrozen(request)).toBe(true);
  expect(Object.isFrozen(request.targetExpectation)).toBe(true);
});
