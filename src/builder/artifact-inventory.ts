import type { Dirent } from "node:fs";
import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { SnapshotVerificationError } from "./snapshot-error.ts";

export function listSnapshotFiles(directory: string): string[] {
  const files: string[] = [];
  visitSnapshotDirectory(directory, directory, files);
  return files.sort();
}

function visitSnapshotDirectory(root: string, current: string, files: string[]): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    collectSnapshotEntry(root, current, entry, files);
  }
}

function collectSnapshotEntry(root: string, current: string, entry: Dirent, files: string[]): void {
  const path = join(current, entry.name);
  if (entry.isSymbolicLink()) {
    throw new SnapshotVerificationError("Capability snapshots may not contain symbolic links.");
  }
  if (entry.isDirectory()) {
    visitSnapshotDirectory(root, path, files);
    return;
  }
  if (!entry.isFile()) {
    throw new SnapshotVerificationError("Capability snapshots may contain only regular files.");
  }
  files.push(relative(root, path).split(sep).join("/"));
}

export function assertContained(root: string, path: string): void {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new SnapshotVerificationError("Capability snapshot path escaped its configured root.");
  }
}
