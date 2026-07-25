import { createHash } from "node:crypto";

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

export function compareFileEntries(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path, "en");
}

export function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
