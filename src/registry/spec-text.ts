// The small validation primitives the spec shape is built from, factored out so the
// per-type contracts (`choice.ts`) can be written against the same rules the spec itself
// uses rather than re-deriving them.

import { z } from "zod";

// Capability ids and field names both end up inside SQL identifiers — the data
// table is `cap_<id>` and each field becomes a column (2.2 mapper) — so both are
// confined to a shape that needs no quoting and can never smuggle SQL.
export const SQL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const SQL_NAME_MESSAGE =
  "must be lowercase letters/digits/underscores, starting with a letter";

/**
 * The longest a SQL name may be.
 *
 * The pattern says what characters an id may use and said nothing about how many. SQLite
 * takes an identifier of any length, so a five-thousand-character id produced valid DDL —
 * and then a `capabilities/<id>/<incarnation>/` path whose first component is past every
 * filesystem's 255-byte limit for one. The two validators disagreed about what an id is,
 * and the disagreement surfaced only at publication, after the whole build was paid for.
 *
 * Sixty-four is well past every id the resolver has ever authored (`coffee_tasting_diary`
 * is twenty) and well inside the limit the path has to keep.
 */
export const MAX_SQL_NAME_LENGTH = 64;

/** A field name, capability id, or any other value that becomes a SQL identifier. */
export const sqlNameText = z
  .string()
  .regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE)
  .max(MAX_SQL_NAME_LENGTH, `must be at most ${MAX_SQL_NAME_LENGTH} characters`);

// Free-text values the platform displays or feeds to the model — blank strings
// are never meaningful, so they fail rather than propagate.
export const nonBlankText = z
  .string()
  .min(1)
  .refine((text) => text.trim().length > 0, "must not be blank");

/**
 * One short authored phrase. Single-line by construction: these fill a request slot or
 * land inside a sentence of desk copy, and a newline would break the surface they feed.
 */
export const singleLinePhrase = (max: number) =>
  nonBlankText.max(max).refine((text) => !/[\r\n]/.test(text), "must be one line");

export function allUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
