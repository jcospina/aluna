// The content carried from prompt resolution into mutation admission.
//
// This is deliberately independent of SSE and the prompt route. Issue 4.8/01 only
// admits new-capability builds; later 4.8 issues extend the same boundary with exact
// active-target expectations and a presenter-independent Builder.

import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { CarriedResolverMeasurement } from "../../metrics/index.ts";
import type { TokenUsage } from "../../provider/index.ts";
import type { CapabilityRegistryExpectation } from "../../registry/index.ts";

export interface ResolvedBuildRequest {
  readonly kind: "new_capability";
  readonly prompt: string;
  readonly intent: IntentClassification & { readonly type: "new_capability" };
  readonly targetExpectation: Extract<CapabilityRegistryExpectation, { readonly state: "absent" }>;
  readonly catalogFingerprint: string;
  readonly resolver: CarriedResolverMeasurement & { readonly usage: TokenUsage };
}

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
}): ResolvedBuildRequest {
  return Object.freeze({
    kind: "new_capability",
    prompt: input.prompt,
    intent: input.intent,
    targetExpectation: Object.freeze({ state: "absent" }),
    catalogFingerprint: input.catalogFingerprint,
    resolver: input.resolver,
  });
}
