// A throwaway migrated database, so no suite touches the real data file.
//
// It sits beside `test-preload.ts` rather than under `src/server/` because every layer wants
// one: the bootstrap was hand-rolled once per suite while the shared version was unreachable
// from anything below the routes. Not a test file itself, so bun never runs it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "./db.ts";
import { runMigrations } from "./migrations.ts";

export interface ScratchDbEnv {
  dir: string;
  /** The database file itself, for a test that reopens it or names it in a scope. */
  path: string;
  conns: PlatformDatabase;
  artifactsRoot: string;
}

/** A migrated database in a fresh temp directory, plus the artifacts root beside it. */
export function createScratchDbEnv(prefix: string): ScratchDbEnv {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const path = join(dir, "test.db");
  const conns = openDatabase(path);
  runMigrations(conns.readwrite);
  return { dir, path, conns, artifactsRoot: join(dir, "artifacts") };
}

/** Closes both connections and removes the directory, artifacts root and all. */
export function teardownScratchDbEnv(
  env: Partial<ScratchDbEnv> & Pick<ScratchDbEnv, "dir" | "conns">,
): void {
  env.conns.readwrite.close();
  env.conns.readonly.close();
  rmSync(env.dir, { recursive: true, force: true });
}
