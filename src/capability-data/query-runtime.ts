import type { Database } from "bun:sqlite";

import { activeSpecFields, type CapabilitySpec } from "../registry/index.ts";
import { deriveCapabilityTableDdl } from "./ddl.ts";
import { CapabilityDataValidationError, sqlIdentifier } from "./internal.ts";
import type {
  CapabilityActionRecord,
  CapabilityDataColumnValue,
  CapabilityDataRow,
  CapabilityQueryParameter,
  CapabilityQueryResultColumn,
  CapabilityQueryRow,
  CapabilityQueryScope,
  CapabilityRecordHandle,
  CapabilityRecordQueryInput,
  CapabilityRecordQueryRow,
  StoredCapabilityRow,
} from "./tool.ts";

type ProjectedQuery = (
  database: Database,
  sql: string,
  parameters: readonly CapabilityQueryParameter[],
  result: readonly CapabilityQueryResultColumn[],
) => CapabilityQueryRow[];

type NormalizeQueryValue = (
  alias: string,
  type: CapabilityQueryResultColumn["type"],
  value: unknown,
) => CapabilityDataColumnValue;

const actionRecordHandles = new WeakMap<object, CapabilityDataRow>();

export function executeRecordQuery(
  database: Database,
  scope: CapabilityQueryScope | undefined,
  input: CapabilityRecordQueryInput,
  executeProjectedQuery: ProjectedQuery,
  normalizeValue: NormalizeQueryValue,
): CapabilityRecordQueryRow[] {
  if (!scope) {
    throw new CapabilityDataValidationError(
      "Record-producing queries require a target capability scope.",
    );
  }
  const { sql, parameters = [], targetIdAlias = "target_id", result = [] } = input;
  assertScopedQuery(database, scope, sql, parameters, { allowTargetId: true });
  return withReadSnapshot(database, () => {
    const descriptor = [{ alias: targetIdAlias, type: "string" as const }, ...result];
    const selected = executeProjectedQuery(database, sql, parameters, descriptor);
    const ids = selected.map((row) => row[targetIdAlias]);
    if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new CapabilityDataValidationError(
        `Record query alias "${targetIdAlias}" must contain nonblank target ids.`,
      );
    }
    const stringIds = ids as string[];
    if (new Set(stringIds).size !== stringIds.length) {
      throw new CapabilityDataValidationError("Record query returned duplicate target ids.");
    }
    const canonical = rehydrateCanonicalRows(scope.target, stringIds, database);
    return selected.map((row, index) => {
      const id = stringIds[index];
      const canonicalRow = id ? canonical.get(id) : undefined;
      if (!canonicalRow) {
        throw new CapabilityDataValidationError(
          `Record query returned missing or foreign target id "${id ?? ""}".`,
        );
      }
      return {
        record: actionRecord(scope.target, canonicalRow, normalizeValue),
        values: Object.fromEntries(
          result.map(({ alias }) => [alias, row[alias]]),
        ) as CapabilityQueryRow,
      };
    });
  });
}

/** Platform-only bridge from an opaque Action record to presentation input. */
export function materializeCapabilityActionRecord(
  record: CapabilityActionRecord,
): CapabilityDataRow {
  const canonical = actionRecordHandles.get(record.handle as object);
  if (!canonical) throw new CapabilityDataValidationError("Unknown capability record handle.");
  return { id: canonical.id, created_at: canonical.created_at, ...record.fields };
}

export function isCapabilityActionRecord(value: unknown): value is CapabilityActionRecord {
  if (typeof value !== "object" || value === null || !("handle" in value)) return false;
  const handle = value.handle;
  return typeof handle === "object" && handle !== null && actionRecordHandles.has(handle);
}

export function createCapabilityActionRecord(row: CapabilityDataRow): CapabilityActionRecord {
  const { id, created_at, ...fields } = row;
  const handle = Object.freeze({}) as CapabilityRecordHandle;
  actionRecordHandles.set(
    handle as object,
    Object.freeze({ id, created_at, ...fields }) as CapabilityDataRow,
  );
  return Object.freeze({
    fields: Object.freeze(fields),
    created_at,
    handle,
  });
}

