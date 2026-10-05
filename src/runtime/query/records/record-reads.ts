// The two reads the record checks make, inside the question's own scope (ADR-0010): which
// capabilities hold each id the steps returned, and the stored record behind each nomination
// that survives that. Both go through the scope's worker and its views, so they read the very
// snapshot the steps read, and both hand back `undefined` for any failure but the question ending:
// a check that could not be read costs the links, never the answer.

import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import { capabilityTableName } from "../../data/schema/ddl.ts";
import type { WholeCatalogReadScope } from "../scope/whole-catalog-read-scope.ts";
import type { QueryWorkerRow } from "../worker/query-worker.ts";

export type CheckingScope = Pick<WholeCatalogReadScope, "catalog" | "read" | "signal">;

/** Which capabilities hold each id. An id no capability holds is no record's. */
export type Holders = ReadonlyMap<string, ReadonlySet<string>>;

/** How many capabilities one read asks at once, well inside SQLite's compound-select limit. */
const CAPABILITIES_PER_READ = 50;

/** A literal SQL string. Capability ids are the spec gate's `[a-z][a-z0-9_]*`; this holds anyway. */
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

const tableOf = (capability: string) => sqlIdentifier(capabilityTableName(capability));

async function readOrNothing<T>(
  scope: CheckingScope,
  read: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (scope.signal.aborted) throw error;
    return undefined;
  }
}

/** Which capabilities of the whole catalog hold each of `ids`. */
export function holdersOf(
  scope: CheckingScope,
  ids: ReadonlySet<string>,
): Promise<Holders | undefined> {
  return readOrNothing(scope, async () => {
    const holders = new Map<string, Set<string>>();
    if (ids.size === 0) return holders;
    const listed = JSON.stringify([...ids]);
    const capabilities = scope.catalog.capabilities.map((row) => row.id);
    for (let from = 0; from < capabilities.length; from += CAPABILITIES_PER_READ) {
      const asked = capabilities.slice(from, from + CAPABILITIES_PER_READ);
      const each = asked.map(
        (capability) =>
          `SELECT ${literal(capability)} AS capability, id FROM ${tableOf(capability)} WHERE id IN (SELECT id FROM wanted)`,
      );
      const sql = `WITH wanted(id) AS (SELECT value FROM json_each(?)) ${each.join(" UNION ALL ")}`;
      for (const row of await scope.read(sql, [listed])) {
        const id = String(row.id);
        holders.set(id, (holders.get(id) ?? new Set()).add(String(row.capability)));
      }
    }
    return holders;
  });
}

/** Each wanted record as its capability stores it, by id, in the columns a question may read. */
export function storedRecords(
  scope: CheckingScope,
  wanted: readonly { readonly id: string; readonly capability: string }[],
): Promise<ReadonlyMap<string, QueryWorkerRow> | undefined> {
  return readOrNothing(scope, async () => {
    const records = new Map<string, QueryWorkerRow>();
    for (const capability of new Set(wanted.map((record) => record.capability))) {
      const ids = wanted.filter((record) => record.capability === capability).map(({ id }) => id);
      for (const row of await scope.read(
        `SELECT * FROM ${tableOf(capability)} WHERE id IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(ids)],
      )) {
        records.set(String(row.id), row);
      }
    }
    return records;
  });
}
