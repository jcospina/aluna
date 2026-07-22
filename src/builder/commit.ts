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
//      the candidate version, *inside the same transaction*. For a brand-new
//      capability the insert is the pointer flip; for evolution an exact
//      incarnation/version compare-and-swap replaces the live row.
//
// Atomicity is the SQLite transaction's, not the filesystem's: a failed registry
// insert rolls back the table/row and leaves a complete verified, never-activated
// published candidate for later reconciliation. It can never leave a live partial
// snapshot because publication precedes this boundary.

import type { Database } from "bun:sqlite";

import {
  type CapabilityRegistryExpectation,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecSchema,
  compareAndSwapCapability,
  incarnationIdSchema,
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
  /** New v1 expects absence; evolution binds the exact active incarnation/version. */
  readonly expected?: CapabilityRegistryExpectation;
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
  const expected = input.expected ?? { state: "absent" };
  if (
    JSON.stringify(verified.spec) !== JSON.stringify(spec) ||
    manifest.capability_id !== spec.id ||
    manifest.incarnation_id !== incarnationId ||
    manifest.version !== version ||
    !isExpectedNextVersion(spec.id, incarnationId, version, expected)
  ) {
    throw new Error("Published snapshot identity does not match the capability registry commit.");
  }

  // The CAS runs inside activation's open transaction. A stale target changes
  // nothing; any later failure rolls this back with DDL and lifecycle success.
  const row = compareAndSwapCapability(
    rowFromSpec(spec, incarnationId, version, artifactsPath),
    expected,
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

function isExpectedNextVersion(
  capabilityId: string,
  incarnationId: string,
  version: number,
  expected: CapabilityRegistryExpectation,
): boolean {
  if (expected.state === "absent") return version === FIRST_CAPABILITY_VERSION;
  return (
    expected.capabilityId === capabilityId &&
    expected.incarnationId === incarnationId &&
    version === expected.version + 1
  );
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
