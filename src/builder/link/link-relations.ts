// The checks every relation the link step proposes passes (ADR-0011), entry by entry: once on
// the step's answer, and again in the activation transaction. The rules are the Link control's
// own, so the two can never disagree.

import type { Database } from "bun:sqlite";
import { linkRefusal } from "../../lifecycle/link/rules.ts";
import { errorDetail } from "../../platform/errors.ts";
import {
  type CapabilityRow,
  listCapabilities,
  type RelatedCapability,
  type Relation,
} from "../../registry/index.ts";
import { applyRelationWork, relationDiff } from "../../runtime/data/index.ts";

/** One proposed relation: a field of the source, and the capability and field it points at. */
export interface CandidateRelation {
  readonly field: string;
  /** The capability pointed at, when the entry names one it may point at. */
  readonly target: RelatedCapability | undefined;
  readonly targetField: string;
}

/**
 * The candidates every rule admits, in order, each pinned to its target's lifetime. A field keeps
 * the first relation admitted for it, and a candidate no rule admits is dropped alone.
 */
export function admittedRelations(
  source: RelatedCapability,
  candidates: readonly CandidateRelation[],
  catalog: readonly RelatedCapability[],
): Relation[] {
  const admitted: Relation[] = [];
  for (const { field, target, targetField } of candidates) {
    if (!target) continue;
    const row = { ...source, relations: [...source.relations, ...admitted] };
    const desk = [...catalog.filter(({ id }) => id !== source.id), row];
    if (linkRefusal({ row, field }, { row: target, field: targetField }, desk)) continue;
    const to = { capability: target.id, incarnation: target.incarnation_id, field: targetField };
    admitted.push({ field, to });
  }
  return admitted;
}

/**
 * Relation work an activation does beside its swap. Work that fails is undone by its savepoint and
 * logged, and the activation goes on: no link may fail a build. An error after which SQLite has
 * ended the whole transaction, a full disk among them, has ended the activation too, so it throws.
 */
export function failingOpen<T>(database: Database, work: string, run: () => T, fallback: T): T {
  const activating = database.inTransaction;
  try {
    return run();
  } catch (error) {
    if (activating && !database.inTransaction) throw error;
    console.error(`omni-crud could not ${work}:`, errorDetail(error));
    return fallback;
  }
}

/**
 * Writes the link step's relations on `row`, the capability an activation has just swapped in,
 * each checked again first against the desk this transaction holds, in the lifetime the step read.
 */
export function writeLinkStepRelations(
  database: Database,
  row: CapabilityRow,
  relations: readonly Relation[],
): CapabilityRow {
  if (relations.length === 0) return row;
  return failingOpen(
    database,
    `write the relations the link step proposed for ${row.id}`,
    () => {
      const catalog = listCapabilities(database);
      const candidates = relations.map(({ field, to }) => ({
        field,
        target: catalog.find(
          ({ id, incarnation_id }) => id === to.capability && incarnation_id === to.incarnation,
        ),
        targetField: to.field,
      }));
      const admitted = admittedRelations(row, candidates, catalog);
      if (admitted.length === 0) return row;
      const change = { kind: "link_new_fields", source: row, relations: admitted } as const;
      const done = applyRelationWork(database, relationDiff(change));
      if (!done) throw new Error(`${row.id} moved after its swap`);
      return done.rows.get(row.id) ?? row;
    },
    row,
  );
}
