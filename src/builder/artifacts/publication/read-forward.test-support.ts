import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalJson,
  contentDigest,
  snapshotContentDigest,
} from "../inventory/artifact-digests.ts";
import type { SnapshotManifest } from "./artifact-lifecycle.ts";

/**
 * Rewrite a published `spec.json` without `plural_noun` and reseal its manifest, the shape every
 * snapshot published before the key existed has on disk. Returns the rewritten bytes.
 */
export function sealWithoutPlural(directory: string): string {
  const specPath = join(directory, "spec.json");
  const { plural_noun: _, ...spec } = JSON.parse(readFileSync(specPath, "utf8"));
  const bytes = canonicalJson(spec);
  writeFileSync(specPath, bytes);
  const manifestPath = join(directory, "snapshot.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
  const files = manifest.files.map((entry) =>
    entry.path === "spec.json" ? { ...entry, content_digest: contentDigest(bytes) } : entry,
  );
  const content = files.flatMap((entry) =>
    entry.content_digest === undefined ? [] : [{ ...entry, content_digest: entry.content_digest }],
  );
  const sealed = { ...manifest, files, snapshot_content_digest: snapshotContentDigest(content) };
  writeFileSync(manifestPath, canonicalJson(sealed));
  return bytes;
}
