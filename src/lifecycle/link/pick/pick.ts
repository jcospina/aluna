// The pick route (ADR-0011): a linked field is a dropdown of the target's
// records, each shown by the target field its relation names. The route reads the target's active
// incarnation, holding the read tokens of both capabilities taken at once, so deleting either one
// cannot race the read. It answers with each record's id and text, and with the sentences the
// dropdown says, which name the target's record noun: the form that draws the field cannot know it.

import { matchKey } from "#shell/core/same-text.js";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import {
  chooseTargetRecord,
  connectFieldName,
  disconnectDetail,
  disconnectFieldName,
  disconnectQuestion,
  unmatchedTargetLine,
} from "../../../presentation/controls/link/link-copy.ts";
import {
  type CapabilityRow,
  capabilitySpecFromRow,
  holdingRelations,
  listCapabilities,
  readActiveIncarnationCatalog,
  relationOf,
  type SpecField,
} from "../../../registry/index.ts";
import {
  capabilityIncarnation,
  type ReadGateCoordinator,
} from "../../../runtime/concurrency/read-gates.ts";
import {
  createCapabilityQueryPort,
  deriveCapabilityTableDdl,
  storedCapabilityActionRecord,
} from "../../../runtime/data/index.ts";
import { pressFields } from "../front-half.ts";
import { type LinkEnd, linkableField } from "../rules.ts";

/** One record a dropdown holds: its id, and the target field's text it is shown and saved by. */
export interface PickRecord {
  readonly id: string;
  readonly text: string;
}

/**
 * What the dropdown is drawn with, every sentence already written around the record nouns, and the
 * target capability, whose record addresses the open icon in the field spells.
 */
export interface PickList {
  readonly placeholder: string;
  readonly unmatched: string;
  readonly disconnect: string;
  readonly unlinking: Unlinking;
  readonly target: string;
  readonly records: readonly PickRecord[];
}

/**
 * What the broken chain asks before it unlinks, the accessible name of the chain that replaces it,
 * and the press it posts, bound to both ends as this read them.
 */
export interface Unlinking {
  readonly lead: string;
  readonly detail: string;
  readonly connect: string;
  readonly press: Readonly<Record<string, string>>;
}

export type PickAnswer =
  | { readonly status: "read"; readonly list: PickList }
  /** The field holds no relation that still holds, so it is no dropdown. */
  | { readonly status: "not_linked"; readonly source: LinkEnd }
  /** A deletion is closing one of the two capabilities. */
  | { readonly status: "unavailable" }
  /** The capability whose form asked is not on the desk. */
  | { readonly status: "gone" };

export interface PickDeps {
  readonly readGates: ReadGateCoordinator;
  readonly readonly: PlatformDatabase["readonly"];
}

/** Names in reading order, whatever their case or accents; ties fall back to the text, then the id. */
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function readPickList(capabilityId: string, fieldName: string, deps: PickDeps): PickAnswer {
  const catalog = listCapabilities(deps.readonly);
  const row = catalog.find((candidate) => candidate.id === capabilityId);
  if (!row) return { status: "gone" };
  const source = { row, field: fieldName };
  const ends = linkedEnds(source, catalog);
  if (!ends) return { status: "not_linked", source };

  const tokens = deps.readGates.tryAcquire({
    catalog: readActiveIncarnationCatalog(deps.readonly),
    incarnations: [capabilityIncarnation(row), capabilityIncarnation(ends.target)],
  });
  if (!tokens) return { status: "unavailable" };
  try {
    const records = targetRecords(ends.target, ends.targetField, deps.readonly, tokens.signal);
    return {
      status: "read",
      list: {
        placeholder: chooseTargetRecord(ends.target.noun),
        unmatched: unmatchedTargetLine(ends.target.noun),
        disconnect: disconnectFieldName(row.noun, ends.sourceField),
        unlinking: {
          lead: disconnectQuestion(row.plural_noun, ends.target.plural_noun),
          detail: disconnectDetail(row.plural_noun, ends.sourceField),
          connect: connectFieldName(row.noun, ends.sourceField),
          press: pressFields(row, ends.target, ends.relation.to.field),
        },
        target: ends.target.id,
        records,
      },
    };
  } finally {
    deps.readGates.release(tokens);
  }
}

/**
 * Both ends of the field's relation, when it still holds (`holdingRelations`, which the form draws
 * its dropdowns by too). Otherwise the field is plain text.
 */
function linkedEnds(source: LinkEnd, catalog: readonly CapabilityRow[]) {
  const relation = relationOf(holdingRelations(source.row, catalog), source.field);
  const target = catalog.find((candidate) => candidate.id === relation?.to.capability);
  const sourceField = linkableField(source);
  const targetField = target && linkableField({ row: target, field: relation?.to.field ?? "" });
  if (!relation || !target || !sourceField || !targetField) return null;
  return { relation, sourceField, target, targetField };
}

/** Every record whose target field holds text, in the order a reader looks a name up in. */
function targetRecords(
  row: CapabilityRow,
  field: SpecField,
  database: PlatformDatabase["readonly"],
  signal: AbortSignal,
): PickRecord[] {
  const target = capabilitySpecFromRow(row);
  const table = sqlIdentifier(deriveCapabilityTableDdl(target).tableName);
  const column = sqlIdentifier(field.name);
  const rows = createCapabilityQueryPort(database, { target, signal }).records({
    sql:
      `SELECT "id" AS "target_id" FROM ${table}` +
      ` WHERE ${column} IS NOT NULL AND trim(${column}) <> ''`,
  });
  // SQLite's `trim` takes spaces only: a record whose text holds nothing a match could compare,
  // invisible marks and all, is left out, as the matching scan leaves it.
  return rows
    .map(({ record }) => {
      const stored = storedCapabilityActionRecord(record);
      return { id: String(stored.id), text: String(stored[field.name]) };
    })
    .filter((record) => matchKey(record.text) !== "")
    .sort((a, b) => collator.compare(a.text, b.text) || order(a.text, b.text) || order(a.id, b.id));
}

function order(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
