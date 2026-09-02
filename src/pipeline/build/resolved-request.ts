// The content carried from prompt resolution into mutation admission.
//
// This is deliberately independent of SSE and the prompt route: it is the whole of what
// the core Builder needs, so any loop that can produce one can drive a build. The implicit
// loop hands over a confirmed proposal in exactly
// this shape, already classified, and is never reclassified on the way in.
//
// Every request carries two bindings that the coordinator revalidates at the head of the
// build lease:
//
//   - a **target expectation** — `expected_absent` for a new semantic id, or the exact
//     `{ capability_id, incarnation_id, expected_version }` of the capability being evolved;
//   - the **catalog fingerprint** of the one active registry view the resolver classified
//     against.
//
// Either one failing to match is a stale refusal. Neither is ever rebased onto a newer
// catalog, because a classification made against a registry that no longer exists is a
// classification about a world that is gone.

import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { CarriedResolverMeasurement } from "../../platform/metrics/index.ts";
import type { TokenUsage } from "../../platform/provider/index.ts";
import type { CapabilityRegistryExpectation } from "../../registry/index.ts";

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
   * The semantic id the expected-absence is asserted over, when the resolver named one
   * (a `namespace` overlap proposing a separate capability). Null when the id is
   * still the Builder's to author, where absence is only provable at the activation CAS.
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

export type PromptResolutionOutcome = "build" | "non_build";

export interface PromptResolutionMemory {
  readonly intent: IntentClassification;
  readonly outcome: PromptResolutionOutcome;
  readonly catalogFingerprint: string;
  readonly resolver: CarriedResolverMeasurement;
  readonly buildRequest?: ResolvedBuildRequest;
}

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
