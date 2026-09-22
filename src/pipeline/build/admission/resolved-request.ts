// The content carried from prompt resolution into mutation admission.
//
// Independent of SSE and the prompt route: it is the whole of what the core Builder needs, so
// any loop that can produce one can drive a build. The implicit loop hands over a confirmed
// proposal in exactly this shape, already classified and never reclassified on the way in.
//
// Every request carries two bindings the coordinator revalidates at the head of the build lease:
// a target expectation — `expected_absent` for a new semantic id, or the exact
// `{ capability_id, incarnation_id, expected_version }` of the capability being evolved — and the
// catalog fingerprint of the one active registry view the resolver classified against.
//
// Either one failing to match is a stale refusal, never rebased onto a newer catalog: a
// classification made against a registry that no longer exists is about a world that is gone.

import type { CarriedResolverMeasurement } from "../../../platform/metrics/index.ts";
import type { TokenUsage } from "../../../platform/provider/index.ts";
import type { CapabilityRegistryExpectation } from "../../../registry/index.ts";
import type { IntentClassification } from "../../intent/index.ts";

interface ResolvedBuildRequestBase {
  readonly prompt: string;
  /** The revision the resolver classified against — decision 28's canonical fingerprint. */
  readonly catalogFingerprint: string;
  readonly resolver: CarriedResolverMeasurement & { readonly usage: TokenUsage };
}

export interface ResolvedNewCapabilityRequest extends ResolvedBuildRequestBase {
  readonly kind: "new_capability";
  readonly intent: IntentClassification & { readonly type: "new_capability" };
  readonly targetExpectation: Extract<CapabilityRegistryExpectation, { readonly state: "absent" }>;
  /**
   * The semantic id the expected-absence is asserted over, when a `namespace` overlap named one.
   * Null when the Builder still authors the id; the Builder checks it once the spec names it.
   */
  readonly expectedAbsentCapabilityId: string | null;
}

export interface ResolvedExistingCapabilityRequest extends ResolvedBuildRequestBase {
  readonly kind: "existing_capability";
  readonly intent: IntentClassification & {
    readonly type: "extend_capability" | "ui_change";
  };
  readonly targetExpectation: Extract<CapabilityRegistryExpectation, { readonly state: "active" }>;
}

export type ResolvedBuildRequest = ResolvedNewCapabilityRequest | ResolvedExistingCapabilityRequest;

// Kept reachable under its old name: what a prompt's resolution is remembered as lives above the
// build tree now, because three of its four readers build nothing.
export type { PromptResolutionMemory, PromptResolutionOutcome } from "../../resolution.ts";

export function resolvedNewCapabilityRequest(input: {
  readonly prompt: string;
  readonly intent: IntentClassification & { readonly type: "new_capability" };
  readonly catalogFingerprint: string;
  readonly resolver: CarriedResolverMeasurement & { readonly usage: TokenUsage };
}): ResolvedNewCapabilityRequest {
  return Object.freeze({
    kind: "new_capability",
    prompt: input.prompt,
    intent: input.intent,
    targetExpectation: Object.freeze({ state: "absent" }),
    expectedAbsentCapabilityId: input.intent.proposed_identity?.id ?? null,
    catalogFingerprint: input.catalogFingerprint,
    resolver: input.resolver,
  });
}

export function resolvedExistingCapabilityRequest(input: {
  readonly prompt: string;
  readonly intent: IntentClassification & {
    readonly type: "extend_capability" | "ui_change";
  };
  readonly target: {
    readonly capabilityId: string;
    readonly incarnationId: string;
    readonly version: number;
  };
  readonly catalogFingerprint: string;
  readonly resolver: CarriedResolverMeasurement & { readonly usage: TokenUsage };
}): ResolvedExistingCapabilityRequest {
  return Object.freeze({
    kind: "existing_capability",
    prompt: input.prompt,
    intent: input.intent,
    targetExpectation: Object.freeze({
      state: "active",
      capabilityId: input.target.capabilityId,
      incarnationId: input.target.incarnationId,
      version: input.target.version,
    }),
    catalogFingerprint: input.catalogFingerprint,
    resolver: input.resolver,
  });
}
