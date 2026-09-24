// What a string field admits on the way in, when it declares a limit.
//
// One refusal over the whole submission, so one answer names every field that overran — the shape
// the missing-required and choice refusals beside it already have. Platform-owned, and it runs
// before canonical state moves, so a generated Handler receives an already-admitted string.
//
// Unlike the disabled-option refusal it takes no account of what the record already holds, and it
// needs none: a limit may only be added or lowered after a lease-held scan has proved no committed
// value exceeds it (`src/pipeline/evolution/assembly/length-scan.ts`).
//
// A field that declares nothing is still bounded. `MAX_DECLARED_MAX_LENGTH` is the most a
// declaration may claim, so it is also the most the platform stores without one: a string field
// that named no limit, and every `string[]`, were the two shapes with no ceiling anywhere.

import {
  isFileFieldType,
  MAX_DECLARED_MAX_LENGTH,
  maxLengthsByField,
  type SpecField,
} from "../../../registry/index.ts";
import { MaxLengthExceededError } from "../internal.ts";

/**
 * Refuse the whole submission if any string field carries more than it declared room for. Length
 * is the UTF-16 code-unit count, which is what the native `maxlength` attribute counts.
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
    // A reference is not text a person typed, so no length refusal may name it (`tool.ts`).
    if (isFileFieldType(field.type)) continue;
    const measured = measuredLength(values[field.name]);
    if (measured === undefined) continue;
    if (measured > (declared.get(field.name) ?? MAX_DECLARED_MAX_LENGTH)) overrun.push(field.name);
  }
  if (overrun.length > 0) {
    throw new MaxLengthExceededError(capabilityId, overrun, action);
  }
}

/**
 * How much text one submitted value carries, or `undefined` when it carries none. A `string[]` is
 * the sum of its elements: `max_length` is refused on a list, which left it with no bound at all.
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
