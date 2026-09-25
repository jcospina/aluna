import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { mintFileKey } from "../src/platform/files/ledger.ts";
import {
  OBJECT_STORE_ROOT,
  OBJECT_STORE_ROOT_ENV_VAR,
  STAGING_DIRECTORY,
} from "../src/platform/files/object-store-root.ts";
import { resetRuntime } from "./reset-runtime.ts";

/** A store under `storeRoot` holding a placed key, a staged one, and a file that is not the store's. */
function fillStore(storeRoot: string): { placed: string; staged: string } {
  const placed = mintFileKey();
  const staged = mintFileKey();
  mkdirSync(join(storeRoot, STAGING_DIRECTORY), { recursive: true });
  writeFileSync(join(storeRoot, placed), "blob bytes");
  writeFileSync(join(storeRoot, STAGING_DIRECTORY, staged), "half an upload");
  writeFileSync(join(storeRoot, "notes.txt"), "not the store's");
  return { placed, staged };
}

describe("runtime reset script", () => {
  test("wipes runtime data while preserving the database file and migration ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "omni-crud-reset-"));

    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(join(root, "capabilities", "notes", "v1"), { recursive: true });
    mkdirSync(join(root, OBJECT_STORE_ROOT), { recursive: true });

    writeFileSync(join(root, "data", "README.md"), "tracked data placeholder");
    writeFileSync(join(root, "capabilities", "README.md"), "tracked capability placeholder");
    writeFileSync(join(root, OBJECT_STORE_ROOT, "README.md"), "tracked storage placeholder");
    writeFileSync(join(root, "capabilities", "notes", "v1", "read.ts"), "generated handler");
    const { placed } = fillStore(join(root, OBJECT_STORE_ROOT));

    const databasePath = join(root, "data", "omni-crud.db");
    const database = new Database(databasePath, { create: true, readwrite: true });
    database.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE capability_registry (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE generation_metrics (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE generation_lifecycle_metrics (build_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE intent_resolution_metrics (request_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE capability_deletion_tombstones (capability_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE file_ledger (key TEXT PRIMARY KEY) STRICT;
      CREATE TABLE cap_notes (id TEXT PRIMARY KEY, text TEXT) STRICT;
      INSERT INTO schema_migrations (id) VALUES ('0001_platform_migrations_ledger');
      INSERT INTO capability_registry (id) VALUES ('notes');
      INSERT INTO generation_metrics (id) VALUES ('build-notes-1');
      INSERT INTO generation_lifecycle_metrics (build_id) VALUES ('build-notes-1');
      INSERT INTO intent_resolution_metrics (request_id) VALUES ('request-notes-1');
      INSERT INTO capability_deletion_tombstones (capability_id) VALUES ('retired-notes');
      INSERT INTO file_ledger (key) VALUES ('a-pending-photo');
      INSERT INTO cap_notes (id, text) VALUES ('note-1', 'old data');
    `);
    database.close();

    const result = resetRuntime({ root, env: {} });

    expect(result.clearedTables).toEqual([
      "capability_registry",
      "generation_metrics",
      "generation_lifecycle_metrics",
      "intent_resolution_metrics",
      "capability_deletion_tombstones",
      "file_ledger",
    ]);
    expect(result.droppedTables).toEqual(["cap_notes"]);
    // Naming the paths, not counting them: deleting two of the wrong things would
    // satisfy a length check just as well.
    expect(result.deletedPaths.map((path: string) => relative(root, path)).sort()).toEqual(
      [
        join("capabilities", "notes"),
        join(OBJECT_STORE_ROOT, STAGING_DIRECTORY),
        join(OBJECT_STORE_ROOT, placed),
      ].sort(),
    );
    expect(readdirSync(join(root, "capabilities"))).toEqual(["README.md"]);
    expect(readdirSync(join(root, OBJECT_STORE_ROOT)).sort()).toEqual(["README.md", "notes.txt"]);
    expect(existsSync(databasePath)).toBe(true);

    const wipedDatabase = new Database(databasePath, { readonly: true });
    expect(wipedDatabase.query("SELECT id FROM schema_migrations").all()).toEqual([
      { id: "0001_platform_migrations_ledger" },
    ]);
    expect(wipedDatabase.query("SELECT id FROM capability_registry").all()).toEqual([]);
    expect(wipedDatabase.query("SELECT id FROM generation_metrics").all()).toEqual([]);
    expect(wipedDatabase.query("SELECT build_id FROM generation_lifecycle_metrics").all()).toEqual(
      [],
    );
    expect(wipedDatabase.query("SELECT request_id FROM intent_resolution_metrics").all()).toEqual(
      [],
    );
    expect(
      wipedDatabase.query("SELECT capability_id FROM capability_deletion_tombstones").all(),
    ).toEqual([]);
    expect(wipedDatabase.query("SELECT key FROM file_ledger").all()).toEqual([]);
    expect(
      wipedDatabase
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cap_notes'")
        .get(),
    ).toBeNull();
    wipedDatabase.close();
  });

  test("empties the configured object store root, and only the store's own entries in it", async () => {
    const root = await mkdtemp(join(tmpdir(), "omni-crud-reset-"));
    const elsewhere = await mkdtemp(join(tmpdir(), "omni-crud-reset-store-"));
    const defaultStore = fillStore(join(root, OBJECT_STORE_ROOT));
    const { placed } = fillStore(elsewhere);

    const result = resetRuntime({ root, env: { [OBJECT_STORE_ROOT_ENV_VAR]: elsewhere } });

    expect(result.deletedPaths.filter((path) => path.startsWith(elsewhere)).sort()).toEqual(
      [join(elsewhere, STAGING_DIRECTORY), join(elsewhere, placed)].sort(),
    );
    expect(readdirSync(elsewhere)).toEqual(["notes.txt"]);
    expect(readdirSync(join(root, OBJECT_STORE_ROOT)).sort()).toEqual(
      [STAGING_DIRECTORY, "notes.txt", defaultStore.placed].sort(),
    );
  });
});
