import type { Database } from "bun:sqlite";
import { lstatSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { DEFAULT_ARTIFACTS_ROOT } from "../builder/index.ts";
import { deriveCapabilityTableDdl } from "../capability-data/ddl.ts";
import {
  type ReadGateCloseLease,
  type ReadGateCoordinator,
  ReadGateDrainTimeoutError,
} from "../read-gates/index.ts";
import {
  type CapabilityDeletionTombstone,
  type CapabilityRow,
  capabilitySpecFromRow,
  getCapabilityDeletionTombstone,
  insertCapabilityDeletionTombstone,
  listCapabilityDeletionTombstones,
  type OwnedResourceEntry,
  removeCapabilityDeletionTombstone,
} from "../registry/index.ts";
import {
  type InstalledPayloadPurgeResult,
  NO_INSTALLED_PAYLOADS,
  purgeInstalledCapabilityPayloads,
} from "./installed-payloads.ts";

export interface OwnedResourceCollectionContext {
  readonly target: CapabilityRow;
  /** Collection runs before DROP so adapters can inspect active and inactive fields. */
  readonly database: Database;
}

export interface OwnedResourceCleanupAdapter {
  readonly name: string;
  collect(context: OwnedResourceCollectionContext): readonly string[] | Promise<readonly string[]>;
  clean(entry: OwnedResourceEntry, tombstone: CapabilityDeletionTombstone): void | Promise<void>;
}

export interface CapabilityDestructionFaults {
  readonly afterManifestCollected?: () => void;
  /** The registry row *becoming* the tombstone is one UPDATE, so this is that seam. */
  readonly afterTombstoneInserted?: () => void;
  readonly afterEventPayloadsPurged?: () => void;
  readonly afterTableDropped?: () => void;
  /** A throw here simulates a process loss after SQLite's point of no return. */
  readonly afterCommit?: () => void | Promise<void>;
}

export interface DestroyCapabilityInput {
  readonly target: CapabilityRow;
  readonly database: Database;
  /** Physically read-only: pre-commit collectors cannot mutate authoritative data. */
  readonly readonlyDatabase: Database;
  readonly readGates: ReadGateCoordinator;
  readonly adapters: readonly OwnedResourceCleanupAdapter[];
  readonly faults?: CapabilityDestructionFaults;
}

/**
 * The drain outdid its deadline, so nothing was destroyed and the gate is open again.
 *
 * It is deliberately its own outcome rather than a throw: a deletion refused because
 * active work would not finish in time is a different thing to tell the user than a
 * deletion that failed, and collapsing the two leaves them looking at a sentence that
 * cannot explain what happened. ADR-0006 names it `deletion_drain_timeout`.
 */
export interface CapabilityDrainTimeoutResult {
  readonly status: "deletion_drain_timeout";
}

export interface CapabilityDestroyedResult {
  readonly status: "deleted" | "cleanup_pending";
  readonly tombstone: CapabilityDeletionTombstone;
  readonly payloads: InstalledPayloadPurgeResult;
  readonly cleanupError?: unknown;
}

export type CapabilityDestructionResult = CapabilityDestroyedResult | CapabilityDrainTimeoutResult;

export interface RecoverCapabilityDeletionInput {
  readonly database: Database;
  readonly adapters: readonly OwnedResourceCleanupAdapter[];
}

export interface CapabilityDeletionRecoveryResult {
  readonly tombstone: CapabilityDeletionTombstone;
  readonly status: "deleted" | "cleanup_pending";
  readonly error?: unknown;
}

function canonicalAdapterMap(
  adapters: readonly OwnedResourceCleanupAdapter[],
): ReadonlyMap<string, OwnedResourceCleanupAdapter> {
  const byName = new Map<string, OwnedResourceCleanupAdapter>();
  for (const adapter of adapters) {
    const name = adapter.name.trim();
    if (name.length === 0 || name !== adapter.name || byName.has(name)) {
      throw new Error(
        "Owned-resource cleanup adapter names must be unique, nonblank, and trimmed.",
      );
    }
    byName.set(name, adapter);
  }
  return byName;
}

function entryIdentity(entry: Pick<OwnedResourceEntry, "adapter" | "key">): string {
  return `${entry.adapter}\u0000${entry.key}`;
}

async function collectOwnedResourceManifest(
  target: CapabilityRow,
  readonlyDatabase: Database,
  adapters: readonly OwnedResourceCleanupAdapter[],
): Promise<readonly OwnedResourceEntry[]> {
  const byIdentity = new Map<string, OwnedResourceEntry>();
  for (const [name, adapter] of canonicalAdapterMap(adapters)) {
    const keys = await adapter.collect({ target, database: readonlyDatabase });
    for (const rawKey of keys) {
      const key = rawKey.trim();
      if (key.length === 0 || key !== rawKey) {
        throw new Error(`Owned-resource adapter ${name} returned an invalid key.`);
      }
      const entry: OwnedResourceEntry = {
        adapter: name,
        key,
        capabilityId: target.id,
        incarnationId: target.incarnation_id,
      };
      byIdentity.set(entryIdentity(entry), entry);
    }
  }
  return Object.freeze(
    [...byIdentity.values()].sort(
      (left, right) =>
        left.adapter.localeCompare(right.adapter) || left.key.localeCompare(right.key),
    ),
  );
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function commitDeletionTombstone(
  input: DestroyCapabilityInput,
  manifest: readonly OwnedResourceEntry[],
): InstalledPayloadPurgeResult {
  const { database, target } = input;
  const tableName = deriveCapabilityTableDdl(capabilitySpecFromRow(target)).tableName;
  let payloads = NO_INSTALLED_PAYLOADS;
  database.transaction(() => {
    insertCapabilityDeletionTombstone(
      {
        capabilityId: target.id,
        incarnationId: target.incarnation_id,
        manifest: [...manifest],
      },
      database,
    );
    input.faults?.afterTombstoneInserted?.();

    payloads = purgeInstalledCapabilityPayloads(target, database);
    input.faults?.afterEventPayloadsPurged?.();

    // `IF EXISTS` so registry/table drift is a repair rather than a wedge: a row whose
    // table is already gone must still be deletable, not permanently undeletable.
    database.exec(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(tableName)};`);
    input.faults?.afterTableDropped?.();
  })();
  return payloads;
}

/**
 * Discharge every durable obligation the tombstone carries, recording each entry's
 * outcome. The first failure stops the run and leaves the tombstone intact with its
 * complete manifest, so a retry re-runs entries that already succeeded — which is why
 * every adapter must treat an already-absent resource as success.
 */
async function cleanOwnedResource(
  entry: OwnedResourceEntry,
  tombstone: CapabilityDeletionTombstone,
  byName: ReadonlyMap<string, OwnedResourceCleanupAdapter>,
): Promise<void> {
  if (
    entry.capabilityId !== tombstone.capabilityId ||
    entry.incarnationId !== tombstone.incarnationId
  ) {
    throw new Error("Deletion tombstone contains a resource owned by another incarnation.");
  }
  const adapter = byName.get(entry.adapter);
  if (!adapter) {
    throw new Error(`Deletion cleanup adapter ${entry.adapter} is not installed.`);
  }
  await adapter.clean(entry, tombstone);
}

async function cleanTombstone(
  tombstone: CapabilityDeletionTombstone,
  database: Database,
  adapters: readonly OwnedResourceCleanupAdapter[],
): Promise<void> {
  const byName = canonicalAdapterMap(adapters);
  for (const entry of tombstone.manifest) {
    await cleanOwnedResource(entry, tombstone, byName);
  }
  if (!removeCapabilityDeletionTombstone(tombstone, database)) {
    throw new Error("Deletion tombstone changed before cleanup completed.");
  }
}

/**
 * Close/drain one exact incarnation, atomically cross deletion's SQLite point of no
 * return, then discharge its durable external cleanup obligation.
 */
export async function destroyCapability(
  input: DestroyCapabilityInput,
): Promise<CapabilityDestructionResult> {
  const incarnation = {
    capabilityId: input.target.id,
    incarnationId: input.target.incarnation_id,
  };
  input.readGates.synchronizeCatalog([incarnation]);
  let closeLease: ReadGateCloseLease;
  try {
    closeLease = await input.readGates.closeAndDrain(incarnation);
  } catch (error) {
    // `closeAndDrain` has already reopened the gate in its own `finally`, so there is
    // nothing left to undo — only something to say.
    if (error instanceof ReadGateDrainTimeoutError) return { status: "deletion_drain_timeout" };
    throw error;
  }
  let committed = false;
  let payloads = NO_INSTALLED_PAYLOADS;
  try {
    const manifest = await collectOwnedResourceManifest(
      input.target,
      input.readonlyDatabase,
      input.adapters,
    );
    input.faults?.afterManifestCollected?.();
    payloads = commitDeletionTombstone(input, manifest);
    committed = true;
    if (!input.readGates.finalizeClose(closeLease)) {
      throw new Error("Committed capability deletion could not retire its drained read gate.");
    }
    await input.faults?.afterCommit?.();

    const tombstone = getCapabilityDeletionTombstone(input.target.id, input.database);
    if (!tombstone) throw new Error("Committed capability deletion lost its tombstone.");
    try {
      await cleanTombstone(tombstone, input.database, input.adapters);
      return { status: "deleted", tombstone, payloads };
    } catch (cleanupError) {
      return { status: "cleanup_pending", tombstone, payloads, cleanupError };
    }
  } finally {
    if (!committed) input.readGates.reopen(closeLease);
  }
}

/** Retry every durable post-commit obligation. Failure preserves the exact tombstone. */
export async function recoverCapabilityDeletionTombstones(
  input: RecoverCapabilityDeletionInput,
): Promise<readonly CapabilityDeletionRecoveryResult[]> {
  const tombstones = listCapabilityDeletionTombstones(input.database);
  const results: CapabilityDeletionRecoveryResult[] = [];
  for (const tombstone of tombstones) {
    try {
      await cleanTombstone(tombstone, input.database, input.adapters);
      results.push({ tombstone, status: "deleted" });
    } catch (error) {
      results.push({ tombstone, status: "cleanup_pending", error });
    }
  }
  return results;
}

/** M4's real adapter: the exact incarnation directory, absent-on-retry is success. */
export function createArtifactCleanupAdapter(
  artifactsRoot = DEFAULT_ARTIFACTS_ROOT,
): OwnedResourceCleanupAdapter {
  return {
    name: "version_artifacts",
    collect: ({ target }) => {
      assertArtifactBinding(artifactsRoot, target);
      return ["incarnation_root"];
    },
    clean: (entry, tombstone) => {
      if (entry.key !== "incarnation_root") {
        throw new Error("Artifact cleanup received an unknown resource key.");
      }
      const directory = assertSafeArtifactDirectory(
        artifactsRoot,
        tombstone.capabilityId,
        tombstone.incarnationId,
      );
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

/**
 * The adapter name the capability-owned object store will answer to when Module 6
 * installs it. Nothing registers it yet: M4's acceptance fake claims it in tests only, and
 * a manifest naming an adapter this process does not have is deliberately a hard failure
 * rather than a silent skip — a real M6 obligation must never be discharged by accident.
 */
export const OWNED_RESOURCE_ADAPTER = "owned_files";

/** The one production adapter inventory shared by live deletion and boot recovery. */
export function createProductionCapabilityDeletionAdapters(
  artifactsRoot = DEFAULT_ARTIFACTS_ROOT,
): readonly OwnedResourceCleanupAdapter[] {
  return [createArtifactCleanupAdapter(artifactsRoot)];
}

function assertSafeArtifactDirectory(
  artifactsRoot: string,
  capabilityId: string,
  incarnationId: string,
): string {
  return assertSafeArtifactPath(artifactsRoot, [capabilityId, incarnationId]);
}

function assertArtifactBinding(artifactsRoot: string, target: CapabilityRow): void {
  const expectedVersionDirectory = assertSafeArtifactPath(artifactsRoot, [
    target.id,
    target.incarnation_id,
    `v${target.version}`,
  ]);
  if (resolve(target.artifacts_path) !== expectedVersionDirectory) {
    throw new Error("Capability artifacts do not match the configured root and exact incarnation.");
  }
}

function assertSafeArtifactPath(artifactsRoot: string, parts: readonly string[]): string {
  const root = resolve(artifactsRoot);
  const directory = resolve(root, ...parts);
  assertPathContained(root, directory);
  const canonicalRoot = realDirectoryIfPresent(root);
  if (!canonicalRoot) return directory;
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const canonicalCurrent = realDirectoryIfPresent(current);
    if (!canonicalCurrent) break;
    assertPathContained(canonicalRoot, canonicalCurrent);
  }
  return directory;
}

function assertPathContained(root: string, target: string): void {
  const candidate = relative(root, target);
  if (
    candidate.length === 0 ||
    candidate === ".." ||
    candidate.startsWith(`..${sep}`) ||
    isAbsolute(candidate)
  ) {
    throw new Error("Artifact cleanup target escaped its configured root.");
  }
}

function realDirectoryIfPresent(path: string): string | null {
  const stat = lstatIfPresent(path);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Artifact cleanup refuses symlinked or non-directory paths.");
  }
  return realpathSync(path);
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
