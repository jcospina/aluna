// Fail-closed artifact reconciliation for boot and lease-head pre-build recovery.
//
// Registry state defines committed history. For an active incarnation at vN, every
// verified v1..vN directory is protected. Cleanup is planned only for staging or
// published v>N candidates whose durable lifecycle proves they never activated.

import type { Database } from "bun:sqlite";
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { getGenerationLifecycle } from "../metrics/index.ts";
import { type CapabilityRow, capabilitySpecFromRow, listCapabilities } from "../registry/index.ts";
import { verifyCapabilitySnapshot } from "./artifact-lifecycle.ts";

export interface TombstonedCapabilityIncarnation {
  readonly capabilityId: string;
  readonly incarnationId: string;
}

export interface ReconcileCapabilityArtifactsInput {
  readonly database: Database;
  readonly artifactsRoot: string;
  /** Future deletion owns these paths; activation recovery must leave them alone. */
  readonly tombstonedIncarnations?: readonly TombstonedCapabilityIncarnation[];
}

export interface CommittedCapabilityVersions {
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly liveVersion: number;
  readonly versions: readonly number[];
}

export interface ArtifactReconciliationResult {
  readonly committed: readonly CommittedCapabilityVersions[];
  readonly removed: readonly string[];
}

export class ArtifactReconciliationError extends Error {
  override readonly name = "ArtifactReconciliationError";
}

interface RemovalCandidate {
  readonly path: string;
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly buildId: string;
  readonly kind: "staging" | "published";
}

/** Validate all history first, then remove the complete proven-safe plan. */
export function reconcileCapabilityArtifacts(
  input: ReconcileCapabilityArtifactsInput,
): ArtifactReconciliationResult {
  const configuredRoot = resolve(input.artifactsRoot);
  if (!existsSync(configuredRoot)) return { committed: [], removed: [] };
  assertRealDirectory(configuredRoot, "artifact root");
  const root = configuredRoot;

  const activeRows = listCapabilities(input.database);
  const activeByIncarnation = new Map(
    activeRows.map((row) => [identity(row.id, row.incarnation_id), row]),
  );
  const tombstoned = new Set(
    (input.tombstonedIncarnations ?? []).map((entry) =>
      identity(entry.capabilityId, entry.incarnationId),
    ),
  );
  const committed = activeRows.map((row) => verifyCommittedHistory(root, row));
  const removals = planRemovals(root, input.database, activeByIncarnation, tombstoned);

  for (const candidate of removals) rmSync(candidate.path, { recursive: true });
  return { committed, removed: removals.map((candidate) => candidate.path) };
}

function verifyCommittedHistory(root: string, row: CapabilityRow): CommittedCapabilityVersions {
  assertCanonicalActivePointer(root, row);
  const versions = Array.from({ length: row.version }, (_, index) => index + 1);
  for (const version of versions) verifyCommittedVersion(root, row, version);
  return {
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    liveVersion: row.version,
    versions,
  };
}

function assertCanonicalActivePointer(root: string, row: CapabilityRow): void {
  const expectedPointer = resolve(root, row.id, row.incarnation_id, `v${row.version}`);
  const actualPointer = resolve(row.artifacts_path);
  const actualRoot = dirname(dirname(dirname(actualPointer)));
  const expectedFromActualRoot = resolve(actualRoot, row.id, row.incarnation_id, `v${row.version}`);
  if (actualPointer !== expectedFromActualRoot) {
    throw corruption(row, `active pointer is not an exact canonical incarnation/version path`);
  }
  try {
    assertRealDirectory(actualRoot, "active pointer root");
    assertRealDirectory(join(actualRoot, row.id), "active pointer capability");
    assertRealDirectory(join(actualRoot, row.id, row.incarnation_id), "active pointer incarnation");
    assertRealDirectory(actualPointer, "active pointer version");
  } catch {
    throw corruption(row, `active pointer v${row.version} does not resolve to a real directory`);
  }
  if (
    realpathSync(actualRoot) !== realpathSync(root) ||
    realpathSync(actualPointer) !== realpathSync(expectedPointer)
  ) {
    throw corruption(
      row,
      `active pointer is not the canonical v${row.version} directory under the configured root`,
    );
  }
}

