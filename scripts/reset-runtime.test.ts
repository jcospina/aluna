import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetRuntime } from "./reset-runtime.ts";

describe("runtime reset script", () => {
  test("wipes runtime data while preserving the database file and migration ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "omni-crud-reset-"));

    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(join(root, "capabilities", "notes", "v1"), { recursive: true });
    mkdirSync(join(root, "storage"), { recursive: true });

    writeFileSync(join(root, "data", "README.md"), "tracked data placeholder");
    writeFileSync(join(root, "capabilities", "README.md"), "tracked capability placeholder");
    writeFileSync(join(root, "storage", "README.md"), "tracked storage placeholder");
    writeFileSync(join(root, "capabilities", "notes", "v1", "read.ts"), "generated handler");
    writeFileSync(join(root, "storage", "blob-key"), "blob bytes");

    const databasePath = join(root, "data", "omni-crud.db");
    const database = new Database(databasePath, { create: true, readwrite: true });
    database.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE capability_registry (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE generation_metrics (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE cap_notes (id TEXT PRIMARY KEY, text TEXT) STRICT;
      INSERT INTO schema_migrations (id) VALUES ('0001_platform_migrations_ledger');
      INSERT INTO capability_registry (id) VALUES ('notes');
      INSERT INTO generation_metrics (id) VALUES ('build-notes-1');
      INSERT INTO cap_notes (id, text) VALUES ('note-1', 'old data');
    `);
    database.close();

    const result = resetRuntime({ root });

    expect(result.clearedTables).toEqual(["capability_registry", "generation_metrics"]);
    expect(result.droppedTables).toEqual(["cap_notes"]);
    expect(result.deletedPaths.length).toBe(2);
    expect(readdirSync(join(root, "capabilities"))).toEqual(["README.md"]);
    expect(readdirSync(join(root, "storage"))).toEqual(["README.md"]);
    expect(existsSync(databasePath)).toBe(true);

    const wipedDatabase = new Database(databasePath, { readonly: true });
    expect(wipedDatabase.query("SELECT id FROM schema_migrations").all()).toEqual([
      { id: "0001_platform_migrations_ledger" },
    ]);
    expect(wipedDatabase.query("SELECT id FROM capability_registry").all()).toEqual([]);
    expect(wipedDatabase.query("SELECT id FROM generation_metrics").all()).toEqual([]);
    expect(
      wipedDatabase
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cap_notes'")
        .get(),
    ).toBeNull();
    wipedDatabase.close();
  });
});
