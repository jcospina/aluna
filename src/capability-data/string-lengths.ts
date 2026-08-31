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

import { maxLengthsByField, type SpecField } from "../registry/index.ts";
import { MaxLengthExceededError } from "./internal.ts";

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
  const limits = maxLengthsByField({ schema: { fields: [...fields] } });
  const overrun: string[] = [];
  for (const [name, limit] of limits) {
    const value = values[name];
    if (typeof value === "string" && value.length > limit) overrun.push(name);
  }
  if (overrun.length > 0) {
    throw new MaxLengthExceededError(capabilityId, overrun, action);
  }
}
