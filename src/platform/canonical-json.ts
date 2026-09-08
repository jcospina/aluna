// Canonical JSON ordering, used wherever a value has to hash, diff, or freeze the same way twice.
//
// The comparator is codepoint order, deliberately locale-independent. `localeCompare` follows the
// runtime's default ICU collation, so a Bun or ICU upgrade can reorder keys and move a hash that
// nothing else changed — which is the last thing a fingerprint or a frozen test file wants.

/** Codepoint order — deliberately locale-independent, unlike `localeCompare`. */
export function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Deep clone with object keys sorted. Arrays keep their order, so an ordered product fact still
 * diffs while a reordered object is recognised as the same value.
 */
export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, entry]) => [key, canonicalizeJson(entry)]),
  );
}
