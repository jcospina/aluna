/**
 * The rewrites one start tag can take before its whole start tag goes instead. lol-html rescans
 * the tag for every removal or change, so a tag carrying thousands of them cost quadratic time.
 */
export const MAX_ATTRIBUTE_REWRITES = 64;

/** What a sanitizer keeps of one attribute: its value, a replacement, or `null` to remove it. */
export type AttributeVerdict = (lower: string, value: string) => string | null;

/** The part of a lol-html element an attribute rewrite touches. */
export interface AttributeHost {
  readonly attributes: Iterable<[string, string]>;
  removeAttribute(name: string): unknown;
  setAttribute(name: string, value: string): unknown;
}

/**
 * Apply `verdict` to each attribute as a browser reads it — the first copy of a repeated name —
 * and return how many it removed. lol-html's `removeAttribute` deletes the first copy, so a
 * repeated name is removed whole and restated once, or a hostile second copy would go live.
 * Returns `undefined`, having changed nothing, when that takes more than
 * {@link MAX_ATTRIBUTE_REWRITES} rewrites: the caller then drops the start tag in one step.
 */
export function rewriteAttributes(
  element: AttributeHost,
  verdict: AttributeVerdict,
): number | undefined {
  const first = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const [name, value] of element.attributes) {
    const lower = name.toLowerCase();
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
    if (!first.has(lower)) first.set(lower, value);
  }
  const plan = [...first].map(([lower, value]): Step => {
    const kept = verdict(lower, value);
    return { lower, kept, copies: counts.get(lower) ?? 1, changed: kept !== value };
  });
  const rewrites = plan.reduce(
    (sum, step) => sum + (step.copies > 1 ? step.copies + 1 : Number(step.changed)),
    0,
  );
  if (rewrites > MAX_ATTRIBUTE_REWRITES) return undefined;
  for (const step of plan) applyVerdict(element, step);
  return plan.filter((step) => step.kept === null).length;
}

interface Step {
  readonly lower: string;
  readonly kept: string | null;
  readonly copies: number;
  readonly changed: boolean;
}

function applyVerdict(element: AttributeHost, { lower, kept, copies, changed }: Step): void {
  if (copies > 1) {
    for (let i = 0; i < copies; i += 1) element.removeAttribute(lower);
    if (kept !== null) element.setAttribute(lower, kept);
  } else if (kept === null) {
    element.removeAttribute(lower);
  } else if (changed) {
    element.setAttribute(lower, kept);
  }
}
