// Registry commit boundary for one already-published immutable snapshot — the pipeline's
// terminal stage, and the atomic moment a build becomes real.
//
// Migration, unit generation and the fail-closed gate have all run inside the write transaction
// the migration stage opened. Commit reverifies the published snapshot evidence, then inserts the
// registry row pointing at that directory, in the same transaction. For a new capability the
// insert is the pointer flip; for an evolution an incarnation/version CAS replaces the live row.
//
// Atomicity is the SQLite transaction's, not the filesystem's: a failed insert rolls back table
// and row, leaving a verified never-activated candidate for reconciliation, never a live partial.

import type { Database } from "bun:sqlite";

import {
  type CapabilityRegistryExpectation,
  type CapabilityRegistryWrite,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecSchema,
  compareAndSwapCapability,
  createCapabilityLogoSeed,
  getCapability,
  incarnationIdSchema,
} from "../../registry/index.ts";
import {
  assertVerifiedPublishedSnapshot,
  DEFAULT_ARTIFACTS_ROOT,
  type SnapshotManifest,
  type VerifiedPublishedSnapshot,
} from "../artifacts/publication/artifact-lifecycle.ts";

/**
 * Every committed capability starts at version 1. Later regenerations bump it (the
 * Diff Engine, a later module); M2 only ever commits a brand-new v1.
 */
export const FIRST_CAPABILITY_VERSION = 1;

export { DEFAULT_ARTIFACTS_ROOT };

export interface CommitCapabilityInput {
  readonly spec: CapabilitySpec;
  // The sole artifact input: a complete final snapshot that the lifecycle module
  // staged, digested, verified, and atomically published without overwrite.
  readonly publication: VerifiedPublishedSnapshot;
  // The read-write connection carrying the migration's open transaction, so the registry row
  // and the `cap_<id>` table commit — and roll back — together.
  readonly database: Database;
  /** New v1 expects absence; evolution binds the exact active incarnation/version. */
  readonly expected?: CapabilityRegistryExpectation;
}

export interface CommitCapabilityResult {
  readonly row: CapabilityRow;
  /** Previous active label for evolution logo diffing; absent for a new capability. */
  readonly previousLabel?: string;
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

/**
 * Commit the build's registry pointer. Artifact publication is deliberately absent
 * from this call surface: only verified final publication evidence can cross it.
 */
export function commitCapability(input: CommitCapabilityInput): CommitCapabilityResult {
  const spec = capabilitySpecSchema.parse(input.spec);
  const verified = assertVerifiedPublishedSnapshot(input.publication);
  const incarnationId = incarnationIdSchema.parse(input.publication.incarnationId);
  const version = input.publication.version;
  const artifactsPath = input.publication.artifactsPath;
  const manifest = verified.manifest;
  const expected = input.expected ?? { state: "absent" };
  const previous =
    expected.state === "active" ? getCapability(expected.capabilityId, input.database) : null;
  const previousLabel = previous?.label;
  if (
    JSON.stringify(verified.spec) !== JSON.stringify(spec) ||
    manifest.capability_id !== spec.id ||
    manifest.incarnation_id !== incarnationId ||
    manifest.version !== version ||
    !isExpectedNextVersion(spec.id, incarnationId, version, expected)
  ) {
    throw new Error("Published snapshot identity does not match the capability registry commit.");
  }

  // The seed is minted with the incarnation's first row and carried forward untouched: the logo
  // is made once (ADR-0007 L7), so a fresh seed would misname what drew the artwork.
  if (expected.state === "active" && !previous) {
    throw new Error(
      `Capability registry commit found no active row to evolve for ${expected.capabilityId}.`,
    );
  }
  const seed = previous ? previous.seed : createCapabilityLogoSeed();

  const row = compareAndSwapCapability(
    registryWriteFromSpec(spec, incarnationId, version, artifactsPath, seed),
    expected,
    input.database,
  );

  return {
    row,
    previousLabel,
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

// The AI-authored spec plus the platform-owned incarnation, version, pointer and seed, which
// the AI never authors. The logo lifecycle is born `absent` and moves only via the claim.
function registryWriteFromSpec(
  spec: CapabilitySpec,
  incarnationId: string,
  version: number,
  artifactsPath: string,
  seed: number,
): CapabilityRegistryWrite {
  return {
    ...spec,
    incarnation_id: incarnationId,
    version,
    artifacts_path: artifactsPath,
    seed,
  };
}
