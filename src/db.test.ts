// Tests for the dual SQLite connections (Epic 1.4). The behavioral cases run
// against a throwaway db file per test (via openDatabase) so they're isolated and
// deterministic; a final case asserts the shared singletons are wired to the
// documented location. The headline guarantee — a write on the read-only
// connection is physically impossible (ARCH §3, §7) — is proven for both DML and
// DDL, since the boundary must hold regardless of what SQL is issued.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DB_PATH, db, dbReadonly, openDatabase, type PlatformDatabase } from "./db.ts";

describe("dual sqlite connections", () => {
  let dir: string;
  let path: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-db-"));
    path = join(dir, "test.db");
    conns = openDatabase(path);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates the db file at the given location if it does not exist", () => {
    expect(existsSync(path)).toBe(true);
  });

  test("a write on the read-write connection succeeds", () => {
    conns.readwrite.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    conns.readwrite.run("INSERT INTO t (v) VALUES (?)", ["hello"]);

    const row = conns.readwrite.query("SELECT v FROM t WHERE id = 1").get() as { v: string };
    expect(row.v).toBe("hello");
  });

  test("an attempted write on the read-only connection fails", () => {
    conns.readwrite.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");

    // DML write — rejected by SQLite, not by any application-level check.
    expect(() => conns.readonly.run("INSERT INTO t (v) VALUES (?)", ["nope"])).toThrow(
      /readonly database/,
    );
    // DDL is a write too: the boundary holds regardless of the SQL issued.
    expect(() => conns.readonly.exec("CREATE TABLE u (id INTEGER)")).toThrow(/readonly database/);
  });

  test("the read-only connection still reads rows committed by the read-write one", () => {
    conns.readwrite.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    conns.readwrite.run("INSERT INTO t (v) VALUES (?)", ["visible"]);

    const row = conns.readonly.query("SELECT v FROM t WHERE id = 1").get() as { v: string };
    expect(row.v).toBe("visible");
  });

  test("exposes shared rw + ro access points at the documented db location", () => {
    expect(DB_PATH).toBe("data/omni-crud.db");
    // Importing the module opened both singletons against DB_PATH, creating the
    // real file on disk (gitignored — see data/README.md).
    expect(existsSync(DB_PATH)).toBe(true);
    expect(db.query("SELECT 1 AS n").get()).toEqual({ n: 1 });
    expect(dbReadonly.query("SELECT 1 AS n").get()).toEqual({ n: 1 });
    expect(() => dbReadonly.exec("CREATE TABLE shared_write_check (id INTEGER)")).toThrow(
      /readonly database/,
    );
  });
});
