// The relation diff (ADR-0011): every relation change, whoever makes it, is mapped here to
// platform work, and the work is done here. The work is the registry row, the matching scan
// and the link rows. None of it is a version, a unit or Gate work, so the Diff Engine's
// change-fact contract does not grow.

import type { Database } from "bun:sqlite";
import {
  deleteCapabilityLinkRows,
  deleteFieldLinkRows,
} from "../../../../platform/links/link-table.ts";
import {
  type CapabilityRow,
  holdingRelations,
  type ReachingRelation,
  type Relation,
  type RelationsExpectation,
  relationsReaching,
  removeRelationsTo,
  sameRelation,
  writeCapabilityRelations,
} from "../../../../registry/index.ts";
import { reviveLinkedText } from "../linked-text.ts";
import { type MatchCounts, matchTypedNames, matchUnlinkedNames } from "../matching-scan.ts";

/** One lifetime of a capability: what a deletion ends, and what a relation pins. */
interface Lifetime {
  readonly capabilityId: string;
  readonly incarnationId: string;
}

/** One relation change, as the one making it read the registry under its lease. */
export type RelationChange =
  /** Link: `relation` on a field of `source` that holds none, pointing at a field of `target`. */
  | {
      readonly kind: "link";
      readonly source: CapabilityRow;
      readonly target: CapabilityRow;
      readonly relation: Relation;
    }
  /** Unlink: the relation one field of `source` holds comes off. */
  | { readonly kind: "unlink"; readonly source: CapabilityRow; readonly field: string }
  /** A deletion ends a lifetime, and every relation it is an end of goes with it. */
  | { readonly kind: "deletion"; readonly deleted: Lifetime }
  /** An activation, with the active catalog as it stood either side of the registry swap. */
  | {
      readonly kind: "activation";
      readonly before: readonly CapabilityRow[];
      readonly after: readonly CapabilityRow[];
    };

/** A relation an activation woke, and the lifetime of the capability whose field holds it. */
type WokenRelation = Pick<ReachingRelation, "source" | "relation">;

/** A matching scan's three inputs: the linked field's capability, its relation and its target. */
interface ScanInputs {
  readonly source: CapabilityRow;
  readonly target: CapabilityRow;
  readonly relation: Relation;
}

/** One piece of platform work. The diff lists them in the order they are done. */
export type RelationWork =
  /** Write a capability's relations in place, bound to the row as it was read. */
  | {
      readonly kind: "write_relations";
      readonly expectation: RelationsExpectation;
      readonly relations: readonly Relation[];
    }
  /** Take every relation pinned to an ended lifetime off the rows that hold one. */
  | { readonly kind: "remove_relations_to"; readonly deleted: Lifetime }
  /** Forget every pick one field made. */
  | { readonly kind: "delete_field_link_rows"; readonly capability: string; readonly field: string }
  /** Forget every pick a capability is an end of. */
  | { readonly kind: "delete_capability_link_rows"; readonly capability: string }
  /** Link the names a newly linked field holds, any row the field had before going first. */
  | ({ readonly kind: "match_typed_names" } & ScanInputs)
  /** Bring a woken relation's field back to its targets' text, from its link rows. */
  | {
      readonly kind: "refresh_from_link_rows";
      readonly revived: WokenRelation;
      /** What the text reaches on its way down, from the woken field's capability. */
      readonly reach: readonly ReachingRelation[];
    }
  /** Link each record of a woken field whose link leads nowhere, by the name it holds. */
  | ({ readonly kind: "match_unlinked_names" } & ScanInputs);

/** The platform work one relation change needs. */
export function relationDiff(change: RelationChange): RelationWork[] {
  switch (change.kind) {
    case "link": {
      const { source, target, relation } = change;
      return [
        writeRelations(source, [...source.relations, relation]),
        { kind: "match_typed_names", source, target, relation },
      ];
    }
    case "unlink": {
      const { source, field } = change;
      const kept = source.relations.filter((relation) => relation.field !== field);
      return [
        writeRelations(source, kept),
        { kind: "delete_field_link_rows", capability: source.id, field },
      ];
    }
    case "deletion":
      return [
        { kind: "remove_relations_to", deleted: change.deleted },
        { kind: "delete_capability_link_rows", capability: change.deleted.capabilityId },
      ];
    case "activation":
      return wokenRelationWork(change.before, change.after);
  }
}

