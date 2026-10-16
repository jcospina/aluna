// Fields linked before the matching scan existed never had their names matched, so a name
// one record holds letter for letter still asked for a pick. At startup, before any request, every
// relation that holds has the names it holds without a working link matched as linking matches
// them today. A link that works stands, and a name no record holds, or several do, keeps its mark.

import type { Database } from "bun:sqlite";
import {
  type CapabilityRow,
  holdingRelations,
  listCapabilities,
  type Relation,
} from "../../../registry/index.ts";
import { matchUnlinkedNames } from "./matching-scan.ts";

/** One linked field's matching at startup: how many records it linked, or why it could not. */
export type StartupMatch =
  | { readonly capability: string; readonly field: string; readonly linked: number }
  | { readonly capability: string; readonly field: string; readonly error: unknown };

/** Match every linked field's unlinked names; one field that fails leaves the others to run. */
export function matchLinkedFieldsAtStartup(database: Database): StartupMatch[] {
  const catalog = listCapabilities(database);
  return catalog.flatMap((source) =>
    holdingRelations(source, catalog).flatMap((relation) => {
      const { capability, incarnation } = relation.to;
      const target = catalog.find(
        (row) => row.id === capability && row.incarnation_id === incarnation,
      );
      return target ? matchField(database, source, target, relation) : [];
    }),
  );
}

/** One field's matching, as the startup reports it: nothing when it linked nothing. */
function matchField(
  database: Database,
  source: CapabilityRow,
  target: CapabilityRow,
  relation: Relation,
): StartupMatch[] {
  const field = { capability: source.id, field: relation.field };
  try {
    const { linked } = matchUnlinkedNames(database, source, target, relation);
    return linked > 0 ? [{ ...field, linked }] : [];
  } catch (error) {
    return [{ ...field, error }];
  }
}
