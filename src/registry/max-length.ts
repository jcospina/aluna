// `max_length` — one declaration on a scalar string field, and the three things it drives.
//
// A limit is authored once and read in three places: the platform's own mutation
// validation, which refuses an over-limit submission before a generated Handler or any
// canonical state sees it; the native `maxlength` attribute, which stops the typing; and
// the character counter under the field. One declaration, so the number being counted
// down to and the number the server enforces cannot drift apart
// (`design/controls.html`, "With a limit").
//
// It is structural, not behavioral. A generated Handler is given the already-admitted
// string and never re-implements the bound, which is the positive proof ADR-0006 wants
// before a unit is copied rather than rewritten: a limit change maps to platform work and
// the two writing suites, and provably cannot have reached either Handler's prompt.

import { z } from "zod";

import type { CapabilitySpec } from "./spec.ts";

/**
 * The structural refusal an over-limit submission earns. Platform-owned, like
 * `invalid_choice` and `record_not_found`: the platform raises it before canonical state
 * moves, so a capability that authored it would be claiming an error it never gets to see.
 */
export const MAX_LENGTH_EXCEEDED_ERROR_CODE = "max_length_exceeded";

/**
 * The largest limit a field may declare.
 *
 * Not a storage limit — SQLite `TEXT` is unbounded and the column is unchanged by this
 * key. It is a limit on what the declaration can mean. The number drives a countdown
 * under the field and a native attribute that stops a keystroke, and both are addressed
 * to a person filling in a form; a limit of a million is a limit nobody reaches, counts
 * toward, or is stopped by, so it is a declaration that claims a bound while having none.
 * The ceiling keeps the key honest about being one.
 */
export const MAX_DECLARED_MAX_LENGTH = 10_000;

/**
 * The smallest limit a field may declare, for two reasons that agree.
 *
 * A bound below one short line of prose is not a length limit. `max_length` exists for the
 * notes, description, review and journal fields the surface has been missing; something
 * that admits only a handful of characters is a different declaration — a closed set of
 * values, which is what the choice type is for.
 *
 * And concretely: the Gate writes its own text into every string field. The smoke's create
 * and update samples, and the search tier's inclusion, literal, Latin and duplicate
 * fixtures, all put real sentences in — the longest of them 45 characters. A capability
 * that declared a tighter bound would author a field its own Gate could not fill, and
 * would fail a rung about nothing it did wrong.
 */
export const MIN_DECLARED_MAX_LENGTH = 64;

export const maxLengthSchema = z
  .number()
  .int()
  .min(MIN_DECLARED_MAX_LENGTH)
  .max(MAX_DECLARED_MAX_LENGTH);

/**
 * A limit belongs to a scalar `string` and to nothing else.
 *
 * A choice stores one of its own declared values, whose length is already bounded by
 * {@link import("./choice.ts").MAX_CHOICE_OPTION_VALUE_LENGTH}; a `string[]` holds many
 * strings, and one number could not say whether it bounds an element or the whole array;
 * the remaining scalars have no length at all. On any of them the key is a claim the
 * platform would have to invent a meaning for, so it is refused instead — symmetric with
 * `values` and `groups`, which only a choice field may carry.
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
 * Every field that declares a limit, as the name→limit lookup.
 *
 * Lifecycle is deliberately not filtered. A soft-hidden field keeps its whole definition,
 * limit included, and its column keeps its values; the pre-activation scan has to read
 * exactly those, and mutation validation would rather enforce a declared bound on anything
 * being written than trust that nothing hidden can reach it.
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
