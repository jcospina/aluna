// Commit stage — Module 2, Epic 2.5(g) (ARCH §6.2 step 5, §9.5, PLAN flow step 7).
//
// The pipeline's terminal stage: the atomic moment a build becomes real. By the
// time commit runs, the migration, unit generation, and the full fail-closed gate
// have all run inside one open write transaction on the platform db (db.ts
// `withWriteTransaction`, opened by the migration stage). Commit is what closes
// that transaction's purpose:
//
//   1. Write the version-1 artifacts — the generated handler `.ts` files and the
//      `.html` views — to the capability's version directory
//      (`capabilities/<id>/v1/`).
//   2. Insert the registry row pointing at that directory (`artifacts_path`), at
//      version 1, *inside the same transaction*. For a brand-new capability that
//      insert **is** the pointer flip: the row's existence is what makes the
//      version live, and the `cap_<id>` table (created by the migration in this
//      same transaction) and the row become real together when it commits.
//
// Atomicity is the transaction's, not this module's: if anything here throws — a
// file write, or the registry insert (a duplicate id, a malformed row) — the open
// transaction rolls back, so no `cap_<id>` table and no registry row survive, and
// any files already written are left **orphaned** for GC (capabilities/README.md),
// never half-registered. A failed build never creates a capability and never bumps
// a version (ARCH §6.2 failure path). Commit is reachable only once every active
// gate rung has passed, because the pipeline sequences it strictly after the gate
// inside the same transaction.

import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { type CapabilityRow, type CapabilitySpec, insertCapability } from "../registry/index.ts";
import type { GeneratedUnit } from "./units.ts";

// Every committed capability starts at version 1. Later regenerations bump it (the
// Diff Engine, a later module); M2 only ever commits a brand-new v1.
export const FIRST_CAPABILITY_VERSION = 1;

// The on-disk root the version directories live under (`capabilities/<id>/v<n>/`,
// capabilities/README.md). A fixed convention rather than config; tests override it
// to write into a throwaway directory.
export const DEFAULT_ARTIFACTS_ROOT = "capabilities";

export interface CommitCapabilityInput {
  readonly spec: CapabilitySpec;
  // The generated handler + view units to write to disk. M2 always produces the
  // create/read handlers and the list/create views; commit writes whatever the
  // unit stage produced, keyed by each unit's own filename.
  readonly units: readonly GeneratedUnit[];
  // The read-write connection carrying the migration's open transaction. The
  // registry insert rides this so the row and the `cap_<id>` table commit together
  // (and roll back together on any failure).
  readonly database: Database;
  // Override the on-disk artifacts root (tests write to a temp dir). Defaults to
  // {@link DEFAULT_ARTIFACTS_ROOT}.
  readonly artifactsRoot?: string;
}

export interface CommitCapabilityResult {
  readonly row: CapabilityRow;
  // The pointer the registry row stores and the router resolves handlers against.
  readonly artifactsPath: string;
  readonly version: number;
  // The filenames written into the version directory (e.g. `create.ts`,
  // `list.html`) — the developer-facing record of what landed on disk.
  readonly files: readonly string[];
}

// Commit the build: write the artifacts, then insert the registry row pointing at
// them. Both happen synchronously so they sit inside the caller's open transaction
// — the registry insert is the single committing step (the pointer flip for v1).
export function commitCapability(input: CommitCapabilityInput): CommitCapabilityResult {
  const version = FIRST_CAPABILITY_VERSION;
  const root = input.artifactsRoot ?? DEFAULT_ARTIFACTS_ROOT;
  // The pointer stored on the row and resolved by the router. The trailing slash
  // matches the convention recorded in ARCH §6.3 and capabilities/README.md.
  const artifactsPath = `${root}/${input.spec.id}/v${version}/`;
  const directory = resolve(process.cwd(), artifactsPath);

  // 1. Write the artifacts first, so the row — once inserted — points at files that
  //    already exist on disk. A write failure throws before the registry insert, so
  //    the open transaction rolls back and nothing is half-registered; any files
  //    written so far are orphaned for GC.
  mkdirSync(directory, { recursive: true });
  const files = input.units.map((unit) => {
    writeFileSync(resolve(directory, unit.filename), unit.content);
    return unit.filename;
  });

  // 2. Insert the registry row inside the migration's open transaction. The insert
  //    re-validates the row (a malformed row throws and writes nothing); a duplicate
  //    id throws the primary-key violation. Either way the transaction rolls back,
  //    so a failed commit leaves no row — the files above become orphans.
  const row = insertCapability(rowFromSpec(input.spec, version, artifactsPath), input.database);

  return { row, artifactsPath, version, files };
}

// The registry row the platform assigns at commit: the AI-authored spec plus the
// two platform-owned values — `version` and the `artifacts_path` pointer. The AI
// never authors these (registry/spec.ts).
function rowFromSpec(spec: CapabilitySpec, version: number, artifactsPath: string): CapabilityRow {
  return { ...spec, version, artifacts_path: artifactsPath };
}
