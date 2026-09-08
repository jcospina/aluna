/**
 * One repair budget, read the same way wherever a stage takes one. The fallback is a parameter
 * rather than an import, so this module stays a leaf and nothing it serves can cycle through it.
 * `label` names the stage in the refusal — the only thing the four call sites ever differed on.
 */
export function normalizeMaxAttempts(
  value: number | undefined,
  fallback: number,
  label?: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    const subject = label === undefined ? "maxAttempts" : `${label} maxAttempts`;
    throw new RangeError(`${subject} must be a positive integer.`);
  }
  return value;
}
