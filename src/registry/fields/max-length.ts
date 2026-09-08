// `max_length` — one declaration on a scalar string field, and the three things it drives.
//
// A limit is authored once and read in three places: the platform's own mutation validation,
// which refuses an over-limit submission before a generated Handler or any canonical state sees
// it; the native `maxlength` attribute, which stops the typing; and the character counter under
// the field. One declaration, so the number counted down to and the number the server enforces
// cannot drift apart (`design/controls.html`, "With a limit").
//
// It is structural, not behavioral: a generated Handler is given the already-admitted string and
// never re-implements the bound, which is the positive proof ADR-0006 wants before a unit is
// copied rather than rewritten.

import { z } from "zod";

import type { CapabilitySpec } from "../spec/spec.ts";

/**
 * The structural refusal an over-limit submission earns. Platform-owned: it is raised before
 * canonical state moves, so a capability authoring it would claim an error it never gets to see.
 */
export const MAX_LENGTH_EXCEEDED_ERROR_CODE = "max_length_exceeded";

/**
 * The largest limit a field may declare. Not a storage limit — SQLite `TEXT` is unbounded — but a
 * bound a person filling in a form can reach: a limit of a million is one nobody is stopped by.
 */
export const MAX_DECLARED_MAX_LENGTH = 10_000;

/**
 * The smallest limit a field may declare. Below one line of prose the declaration is a closed set
 * of values, which is the choice type; and the Gate's own longest string fixture is 45 characters.
 */
export const MIN_DECLARED_MAX_LENGTH = 64;

export const maxLengthSchema = z
  .number()
  .int()
  .min(MIN_DECLARED_MAX_LENGTH)
  .max(MAX_DECLARED_MAX_LENGTH);

/**
 * A limit belongs to a scalar `string`: one number cannot say whether it bounds a `string[]`
 * element or the array; a choice has {@link import("./choice.ts").MAX_CHOICE_OPTION_VALUE_LENGTH}.
 */
export function validateMaxLength(
  spec: Pick<CapabilitySpec, "schema">,
  ctx: z.RefinementCtx,
): void {
  for (const [index, field] of spec.schema.fields.entries()) {
    if (field.max_length === undefined || field.type === "string") continue;
    ctx.addIssue({
      code: "custom",
      message: "only a scalar string field declares max_length",
      path: ["schema", "fields", index, "max_length"],
    });
  }
}

/**
 * Every field that declares a limit, as the name→limit lookup. Lifecycle is deliberately not
 * filtered: a soft-hidden field keeps its limit, and the pre-activation scan reads exactly those.
 */
export function maxLengthsByField(
  spec: Pick<CapabilitySpec, "schema">,
): ReadonlyMap<string, number> {
  const limits = new Map<string, number>();
  for (const field of spec.schema.fields) {
    if (field.max_length === undefined) continue;
    limits.set(field.name, field.max_length);
  }
  return limits;
}
