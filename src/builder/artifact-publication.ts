// Same-filesystem, no-overwrite directory publication for capability snapshots.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { contentDigest } from "./artifact-digests.ts";
import { SnapshotVerificationError } from "./snapshot-error.ts";

const MAX_LOCK_GENERATIONS = 64;

export function createSafeStagingParent(
  root: string,
  capabilityId: string,
  incarnationId: string,
): void {
  ensureDirectoryWithoutSymlink(root);
  const capabilityDirectory = join(root, capabilityId);
  ensureDirectoryWithoutSymlink(capabilityDirectory);
  const incarnationDirectory = join(capabilityDirectory, incarnationId);
  ensureDirectoryWithoutSymlink(incarnationDirectory);
  ensureDirectoryWithoutSymlink(join(incarnationDirectory, ".staging"));
}

export function publishDirectoryWithoutOverwrite(
  stagingDirectory: string,
  finalDirectory: string,
  beforeRename: () => void,
): void {
  const lockPath = `${finalDirectory}.publish-lock`;
  let ownedLock: PublishLock | undefined;
  let published = false;
  try {
    ownedLock = acquirePublishLock(lockPath);
    if (existsSync(finalDirectory)) {
      throw new Error(`Refusing to overwrite existing capability snapshot ${finalDirectory}.`);
    }
    beforeRename();
    renameSync(stagingDirectory, finalDirectory);
    published = true;
  } finally {
    if (ownedLock) releasePublishLock(ownedLock, published);
  }
}

interface PublishLock {
  readonly generationPath: string;
  readonly ownerPath: string;
  readonly staleAncestors: readonly string[];
  readonly token: string;
}

function acquirePublishLock(rootLockPath: string): PublishLock {
  const token = `${process.pid}-${randomUUID()}`;
  const ownerPath = `${rootLockPath}.${token}.owner`;
  writeFileSync(ownerPath, `${JSON.stringify({ pid: process.pid, token })}\n`, { flag: "wx" });
  const staleAncestors: string[] = [];
  let generationPath = rootLockPath;

  for (let generation = 0; generation < MAX_LOCK_GENERATIONS; generation += 1) {
    try {
      // The owner payload is complete before this atomic link makes it the
      // contended lock, so a crash can never strand an empty lock file.
      linkSync(ownerPath, generationPath);
      return { generationPath, ownerPath, staleAncestors, token };
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        unlinkSync(ownerPath);
        throw error;
      }
      const existing = readLockNode(generationPath);
      if (existing.pid && isProcessAlive(existing.pid)) {
        unlinkSync(ownerPath);
        throw error;
      }
      // Never delete or replace a stale lock. Every contender derives the same
      // content-addressed successor and races on one atomic link. A live successor
      // is therefore stable even when many processes observe the same dead owner.
      staleAncestors.push(generationPath);
      generationPath = `${rootLockPath}.next-${contentDigest(existing.raw).slice("sha256:".length)}`;
    }
  }
  unlinkSync(ownerPath);
  throw new SnapshotVerificationError(`Could not acquire publication lock ${rootLockPath}.`);
}

function releasePublishLock(lock: PublishLock, published: boolean): void {
  try {
    if (readLockNode(lock.generationPath).token === lock.token) {
      unlinkSync(lock.generationPath);
    }
    if (published) {
      // The final directory now exists, so no later contender can publish. It is
      // safe for the winner to remove dead ancestors without any lock hand-off.
      for (const ancestor of [...lock.staleAncestors].reverse()) {
        if (existsSync(ancestor)) unlinkSync(ancestor);
      }
    }
  } finally {
    if (existsSync(lock.ownerPath)) unlinkSync(lock.ownerPath);
  }
}

function readLockNode(lockPath: string): {
  readonly raw: string;
  readonly pid?: number;
  readonly token?: string;
} {
  const stat = lstatSync(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new SnapshotVerificationError(`Publication lock is not a regular file: ${lockPath}.`);
  }
  const raw = readFileSync(lockPath, "utf8");
  try {
    const value = JSON.parse(raw) as {
      pid?: unknown;
      token?: unknown;
    };
    if (!Number.isSafeInteger(value.pid) || Number(value.pid) <= 0) return { raw };
    if (value.token !== undefined && typeof value.token !== "string") return { raw };
    return {
      raw,
      pid: Number(value.pid),
      ...(typeof value.token === "string" ? { token: value.token } : {}),
    };
  } catch {
    return { raw };
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function ensureDirectoryWithoutSymlink(directory: string): void {
  try {
    mkdirSync(directory);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new SnapshotVerificationError(
      `Capability artifact path component is not a real directory: ${directory}.`,
    );
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}
