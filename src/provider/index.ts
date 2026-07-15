// The pluggable AI provider — Module 1, Epic 1.5 (ARCH §4, ADR-0003).
//
// The single public entry point for the provider subsystem. The orchestrator
// (later modules) imports the contract and the `createProvider` factory from here
// and depends on nothing else — never on a specific SDK. Issue 02 adds the concrete
// provider (the AI SDK spine) behind this same surface; callers see only the
// contract, so the spine stays swappable.

export { abortableProvider, ProviderAbortedError } from "./abort.ts";
export {
  API_KEY_ENV_VAR,
  BASE_URL_ENV_VAR,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODEL_ENV_VAR,
  type ProviderConfig,
  requireApiKey,
  resolveBaseURL,
  resolveModel,
  resolveProviderConfig,
} from "./config.ts";
export type { DeepPartial, GenerateResult, Provider, TokenUsage } from "./contract.ts";
export { createProvider } from "./spine.ts";
