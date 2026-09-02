// The process secret vault: provider credentials, read once at boot and then removed
// from `process.env`.
//
// ADR-0004 accepts that generated Handlers run without a process sandbox, and the static
// source-safety checks are what stand in for one. Those checks are a deny-list over
// *identifiers*, and a deny-list over identifiers cannot see a property access —
// `({}).constructor.constructor` reaches the Function constructor while naming nothing
// banned, and from there `process.env` is one expression away.
//
// So the ambient reference is made worthless rather than unreachable. The two credentials
// are lifted into this closure at boot and deleted from the environment, so code that does
// walk its way to `process.env` finds no key there. Nothing else changes: the callers that
// already took `env` as a parameter still do, and an explicitly supplied environment is
// still answered from itself, which is what keeps every test honest.
//
// This is containment, not a sandbox. It bounds the *value* of an escape rather than
// preventing one; the escape itself stays what ADR-0004 says it is.

/** The credentials lifted out of the environment. Their names stay public; their values do not. */
export const VAULTED_SECRET_ENV_VARS = ["OMNI_API_KEY", "RECRAFT_API_KEY"] as const;

const vault = new Map<string, string>();

/**
 * Move every vaulted credential from `env` into this module and delete it from `env`.
 * Idempotent, and safe to call when a variable is unset — an absent key stays absent, and
 * a later call cannot un-vault what an earlier one captured.
 *
 * Called once from the platform entrypoint, before the server accepts traffic.
 */
export function captureProcessSecrets(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of VAULTED_SECRET_ENV_VARS) {
    const value = env[name]?.trim();
    if (value) vault.set(name, value);
    delete env[name];
  }
}

/**
 * Read a credential the way its caller's `env` argument asks for.
 *
 * An explicitly supplied environment answers from itself alone: a test handing in
 * `{}` means "this variable is not set" and must still see that, whatever the real process
 * holds. Only the ambient environment — the default every production caller takes — falls
 * through to the vault, because that is the one the boot capture emptied.
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
