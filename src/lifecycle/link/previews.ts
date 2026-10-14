// The few values beside each target in the chooser, read under the
// target capability's own read token and through its own query port, as a collection count is.

import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import { sqlIdentifier } from "../../platform/persistence/sql-identifier.ts";
import { type CapabilityRow, capabilitySpecFromRow } from "../../registry/index.ts";
import {
  capabilityIncarnation,
  type ReadGateCoordinator,
} from "../../runtime/concurrency/read-gates.ts";
import { createCapabilityQueryPort, deriveCapabilityTableDdl } from "../../runtime/data/index.ts";
import { tryReadToken } from "../../server/files/read-token.ts";
import type { LinkEnd } from "./rules.ts";

/** Enough to recognise a field by what it holds; the panel's width cuts the line before it ends. */
export const PREVIEW_VALUES = 3;

export interface PreviewDeps {
  readonly readGates: ReadGateCoordinator;
  readonly readonly: PlatformDatabase["readonly"];
}

/**
 * The oldest distinct non-blank values of each target field, keyed by target. A capability whose
 * read token cannot be taken, because a deletion is closing it, is absent: it cannot be picked.
 */
export function readPreviews(
  targets: readonly LinkEnd[],
  deps: PreviewDeps,
): Map<LinkEnd, readonly string[]> {
  const previews = new Map<LinkEnd, readonly string[]>();
  for (const row of new Set(targets.map((target) => target.row))) {
    const tokens = tryReadToken(deps.readGates, deps.readonly, capabilityIncarnation(row));
    if (!tokens) continue;
    try {
      for (const target of targets.filter((candidate) => candidate.row === row)) {
        previews.set(target, previewOf(row, target.field, deps.readonly, tokens.signal));
      }
    } finally {
      deps.readGates.release(tokens);
    }
  }
  return previews;
}

/** A preview is a courtesy: one that cannot be read leaves its target listed with no values. */
function previewOf(
  row: CapabilityRow,
  field: string,
  database: PlatformDatabase["readonly"],
  signal: AbortSignal,
): readonly string[] {
  try {
    return fieldValues(row, field, database, signal);
  } catch (error) {
    if (!signal.aborted)
      console.error(`The values of ${row.id}.${field} could not be read:`, error);
    return [];
  }
}

function fieldValues(
  row: CapabilityRow,
  field: string,
  database: PlatformDatabase["readonly"],
  signal: AbortSignal,
): readonly string[] {
  const target = capabilitySpecFromRow(row);
  const table = sqlIdentifier(deriveCapabilityTableDdl(target).tableName);
  const column = sqlIdentifier(field);
  const rows = createCapabilityQueryPort(database, { target, signal }).all({
    sql:
      `SELECT ${column} AS "value" FROM ${table}` +
      ` WHERE ${column} IS NOT NULL AND trim(${column}) <> ''` +
      ` GROUP BY ${column} ORDER BY min("created_at"), ${column} LIMIT ${PREVIEW_VALUES}`,
    result: [{ alias: "value", type: "string" }],
  });
  return rows.map((value) => String(value.value));
}
