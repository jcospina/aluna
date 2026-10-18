// What the records linking to a deleted record keep (ADR-0011). An optional linked field is
// cleared; a required one keeps the last name it showed, with no record behind it, so its card
// carries the broken-link mark. No linking record is deleted or waited on.

import type { Database } from "bun:sqlite";
import {
  deleteSourceLinkRows,
  deleteTargetLinkRows,
  LINK_TABLE,
  type LinkTarget,
} from "../../../platform/links/link-table.ts";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import type { Relation } from "../../../registry/index.ts";
import { capabilityTableName } from "../schema/ddl.ts";
import { type RefreshReach, unlinkClearedTarget } from "./linked-text.ts";

/**
 * Release what a deleted record held and what pointed at it, in its deletion's savepoint: the picks
 * it made, and every link row naming it, a dormant relation's too. Each optional field linked to it
 * through a relation that holds is cleared where the deletion may write, and a cleared field that
 * is itself a target is treated as a target whose text was cleared. A field behind a dormant
 * relation is plain text, so it keeps its text.
 */
export function releaseDeletedRecord(
  database: Database,
  deleted: LinkTarget,
  reach: RefreshReach,
): void {
  deleteSourceLinkRows(database, deleted.capability, deleted.record);
  for (const { source, relation, holds, required } of reach.relations) {
    if (!holds || required || !pointsAtRecordsOf(relation, deleted)) continue;
    if (!reach.writable(source)) continue;
    const origin = { ...source, field: relation.field };
    for (const record of clearLinkedField(database, source.capability, relation, deleted)) {
      unlinkClearedTarget(database, origin, record, reach);
    }
  }
  deleteTargetLinkRows(database, deleted);
}

/** Empty the linked field of each record whose link row through it names the deleted record. */
function clearLinkedField(
  database: Database,
  sourceCapability: string,
  relation: Relation,
  deleted: LinkTarget,
): string[] {
  const table = sqlIdentifier(capabilityTableName(sourceCapability));
  const column = sqlIdentifier(relation.field);
  return database
    .query<{ id: string }, [string, string, string, string, string]>(
      `UPDATE ${table} SET ${column} = NULL WHERE "id" IN (
         SELECT source_record FROM ${LINK_TABLE}
         WHERE target_capability = ? AND target_incarnation = ? AND target_record = ?
           AND source_capability = ? AND source_field = ?
       ) RETURNING "id"`,
    )
    .all(deleted.capability, deleted.incarnation, deleted.record, sourceCapability, relation.field)
    .map(({ id }) => id);
}

function pointsAtRecordsOf(relation: Relation, deleted: LinkTarget): boolean {
  return (
    relation.to.capability === deleted.capability && relation.to.incarnation === deleted.incarnation
  );
}
