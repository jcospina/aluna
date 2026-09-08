import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitForLog } from "../../../platform/async.test-support.ts";
import {
  finalizeGenerationLifecycleFailure,
  finalizeGenerationLifecycleSuccess,
  reconcileRunningGenerationLifecycles,
  startGenerationLifecycle,
} from "../../../platform/metrics/index.ts";
import { openDatabase, type PlatformDatabase } from "../../../platform/persistence/db.ts";
import { runMigrations } from "../../../platform/persistence/migrations.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import {
  FIRST_INCARNATION_ID,
  SECOND_INCARNATION_ID,
  THIRD_INCARNATION_ID,
} from "../../../registry/incarnations.test-support.ts";
import { insertCapability } from "../../../registry/index.ts";
import { generatedUnitsFor, notesFixtureGate, notesSpec } from "../../gate/gate.test-support.ts";
import type { CapabilityGateResult } from "../../gate/gate.ts";
import { publishCapabilitySnapshot, verifyCapabilitySnapshot } from "./artifact-lifecycle.ts";
import {
  ArtifactReconciliationError,
  reconcileCapabilityArtifacts,
} from "./artifact-reconciliation.ts";

const INCARNATION_ID = FIRST_INCARNATION_ID;
const ORPHAN_INCARNATION_ID = SECOND_INCARNATION_ID;

let gate: CapabilityGateResult;

beforeAll(async () => {
  gate = await notesFixtureGate({ enabled: false });
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the recovery matrix shares one isolated artifact/database fixture.
describe("reconcileCapabilityArtifacts", () => {
  let dir: string;
  let artifactsRoot: string;
  let conns: PlatformDatabase;
  let env: ScratchDbEnv;

  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-reconcile-");
    ({ dir, conns } = env);
    artifactsRoot = join(dir, "capabilities");
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
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
      incarnation_id: THIRD_INCARNATION_ID,
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
        seed: 184206,
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

    const proc = Bun.spawn(["bun", join(import.meta.dir, "../..", "..", "index.ts")], {
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

  // The logo and its temp sit outside every `vN/` inventory (ADR-0007), in the directory this
  // pass enumerates. Unnamed, a capability that grew a face made the platform unbootable.
  test("a capability's artwork is a known sibling of its version directories", () => {
    installActiveV2(conns, artifactsRoot);
    const logo = join(artifactsRoot, "notes", INCARNATION_ID, "logo.svg");
    writeFileSync(logo, '<svg xmlns="http://www.w3.org/2000/svg"/>');

    const result = reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot });

    // Known, and never a removal candidate: deletion's cleanup of the incarnation tree is
    // the only thing that takes artwork away.
    expect(result.removed).toEqual([]);
    expect(existsSync(logo)).toBe(true);
  });

  test("a crashed attempt's staging bytes are known, and are left for the retry sweep", () => {
    installActiveV2(conns, artifactsRoot);
    const staging = join(artifactsRoot, "notes", INCARNATION_ID, ".staging");
    mkdirSync(staging, { recursive: true });
    const temp = join(staging, "logo-attempt-2.svg");
    writeFileSync(temp, "<svg/>");

    const result = reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot });

    // Not swept here: this pass runs at the head of every build, where a logo attempt may be
    // mid-write. Desk-load recovery owns the sweep.
    expect(result.removed).toEqual([]);
    expect(existsSync(temp)).toBe(true);
  });

  test("a symlink wearing the artwork's name still fails closed", () => {
    installActiveV2(conns, artifactsRoot);
    const incarnation = join(artifactsRoot, "notes", INCARNATION_ID);
    symlinkSync(join(incarnation, "v1"), join(incarnation, "logo.svg"));

    expect(() =>
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }),
    ).toThrow(/capability logo path is not a real file/);
  });

  test("a symlink wearing an attempt's name still fails closed", () => {
    installActiveV2(conns, artifactsRoot);
    const staging = join(artifactsRoot, "notes", INCARNATION_ID, ".staging");
    mkdirSync(staging, { recursive: true });
    symlinkSync(
      join(artifactsRoot, "notes", INCARNATION_ID, "v1"),
      join(staging, "logo-attempt-1.svg"),
    );

    expect(() =>
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }),
    ).toThrow(/logo attempt staging path is not a real file/);
  });

  // The names are a grammar, not a prefix match: anything else in `.staging` is a staging
  // build directory and still has to prove it never activated.
  test.each([
    "logo-attempt-0.svg",
    "logo-attempt-01.svg",
    "logo-attempt-1.svg.bak",
    "logo.svg",
  ])("%s is not an attempt temp and is judged as a staging build", (name) => {
    installActiveV2(conns, artifactsRoot);
    const staging = join(artifactsRoot, "notes", INCARNATION_ID, ".staging");
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, name), "<svg/>");

    expect(() =>
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }),
    ).toThrow(/staging build path is not a real directory/);
  });
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
    seed: 184206,
    logo: { status: "absent", attempts: 0 },
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
