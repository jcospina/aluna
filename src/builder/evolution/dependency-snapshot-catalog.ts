// Verified dependency snapshot catalog — PLAN decision 24; ADR-0006.
//
// Candidate generation receives a lease-frozen projection of active registry rows.
// Provenance needs the other half of that truth: the immutable incarnation, version,
// and verified snapshot content digest behind every projected row. Build this catalog
// from the same frozen rows, and fail closed if a registry pointer and its bytes disagree.

import { isDeepStrictEqual } from "node:util";

import { type CapabilityRow, capabilitySpecFromRow } from "../../registry/index.ts";
import {
  type VerifiedCapabilitySnapshot,
  verifyCapabilitySnapshot,
} from "../artifacts/artifact-lifecycle.ts";
import type { VerifiedDependencySnapshot } from "../artifacts/artifact-provenance.ts";
import { SnapshotVerificationError } from "../artifacts/snapshot-error.ts";

export function buildVerifiedDependencySnapshotCatalog(
  rows: readonly CapabilityRow[],
  forCapabilityId: string,
): readonly VerifiedDependencySnapshot[] {
  return rows
    .filter((row) => row.id !== forCapabilityId)
    .map((row) => verifiedDependencySnapshot(row, verifyCapabilitySnapshot(row.artifacts_path)));
}

/**
 * Reverify the frozen dependency rows and require the exact evidence captured at
 * admission. Evolution calls this synchronously at the SQLite pre-COMMIT boundary, so
 * dependency bytes cannot change after provenance is authored yet still activate.
 */
export function assertVerifiedDependencySnapshotCatalog(
  rows: readonly CapabilityRow[],
  forCapabilityId: string,
  expected: readonly VerifiedDependencySnapshot[],
): void {
  const current = buildVerifiedDependencySnapshotCatalog(rows, forCapabilityId);
  if (!isDeepStrictEqual(current, expected)) {
    throw new SnapshotVerificationError(
      "The verified dependency snapshot catalog changed before activation.",
    );
  }
}

function verifiedDependencySnapshot(
  row: CapabilityRow,
  snapshot: VerifiedCapabilitySnapshot,
): VerifiedDependencySnapshot {
  const { manifest } = snapshot;
  if (
    manifest.capability_id !== row.id ||
    manifest.incarnation_id !== row.incarnation_id ||
    manifest.version !== row.version ||
    !isDeepStrictEqual(snapshot.spec, capabilitySpecFromRow(row))
  ) {
    throw new SnapshotVerificationError(
      `Dependency ${row.id} registry pointer/spec does not match its verified snapshot.`,
    );
  }
  return {
    capability_id: row.id,
    incarnation_id: row.incarnation_id,
    version: row.version,
    snapshot_content_digest: manifest.snapshot_content_digest,
  };
}
