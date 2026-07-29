export function normalizeGateAttempts(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} maxAttempts must be a positive integer.`);
  }
  return value;
}
