// The pre-activation length scan: the one refusal driven by committed data, not by the candidate.
//
// Every other check in the path reads specs. This one reads the physical column: adding or
// lowering a `max_length` narrows what the platform admits, and a row committed under the old
// bound becomes readable but unsaveable — saving an unrelated field resubmits the long value and
// leaves the record permanently uneditable. An evolution may not strand a valid row.
//
// It reads the physical column whatever the field's lifecycle, a soft-hidden field's included:
// hiding never drops or clears a column, so a limit added while a field was hidden would be a
// limit nothing had checked, and reactivation would reveal exactly the stranded rows.
//
// It runs under the exclusive build lease the run already holds, so no record write lands between
// the scan and activation — which is what lets the scan sit before the assembly is spent.

import type { Database } from "bun:sqlite";
import {
  type CapabilitySpec,
  maxLengthsByField,
  SQL_NAME_PATTERN,
} from "../../../registry/index.ts";
import { capabilityTableName } from "../../../runtime/data/schema/ddl.ts";

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
 * Refuses the candidate if a limit it adds or lowers is already broken by committed data. Only
 * narrowing is scanned: raising a limit strands nothing, and the query scans a whole user table.
 */
export function assertStoredValuesFitMaxLengths(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  database: Database,
): void {
  const narrowed = narrowedLimits(committed, candidate);
  if (narrowed.size === 0) return;

  assertSqlName(candidate.id, "capability id");
  const table = capabilityTableName(candidate.id);
  const oversized: OversizedStoredField[] = [];
  for (const [field, limit] of narrowed) {
    assertSqlName(field, "field name");
    const longest = longestStoredLength(database, table, field, limit);
    if (longest > limit) oversized.push({ field, limit, longest });
  }
  if (oversized.length > 0) throw new MaxLengthScanError(candidate.id, oversized);
}

/**
 * The limits that are new or tighter than the committed spec declared. A field the candidate
 * introduces is absent: its column is added by this evolution and has no values to strand.
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
 * The longest value the column holds that could break the limit, in the limit's own units — or
 * `0` when nothing can. On a limit nothing is near, the query returns no rows at all.
 */
function longestStoredLength(
  database: Database,
  table: string,
  field: string,
  limit: number,
): number {
  // `max(length(...))` first, so the common answer costs one scalar rather than a materialized
  // column. Both identifiers are interpolated, and both are spec-validated `[a-z][a-z0-9_]*`.
  const widest = database
    .query(`SELECT max(length(CAST("${field}" AS BLOB))) AS bytes FROM "${table}"`)
    .get() as { bytes: number | null } | null;
  // Bytes are a sound superset: the limit counts UTF-16 code units and every code point is at
  // least as many UTF-8 bytes, so a row whose byte count fits the limit provably fits it.
  if ((widest?.bytes ?? 0) <= limit) return 0;

  let longest = 0;
  // Bytes, not characters: SQLite's `length(X)` over text stops at the first NUL, so a value
  // carrying one hides behind any limit and the scan fails open. CAST to BLOB counts through it.
  const rows = database
    .query(
      `SELECT "${field}" AS value FROM "${table}" ` +
        `WHERE "${field}" IS NOT NULL AND length(CAST("${field}" AS BLOB)) > ?`,
    )
    .iterate(limit) as Iterable<{ value: unknown }>;
  // Iterated rather than materialized: lowering a limit far on a large capability makes every row
  // a candidate, and only the widest length is wanted, so only one row is ever in hand.
  for (const row of rows) {
    if (typeof row.value !== "string") continue;
    longest = Math.max(longest, row.value.length);
  }
  return longest;
}

/**
 * The two identifiers this module interpolates, checked rather than assumed: both are already
 * `[a-z][a-z0-9_]*` by the Diff, so this fires only on a caller that skipped the spec parse.
 */
function assertSqlName(name: string, what: string): void {
  if (!SQL_NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to build a length scan over an unvalidated ${what}: "${name}".`);
  }
}
