// Tests for the dual SQLite connections. The behavioral cases run against a throwaway db file
// per test (via openDatabase) so they're isolated and deterministic; the last two resolve the
// documented location without opening it and assert the shared singletons are wired to the
// configured one. The headline guarantee — a write on the read-only connection is physically
// impossible — is proven for both DML and DDL, since the boundary must hold regardless of what
// SQL is issued.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DB_PATH,
  DB_PATH_ENV_VAR,
  db,
  dbReadonly,
  openDatabase,
  type PlatformDatabase,
  resolveDbPath,
} from "./db.ts";

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

  test("the database file is the setting, or the documented default when it is unset or blank", () => {
    // Resolved, never opened: the default names the developer's real database.
    expect(resolveDbPath({})).toBe(DB_PATH);
    expect(resolveDbPath({ [DB_PATH_ENV_VAR]: "   " })).toBe(DB_PATH);
    expect(resolveDbPath({ [DB_PATH_ENV_VAR]: ` ${path} ` })).toBe(path);
  });

  test("exposes shared rw + ro access points with the read path still read-only", () => {
    // The singletons open the configured file, which the test preload points at scratch.
    expect(realpathSync(db.filename)).toBe(realpathSync(resolveDbPath()));
    expect(resolveDbPath()).not.toBe(DB_PATH);
    expect(db.query("SELECT 1 AS n").get()).toEqual({ n: 1 });
    expect(dbReadonly.query("SELECT 1 AS n").get()).toEqual({ n: 1 });
    expect(() => dbReadonly.exec("CREATE TABLE shared_write_check (id INTEGER)")).toThrow(
      /readonly database/,
    );
  });
});
