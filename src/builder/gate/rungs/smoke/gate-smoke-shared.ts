// What both smoke files check, in the shape the behavioral rung's `gate-behavioral-shared.ts`
// already gave that rung. The three assertions below were written out in each file.

import type { CapabilityInput } from "../../../../runtime/router/contract.ts";

export function assertIdsEqual(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

/**
 * Every presented fragment reached the answer, in the order the Handler was handed them. `label`
 * names the Action in the refusal — the only thing the two copies of this differed on.
 */
export function assertPresentedFragmentsReturned(
  label: string,
  fragment: string,
  presented: readonly string[],
): void {
  let cursor = 0;
  for (const item of presented) {
    const index = fragment.indexOf(item, cursor);
    if (index < 0) {
      throw new Error(`${label} Handler discarded or reordered a presented record fragment`);
    }
    cursor = index + item.length;
  }
}

export function emptyInput(): CapabilityInput {
  return { values: {}, submittedFields: new Set() };
}
