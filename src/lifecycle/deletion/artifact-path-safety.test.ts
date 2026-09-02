// Fault-battery case 8: path traversal and symlink rejection in artifact cleanup.
//
// It lives beside `fault-battery.test.ts` rather than inside it because it is the one case
// that needs no database at all — only a throwaway directory and the adapter. The battery's
// header comment points here so the acceptance list stays readable as one list.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CapabilityDeletionTombstone } from "../../registry/index.ts";
import { createArtifactCleanupAdapter } from "./destruction/two-phase-destruction.ts";

function tombstoneFor(capabilityId: string, incarnationId: string): CapabilityDeletionTombstone {
  return {
    capabilityId,
    incarnationId,
    manifest: [],
    createdAt: "2026-08-04 00:00:00",
    cleanupAttempts: 0,
    cleanupError: null,
  };
}

describe("artifact cleanup path safety", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-artifact-safety-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a traversal identity, a symlinked root, and an unknown key are all refused", () => {
    const artifactsRoot = join(dir, "artifacts");
    const outside = join(dir, "outside");
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "keep.txt"), "safe");
    const adapter = createArtifactCleanupAdapter(artifactsRoot);

    // A tombstone whose identity tries to climb out of the configured root.
    expect(() =>
      adapter.clean(
        {
          adapter: "version_artifacts",
          key: "incarnation_root",
          capabilityId: "../outside",
          incarnationId: ".",
        },
        tombstoneFor("../outside", "."),
      ),
    ).toThrow("escaped its configured root");
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);

    // A symlink planted where the capability directory belongs.
    symlinkSync(outside, join(artifactsRoot, "notes"), "dir");
    expect(() =>
      adapter.clean(
        {
          adapter: "version_artifacts",
          key: "incarnation_root",
          capabilityId: "notes",
          incarnationId: "inc-1",
        },
        tombstoneFor("notes", "inc-1"),
      ),
    ).toThrow("refuses symlinked");
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);

    // An unknown key is refused before any path is derived at all.
    expect(() =>
      adapter.clean(
        {
          adapter: "version_artifacts",
          key: "../../etc/passwd",
          capabilityId: "notes",
          incarnationId: "inc-1",
        },
        tombstoneFor("notes", "inc-1"),
      ),
    ).toThrow("unknown resource key");
  });

  // The adapter removed `capabilities/<id>/<incarnation>/` and stopped there, so every
  // capability built once and deleted left its own empty directory behind for ever —
  // nothing else on the deletion path or in artifact reconciliation removes an id-level one.
  test("the capability's own directory goes with its last incarnation, and not before", () => {
    const artifactsRoot = join(dir, "artifacts");
    const capability = join(artifactsRoot, "notes");
    const first = join(capability, "incarnation-1");
    const second = join(capability, "incarnation-2");
    mkdirSync(join(first, "v1"), { recursive: true });
    mkdirSync(join(second, "v1"), { recursive: true });
    writeFileSync(join(first, "v1", "read.ts"), "export default async function read() {}");
    const adapter = createArtifactCleanupAdapter(artifactsRoot);

    // An evolution keeps earlier incarnations beside the live one, so removing one must
    // not take the capability's directory — or its sibling — with it.
    adapter.clean(
      {
        adapter: adapter.name,
        key: "incarnation_root",
        capabilityId: "notes",
        incarnationId: "incarnation-1",
      },
      tombstoneFor("notes", "incarnation-1"),
    );
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
    expect(existsSync(capability)).toBe(true);

    // The last one takes it.
    adapter.clean(
      {
        adapter: adapter.name,
        key: "incarnation_root",
        capabilityId: "notes",
        incarnationId: "incarnation-2",
      },
      tombstoneFor("notes", "incarnation-2"),
    );
    expect(existsSync(capability)).toBe(false);
    // And nothing above it.
    expect(existsSync(artifactsRoot)).toBe(true);
  });

  test("an artifacts root that does not exist yet still refuses an escaping identity", () => {
    const adapter = createArtifactCleanupAdapter(join(dir, "never-created"));

    expect(() =>
      adapter.clean(
        {
          adapter: "version_artifacts",
          key: "incarnation_root",
          capabilityId: "..",
          incarnationId: "..",
        },
        tombstoneFor("..", ".."),
      ),
    ).toThrow("escaped its configured root");
  });
});
