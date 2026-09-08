/**
 * Where published capability snapshots live. A leaf, because `artifact-lifecycle.ts` pulls the
 * whole builder — and the TypeScript compiler with it — behind this one string.
 */
export const DEFAULT_ARTIFACTS_ROOT = "capabilities";
