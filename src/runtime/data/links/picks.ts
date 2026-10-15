// What a save does with the records its linked fields picked (ADR-0011). The form posts each
// pick beside the field's text; the router checks it before generated
// code runs and again inside the save's transaction, and the mutation ports write the link row in
// the record's own savepoint. The field's column is the Handler's as it always was.
//
// The ports read no relation of their own: the router hands them the ones that hold, and the Gate
// hands them none, so a Gate run writes no link row whatever its scratch saves post.

import { type Database, SQLiteError } from "bun:sqlite";
import {
  deleteLinkRow,
  deleteSourceLinkRows,
  readSourceLinkRows,
  writeLinkRow,
} from "../../../platform/links/link-table.ts";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import { PICK_NOT_FOUND_ERROR_CODE, type Relation, relationOf } from "../../../registry/index.ts";
import { CapabilityDataValidationError } from "../internal.ts";
import { capabilityTableName } from "../schema/ddl.ts";

/** A capability's relations as a save finds them: those that hold, and those asleep. */
export interface SaveRelations {
  readonly relations: readonly Relation[];
  /** Relations that hold no longer, whose link rows stay for the day they hold again. */
  readonly dormant: readonly Relation[];
}

/** What a save's ports are handed: its relations, and the picks the router checked. */
export interface LinkBinding extends SaveRelations {
  /** Each linked field's pick, as the id of the target record it names. */
  readonly picks: ReadonlyMap<string, string>;
}

/** No relation and no pick: the Gate's binding, and every save of a capability with no link. */
export const NO_LINKS: LinkBinding = Object.freeze({
  relations: [],
  dormant: [],
  picks: new Map(),
});

/** A second create from a save whose picks its first create already linked. */
export class PickWriteError extends CapabilityDataValidationError {
  override readonly name = "PickWriteError";

  constructor() {
    super("A save's picks link only the record its first create wrote.");
  }
}

/**
 * A pick naming no record of its field's target: forged, or a record deleted while the form was
 * open. Refused before anything is written, and the field asks for a new pick.
 */
export class PickNotFoundError extends CapabilityDataValidationError {
  override readonly name = "PickNotFoundError";
  readonly code = PICK_NOT_FOUND_ERROR_CODE;
  readonly action: "create" | "update";
  readonly fields: readonly string[];
  /** Each refused field's target record noun, in the same order. */
  readonly nouns: readonly string[];

  constructor(
    capabilityId: string,
    refused: readonly { readonly field: string; readonly noun: string }[],
    action: "create" | "update",
  ) {
    const fields = refused.map(({ field }) => field);
    super(`Pick names no record for capability "${capabilityId}": ${fields.join(", ")}.`);
    this.action = action;
    this.fields = fields;
    this.nouns = refused.map(({ noun }) => noun);
  }
}

/** Where a save's picks are checked, and the noun each target's record is called by. */
export interface PickScope {
  readonly database: Database;
  readonly capabilityId: string;
  readonly action: "create" | "update";
  readonly targetNoun: (capabilityId: string) => string;
}

/**
 * The picks a save writes: each posted one whose field holds a relation, its id naming a record of
 * the target. A pick for a field whose relation is gone or dormant is dropped, and the text saves
 * as plain text. One naming no record, forged or deleted while the form was open, refuses the save
 * with every such field named.
 */
export function resolveSubmittedPicks(
  scope: PickScope,
  held: SaveRelations,
  posted: ReadonlyMap<string, string> | undefined,
): LinkBinding {
  const picks = new Map<string, string>();
  const refused: { field: string; noun: string }[] = [];
  for (const [field, id] of posted ?? []) {
    const target = relationOf(held.relations, field)?.to.capability;
    if (target === undefined) continue;
    if (recordExists(scope.database, target, id)) picks.set(field, id);
    else refused.push({ field, noun: scope.targetNoun(target) });
  }
  if (refused.length > 0) throw new PickNotFoundError(scope.capabilityId, refused, scope.action);
  return { relations: held.relations, dormant: held.dormant, picks };
}

