// What a string field admits on the way in, when it declares a limit.
//
// One refusal, over the whole submission at once, so one answer names every field that
// overran — the shape the missing-required and choice refusals beside it already have. It
// is platform-owned and it runs before canonical state moves, so a generated Handler
// receives an already-admitted string and never re-implements the bound.
//
// Unlike the disabled-option refusal it takes no account of what the record already
// holds, and it needs none. A limit may only be added or lowered after a lease-held scan
// has proved no committed value exceeds it (`src/pipeline/evolution/length-scan.ts`), so
// no stored value can ever violate a live limit — an exemption for one would be an
// exemption for a case the platform refuses to create.
//
// A field that declares nothing is still bounded. `MAX_DECLARED_MAX_LENGTH` is the most a
// declaration may claim, so it is also the most the platform will store without one: a
// string field that named no limit, and every `string[]` — which may not name one at all —
// were the two shapes with no ceiling anywhere, and a single submission could carry as much
// text as the request body allowed. The declared bound is still the one the person sees and
// the browser stops at; this is only the floor under the ones nobody declared.

import {
  MAX_DECLARED_MAX_LENGTH,
  maxLengthsByField,
  type SpecField,
} from "../../../registry/index.ts";
import { MaxLengthExceededError } from "../internal.ts";

/**
 * Refuse the whole submission if any string field carries more than it declared room for.
 *
 * Length is the UTF-16 code-unit count, which is what the native `maxlength` attribute
 * counts. The number the browser stops typing at is therefore exactly the number enforced
 * here, rather than a second reading of one declaration.
 */
export function assertAdmittedStringLengths(
  capabilityId: string,
  fields: readonly SpecField[],
  values: Readonly<Record<string, unknown>>,
  action: "create" | "update",
): void {
  const declared = maxLengthsByField({ schema: { fields: [...fields] } });
  const overrun: string[] = [];
  for (const field of fields) {
    const measured = measuredLength(values[field.name]);
    if (measured === undefined) continue;
    if (measured > (declared.get(field.name) ?? MAX_DECLARED_MAX_LENGTH)) overrun.push(field.name);
  }
  if (overrun.length > 0) {
    throw new MaxLengthExceededError(capabilityId, overrun, action);
  }
}

/**
 * How much text one submitted value carries, or `undefined` when it carries none.
 *
 * A `string[]` is measured as the sum of its elements, which is one number for two bounds
 * that would otherwise both be missing: how long an element may be, and how many of them
 * there may be. `max_length` is *refused* on a list field — one number could not say which
 * of the two it meant — so before this a list had no bound at all in either direction, and
 * a submission could carry as many megabytes as the request body allowed.
 */
function measuredLength(value: unknown): number | undefined {
  if (typeof value === "string") return value.length;
  if (!Array.isArray(value)) return undefined;
  let total = 0;
  for (const element of value) {
    if (typeof element === "string") total += element.length;
  }
  return total;
}
