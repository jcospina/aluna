import type { Database } from "bun:sqlite";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";

// What SQLite says a capability table is, for the suites that check DDL against the file.

/** One row of `PRAGMA table_xinfo`. */
interface TableColumn {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: 0 | 1;
  readonly dflt_value: string | null;
  readonly pk: number;
  readonly hidden: number;
}

export function tableColumns(database: Database, tableName: string): TableColumn[] {
  return database.query(`PRAGMA table_xinfo(${sqlIdentifier(tableName)})`).all() as TableColumn[];
}
