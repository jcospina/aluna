// What one prompt's resolution is remembered as, whichever way it went.
//
// Above the build tree because three of its four readers are not the build path: a deflection, a
// refusal and a question each leave this and build nothing. The build request it may carry is the
// build path's own shape, and is imported from there rather than restated here.

import type { CarriedResolverMeasurement } from "../platform/metrics/index.ts";
import type { ResolvedBuildRequest } from "./build/admission/resolved-request.ts";
import type { IntentClassification } from "./intent/index.ts";

export type PromptResolutionOutcome = "build" | "non_build";

export interface PromptResolutionMemory {
  readonly intent: IntentClassification;
  readonly outcome: PromptResolutionOutcome;
  readonly catalogFingerprint: string;
  readonly resolver: CarriedResolverMeasurement;
  readonly buildRequest?: ResolvedBuildRequest;
}