/**
 * Whether `record` is a record of `capability` now. Read outside the target's read token when a
 * form is drawn, so a table its deletion has already dropped holds no record rather than failing
 * the read: nothing about a link may stop a record loading (ADR-0011).
 */
function recordExists(database: Database, capability: string, record: string): boolean {
  const table = sqlIdentifier(capabilityTableName(capability));
  try {
    return database.query(`SELECT 1 FROM ${table} WHERE "id" = ?`).get(record) !== null;
  } catch (error) {
    if (error instanceof SQLiteError && error.message.startsWith("no such table")) return false;
    throw error;
  }
}

/** A new record's link rows, one for each pick, written where the record is. */
export function linkCreatedRecord(
  database: Database,
  capabilityId: string,
  recordId: string,
  links: LinkBinding,
): void {
  for (const relation of links.relations) {
    const picked = links.picks.get(relation.field);
    if (picked === undefined) continue;
    writeLinkRow(database, source(capabilityId, recordId, relation), target(relation, picked));
  }
}

/** The record an edit acts on, and which of its fields the edit changed the text of. */
interface Edit {
  readonly capabilityId: string;
  readonly recordId: string;
  readonly changed: (field: string) => boolean;
}

/**
 * An edited record's link rows. A submitted linked field with a pick links to it. One without a
 * pick, emptied or holding other text, loses its row, and keeps it while its text stands and the
 * row still points at a record of the target: a form drawn before a link existed posts no pick. A
 * field the form did not submit keeps its row. A dormant relation's row stays unless the save
 * changed its text, so a revival never overwrites what was typed while it slept (ADR-0011).
 */
export function relinkUpdatedRecord(
  database: Database,
  edit: Edit,
  links: LinkBinding,
  submittedFields: ReadonlySet<string>,
): void {
  for (const relation of links.relations) {
    if (!submittedFields.has(relation.field)) continue;
    relinkField(database, edit, relation, links.picks.get(relation.field));
  }
  for (const relation of links.dormant) {
    if (!submittedFields.has(relation.field) || !edit.changed(relation.field)) continue;
    deleteLinkRow(database, source(edit.capabilityId, edit.recordId, relation));
  }
}

/** One submitted linked field: linked to its pick, or with none, its row kept or let go. */
function relinkField(
  database: Database,
  edit: Edit,
  relation: Relation,
  picked: string | undefined,
): void {
  const from = source(edit.capabilityId, edit.recordId, relation);
  if (picked !== undefined) writeLinkRow(database, from, target(relation, picked));
  else if (!standsUnpicked(database, edit, relation)) deleteLinkRow(database, from);
}

/** Every link row a deleted record held as a source, gone with it. */
export function unlinkDeletedRecord(database: Database, capabilityId: string, recordId: string) {
  deleteSourceLinkRows(database, capabilityId, recordId);
}

/** Whether a linked field submitted without a pick keeps its row: its text and its pick stand. */
function standsUnpicked(database: Database, edit: Edit, relation: Relation): boolean {
  if (edit.changed(relation.field)) return false;
  return heldPicks(database, edit.capabilityId, edit.recordId, [relation]).has(relation.field);
}

/**
 * What each linked field of one record picked, for the relations that hold: a row pointing at
 * another capability or into another lifetime of the target, or at a record since deleted, picks
 * nothing.
 */
export function heldPicks(
  database: Database,
  capabilityId: string,
  recordId: string,
  relations: readonly Relation[],
): ReadonlyMap<string, string> {
  if (relations.length === 0) return new Map();
  const held = new Map<string, string>();
  for (const [field, row] of readSourceLinkRows(database, capabilityId, recordId)) {
    const to = relationOf(relations, field)?.to;
    if (to?.capability !== row.capability || to.incarnation !== row.incarnation) continue;
    if (recordExists(database, row.capability, row.record)) held.set(field, row.record);
  }
  return held;
}

function source(capabilityId: string, recordId: string, relation: Relation) {
  return { capability: capabilityId, record: recordId, field: relation.field };
}

function target(relation: Relation, recordId: string) {
  return {
    capability: relation.to.capability,
    incarnation: relation.to.incarnation,
    record: recordId,
  };
}