function verifyCommittedVersion(root: string, row: CapabilityRow, version: number): void {
  const directory = resolve(root, row.id, row.incarnation_id, `v${version}`);
  if (!existsSync(directory)) throw corruption(row, `committed v${version} is missing`);
  assertRealDirectory(directory, `committed ${row.id} v${version}`);
  let verified: ReturnType<typeof verifyCapabilitySnapshot>;
  try {
    // Provenance parsing validates historical dependency identity/digest shape;
    // intentionally do not resolve those pairs against today's live registry.
    verified = verifyCapabilitySnapshot(directory);
  } catch (error) {
    throw corruption(
      row,
      `committed v${version} is corrupt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertCommittedIdentity(row, version, verified.manifest);
  if (
    version === row.version &&
    JSON.stringify(verified.spec) !== JSON.stringify(capabilitySpecFromRow(row))
  ) {
    throw corruption(row, `live v${version} spec.json does not match the registry spec`);
  }
}

function assertCommittedIdentity(
  row: CapabilityRow,
  version: number,
  manifest: ReturnType<typeof verifyCapabilitySnapshot>["manifest"],
): void {
  if (
    manifest.capability_id !== row.id ||
    manifest.incarnation_id !== row.incarnation_id ||
    manifest.version !== version
  ) {
    throw corruption(row, `committed v${version} has mismatched snapshot identity`);
  }
}

function planRemovals(
  root: string,
  database: Database,
  active: ReadonlyMap<string, CapabilityRow>,
  tombstoned: ReadonlySet<string>,
): RemovalCandidate[] {
  const removals: RemovalCandidate[] = [];
  for (const capabilityEntry of readdirSync(root, { withFileTypes: true })) {
    if (capabilityEntry.name === "README.md" && capabilityEntry.isFile()) continue;
    assertDirectoryEntry(capabilityEntry, root, "capability");
    const capabilityId = capabilityEntry.name;
    const capabilityDirectory = join(root, capabilityId);
    for (const incarnationEntry of readdirSync(capabilityDirectory, { withFileTypes: true })) {
      assertDirectoryEntry(incarnationEntry, capabilityDirectory, "incarnation");
      const incarnationId = incarnationEntry.name;
      if (tombstoned.has(identity(capabilityId, incarnationId))) continue;
      const incarnationDirectory = join(capabilityDirectory, incarnationId);
      const activeRow = active.get(identity(capabilityId, incarnationId));
      planIncarnationRemovals(
        incarnationDirectory,
        capabilityId,
        incarnationId,
        activeRow,
        database,
        removals,
      );
    }
  }
  return removals;
}

function planIncarnationRemovals(
  directory: string,
  capabilityId: string,
  incarnationId: string,
  active: CapabilityRow | undefined,
  database: Database,
  removals: RemovalCandidate[],
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.includes(".publish-lock")) {
      // Publication owns its non-destructive live/stale successor protocol. Never
      // sweep lock generations here, but do not let a crash-stale lock brick boot or
      // prevent the next publisher from performing the safe recovery handshake.
      continue;
    }
    if (entry.name === ".staging") {
      assertDirectoryEntry(entry, directory, "staging");
      planStagingRemovals(
        join(directory, entry.name),
        capabilityId,
        incarnationId,
        database,
        removals,
      );
      continue;
    }
    const match = /^v([1-9][0-9]*)$/.exec(entry.name);
    if (!match) {
      throw new ArtifactReconciliationError(
        `Artifact reconciliation found unknown state: ${join(directory, entry.name)}.`,
      );
    }
    assertDirectoryEntry(entry, directory, "version");
    const version = Number(match[1]);
    if (active && version <= active.version) continue;
    const candidate = verifiedPublishedCandidate(
      join(directory, entry.name),
      capabilityId,
      incarnationId,
      version,
    );
    assertNeverActivated(candidate, database);
    removals.push(candidate);
  }
}

function planStagingRemovals(
  stagingDirectory: string,
  capabilityId: string,
  incarnationId: string,
  database: Database,
  removals: RemovalCandidate[],
): void {
  for (const entry of readdirSync(stagingDirectory, { withFileTypes: true })) {
    assertDirectoryEntry(entry, stagingDirectory, "staging build");
    const candidate: RemovalCandidate = {
      path: join(stagingDirectory, entry.name),
      capabilityId,
      incarnationId,
      buildId: entry.name,
      kind: "staging",
    };
    assertNeverActivated(candidate, database);
    removals.push(candidate);
  }
}

function verifiedPublishedCandidate(
  directory: string,
  capabilityId: string,
  incarnationId: string,
  version: number,
): RemovalCandidate {
  try {
    const verified = verifyCapabilitySnapshot(directory);
    if (
      verified.manifest.capability_id !== capabilityId ||
      verified.manifest.incarnation_id !== incarnationId ||
      verified.manifest.version !== version
    ) {
      throw new Error("snapshot identity does not match its final path");
    }
    return {
      path: directory,
      capabilityId,
      incarnationId,
      buildId: verified.manifest.build_id,
      kind: "published",
    };
  } catch (error) {
    throw new ArtifactReconciliationError(
      `Artifact reconciliation cannot prove published candidate ${directory}: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

function assertNeverActivated(candidate: RemovalCandidate, database: Database): void {
  const lifecycle = getGenerationLifecycle(candidate.buildId, candidate.incarnationId, database);
  const provenTerminal =
    lifecycle?.capabilityId === candidate.capabilityId &&
    (lifecycle.lifecycleStatus === "failed" || lifecycle.lifecycleStatus === "interrupted");
  if (!provenTerminal) {
    throw new ArtifactReconciliationError(
      `Artifact reconciliation lacks never-activated proof for ${candidate.kind} candidate ${candidate.path}.`,
    );
  }
}

function assertDirectoryEntry(
  entry: { readonly name: string; isDirectory(): boolean; isSymbolicLink(): boolean },
  parent: string,
  kind: string,
): void {
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new ArtifactReconciliationError(
      `Artifact reconciliation ${kind} path is not a real directory: ${join(parent, entry.name)}.`,
    );
  }
}

function assertRealDirectory(path: string, kind: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ArtifactReconciliationError(
      `Artifact reconciliation ${kind} is not a real directory: ${path}.`,
    );
  }
}

function identity(capabilityId: string, incarnationId: string): string {
  return `${capabilityId}/${incarnationId}`;
}

function corruption(row: CapabilityRow, detail: string): ArtifactReconciliationError {
  return new ArtifactReconciliationError(
    `Committed capability history is corrupt for ${row.id}/${row.incarnation_id}: ${detail}.`,
  );
}