function actionRecord(
  spec: CapabilitySpec,
  row: StoredCapabilityRow,
  normalizeValue: NormalizeQueryValue,
): CapabilityActionRecord {
  const fields = Object.fromEntries(
    activeSpecFields(spec.schema.fields).map((field) => [
      field.name,
      normalizeValue(field.name, field.type, row[field.name]),
    ]),
  );
  return createCapabilityActionRecord({
    id: String(row.id),
    created_at: normalizeValue("created_at", "datetime", row.created_at) as string,
    ...fields,
  });
}

function rehydrateCanonicalRows(
  spec: CapabilitySpec,
  ids: readonly string[],
  database: Database,
): Map<string, StoredCapabilityRow> {
  if (ids.length === 0) return new Map();
  const { tableName } = deriveCapabilityTableDdl(spec);
  const columns = ["id", "created_at", "extra", ...spec.schema.fields.map(({ name }) => name)];
  const sql = `SELECT ${columns.map(sqlIdentifier).join(", ")} FROM ${sqlIdentifier(tableName)} WHERE "id" IN (${ids.map(() => "?").join(", ")})`;
  const rows = database.query(sql).all(...ids) as StoredCapabilityRow[];
  return new Map(rows.map((row) => [String(row.id), row]));
}

function withReadSnapshot<T>(database: Database, operation: () => T): T {
  const ownsTransaction = !database.inTransaction;
  if (ownsTransaction) {
    // A cached `.get()` statement can retain its last read snapshot until it is
    // reset. Finalize those cursors before opening the Action's explicit
    // selection + rehydration snapshot so a preceding registry lookup cannot
    // pin stale capability data.
    (database as Database & { clearQueryCache(): void }).clearQueryCache();
    database.exec("BEGIN");
  }
  try {
    const result = operation();
    if (ownsTransaction) database.exec("COMMIT");
    return result;
  } catch (error) {
    if (ownsTransaction && database.inTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

interface ExplainOpcode {
  readonly p1: number;
  readonly opcode: string;
  readonly p2: number;
}

interface SchemaRoot {
  readonly name: string;
  readonly rootpage: number;
  readonly tbl_name: string;
  readonly type: "index" | "table";
}

interface QueryScopeOptions {
  readonly allowTargetId: boolean;
}

export function assertScopedQuery(
  database: Database,
  scope: CapabilityQueryScope,
  sql: string,
  parameters: readonly CapabilityQueryParameter[],
  options: QueryScopeOptions,
): void {
  if (/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) return;
  if (!/^\s*(?:SELECT|WITH)\b/i.test(sql) || /;\s*\S/.test(sql)) {
    throw new CapabilityDataValidationError("The query port accepts one SELECT statement.");
  }
  assertNoAmbientSchemaReader(sql);
  const allowedTables = new Set(capabilityQueryScopeTableNames(scope));
  const roots = database
    .query(
      "SELECT type, name, rootpage, tbl_name FROM sqlite_master WHERE rootpage > 0 AND type IN ('table', 'index')",
    )
    .all() as SchemaRoot[];
  const sourceByRoot = new Map(roots.map((root) => [root.rootpage, root] as const));
  const opcodes = database.query(`EXPLAIN ${sql}`).all(...parameters) as ExplainOpcode[];
  const accessed = new Set(
    opcodes
      .filter(({ opcode, p2 }) => opcode === "OpenRead" && p2 > 0)
      .map(({ p2 }) => sourceByRoot.get(p2)?.tbl_name ?? (p2 === 1 ? "sqlite_schema" : undefined))
      .filter((table): table is string => table !== undefined),
  );
  const forbidden = [...accessed].filter((table) => !allowedTables.has(table)).sort();
  if (forbidden.length > 0) {
    throw new CapabilityDataValidationError(
      `Query accesses undeclared capability table${forbidden.length === 1 ? "" : "s"}: ${forbidden.join(", ")}.`,
    );
  }
  assertTargetColumnAccess(database, scope, opcodes, sourceByRoot, options);
}

/** The canonical physical tables admitted by one Action's target/dependency scope. */
export function capabilityQueryScopeTableNames(scope: CapabilityQueryScope): readonly string[] {
  return [scope.target, ...(scope.dependencies ?? [])].map(
    (spec) => deriveCapabilityTableDdl(spec).tableName,
  );
}

function assertNoAmbientSchemaReader(sql: string): void {
  if (/\b(?:pragma_[a-z0-9_]+|sqlite_[a-z0-9_]+|dbstat)\b/i.test(sql)) {
    throw new CapabilityDataValidationError(
      "Query access to SQLite schema and ambient virtual tables is not available to Handlers.",
    );
  }
}

function assertTargetColumnAccess(
  database: Database,
  scope: CapabilityQueryScope,
  opcodes: readonly ExplainOpcode[],
  sourceByRoot: ReadonlyMap<number, SchemaRoot>,
  options: QueryScopeOptions,
): void {
  const targetTable = deriveCapabilityTableDdl(scope.target).tableName;
  const forbiddenColumns = protectedTargetColumns(scope, options);
  const cursorColumns = targetCursorColumns(database, opcodes, sourceByRoot, targetTable);
  const exposed = accessedProtectedColumns(opcodes, cursorColumns, forbiddenColumns);
  if (exposed.size > 0) {
    throw new CapabilityDataValidationError(
      `Query reads protected target column${exposed.size === 1 ? "" : "s"}: ${[...exposed].sort().join(", ")}.`,
    );
  }
}

function protectedTargetColumns(
  scope: CapabilityQueryScope,
  options: QueryScopeOptions,
): ReadonlySet<string> {
  const columns = new Set([
    "extra",
    ...scope.target.schema.fields
      .filter(({ lifecycle }) => lifecycle === "inactive")
      .map(({ name }) => name),
  ]);
  if (!options.allowTargetId) columns.add("id");
  return columns;
}

function targetCursorColumns(
  database: Database,
  opcodes: readonly ExplainOpcode[],
  sourceByRoot: ReadonlyMap<number, SchemaRoot>,
  targetTable: string,
): ReadonlyMap<number, ReadonlyMap<number, string>> {
  const cursorColumns = new Map<number, ReadonlyMap<number, string>>();
  for (const opcode of opcodes) {
    if (opcode.opcode !== "OpenRead") continue;
    const source = sourceByRoot.get(opcode.p2);
    if (!source || source.tbl_name !== targetTable) continue;
    cursorColumns.set(opcode.p1, sourceColumns(database, source));
  }
  return cursorColumns;
}

function accessedProtectedColumns(
  opcodes: readonly ExplainOpcode[],
  cursorColumns: ReadonlyMap<number, ReadonlyMap<number, string>>,
  forbiddenColumns: ReadonlySet<string>,
): ReadonlySet<string> {
  const exposed = new Set<string>();
  for (const opcode of opcodes) {
    if (opcode.opcode !== "Column") continue;
    const column = cursorColumns.get(opcode.p1)?.get(opcode.p2);
    if (column && forbiddenColumns.has(column)) exposed.add(column);
  }
  return exposed;
}

function sourceColumns(database: Database, source: SchemaRoot): ReadonlyMap<number, string> {
  const pragma = source.type === "table" ? "table_xinfo" : "index_xinfo";
  const rows = database.query(`PRAGMA ${pragma}(${sqlIdentifier(source.name)})`).all() as {
    readonly cid: number;
    readonly name: string | null;
    readonly seqno?: number;
  }[];
  return new Map(
    rows
      .filter(({ name }) => name !== null)
      .map((row) => [
        source.type === "table" ? row.cid : (row.seqno ?? row.cid),
        row.name as string,
      ]),
  );
}
