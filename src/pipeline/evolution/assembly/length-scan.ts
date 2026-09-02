// The pre-activation length scan: the one place an evolution is refused for what the
// committed *data* holds rather than for what the candidate says.
//
// Every other check in the path reads specs. This one reads the physical column, because
// the question it answers cannot be asked of a spec: adding a `max_length`, or lowering
// one, narrows what the platform admits — and a row committed under the old bound would
// become a row that can be read but never saved again. Saving an unrelated field
// resubmits the long value, earns a typed refusal, and leaves the record permanently
// uneditable. An evolution may not strand a valid row, so a limit the committed values
// cannot fit is refused before anything is published.
//
// It reads the physical column whatever the field's lifecycle, a soft-hidden field's
// included: hiding never drops a column and never clears it, so a limit added while a
// field was hidden would be a limit nothing had ever checked, and reactivation would
// reveal exactly the stranded rows this exists to prevent.
//
// It runs under the exclusive build lease the whole run is already held by, so no record
// write can land between the scan and the activation that follows it. That is what lets
// the scan sit here — early, before an assembly is spent on a candidate that cannot
// activate — rather than immediately before the pointer moves.

import type { Database } from "bun:sqlite";
import {
  type CapabilitySpec,
  maxLengthsByField,
  SQL_NAME_PATTERN,
} from "../../../registry/index.ts";
import { CAPABILITY_TABLE_PREFIX } from "../../../runtime/data/index.ts";

/**
 * One field whose declared limit the committed column already breaks, and the worst case
 * in it — the number a person needs to choose a limit that would actually be admitted.
 */
export interface OversizedStoredField {
  readonly field: string;
  readonly limit: number;
  readonly longest: number;
}

export class MaxLengthScanError extends Error {
  override readonly name = "MaxLengthScanError";
  readonly fields: readonly OversizedStoredField[];

  constructor(capabilityId: string, fields: readonly OversizedStoredField[]) {
    super(
      `Capability "${capabilityId}" cannot take these limits — stored values already exceed them: ` +
        `${fields.map((f) => `${f.field} (max_length ${f.limit}, longest stored ${f.longest})`).join(", ")}.`,
    );
    this.fields = [...fields];
  }
}

/**
 * Refuse the candidate if any limit it adds or lowers is already broken by committed data.
 *
 * Only the narrowing direction is scanned. Raising a limit, or removing one, can strand
 * nothing, and the query is over a whole user table — a scan nobody needs is a scan that
 * makes every unrelated evolution slower.
 */
export function assertStoredValuesFitMaxLengths(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  database: Database,
): void {
  const narrowed = narrowedLimits(committed, candidate);
  if (narrowed.size === 0) return;

  assertSqlName(candidate.id, "capability id");
  const table = `${CAPABILITY_TABLE_PREFIX}${candidate.id}`;
  const oversized: OversizedStoredField[] = [];
  for (const [field, limit] of narrowed) {
    assertSqlName(field, "field name");
    const longest = longestStoredLength(database, table, field, limit);
    if (longest > limit) oversized.push({ field, limit, longest });
  }
  if (oversized.length > 0) throw new MaxLengthScanError(candidate.id, oversized);
}

/**
 * The limits that are new or tighter than what the committed spec declared. A field the
 * candidate introduces is not here at all: its column is added by this same evolution and
 * has no values to strand.
 */
function narrowedLimits(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
): ReadonlyMap<string, number> {
  const before = maxLengthsByField(committed);
  const committedNames = new Set(committed.schema.fields.map((field) => field.name));
  const narrowed = new Map<string, number>();
  for (const [field, limit] of maxLengthsByField(candidate)) {
    if (!committedNames.has(field)) continue;
    const previous = before.get(field);
    if (previous === undefined || limit < previous) narrowed.set(field, limit);
  }
  return narrowed;
}

/**
 * The longest value the column holds that could possibly break the limit, in the units the
 * limit is expressed in — or `0` when nothing can.
 *
 * The filter is over **bytes**, not characters. SQLite's `length(X)` over text counts
 * characters *up to the first NUL*, so a stored value carrying one measures as the prefix
 * before it and hides behind any limit at all — a scan built on it fails open, activates a
 * limit the column cannot hold, and strands exactly the row this exists to protect.
 * `length(CAST(X AS BLOB))` counts UTF-8 bytes and counts through a NUL.
 *
 * Bytes are also a sound superset. The limit counts UTF-16 code units, the way the native
 * `maxlength` attribute counts and the way the write path measures; every code point is at
 * least as many UTF-8 bytes as it is code units (1–3 bytes per unit inside the BMP, 4 bytes
 * per 2 units above it), so `bytes >= code units` always. A row whose byte count fits the
 * limit provably fits it, and the exact count is then taken in the same JavaScript the
 * refusal itself would take it in. On a limit that nothing is near — the ordinary case — the
 * query returns no rows at all.
 *
 * `max(length(...))` is asked first so the common answer costs one scalar rather than a
 * column materialized into JS; only a column that really has a candidate is read.
 *
 * The identifiers are interpolated because both are spec-validated `[a-z][a-z0-9_]*`
 * (`SQL_NAME_PATTERN`), which is what every other statement over a capability table relies
 * on; the limit is a bound parameter.
 */
function longestStoredLength(
  database: Database,
  table: string,
  field: string,
  limit: number,
): number {
  const widest = database
    .query(`SELECT max(length(CAST("${field}" AS BLOB))) AS bytes FROM "${table}"`)
    .get() as { bytes: number | null } | null;
  if ((widest?.bytes ?? 0) <= limit) return 0;

  let longest = 0;
  const rows = database
    .query(
      `SELECT "${field}" AS value FROM "${table}" ` +
        `WHERE "${field}" IS NOT NULL AND length(CAST("${field}" AS BLOB)) > ?`,
    )
    .iterate(limit) as Iterable<{ value: unknown }>;
  // Iterated rather than materialized: this branch is only reached on a column that really
  // holds a candidate, and lowering a limit a long way on a large capability makes that
  // every row. Only the widest length is wanted, so only one row is ever in hand.
  for (const row of rows) {
    if (typeof row.value !== "string") continue;
    longest = Math.max(longest, row.value.length);
  }
  return longest;
}

/**
 * The two identifiers this module interpolates, checked here rather than assumed.
 *
 * Both are spec-validated `[a-z][a-z0-9_]*` by the time a candidate reaches the Diff, and
 * the residual totality check has already pinned the id — so this can only fire on a
 * caller that skipped both. It is the one SQL-building site in the evolution path with no
 * schema parse of its own, and a statement built from an unchecked name is not a thing to
 * leave resting on where it happens to be called from.
 */
function assertSqlName(name: string, what: string): void {
  if (!SQL_NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to build a length scan over an unvalidated ${what}: "${name}".`);
  }
}
