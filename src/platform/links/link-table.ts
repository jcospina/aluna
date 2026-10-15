// The link table (ADR-0011): which record each linked field picked. One row per source
// capability, record and field, naming the target capability, incarnation and record. The field
// keeps its own text in its own table, so generated code reads and writes exactly what it did
// before the link. Only the platform writes here.
//
// A leaf over the database handle it is given, as the file ledger is: the migration that builds the
// table and the save that writes a row can both name it. Its name carries no `cap_` prefix, so a
// Handler's query, which may open only `cap_` tables in its scope, cannot read it.

import type { Database } from "bun:sqlite";
import { LINK_TABLE } from "../persistence/table-names.ts";

export { LINK_TABLE } from "../persistence/table-names.ts";

/** One record's linked field: the end a link row is written from. */
export interface LinkSource {
  readonly capability: string;
  readonly record: string;
  readonly field: string;
}

/** The record a linked field picked, in the incarnation it lives in. */
export interface LinkTarget {
  readonly capability: string;
  readonly incarnation: string;
  readonly record: string;
}

/**
 * Build the link table: migration `0021_link_table` runs it, and so does every Gate scratch
 * database. The primary key is the index from the source end; the refresh, record deletion and the
 * backwards search start from the target, so it carries one from that end too.
 */
export function createLinkTableSchema(database: Database): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${LINK_TABLE} (
       source_capability  TEXT NOT NULL,
       source_record      TEXT NOT NULL,
       source_field       TEXT NOT NULL,
       target_capability  TEXT NOT NULL,
       target_incarnation TEXT NOT NULL,
       target_record      TEXT NOT NULL,
       PRIMARY KEY (source_capability, source_record, source_field)
     ) STRICT;`,
  );
  database.exec(
    `CREATE INDEX IF NOT EXISTS ${LINK_TABLE}_target
     ON ${LINK_TABLE} (target_capability, target_incarnation, target_record);`,
  );
}

/** Point `source` at `target`, replacing whatever it picked before. */
export function writeLinkRow(database: Database, source: LinkSource, target: LinkTarget): void {
  database
    .query(
      `INSERT INTO ${LINK_TABLE}
         (source_capability, source_record, source_field,
          target_capability, target_incarnation, target_record)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_capability, source_record, source_field) DO UPDATE SET
         target_capability = excluded.target_capability,
         target_incarnation = excluded.target_incarnation,
         target_record = excluded.target_record`,
    )
    .run(
      source.capability,
      source.record,
      source.field,
      target.capability,
      target.incarnation,
      target.record,
    );
}

/** Forget what `source` picked, if it picked anything. */
export function deleteLinkRow(database: Database, source: LinkSource): void {
  database
    .query(
      `DELETE FROM ${LINK_TABLE}
       WHERE source_capability = ? AND source_record = ? AND source_field = ?`,
    )
    .run(source.capability, source.record, source.field);
}

/** Forget every pick one record holds as a source, whichever field made it. */
export function deleteSourceLinkRows(database: Database, capability: string, record: string): void {
  database
    .query(`DELETE FROM ${LINK_TABLE} WHERE source_capability = ? AND source_record = ?`)
    .run(capability, record);
}

/** What each of one record's fields picked, by field. */
export function readSourceLinkRows(
  database: Database,
  capability: string,
  record: string,
): ReadonlyMap<string, LinkTarget> {
  const rows = database
    .query<
      {
        source_field: string;
        target_capability: string;
        target_incarnation: string;
        target_record: string;
      },
      [string, string]
    >(
      `SELECT source_field, target_capability, target_incarnation, target_record
       FROM ${LINK_TABLE} WHERE source_capability = ? AND source_record = ?`,
    )
    .all(capability, record);
  return new Map(
    rows.map((row) => [
      row.source_field,
      {
        capability: row.target_capability,
        incarnation: row.target_incarnation,
        record: row.target_record,
      },
    ]),
  );
}
