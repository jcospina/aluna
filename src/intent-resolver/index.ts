// Intent Resolver - Module 2, Epic 2.4 (ARCH 6.2, PLAN decision 6).
//
// Public surface for the classification-only slice: prompt + registry context
// through the provider contract, returning the full intent language even though
// Module 2 acts only on `new_capability`.

export {
  buildIntentPrompt,
  type ClassifyIntentInput,
  type ClassifyIntentResult,
  classifyIntent,
  classifyIntentWithUsage,
  INTENT_RESOLUTION_NARRATION,
  type IntentPromptContext,
  type IntentResolverSend,
} from "./resolver.ts";
export {
  INTENT_TYPES,
  type IntentClassification,
  type IntentType,
  intentClassificationSchema,
  intentTypeSchema,
} from "./schema.ts";
