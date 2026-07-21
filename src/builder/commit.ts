// Registry commit boundary for one already-published immutable snapshot.
//
// The pipeline's terminal stage: the atomic moment a build becomes real. By the
// time commit runs, the migration, unit generation, and the full fail-closed gate
// have all run inside one open write transaction on the platform db (db.ts
// `withWriteTransaction`, opened by the migration stage). Commit is what closes
// that transaction's purpose:
//
//   1. Reverify the artifact-lifecycle module's published snapshot evidence.
//   2. Insert the registry row pointing at that directory (`artifacts_path`), at
//      version 1, *inside the same transaction*. For a brand-new capability that
//      insert **is** the pointer flip: the row's existence is what makes the
//      version live, and the `cap_<id>` table (created by the migration in this
//      same transaction) and the row become real together when it commits.
//
// Atomicity is the SQLite transaction's, not the filesystem's: a failed registry
// insert rolls back the table/row and leaves a complete verified, never-activated
// published candidate for later reconciliation. It can never leave a live partial
// snapshot because publication precedes this boundary.

import type { Database } from "bun:sqlite";

import {
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecSchema,
  incarnationIdSchema,
  insertCapability,
} from "../registry/index.ts";
import {
  assertVerifiedPublishedSnapshot,
  DEFAULT_ARTIFACTS_ROOT,
  type SnapshotManifest,
  type VerifiedPublishedSnapshot,
} from "./artifact-lifecycle.ts";

// Every committed capability starts at version 1. Later regenerations bump it (the
// Diff Engine, a later module); M2 only ever commits a brand-new v1.
export const FIRST_CAPABILITY_VERSION = 1;

export { DEFAULT_ARTIFACTS_ROOT };

export interface CommitCapabilityInput {
  readonly spec: CapabilitySpec;
  // The sole artifact input: a complete final snapshot that the lifecycle module
  // staged, digested, verified, and atomically published without overwrite.
  readonly publication: VerifiedPublishedSnapshot;
  // The read-write connection carrying the migration's open transaction. The
  // registry insert rides this so the row and the `cap_<id>` table commit together
  // (and roll back together on any failure).
  readonly database: Database;
}

export interface CommitCapabilityResult {
  readonly row: CapabilityRow;
  // The pointer the registry row stores and the router resolves handlers against.
  readonly artifactsPath: string;
  readonly incarnationId: string;
  readonly version: number;
  // The filenames written into the version directory (e.g. `item.ts`, `create.ts`) —
  // the developer-facing record of what landed on disk.
  readonly files: readonly string[];
  readonly buildId: string;
  readonly snapshotVerified: true;
  readonly snapshotContentDigest: string;
  readonly manifest: SnapshotManifest;
}

// Commit the build's registry pointer. Artifact publication is deliberately absent
// from this call surface: only verified final publication evidence can cross it.
export function commitCapability(input: CommitCapabilityInput): CommitCapabilityResult {
  const spec = capabilitySpecSchema.parse(input.spec);
  const verified = assertVerifiedPublishedSnapshot(input.publication);
  const incarnationId = incarnationIdSchema.parse(input.publication.incarnationId);
  const version = input.publication.version;
  const artifactsPath = input.publication.artifactsPath;
  const manifest = verified.manifest;
  if (
    JSON.stringify(verified.spec) !== JSON.stringify(spec) ||
    manifest.capability_id !== spec.id ||
    manifest.incarnation_id !== incarnationId ||
    manifest.version !== version ||
    version !== FIRST_CAPABILITY_VERSION
  ) {
    throw new Error("Published snapshot identity does not match the capability registry commit.");
  }

  // Insert the registry row inside the migration's open transaction. The insert
  // re-validates the row; a malformed row or duplicate id writes nothing. Either
  // way the transaction rolls back and the published directory remains a complete
  // never-activated candidate for later reconciliation.
  const row = insertCapability(
    rowFromSpec(spec, incarnationId, version, artifactsPath),
    input.database,
  );

  return {
    row,
    artifactsPath,
    incarnationId,
    version,
    files: verified.files,
    buildId: manifest.build_id,
    snapshotVerified: true,
    snapshotContentDigest: manifest.snapshot_content_digest,
    manifest,
  };
}

// The registry row the platform assigns at commit: the AI-authored spec plus the
// platform-owned incarnation, version, and `artifacts_path` pointer. The AI never
// authors these (registry/spec.ts).
function rowFromSpec(
  spec: CapabilitySpec,
  incarnationId: string,
  version: number,
  artifactsPath: string,
): CapabilityRow {
  return { ...spec, incarnation_id: incarnationId, version, artifacts_path: artifactsPath };
}
