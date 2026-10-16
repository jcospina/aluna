// The matching scan (ADR-0011). Names are compared by `matchKey` in code, since SQLite's `lower()`
// folds ASCII only. It writes link rows and nothing else: inside the transaction that writes a
// relation, under its lease, and at startup for fields linked before.

import type { Database } from "bun:sqlite";
import { holdsName, matchKey } from "#shell/core/same-text.js";
import {
  deleteFieldLinkRows,
  LINK_TABLE,
  writeLinkRow,
} from "../../../platform/links/link-table.ts";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import type { MatchCounts } from "../../../presentation/controls/link/link-copy.ts";
import type { CapabilityRow, Relation } from "../../../registry/index.ts";
import { capabilityTableName } from "../../../runtime/data/index.ts";

/** One record and the name its field holds, never blank. */
interface NamedRecord {
  readonly id: string;
  readonly name: string;
}

/**
 * Link each record of `source` whose `relation.field` names exactly one record of `target`, in one
 * transaction. The field held no relation before this one, so any row it still has is left from a
 * relation since taken away, and goes: a name with no match has no row behind it.
 */
export function matchTypedNames(
  database: Database,
  source: CapabilityRow,
  target: CapabilityRow,
  relation: Relation,
): MatchCounts {
  return database.transaction((): MatchCounts => {
    deleteFieldLinkRows(database, source.id, relation.field);
    return linkByName(database, source, target, relation, new Set());
  })();
}

/**
 * The same matching for a field already linked: each record whose link does not lead to a record
 * of `target` is linked by its name, and a link that does stands, whatever its text names now.
 */
export function matchUnlinkedNames(
  database: Database,
  source: CapabilityRow,
  target: CapabilityRow,
  relation: Relation,
): MatchCounts {
  return database.transaction((): MatchCounts => {
    const standing = linkedRecords(database, source, target, relation);
    return linkByName(database, source, target, relation, standing);
  })();
}

/** Link each named record of `source` but those in `skipped` by the one target record its name is. */
function linkByName(
  database: Database,
  source: CapabilityRow,
  target: CapabilityRow,
  relation: Relation,
  skipped: ReadonlySet<string>,
): MatchCounts {
  const byName = recordsByName(namedRecords(database, target, relation.to.field));
  let linked = 0;
  let unmatched = 0;
  for (const { id, name } of namedRecords(database, source, relation.field)) {
    if (skipped.has(id)) continue;
    const record = byName.get(matchKey(name));
    if (!record) {
      unmatched += 1;
      continue;
    }
    const from = { capability: source.id, record: id, field: relation.field };
    const to = { capability: target.id, incarnation: target.incarnation_id, record };
    writeLinkRow(database, from, to);
    linked += 1;
  }
  return { linked, unmatched };
}

/** The records of `source` whose link for the field leads to a record of `target` now. */
function linkedRecords(
  database: Database,
  source: CapabilityRow,
  target: CapabilityRow,
  relation: Relation,
): ReadonlySet<string> {
  const targets = sqlIdentifier(capabilityTableName(target.id));
  const rows = database
    .query<{ source_record: string }, [string, string, string, string]>(
      `SELECT source_record FROM ${LINK_TABLE}
       WHERE source_capability = ? AND source_field = ? AND target_capability = ?
         AND target_incarnation = ? AND target_record IN (SELECT "id" FROM ${targets})`,
    )
    .all(source.id, relation.field, target.id, target.incarnation_id);
  return new Set(rows.map((row) => row.source_record));
}

/** Each name to the one record holding it, or to null when more than one does. */
function recordsByName(records: readonly NamedRecord[]): ReadonlyMap<string, string | null> {
  const byName = new Map<string, string | null>();
  for (const { id, name } of records) {
    const key = matchKey(name);
    byName.set(key, byName.has(key) ? null : id);
  }
  return byName;
}

/** Every record whose field holds a name: text with more in it than spaces and invisible marks. */
function namedRecords(database: Database, row: CapabilityRow, field: string): NamedRecord[] {
  const table = sqlIdentifier(capabilityTableName(row.id));
  const column = sqlIdentifier(field);
  const rows = database
    .query<{ id: unknown; name: unknown }, []>(
      `SELECT "id" AS "id", ${column} AS "name" FROM ${table} WHERE ${column} IS NOT NULL`,
    )
    .all();
  return rows.flatMap(({ id, name }) => (holdsName(name) ? [{ id: String(id), name }] : []));
}
