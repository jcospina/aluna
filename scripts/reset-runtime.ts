import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const GENERATED_DIRS = ["capabilities", "storage"] as const;
const TRACKED_PLACEHOLDER = "README.md";
const DATABASE_PATH = join("data", "omni-crud.db");
const CAPABILITY_TABLE_PREFIX = "cap_";
const PLATFORM_DATA_TABLES = ["capability_registry", "generation_metrics", "event_log"] as const;

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

  for (const dirname of GENERATED_DIRS) {
    const directory = join(root, dirname);
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
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });

  const database = new Database(join(root, DATABASE_PATH), { create: true, readwrite: true });
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA busy_timeout = 5000;");

  try {
    const existingTables = listTables(database);
    const clearedTables: string[] = [];
    const droppedTables: string[] = [];

    database.transaction(() => {
      for (const table of PLATFORM_DATA_TABLES) {
        if (!existingTables.has(table)) continue;
        database.run(`DELETE FROM ${quoteIdentifier(table)}`);
        clearedTables.push(table);
      }

      for (const table of existingTables) {
        if (!table.startsWith(CAPABILITY_TABLE_PREFIX)) continue;
        database.run(`DROP TABLE ${quoteIdentifier(table)}`);
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

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function generatedLeftovers(root: string): string[] {
  const leftovers: string[] = [];

  for (const dirname of GENERATED_DIRS) {
    const directory = join(root, dirname);
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
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
