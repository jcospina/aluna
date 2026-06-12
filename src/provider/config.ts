// Provider configuration — Module 1, Epic 1.5 (ARCH §4 "Model strategy", ADR-0003).
//
// The resolved trio the spine swaps providers by (ADR-0003): the BYO API key, the
// single globally configured model, and the endpoint (baseURL). All three come
// from the environment, all deliberately tiny: there is no per-task routing and no
// per-call model selection — "compare models = run the demo twice" (ARCH §4),
// which a one-env swap of this trio makes literal. The baseURL is the registry key
// the spine uses to pick the wire shape (Anthropic Messages vs OpenAI-compatible).
//
// The functions take `env` as a parameter (defaulting to the real process env) so
// they are pure and testable without mutating global state.

// The configured global model, in exactly one place. The demo ships against a
// single model by default; the default is `gpt-5` (OpenAI), with "fast mode" — the
// platform the project currently has credits/key for. Note: "fast mode" is a
// serving/latency concern tuned at the provider call (the spine sets reasoning
// effort `minimal` for the OpenAI wire, issue 02), not a separate model id — the
// API model string is the bare `gpt-5`.
//
// Which model ships as the default is deliberately open (ADR-0003: "an empirical
// call for the experiment, not an architecture decision"); this constant is the
// one line to change, or override `OMNI_MODEL` at runtime, to swap it across GPT,
// Claude, Gemini, or the open Chinese coding models — all reachable through the
// OpenAI-/Anthropic-compatible wire shapes the spine targets (ADR-0003). Swapping
// model usually means swapping the endpoint too: change `OMNI_MODEL` *and*
// `OMNI_BASE_URL` together (e.g. to a `claude-*` id at the Anthropic endpoint).
export const DEFAULT_MODEL = "gpt-5";

// The environment variable that overrides the default global model. A single
// config change — no code edit — to run the demo against a different model.
export const MODEL_ENV_VAR = "OMNI_MODEL";

// The default endpoint, paired with the default model: OpenAI's API base. The spine
// reads the wire shape off this URL (ADR-0003: "a provider registry keyed by
// baseURL") — OpenAI's own host selects the first-party OpenAI wire, an Anthropic
// host the Anthropic Messages wire, and any other host the generic OpenAI-compatible
// wire. Override with `OMNI_BASE_URL` to point at any OpenAI-/Anthropic-compatible
// endpoint (the open Chinese coding models all expose one, and reach the compatible
// wire), which is how a provider swap stays a config change, not a code edit.
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

// The environment variable that overrides the default endpoint. The third leg of
// the swap trio (key + model + endpoint).
export const BASE_URL_ENV_VAR = "OMNI_BASE_URL";

// The BYO key lives here under a provider-neutral name. Provider-agnosticism is
// the thesis (ADR-0003): you move providers by swapping the whole trio — the
// model (OMNI_MODEL), the endpoint (OMNI_BASE_URL, wired in issue 02), and this
// key — so the key var must not imply one vendor (the value may be an OpenAI,
// Anthropic, or any compatible provider's key). The key is passed explicitly to
// the spine (createAnthropic / createOpenAICompatible, issue 02), so it need not
// match any SDK's own default variable.
export const API_KEY_ENV_VAR = "OMNI_API_KEY";

// The resolved provider configuration the spine (issue 02) consumes: the BYO key,
// the single global model, and the endpoint the spine keys the wire shape off.
export interface ProviderConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseURL: string;
}

// Resolve the single global model: the OMNI_MODEL override if set and non-empty,
// otherwise the configured default. Reading at call time (rather than freezing at
// import) keeps it overridable per run and trivially testable.
export function resolveModel(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[MODEL_ENV_VAR]?.trim();
  return override && override.length > 0 ? override : DEFAULT_MODEL;
}

// Resolve the endpoint the same way: OMNI_BASE_URL override if set and non-empty,
// otherwise the configured default. The spine reads the wire shape off this URL,
// so it is the third leg of the provider swap (key + model + endpoint).
export function resolveBaseURL(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[BASE_URL_ENV_VAR]?.trim();
  return override && override.length > 0 ? override : DEFAULT_BASE_URL;
}

// Read the BYO key from the environment, failing loudly when it is missing. The
// error names the variable and how to fix it — a missing key must surface clearly,
// never as a confusing downstream failure (issue 02 acceptance).
export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env[API_KEY_ENV_VAR]?.trim();
  if (!key) {
    throw new Error(
      `Missing ${API_KEY_ENV_VAR}. The AI provider is bring-your-own-key: set ` +
        `${API_KEY_ENV_VAR} in the environment to your provider API key.`,
    );
  }
  return key;
}

// The single entry point for the spine (issue 02): the whole trio resolved at
// once. Throws (via requireApiKey) when the key is absent.
export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return { apiKey: requireApiKey(env), model: resolveModel(env), baseURL: resolveBaseURL(env) };
}
