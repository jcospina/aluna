// Intent Resolver (ARCH 6.2).
//
// Public surface for intent classification: prompt + registry context
// through the provider contract, returning the full intent language even though
// only `new_capability` is acted on so far.

export {
  buildIntentPrompt,
  type ClassifyIntentInput,
  type ClassifyIntentResult,
  classifyIntent,
  classifyIntentWithUsage,
  INTENT_RESOLUTION_NARRATION,
  INTENT_RESOLVER_PROMPT_PREFIX,
  type IntentPromptContext,
  type IntentResolverSend,
} from "./resolver.ts";
export {
  INTENT_TYPES,
  type IntentClassification,
  type IntentType,
  intentClassificationSchema,
  intentTypeSchema,
  OVERLAP_RESOLUTIONS,
  type OverlapResolution,
  overlapResolutionSchema,
} from "./schema.ts";
