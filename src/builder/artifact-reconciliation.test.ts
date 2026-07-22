import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../db.ts";
import {
  finalizeGenerationLifecycleFailure,
  finalizeGenerationLifecycleSuccess,
  reconcileRunningGenerationLifecycles,
  startGenerationLifecycle,
} from "../metrics/index.ts";
import { runMigrations } from "../migrations.ts";
import { insertCapability } from "../registry/index.ts";
import { publishCapabilitySnapshot, verifyCapabilitySnapshot } from "./artifact-lifecycle.ts";
import {
  ArtifactReconciliationError,
  reconcileCapabilityArtifacts,
} from "./artifact-reconciliation.ts";
import { gateInput, generatedUnitsFor, notesSpec } from "./gate.test-support.ts";
import { type CapabilityGateResult, runCapabilityGate } from "./gate.ts";

const INCARNATION_ID = "11111111-1111-4111-8111-111111111111";
const ORPHAN_INCARNATION_ID = "22222222-2222-4222-8222-222222222222";

let gate: CapabilityGateResult;

beforeAll(async () => {
  const units = [...generatedUnitsFor(notesSpec())];
  gate = await runCapabilityGate(
    gateInput({
      spec: notesSpec(),
      handlers: Object.fromEntries(
        units.filter((unit) => unit.kind === "handler").map((unit) => [unit.name, unit.content]),
      ),
      itemRenderer: units.find((unit) => unit.kind === "item-renderer")?.content,
      behavioralTier: { enabled: false },
    }),
  );
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the recovery matrix shares one isolated artifact/database fixture.
describe("reconcileCapabilityArtifacts", () => {
  let dir: string;
  let artifactsRoot: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-reconcile-"));
    artifactsRoot = join(dir, "capabilities");
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("retains committed v1..vN, removes only proven staging/v>N, and enables retry", () => {
    installActiveV2(conns, artifactsRoot);
    const failedV3 = publish(artifactsRoot, "build-v3-failed", INCARNATION_ID, 3);
    markFailed(conns, "build-v3-failed", INCARNATION_ID);

    start(conns, "build-v4-staging", INCARNATION_ID);
    expect(() =>
      publishCapabilitySnapshot({
        buildId: "build-v4-staging",
        spec: notesSpec(),
        incarnationId: INCARNATION_ID,
        version: 4,
        units: [...generatedUnitsFor(notesSpec())],
        gate,
        artifactsRoot,
        beforePublish: () => {
          throw new Error("crash before rename");
        },
      }),
    ).toThrow("crash before rename");
    reconcileRunningGenerationLifecycles(conns.readwrite);
    const staging = join(artifactsRoot, "notes", INCARNATION_ID, ".staging", "build-v4-staging");

    const result = reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot });

    expect(result.committed).toEqual([
      {
        capabilityId: "notes",
        incarnationId: INCARNATION_ID,
        liveVersion: 2,
        versions: [1, 2],
      },
    ]);
    expect(result.removed).toEqual([staging, failedV3.directory]);
    expect(existsSync(versionPath(artifactsRoot, INCARNATION_ID, 1))).toBe(true);
    expect(existsSync(versionPath(artifactsRoot, INCARNATION_ID, 2))).toBe(true);
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(failedV3.directory)).toBe(false);
    expect(
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }).removed,
    ).toEqual([]);

    const retry = publish(artifactsRoot, "build-v3-retry", INCARNATION_ID, 3);
    expect(existsSync(retry.directory)).toBe(true);
  });

  test("missing committed history fails closed before a safe candidate is removed", () => {
    installActiveV2(conns, artifactsRoot);
    const failedV3 = publish(artifactsRoot, "build-v3-failed", INCARNATION_ID, 3);
    markFailed(conns, "build-v3-failed", INCARNATION_ID);
    rmSync(versionPath(artifactsRoot, INCARNATION_ID, 1), { recursive: true });

    expect(() =>
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }),
    ).toThrow(/Committed capability history is corrupt.*committed v1 is missing/);
    expect(existsSync(failedV3.directory)).toBe(true);
  });

  test("corrupt committed bytes fail closed and are never treated as candidates", () => {
    installActiveV2(conns, artifactsRoot);
    const v1Create = join(versionPath(artifactsRoot, INCARNATION_ID, 1), "create.ts");
    writeFileSync(v1Create, "tampered");

    expect(() =>
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }),
    ).toThrow(/committed v1 is corrupt.*failed content verification/);
    expect(existsSync(versionPath(artifactsRoot, INCARNATION_ID, 2))).toBe(true);
  });

  test("historical dependency provenance validates without a current-liveness lookup", () => {
    const v1 = publish(artifactsRoot, "build-v1", INCARNATION_ID, 1);
    markSuccess(conns, "build-v1", INCARNATION_ID);
    insertCapability(activeRow(artifactsRoot, 1), conns.readwrite);
    const manifestPath = join(v1.directory, "snapshot.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      unit_provenance: Record<string, { dependencies: unknown[] }>;
    };
    manifest.unit_provenance["read.ts"]?.dependencies.push({
      capability_id: "deleted_reference",
      incarnation_id: "33333333-3333-4333-8333-333333333333",
      version: 7,
      snapshot_content_digest: `sha256:${"a".repeat(64)}`,
    });
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(
      verifyCapabilitySnapshot(v1.directory).manifest.unit_provenance["read.ts"].dependencies,
    ).toHaveLength(1);

    expect(
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }).committed,
    ).toEqual([
      {
        capabilityId: "notes",
        incarnationId: INCARNATION_ID,
        liveVersion: 1,
        versions: [1],
      },
    ]);
  });

  test("orphaned success and unknown paths have no never-activated proof", () => {
    const orphan = publish(artifactsRoot, "build-orphan-success", ORPHAN_INCARNATION_ID, 1);
    markSuccess(conns, "build-orphan-success", ORPHAN_INCARNATION_ID);

    expect(() =>
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }),
    ).toThrow(ArtifactReconciliationError);
    expect(existsSync(orphan.directory)).toBe(true);

    expect(
      reconcileCapabilityArtifacts({
        database: conns.readwrite,
        artifactsRoot,
        tombstonedIncarnations: [{ capabilityId: "notes", incarnationId: ORPHAN_INCARNATION_ID }],
      }).removed,
    ).toEqual([]);
    expect(existsSync(orphan.directory)).toBe(true);
  });

  test("live publication lock state is preserved without bricking reconciliation", () => {
    installActiveV2(conns, artifactsRoot);
    const lock = `${versionPath(artifactsRoot, INCARNATION_ID, 3)}.publish-lock`;
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "live" }));

    expect(
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }).removed,
    ).toEqual([]);
    expect(existsSync(lock)).toBe(true);
  });

  test("a crash-stale lock remains available to the next publisher's safe recovery", () => {
    installActiveV2(conns, artifactsRoot);
    const lock = `${versionPath(artifactsRoot, INCARNATION_ID, 3)}.publish-lock`;
    const orphanOwner = `${lock}.orphan.owner`;
    writeFileSync(lock, JSON.stringify({ pid: 2_147_483_647, token: "stale" }));
    writeFileSync(orphanOwner, JSON.stringify({ pid: 2_147_483_647, token: "orphan" }));

    expect(
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }).removed,
    ).toEqual([]);
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(orphanOwner)).toBe(true);
    const publication = publish(artifactsRoot, "build-after-stale-lock", INCARNATION_ID, 3);
    expect(existsSync(publication.directory)).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(orphanOwner)).toBe(true);
  });

  test("an active pointer cannot use a symlink alias for the configured root", () => {
    const v1 = publish(artifactsRoot, "build-v1", INCARNATION_ID, 1);
    markSuccess(conns, "build-v1", INCARNATION_ID);
    const aliasRoot = join(dir, "capabilities-alias");
    symlinkSync(artifactsRoot, aliasRoot, "dir");
    insertCapability(
      {
        ...notesSpec(),
        incarnation_id: INCARNATION_ID,
        version: 1,
        artifacts_path: `${versionPath(aliasRoot, INCARNATION_ID, 1)}/`,
      },
      conns.readwrite,
    );

    expect(() =>
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }),
    ).toThrow(/active pointer v1 does not resolve to a real directory/);
    expect(existsSync(v1.directory)).toBe(true);
  });

  test("boot runs the same reconciliation before the server starts", async () => {
    const bootDirectory = join(dir, "boot");
    const bootRoot = join(bootDirectory, "capabilities");
    const bootConns = openDatabase(join(bootDirectory, "data", "omni-crud.db"));
    runMigrations(bootConns.readwrite);
    publish(bootRoot, "boot-v1", INCARNATION_ID, 1);
    markSuccess(bootConns, "boot-v1", INCARNATION_ID);
    insertCapability(activeRow(bootRoot, 1), bootConns.readwrite);
    const failedV2 = publish(bootRoot, "boot-v2-failed", INCARNATION_ID, 2);
    markFailed(bootConns, "boot-v2-failed", INCARNATION_ID);
    bootConns.readwrite.close();
    bootConns.readonly.close();

    const proc = Bun.spawn(["bun", join(import.meta.dir, "..", "index.ts")], {
      cwd: bootDirectory,
      env: { ...process.env, PORT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      await waitForLog(proc.stdout, "listening", 15_000);
      expect(existsSync(versionPath(bootRoot, INCARNATION_ID, 1))).toBe(true);
      expect(existsSync(failedV2.directory)).toBe(false);
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 20_000);
});

function installActiveV2(conns: PlatformDatabase, root: string): void {
  publish(root, "build-v1", INCARNATION_ID, 1);
  markSuccess(conns, "build-v1", INCARNATION_ID);
  publish(root, "build-v2", INCARNATION_ID, 2);
  markSuccess(conns, "build-v2", INCARNATION_ID);
  insertCapability(activeRow(root, 2), conns.readwrite);
}

function activeRow(root: string, version: number) {
  return {
    ...notesSpec(),
    incarnation_id: INCARNATION_ID,
    version,
    artifacts_path: `${versionPath(root, INCARNATION_ID, version)}/`,
  };
}

function publish(root: string, buildId: string, incarnationId: string, version: number) {
  return publishCapabilitySnapshot({
    buildId,
    spec: notesSpec(),
    incarnationId,
    version,
    units: [...generatedUnitsFor(notesSpec())],
    gate,
    artifactsRoot: root,
  });
}

function markSuccess(conns: PlatformDatabase, buildId: string, incarnationId: string): void {
  start(conns, buildId, incarnationId);
  finalizeGenerationLifecycleSuccess(
    { buildId, incarnationId, outcome: "activated", stages: [] },
    conns.readwrite,
  );
}

function markFailed(conns: PlatformDatabase, buildId: string, incarnationId: string): void {
  start(conns, buildId, incarnationId);
  finalizeGenerationLifecycleFailure(
    { buildId, incarnationId, outcome: "activation_failed", stages: [] },
    conns.readwrite,
  );
}

function start(conns: PlatformDatabase, buildId: string, incarnationId: string): void {
  startGenerationLifecycle(
    { buildId, incarnationId, capabilityId: "notes", stages: [] },
    conns.readwrite,
  );
}

function versionPath(root: string, incarnationId: string, version: number): string {
  return join(root, "notes", incarnationId, `v${version}`);
}

async function waitForLog(
  stream: ReadableStream<Uint8Array>,
  needle: string,
  timeoutMs: number,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`timed out waiting for "${needle}"`)), timeoutMs),
  );
  const scan = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`stream ended before "${needle}" appeared`);
      seen += decoder.decode(value, { stream: true });
      if (seen.includes(needle)) return;
    }
  })();
  await Promise.race([scan, deadline]);
}
