import { createHash } from "node:crypto";

import { compareStrings } from "../../../platform/canonical-json.ts";

interface DigestEntry {
  readonly path: string;
  readonly content_digest: string;
}

export function contentDigest(content: string | NodeJS.ArrayBufferView): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function snapshotContentDigest(entries: readonly DigestEntry[]): string {
  const canonical = [...entries]
    .sort(compareFileEntries)
    .map((entry) => `${entry.path}\0${entry.content_digest}\n`)
    .join("");
  return contentDigest(canonical);
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Codepoint order, matching the `[...paths].sort()` the snapshot contract verifies the published
 * inventory against. A locale collation could order the same list differently and move the digest.
 */
export function compareFileEntries(left: { path: string }, right: { path: string }): number {
  return compareStrings(left.path, right.path);
}
