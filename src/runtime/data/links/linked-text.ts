// The id wins, the linked-text refresh and a woken relation's revival (ADR-0011).

import type { Database } from "bun:sqlite";
import { holdsName } from "#shell/core/same-text.js";
import {
  deleteFieldLinkRowsTo,
  LINK_TABLE,
  type LinkTarget,
} from "../../../platform/links/link-table.ts";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import type { ReachingRelation, Relation } from "../../../registry/index.ts";
import { capabilityTableName } from "../schema/ddl.ts";

/** The relations an edit's refresh reaches, and the capabilities it may write. */
export interface RefreshReach {
  /** Each relation reaching the edited capability (`relationsReaching`). */
  readonly relations: readonly ReachingRelation[];
  /** Whether the refresh may write a capability's records: its read token is held and open. */
  readonly writable: (source: ReachingRelation["source"]) => boolean;
}

/** A reach of nothing: the Gate's, and every save but an edit's. */
export const NO_REACH: RefreshReach = Object.freeze({ relations: [], writable: () => false });

/** The text record `id` holds in a relation's target field, read on the save's connection. */
export function targetText(database: Database, relation: Relation, id: string): unknown {
  const table = sqlIdentifier(capabilityTableName(relation.to.capability));
  const column = sqlIdentifier(relation.to.field);
  const row = database
    .query<{ text: unknown }, [string]>(`SELECT ${column} AS "text" FROM ${table} WHERE "id" = ?`)
    .get(id);
  return row?.text;
}

/**
 * The text each picked field stores: its target's, as it is now, whatever the Handler handed over.
 * An edit writes only the fields its form submitted, so a pick for any other changes nothing.
 */
export function pickedTexts(
  database: Database,
  links: { readonly relations: readonly Relation[]; readonly picks: ReadonlyMap<string, string> },
): Record<string, unknown> {
  const texts: Record<string, unknown> = {};
  for (const relation of links.relations) {
    const picked = links.picks.get(relation.field);
    if (picked !== undefined) texts[relation.field] = targetText(database, relation, picked);
  }
  return texts;
}

/**
 * Write each target field an edit changed into every field linked to the edited record, down each
 * chain. A target field left holding no name moves no text: the link rows through it go instead.
 */
export function refreshLinkedText(
  database: Database,
  edited: LinkTarget,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  reach: RefreshReach,
): void {
  for (const field of targetFields(edited, reach)) {
    const text = after[field];
    if (before[field] === text) continue;
    const origin = { capability: edited.capability, incarnation: edited.incarnation, field };
    if (!holdsName(text)) unlinkClearedTarget(database, origin, edited.record, reach);
    else carryText({ database, text, reach, visited: new Set() }, origin, [edited.record]);
  }
}

/**
 * Bring a woken relation's field back to its target's text (ADR-0011): each record whose
 * link row names a record of the target shows that record's text, carried on down every chain. A
 * row naming a record that holds no name, cleared or gone, lets go, as a cleared target's rows do.
 */
export function reviveLinkedText(
  database: Database,
  revived: Pick<ReachingRelation, "source" | "relation">,
  reach: RefreshReach,
): void {
  const { source, relation } = revived;
  const field = { capability: source.capability, field: relation.field };
  for (const { record, text } of pickedTargets(database, field, relation.to)) {
    const target = {
      capability: relation.to.capability,
      incarnation: relation.to.incarnation,
      record,
    };
    if (!holdsName(text)) {
      deleteFieldLinkRowsTo(database, field, target);
      continue;
    }
    const carry = { database, text, reach, visited: new Set<string>() };
    firstVisit(carry.visited, source.capability, relation.field);
    const rewritten = rewriteLinkedField(carry, source.capability, relation, [record]);
    carryText(carry, { ...source, field: relation.field }, rewritten);
  }
}

