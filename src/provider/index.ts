// The pluggable AI provider — Module 1, Epic 1.5 (ARCH §4, ADR-0003).
//
// The single public entry point for the provider subsystem. The orchestrator
// (later modules) imports the contract from here and depends on nothing else —
// never on a specific SDK. Issue 02 adds the concrete provider implementation
// behind this same surface.

export {
  API_KEY_ENV_VAR,
  DEFAULT_MODEL,
  MODEL_ENV_VAR,
  type ProviderConfig,
  requireApiKey,
  resolveModel,
  resolveProviderConfig,
} from "./config.ts";
export type { DeepPartial, GenerateResult, Provider } from "./contract.ts";