function writeRelations(row: CapabilityRow, relations: readonly Relation[]): RelationWork {
  const expectation = {
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    version: row.version,
    relations: row.relations,
  };
  return { kind: "write_relations", expectation, relations };
}

/**
 * An activation's work. A relation that still holds needs none, and nor does one gone to sleep,
 * whose link rows stay. Each relation that holds now and did not before wakes: its field is brought
 * back to its targets' text, then the names typed into it while it slept are matched, as every
 * boot matches them.
 */
function wokenRelationWork(
  before: readonly CapabilityRow[],
  after: readonly CapabilityRow[],
): RelationWork[] {
  const woken = after.flatMap((source) => {
    const was = before.find(
      (row) => row.id === source.id && row.incarnation_id === source.incarnation_id,
    );
    if (!was) return [];
    const held = holdingRelations(was, before);
    return holdingRelations(source, after)
      .filter((relation) => !held.some((each) => sameRelation(each, relation)))
      .flatMap((relation) => {
        const target = after.find((row) => row.id === relation.to.capability);
        return target ? [{ source, target, relation }] : [];
      });
  });
  return [
    ...woken.map(({ source, relation }): RelationWork => {
      const revived = {
        source: { capability: source.id, incarnation: source.incarnation_id },
        relation,
      };
      return { kind: "refresh_from_link_rows", revived, reach: relationsReaching(source, after) };
    }),
    ...woken.map((inputs): RelationWork => ({ kind: "match_unlinked_names", ...inputs })),
  ];
}

/** What the work left: each row a relation write left, and what Link's matching scan matched. */
export interface RelationWorkDone {
  readonly rows: ReadonlyMap<string, CapabilityRow>;
  readonly matched: MatchCounts;
}

/** A relation write found its row no longer the row the change was read from. */
class RelationRowMovedError extends Error {}

/**
 * Do the work in the order listed, in one transaction of its own, a savepoint of the caller's when
 * it holds one, under the caller's lease. A relation write that finds its row moved undoes all of
 * it and the answer is `null`. Only Link's and Unlink's work writes a relation, so a deletion's or
 * an activation's is never answered `null`.
 */
export function applyRelationWork(
  database: Database,
  work: readonly RelationWork[],
): RelationWorkDone | null {
  try {
    return database.transaction(() => doWork(database, work))();
  } catch (error) {
    if (error instanceof RelationRowMovedError) return null;
    throw error;
  }
}

/**
 * Each piece of work in turn. A woken relation's refresh may write every capability it reaches:
 * only an activation wakes one, under the build lease, and no deletion can close a capability while
 * that lease is held.
 */
function doWork(database: Database, work: readonly RelationWork[]): RelationWorkDone {
  const rows = new Map<string, CapabilityRow>();
  const matched = { linked: 0, unmatched: 0 };
  for (const each of work) {
    switch (each.kind) {
      case "write_relations": {
        const row = writeCapabilityRelations(each.expectation, each.relations, database);
        if (!row) throw new RelationRowMovedError();
        rows.set(row.id, row);
        break;
      }
      case "remove_relations_to":
        removeRelationsTo(each.deleted, database);
        break;
      case "delete_field_link_rows":
        deleteFieldLinkRows(database, each.capability, each.field);
        break;
      case "delete_capability_link_rows":
        deleteCapabilityLinkRows(database, each.capability);
        break;
      case "match_typed_names": {
        const counts = matchTypedNames(database, each.source, each.target, each.relation);
        matched.linked += counts.linked;
        matched.unmatched += counts.unmatched;
        break;
      }
      case "refresh_from_link_rows":
        reviveLinkedText(database, each.revived, { relations: each.reach, writable: () => true });
        break;
      case "match_unlinked_names":
        matchUnlinkedNames(database, each.source, each.target, each.relation);
    }
  }
  return { rows, matched };
}
