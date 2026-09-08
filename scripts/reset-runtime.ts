// Reset imports every table and root it clears, so adding or renaming one cannot leave corpus
// behind here. The one name written out is the retired tombstone store, which no module declares
// any more; every module that does declare one is a leaf, so naming a table opens no database.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_ARTIFACTS_ROOT } from "../src/builder/artifacts/artifacts-root.ts";
import { errorMessage } from "../src/platform/errors.ts";
import { DB_PATH } from "../src/platform/persistence/db-path.ts";
import { sqlIdentifier } from "../src/platform/persistence/sql-identifier.ts";
import {
  CAPABILITY_TABLE_PREFIX,
  EVENT_LOG_OWNERSHIP_TABLE,
  EVENT_LOG_TABLE,
  GENERATION_LIFECYCLE_TABLE,
  GENERATION_METRICS_TABLE,
  INTENT_RESOLUTION_METRICS_TABLE,
  OBJECT_STORE_ROOT,
  REGISTRY_TABLE,
} from "../src/platform/persistence/table-names.ts";

const GENERATED_DIRS = [DEFAULT_ARTIFACTS_ROOT, OBJECT_STORE_ROOT] as const;
const TRACKED_PLACEHOLDER = "README.md";
const PLATFORM_DATA_TABLES = [
  REGISTRY_TABLE,
  GENERATION_METRICS_TABLE,
  GENERATION_LIFECYCLE_TABLE,
  INTENT_RESOLUTION_METRICS_TABLE,
  // Pre-4.9 databases may still carry the retired standalone tombstone store. No module declares
  // it any more, so the name lives here; clearing it keeps reset corpus-free across local histories.
  "capability_deletion_tombstones",
  EVENT_LOG_TABLE,
  // Both halves of the Event Log store, or a reset leaves ownership rows pointing at deleted
  // event ids. Neither exists outside the 4.9 seam fake until M7, so both are no-ops today.
  EVENT_LOG_OWNERSHIP_TABLE,
] as const;

export interface ResetRuntimeOptions {
  readonly root?: string;
}

export interface ResetRuntimeResult {
  readonly root: string;
  readonly deletedPaths: readonly string[];
  readonly clearedTables: readonly string[];
  readonly droppedTables: readonly string[];
}

export function resetRuntime(options: ResetRuntimeOptions = {}): ResetRuntimeResult {
  const root = resolve(options.root ?? process.cwd());
  const deletedPaths: string[] = [];
  const databaseResult = wipeDatabaseData(root);

  for (const generatedDir of GENERATED_DIRS) {
    const directory = join(root, generatedDir);
    mkdirSync(directory, { recursive: true });

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === TRACKED_PLACEHOLDER) continue;

      const path = join(directory, entry.name);
      rmSync(path, { force: true, recursive: true });
      deletedPaths.push(path);
    }
  }

  const leftovers = generatedLeftovers(root);
  if (leftovers.length > 0) {
    throw new Error(`Runtime reset left generated files behind: ${leftovers.join(", ")}`);
  }

  return {
    root,
    deletedPaths,
    clearedTables: databaseResult.clearedTables,
    droppedTables: databaseResult.droppedTables,
  };
}

function wipeDatabaseData(root: string): {
  readonly clearedTables: readonly string[];
  readonly droppedTables: readonly string[];
} {
  const databasePath = join(root, DB_PATH);
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new Database(databasePath, { create: true, readwrite: true });
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA busy_timeout = 5000;");

  try {
    const existingTables = listTables(database);
    const clearedTables: string[] = [];
    const droppedTables: string[] = [];

    database.transaction(() => {
      for (const table of PLATFORM_DATA_TABLES) {
        if (!existingTables.has(table)) continue;
        database.run(`DELETE FROM ${sqlIdentifier(table)}`);
        clearedTables.push(table);
      }

      for (const table of existingTables) {
        if (!table.startsWith(CAPABILITY_TABLE_PREFIX)) continue;
        database.run(`DROP TABLE ${sqlIdentifier(table)}`);
        droppedTables.push(table);
      }
    })();

    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");

    return { clearedTables, droppedTables };
  } finally {
    database.close();
  }
}

function listTables(database: Database): Set<string> {
  const rows = database
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];

  return new Set(rows.map((row) => row.name));
}

function generatedLeftovers(root: string): string[] {
  const leftovers: string[] = [];

  for (const generatedDir of GENERATED_DIRS) {
    const directory = join(root, generatedDir);
    if (!existsSync(directory)) continue;

    for (const entry of readdirSync(directory)) {
      if (entry === TRACKED_PLACEHOLDER) continue;
      leftovers.push(join(directory, entry));
    }
  }

  return leftovers;
}

if (import.meta.main) {
  try {
    const result = resetRuntime();
    console.log(`Reset runtime data under ${result.root}`);
    console.log(`Cleared ${result.clearedTables.length} platform data table(s).`);
    console.log(`Dropped ${result.droppedTables.length} generated capability table(s).`);
    console.log(`Deleted ${result.deletedPaths.length} generated artifact/blob path(s).`);
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