/** Each record of the target's lifetime one field's link rows name, and the text it holds now. */
function pickedTargets(
  database: Database,
  field: { readonly capability: string; readonly field: string },
  to: Relation["to"],
): { readonly record: string; readonly text: unknown }[] {
  const table = sqlIdentifier(capabilityTableName(to.capability));
  const column = sqlIdentifier(to.field);
  return database
    .query<{ record: string; text: unknown }, [string, string, string, string]>(
      `SELECT DISTINCT link.target_record AS "record", target.${column} AS "text"
       FROM ${LINK_TABLE} AS link LEFT JOIN ${table} AS target ON target."id" = link.target_record
       WHERE link.source_capability = ? AND link.source_field = ?
         AND link.target_capability = ? AND link.target_incarnation = ?`,
    )
    .all(field.capability, field.field, to.capability, to.incarnation);
}

/** The edited capability's fields that a relation reaching it points at. */
function targetFields(edited: LinkTarget, reach: RefreshReach): Set<string> {
  const into = reach.relations.filter(
    ({ relation: { to } }) =>
      to.capability === edited.capability && to.incarnation === edited.incarnation,
  );
  return new Set(into.map(({ relation }) => relation.to.field));
}

/** Delete the link rows of every relation pointing at `origin` that name `record`, dormant too. */
function unlinkClearedTarget(
  database: Database,
  origin: Relation["to"],
  record: string,
  reach: RefreshReach,
): void {
  const target = { capability: origin.capability, incarnation: origin.incarnation, record };
  for (const { source, relation } of reach.relations) {
    if (!pointsAt(relation.to, origin)) continue;
    deleteFieldLinkRowsTo(
      database,
      { capability: source.capability, field: relation.field },
      target,
    );
  }
}

/** One target's text on its way down, and the fields it has reached. */
interface Carry {
  readonly database: Database;
  readonly text: string;
  readonly reach: RefreshReach;
  readonly visited: Set<string>;
}

/**
 * Write the text into each field linked to `records` through `origin`, then on down from each. A
 * field reached before is left alone, and so is a capability the refresh may not write.
 */
function carryText(carry: Carry, origin: Relation["to"], records: readonly string[]): void {
  for (const { source, relation, holds } of carry.reach.relations) {
    if (!holds || !pointsAt(relation.to, origin)) continue;
    if (!firstVisit(carry.visited, source.capability, relation.field)) continue;
    if (!carry.reach.writable(source)) continue;
    const rewritten = rewriteLinkedField(carry, source.capability, relation, records);
    const next = { ...source, field: relation.field };
    carryText(carry, next, rewritten);
  }
}

/** Mark a capability's field visited, and say whether this is its first visit. */
function firstVisit(visited: Set<string>, capability: string, field: string): boolean {
  const key = `${capability}\u0000${field}`;
  if (visited.has(key)) return false;
  visited.add(key);
  return true;
}

/** Write the text into the linked field of each record whose link row names one of `records`. */
function rewriteLinkedField(
  carry: Carry,
  sourceCapability: string,
  relation: Relation,
  records: readonly string[],
): string[] {
  const table = sqlIdentifier(capabilityTableName(sourceCapability));
  const column = sqlIdentifier(relation.field);
  const { capability, incarnation } = relation.to;
  return carry.database
    .query<{ id: string }, [string, string, string, string, string, string]>(
      `UPDATE ${table} SET ${column} = ? WHERE "id" IN (
         SELECT source_record FROM ${LINK_TABLE}
         WHERE target_capability = ? AND target_incarnation = ?
           AND target_record IN (SELECT value FROM json_each(?))
           AND source_capability = ? AND source_field = ?
       ) RETURNING "id"`,
    )
    .all(
      carry.text,
      capability,
      incarnation,
      JSON.stringify(records),
      sourceCapability,
      relation.field,
    )
    .map(({ id }) => id);
}

function pointsAt(to: Relation["to"], field: Relation["to"]): boolean {
  return (
    to.capability === field.capability &&
    to.incarnation === field.incarnation &&
    to.field === field.field
  );
}
