/**
 * Collapse every repeated attribute to the copy a browser honours — the first — and return each
 * attribute once. lol-html's `removeAttribute` deletes the first copy, so judging a hostile second
 * copy on its own would delete the good one and leave the hostile one live.
 */
export function collapseRepeatedAttributes(
  element: HTMLRewriterTypes.Element,
): readonly (readonly [string, string])[] {
  const first = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const [name, value] of element.attributes) {
    const lower = name.toLowerCase();
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
    if (!first.has(lower)) first.set(lower, value);
  }
  for (const [lower, count] of counts) {
    if (count === 1) continue;
    // Each call removes one occurrence, so drop them all and restate the winner once.
    for (let i = 0; i < count; i += 1) element.removeAttribute(lower);
    element.setAttribute(lower, first.get(lower) ?? "");
  }
  return [...first];
}
