// The process secret vault: provider credentials, read once at boot and then removed from
// `process.env`.
//
// ADR-0004 accepts that generated Handlers run without a process sandbox, and the static
// source-safety checks stand in for one. Those checks are a deny-list over identifiers, and a
// deny-list cannot see a property access — `({}).constructor.constructor` reaches the Function
// constructor while naming nothing banned, and `process.env` is one expression away from there.
//
// So the two credentials are lifted into this closure at boot and deleted from the environment,
// and code that does walk its way to `process.env` finds no key. This bounds the value of an
// escape rather than preventing one.

/** The credentials lifted out of the environment. Their names stay public; their values do not. */
export const VAULTED_SECRET_ENV_VARS = ["OMNI_API_KEY", "RECRAFT_API_KEY"] as const;

const vault = new Map<string, string>();

/**
 * Move every vaulted credential from `env` into this module and delete it from `env`. An absent
 * key stays absent, and a later call cannot un-vault what an earlier one captured.
 */
export function captureProcessSecrets(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of VAULTED_SECRET_ENV_VARS) {
    const value = env[name]?.trim();
    if (value) vault.set(name, value);
    delete env[name];
  }
}

/**
 * An explicitly supplied environment answers from itself alone, so a test handing in `{}` still
 * sees "not set". Only the ambient environment falls through to the vault boot capture filled.
 */
export function readSecret(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const direct = env[name]?.trim();
  if (direct) return direct;
  return env === process.env ? vault.get(name) : undefined;
}

/** Test seam: forget everything captured, so a vault test cannot leak into its neighbours. */
export function clearProcessSecrets(): void {
  vault.clear();
}
