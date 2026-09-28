/**
 * Where published capability snapshots live. A leaf, because `artifact-lifecycle.ts` pulls the
 * whole builder — and the TypeScript compiler with it — behind this one string.
 */
export const DEFAULT_ARTIFACTS_ROOT = "capabilities";

export const ARTIFACTS_ROOT_ENV_VAR = "OMNI_ARTIFACTS_ROOT";

/** The configured root, a relative one read from the working directory; `capabilities` when unset. */
export function resolveArtifactsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env[ARTIFACTS_ROOT_ENV_VAR]?.trim() || DEFAULT_ARTIFACTS_ROOT;
}
