// The scratch platform both whole-catalog read scope suites are written against.
//
// A scope's claims are ownership claims, so every one of them needs the same three things:
// a migrated throwaway database, a registry holding known incarnations, and a read gate
// coordinator that has recovered exactly those. Shared rather than duplicated so the two
// suites cannot drift into disagreeing about what a catalogued desk is.
//
// The database registry is a factory rather than module state: each suite owns its own
// and disposes it in its own `afterEach`, which keeps a file that fails halfway from
// leaving another file's connections open. This module is not run as a test by bun.

import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../../platform/persistence/db.ts";
import { runMigrations } from "../../platform/persistence/migrations.ts";
import { readActiveRegistryCatalog } from "../../registry/index.ts";
import { validSpec } from "../../registry/spec/spec.test-support.ts";
import { insertCapability } from "../../registry/store/store.ts";
import { createReadGateCoordinator, type ReadGateCoordinator } from "../concurrency/read-gates.ts";
import {
  type QueryWorker,
  QueryWorkerClosedError,
  type QueryWorkerRow,
  type QueryWorkerValue,
} from "./query-worker.ts";

export const NOTES = {
  capabilityId: "notes",
  incarnationId: "11111111-1111-4111-8111-111111111111",
};
export const TASKS = {
  capabilityId: "tasks",
  incarnationId: "22222222-2222-4222-8222-222222222222",
};

export interface ScratchPlatform {
  readonly path: string;
  readonly database: PlatformDatabase;
}

export interface ScratchPlatforms {
  /** A migrated throwaway platform database with an empty registry. */
  migrated(): ScratchPlatform;
  /** The same database holding two active capabilities. */
  catalogued(): ScratchPlatform;
  /** Close every connection and remove every directory this factory handed out. */
  disposeAll(): void;
}

export function createScratchPlatforms(): ScratchPlatforms {
  const connections: PlatformDatabase[] = [];
  const directories: string[] = [];

  function migrated(): ScratchPlatform {
    const directory = mkdtempSync(join(tmpdir(), "omni-crud-query-scope-"));
    directories.push(directory);
    const path = join(directory, "test.db");
    const pair = openDatabase(path);
    connections.push(pair);
    runMigrations(pair.readwrite);
    return { path, database: pair };
  }

  return {
    migrated,
    catalogued() {
      const platform = migrated();
      addCapability(platform.database.readwrite, NOTES.capabilityId, NOTES.incarnationId);
      addCapability(platform.database.readwrite, TASKS.capabilityId, TASKS.incarnationId);
      return platform;
    },
    disposeAll() {
      for (const pair of connections) {
        pair.readwrite.close();
        pair.readonly.close();
      }
      for (const directory of directories) rmSync(directory, { recursive: true, force: true });
      connections.length = 0;
      directories.length = 0;
    },
  };
}

export interface FakeWorkerCall {
  readonly sql: string;
  readonly parameters: readonly QueryWorkerValue[];
}

export interface FakeWorkerLog {
  created: number;
  closed: number;
  readonly calls: FakeWorkerCall[];
  readonly factoryArguments: unknown[][];
}

/**
 * Workers that answer from a fixed row set and count what was asked of them.
 *
 * `hold` makes a read stay outstanding until something closes the worker, which is the only
 * way a fake can stand in for the one thing the real worker is here to do: reject the read
 * a cancel arrived in the middle of. Without it a `close()` count is a count of calls, not
 * evidence that anything was killed.
 */
export function fakeWorkers(
  rows: readonly QueryWorkerRow[] = [],
  options: { readonly hold?: boolean } = {},
): {
  log: FakeWorkerLog;
  createWorker: (...args: unknown[]) => QueryWorker;
} {
  const log: FakeWorkerLog = { created: 0, closed: 0, calls: [], factoryArguments: [] };
  return {
    log,
    createWorker: (...args: unknown[]) => {
      log.created += 1;
      log.factoryArguments.push(args);
      const outstanding = new Set<(reason: Error) => void>();
      return {
        read(sql: string, parameters: readonly QueryWorkerValue[] = []) {
          log.calls.push({ sql, parameters });
          if (!options.hold) return Promise.resolve(rows);
          return new Promise<readonly QueryWorkerRow[]>((_resolve, reject) => {
            outstanding.add(reject);
          });
        },
        close() {
          log.closed += 1;
          for (const reject of outstanding) {
            reject(new QueryWorkerClosedError("The query worker is closed."));
          }
          outstanding.clear();
        },
      };
    },
  };
}

export function gatesFor(database: PlatformDatabase): ReadGateCoordinator {
  const readGates = createReadGateCoordinator();
  readGates.recoverAtBoot(
    readActiveRegistryCatalog(database.readonly).capabilities.map((row) => ({
      capabilityId: row.id,
      incarnationId: row.incarnation_id,
    })),
  );
  return readGates;
}

export function readerCounts(readGates: ReadGateCoordinator): readonly number[] {
  return readGates.snapshot().map((entry) => entry.readerCount);
}

/** One more active capability in an existing registry — the mid-question arrival case. */
export function addCapability(database: Database, id: string, incarnationId: string): void {
  insertCapability(
    {
      ...validSpec({ id, label: id, noun: id }),
      incarnation_id: incarnationId,
      version: 1,
      artifacts_path: `capabilities/${id}/${incarnationId}/v1/`,
      seed: 184206,
    },
    database,
  );
}
