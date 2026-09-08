// Provider configuration (ARCH §4 "Model strategy", ADR-0003).
//
// The resolved trio the spine swaps providers by: the BYO API key, the
// single globally configured model, and the endpoint (baseURL). All three come
// from the environment, all deliberately tiny: there is no per-task routing and no
// per-call model selection — "compare models = run the demo twice",
// which a one-env swap of this trio makes literal. The baseURL is the registry key
// the spine uses to pick the wire shape (Anthropic Messages vs OpenAI-compatible).
//
// The functions take `env` as a parameter (defaulting to the real process env) so
// they are pure and testable without mutating global state.

import { API_KEY_ENV_VAR, readSecret } from "../secrets.ts";

/**
 * The configured global model, in exactly one place (ADR-0003 calls the choice empirical). The
 * effort knob is tuned at the provider call, so this string is bare; swap `OMNI_BASE_URL` with it.
 */
export const DEFAULT_MODEL = "gpt-5.6-terra";

/**
 * The environment variable that overrides the default global model. A single
 * config change — no code edit — to run the demo against a different model.
 */
export const MODEL_ENV_VAR = "OMNI_MODEL";

/**
 * The default endpoint, paired with the default model. The spine reads the wire shape off this URL
 * (ADR-0003, "a provider registry keyed by baseURL"), so a provider swap stays a config change.
 */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * The environment variable that overrides the default endpoint. The third leg of
 * the swap trio (key + model + endpoint).
 */
export const BASE_URL_ENV_VAR = "OMNI_BASE_URL";

export { API_KEY_ENV_VAR } from "../secrets.ts";

/**
 * The resolved provider configuration the spine (issue 02) consumes: the BYO key,
 * the single global model, and the endpoint the spine keys the wire shape off.
 */
export interface ProviderConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseURL: string;
}

/**
 * The OMNI_MODEL override if set and non-empty, otherwise the default. Read at call time rather
 * than frozen at import, so a single run can override it.
 */
export function resolveModel(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[MODEL_ENV_VAR]?.trim();
  return override && override.length > 0 ? override : DEFAULT_MODEL;
}

/**
 * The OMNI_BASE_URL override if set and non-empty, otherwise the default. The spine reads the wire
 * shape off this URL, the third leg of the swap (key + model + endpoint).
 */
export function resolveBaseURL(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[BASE_URL_ENV_VAR]?.trim();
  return override && override.length > 0 ? override : DEFAULT_BASE_URL;
}

/**
 * Read the BYO key, failing loudly when it is missing: the error names the variable and the fix,
 * rather than surfacing as a confusing downstream failure.
 */
export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  // Read through the vault: the ambient environment no longer holds this key after boot
  // (src/platform/secrets.ts). An explicitly supplied `env` is still answered from itself.
  const key = readSecret(API_KEY_ENV_VAR, env);
  if (!key) {
    throw new Error(
      `Missing ${API_KEY_ENV_VAR}. The AI provider is bring-your-own-key: set ` +
        `${API_KEY_ENV_VAR} in the environment to your provider API key.`,
    );
  }
  return key;
}

/**
 * The single entry point for the spine (issue 02): the whole trio resolved at
 * once. Throws (via requireApiKey) when the key is absent.
 */
export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return { apiKey: requireApiKey(env), model: resolveModel(env), baseURL: resolveBaseURL(env) };
}
