// The pluggable AI provider (ARCH §4, ADR-0003).
//
// The single public entry point for the provider subsystem. The orchestrator
// imports the contract and the `createProvider` factory from here
// and depends on nothing else — never on a specific SDK. The concrete
// provider (the AI SDK spine) goes behind this same surface; callers see only the
// contract, so the spine stays swappable.

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
export type { DeepPartial, GenerateResult, Provider } from "./contract.ts";
export { createProvider } from "./spine.ts";
