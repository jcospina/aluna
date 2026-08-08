// Intent Resolver.
//
// Public surface for the classification-only call: prompt + registry context
// through the provider contract, returning the full intent language.

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
