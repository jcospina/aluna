// Intent Resolver (ARCH 6.2).
//
// Public surface for intent classification: prompt + registry context
// through the provider contract, returning the full intent language even though
// only `new_capability` is acted on so far.

export {
  buildIntentPrompt,
  type ClassifyIntentInput,
  classifyIntent,
  type IntentPromptContext,
} from "./resolver.ts";
export {
  INTENT_TYPES,
  type IntentClassification,
  type IntentType,
  intentClassificationSchema,
  intentTypeSchema,
} from "./schema.ts";
