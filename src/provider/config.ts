// Provider configuration — Module 1, Epic 1.5 (ARCH §4 "Model strategy", ADR-0003).
//
// Two settings, both deliberately tiny: the BYO API key (read from the
// environment) and the single, globally configured model. There is no per-task
// routing and no per-call model selection — "compare models = run the demo twice"
// (ARCH §4), which a one-line swap here (or one env var) makes literal.
//
// The functions take `env` as a parameter (defaulting to the real process env) so
// they are pure and testable without mutating global state.

// The configured global model, in exactly one place. The demo runs against a
// single Claude model by default (ARCH §4 names "Claude Opus (fast mode)"); the
// model id is `claude-opus-4-8`. Note: "fast mode" is a serving/latency concern
// tuned at the provider call (issue 02), not a separate model id — the API model
// string is the bare `claude-opus-4-8`.
//
// Which model ships as the default is deliberately open (ADR-0003: "an empirical
// call for the experiment, not an architecture decision"); this constant is the
// one line to change, or override `OMNI_MODEL` at runtime, to swap it across
// Claude, GPT, Gemini, or the open Chinese coding models — all reachable through
// the Anthropic-/OpenAI-compatible wire shapes the spine targets (ADR-0003).
export const DEFAULT_MODEL = "claude-opus-4-8";

// The environment variable that overrides the default global model. A single
// config change — no code edit — to run the demo against a different model.
export const MODEL_ENV_VAR = "OMNI_MODEL";

// The BYO key lives here under a provider-neutral name. Provider-agnosticism is
// the thesis (ADR-0003): you move providers by swapping the whole trio — the
// model (OMNI_MODEL), the endpoint (OMNI_BASE_URL, wired in issue 02), and this
// key — so the key var must not imply one vendor (the value may be an OpenAI,
// Anthropic, or any compatible provider's key). The key is passed explicitly to
// the spine (createAnthropic / createOpenAICompatible, issue 02), so it need not
// match any SDK's own default variable.
export const API_KEY_ENV_VAR = "OMNI_API_KEY";

// The resolved provider configuration the spine (issue 02) consumes: the BYO key
// and the single global model, together.
export interface ProviderConfig {
  readonly apiKey: string;
  readonly model: string;
}

// Resolve the single global model: the OMNI_MODEL override if set and non-empty,
// otherwise the configured default. Reading at call time (rather than freezing at
// import) keeps it overridable per run and trivially testable.
export function resolveModel(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[MODEL_ENV_VAR]?.trim();
  return override && override.length > 0 ? override : DEFAULT_MODEL;
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

// The single entry point for the spine (issue 02): both settings resolved at once.
// Throws (via requireApiKey) when the key is absent.
export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return { apiKey: requireApiKey(env), model: resolveModel(env) };
}
