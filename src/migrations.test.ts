// Tests for the platform migrations runner (Epic 1.4). The behavioral cases run
// against a throwaway db (via openDatabase) so each is isolated; a final boot case
// spawns the real entrypoint in a temp working directory and asserts the migration
// runs on boot. The headline guarantees: an ordered migration is applied through
// the read-write connection and recorded, a re-run is a clean no-op, and only
// platform schema — the ledger, no domain/capability tables — is created.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "./db.ts";
import { MIGRATIONS, MIGRATIONS_TABLE, runMigrations } from "./migrations.ts";

const BASELINE_ID = "0001_platform_migrations_ledger";

// User-defined tables only — SQLite's internal `sqlite_*` tables are excluded so
// the "no domain tables" assertion is about schema the platform actually created.
function userTables(database: Database): string[] {
  const rows = database
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return rows.map((row) => row.name).sort();
}

describe("platform migrations runner", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-mig-"));
    conns = openDatabase(join(dir, "test.db"));
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("applies the ordered migrations through the read-write connection and records them", () => {
    const applied = runMigrations(conns.readwrite);

    // Every migration ran, in order, and reported itself applied.
    expect(applied).toEqual(MIGRATIONS.map((m) => m.id));
    expect(applied).toContain(BASELINE_ID);

    // The ledger exists and holds a row per applied migration, each stamped.
    const rows = conns.readwrite
      .query(`SELECT id, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY id`)
      .all() as { id: string; applied_at: string }[];
    expect(rows.map((r) => r.id)).toEqual(applied);
    for (const row of rows) {
      expect(row.applied_at).toBeTruthy();
    }
  });

  test("re-running is a no-op (idempotent)", () => {
    runMigrations(conns.readwrite);
    const before = conns.readwrite
      .query(`SELECT id, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY id`)
      .all() as { id: string; applied_at: string }[];

    // A second pass applies nothing and leaves the ledger byte-for-byte the same —
    // no duplicate rows, no re-stamped applied_at.
    const appliedAgain = runMigrations(conns.readwrite);
    expect(appliedAgain).toEqual([]);

    const after = conns.readwrite
      .query(`SELECT id, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY id`)
      .all() as { id: string; applied_at: string }[];
    expect(after).toEqual(before);
  });

  test("creates platform schema only — no domain or capability tables", () => {
    runMigrations(conns.readwrite);

    // The only table the platform stands up in Module 1 is the migrations ledger.
    // The registry, event log, data tables, and metrics are owned by later modules.
    expect(userTables(conns.readwrite)).toEqual([MIGRATIONS_TABLE]);
  });

  test("the migration is durable on the read-only connection", () => {
    runMigrations(conns.readwrite);

    // Reading the ledger back through the separate read-only connection proves the
    // write landed in the shared db file, not just in the writer's view.
    const row = conns.readonly
      .query(`SELECT id FROM ${MIGRATIONS_TABLE} WHERE id = ?`)
      .get(BASELINE_ID) as { id: string } | null;
    expect(row?.id).toBe(BASELINE_ID);
  });
});

describe("migrations run on app boot", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-boot-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("booting the entrypoint creates the db file with the migrations table", async () => {
    const entry = join(import.meta.dir, "index.ts");

    // Boot the real entrypoint with the temp dir as cwd, so its relative db path
    // (data/omni-crud.db) resolves to an isolated location. PORT=0 binds an
    // ephemeral port to avoid clashing with anything already listening.
    const proc = Bun.spawn(["bun", entry], {
      cwd: dir,
      env: { ...process.env, PORT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // The "listening" line is logged only after runMigrations() returns, so
      // seeing it means migrations have run.
      await waitForLog(proc.stdout, "listening", 15000);

      const dbPath = join(dir, "data", "omni-crud.db");
      expect(existsSync(dbPath)).toBe(true);

      const booted = new Database(dbPath, { readonly: true });
      try {
        const ledger = booted
          .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(MIGRATIONS_TABLE);
        expect(ledger).toBeTruthy();

        const baseline = booted
          .query(`SELECT id FROM ${MIGRATIONS_TABLE} WHERE id = ?`)
          .get(BASELINE_ID) as { id: string } | null;
        expect(baseline?.id).toBe(BASELINE_ID);
      } finally {
        booted.close();
      }
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 20000);
});

// Read a piped stream until `needle` appears in the decoded output, or reject once
// `timeoutMs` elapses. Used to detect the entrypoint's boot log without a sleep.
async function waitForLog(
  stream: ReadableStream<Uint8Array>,
  needle: string,
  timeoutMs: number,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = "";

  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`timed out waiting for "${needle}"`)), timeoutMs),
  );

  const scan = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`stream ended before "${needle}" appeared`);
      seen += decoder.decode(value, { stream: true });
      if (seen.includes(needle)) return;
    }
  })();

  try {
    await Promise.race([scan, deadline]);
  } finally {
    reader.releaseLock();
  }
}
