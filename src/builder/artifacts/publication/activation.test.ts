import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { deliverActivatedPresentation } from "../../../pipeline/streaming/terminal-presentation.ts";
import {
  finalizeGenerationLifecycleFailure,
  finalizeGenerationLifecycleSuccess,
  getGenerationLifecycle,
  startGenerationLifecycle,
} from "../../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import {
  FIRST_INCARNATION_ID,
  SECOND_INCARNATION_ID,
} from "../../../registry/incarnations.test-support.ts";
import { getCapability } from "../../../registry/index.ts";
import { createMutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import { applyCapabilityTableDdl } from "../../../runtime/data/index.ts";
import { createApp } from "../../../server/app.ts";
import { renderCachedCapabilityCommitSwap } from "../../../server/http/index.ts";
import { generatedUnitsFor, notesFixtureGate, notesSpec } from "../../gate/gate.test-support.ts";
import type { CapabilityGateResult } from "../../gate/gate.ts";
import { activatePublishedSnapshot, expectedActiveCapability } from "./activation.ts";
import { publishCapabilitySnapshot } from "./artifact-lifecycle.ts";

const INCARNATION_ID = FIRST_INCARNATION_ID;
const OTHER_INCARNATION_ID = SECOND_INCARNATION_ID;

let gate: CapabilityGateResult;

beforeAll(async () => {
  gate = await notesFixtureGate({ enabled: false });
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the seam matrix shares one isolated database fixture.
describe("activatePublishedSnapshot — point of no return", () => {
  let env: ScratchDbEnv;
  let artifactsRoot: string;
  let conns: PlatformDatabase;

  beforeEach(async () => {
    env = createScratchDbEnv("omni-crud-activation-");
    conns = env.conns;
    artifactsRoot = join(env.dir, "capabilities");
    await activateV1(conns, artifactsRoot);
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  for (const seam of [
    "beforeTransaction",
    "afterMigration",
    "afterRegistryCas",
    "afterMetricsFinalized",
  ] as const) {
    test(`a fault at ${seam} leaves v1 live and all SQLite effects rolled back`, async () => {
      const buildId = `build-v2-${seam}`;
      const publication = publish(artifactsRoot, buildId, INCARNATION_ID, 2);
      startLifecycle(conns, buildId, INCARNATION_ID);

      await expect(
        activatePublishedSnapshot({
          database: conns.readwrite,
          spec: notesSpec(),
          publication,
          expected: expectedActiveCapability({
            capabilityId: "notes",
            incarnationId: INCARNATION_ID,
            version: 1,
          }),
          applyMigration: addEvolutionMarker,
          finalizeMetrics: () => finalizeSuccess(conns, buildId, INCARNATION_ID),
          faults: { [seam]: () => fault(seam) },
        }),
      ).rejects.toThrow(`fault:${seam}`);

      expect(getCapability("notes", conns.readonly)).toMatchObject({
        incarnation_id: INCARNATION_ID,
        version: 1,
      });
      expect(hasColumn(conns.readwrite, "cap_notes", "evolution_marker")).toBe(false);
      expect(getGenerationLifecycle(buildId, INCARNATION_ID, conns.readonly)).toMatchObject({
        lifecycleStatus: "running",
        outcome: null,
      });
      expect(existsSync(publication.directory)).toBe(true);
    });
  }

  test("a fault after commit cannot roll back the v2 pointer or relabel success", async () => {
    const buildId = "build-v2-post-commit";
    const publication = publish(artifactsRoot, buildId, INCARNATION_ID, 2);
    startLifecycle(conns, buildId, INCARNATION_ID);
    // The incarnation's logo seed is minted once, at v1. v2 must arrive carrying it.
    const bornSeed = getCapability("notes", conns.readonly)?.seed;

    await expect(
      activatePublishedSnapshot({
        database: conns.readwrite,
        spec: notesSpec(),
        publication,
        expected: expectedActiveCapability({
          capabilityId: "notes",
          incarnationId: INCARNATION_ID,
          version: 1,
        }),
        applyMigration: addEvolutionMarker,
        finalizeMetrics: () => finalizeSuccess(conns, buildId, INCARNATION_ID),
        faults: { afterCommit: () => fault("afterCommit") },
      }),
    ).rejects.toThrow("fault:afterCommit");

    expect(getCapability("notes", conns.readonly)).toMatchObject({
      incarnation_id: INCARNATION_ID,
      version: 2,
      artifacts_path: `${artifactsRoot}/notes/${INCARNATION_ID}/v2/`,
      seed: bornSeed,
      logo: { status: "absent", attempts: 0 },
    });
    expect(hasColumn(conns.readwrite, "cap_notes", "evolution_marker")).toBe(true);
    expect(getGenerationLifecycle(buildId, INCARNATION_ID, conns.readonly)).toMatchObject({
      lifecycleStatus: "success",
      outcome: "activated",
    });
    expect(() =>
      finalizeGenerationLifecycleFailure(
        { buildId, incarnationId: INCARNATION_ID, outcome: "activation_failed", stages: [] },
        conns.readwrite,
      ),
    ).toThrow(/Running generation lifecycle not found/);

    const coordinator = createMutationCoordinator();
    const reservation = coordinator.reserveBuild();
    const delivered = await coordinator.withBuildLease(reservation, () =>
      deliverActivatedPresentation(
        (event) => (event === "commit" ? new Promise(() => undefined) : Promise.resolve()),
        "preview",
        "complete View",
        10,
      ),
    );
    expect(delivered).toBe(false);
    expect(coordinator.snapshot().activeLease).toBeNull();

    const app = createApp({ capabilityRouter: { databases: conns } });
    const rehydrated = await app.request("/capability/notes", {
      headers: { "HX-Request": "true" },
    });
    const rehydratedView = await rehydrated.text();
    expect(rehydratedView).toContain(`data-active-capability-incarnation="${INCARNATION_ID}"`);
    expect(rehydratedView).toContain('hx-get="/capability/notes/read"');
  });

  test("successful evolution carries its prior label into complete-View delivery", async () => {
    const buildId = "build-v2-desk-context";
    const publication = publish(artifactsRoot, buildId, INCARNATION_ID, 2);
    startLifecycle(conns, buildId, INCARNATION_ID);

    const commit = await activatePublishedSnapshot({
      database: conns.readwrite,
      spec: notesSpec(),
      publication,
      expected: expectedActiveCapability({
        capabilityId: "notes",
        incarnationId: INCARNATION_ID,
        version: 1,
      }),
      applyMigration: addEvolutionMarker,
      finalizeMetrics: () => finalizeSuccess(conns, buildId, INCARNATION_ID),
    });

    // The slot carries the version a rename binds to; a desk holding the old one refuses every
    // rename until reload (5.9/01). Here it comes off a real pointer swap, not an argument.
    expect(commit.previousLabel).toBe("Notes");
    expect(commit.row.label).toBe("Notes");
    const swap = renderCachedCapabilityCommitSwap(commit.row, commit.previousLabel);
    expect(swap).toContain('data-active-capability-id="notes"');
    expect(swap).toContain("outerHTML:#capability-logo-notes");
    expect(swap).toContain(`name="version" value="${commit.row.version}"`);
    // And inert: an evolution never enters the logo path.
    expect(swap).not.toContain("logo-attempt");
  });

  test("wrong expected incarnation and version are stale CAS writes that touch no pointer", async () => {
    const cases = [
      {
        buildId: "build-wrong-incarnation",
        incarnationId: OTHER_INCARNATION_ID,
        candidateVersion: 2,
        expectedVersion: 1,
      },
      {
        buildId: "build-wrong-version",
        incarnationId: INCARNATION_ID,
        candidateVersion: 3,
        expectedVersion: 2,
      },
    ] as const;

    for (const candidate of cases) {
      const publication = publish(
        artifactsRoot,
        candidate.buildId,
        candidate.incarnationId,
        candidate.candidateVersion,
      );
      startLifecycle(conns, candidate.buildId, candidate.incarnationId);
      await expect(
        activatePublishedSnapshot({
          database: conns.readwrite,
          spec: notesSpec(),
          publication,
          expected: expectedActiveCapability({
            capabilityId: "notes",
            incarnationId: candidate.incarnationId,
            version: candidate.expectedVersion,
          }),
          applyMigration: () => undefined,
          finalizeMetrics: () => finalizeSuccess(conns, candidate.buildId, candidate.incarnationId),
        }),
      ).rejects.toThrow(/registry CAS failed/);
      expect(getCapability("notes", conns.readonly)).toMatchObject({
        incarnation_id: INCARNATION_ID,
        version: 1,
      });
      expect(
        getGenerationLifecycle(candidate.buildId, candidate.incarnationId, conns.readonly),
      ).toMatchObject({ lifecycleStatus: "running", outcome: null });
    }
  });
});

async function activateV1(conns: PlatformDatabase, artifactsRoot: string): Promise<void> {
  const buildId = "build-v1";
  const publication = publish(artifactsRoot, buildId, INCARNATION_ID, 1);
  startLifecycle(conns, buildId, INCARNATION_ID);
  await activatePublishedSnapshot({
    database: conns.readwrite,
    spec: notesSpec(),
    publication,
    applyMigration: (database) => void applyCapabilityTableDdl(notesSpec(), database),
    finalizeMetrics: () => finalizeSuccess(conns, buildId, INCARNATION_ID),
  });
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

function startLifecycle(conns: PlatformDatabase, buildId: string, incarnationId: string): void {
  startGenerationLifecycle(
    { buildId, incarnationId, capabilityId: "notes", stages: [] },
    conns.readwrite,
  );
}

function finalizeSuccess(conns: PlatformDatabase, buildId: string, incarnationId: string): void {
  finalizeGenerationLifecycleSuccess(
    { buildId, incarnationId, outcome: "activated", stages: [] },
    conns.readwrite,
  );
}

function addEvolutionMarker(database: PlatformDatabase["readwrite"]): void {
  database.exec('ALTER TABLE "cap_notes" ADD COLUMN "evolution_marker" TEXT;');
}

function hasColumn(
  database: PlatformDatabase["readwrite"],
  table: string,
  column: string,
): boolean {
  return (database.query(`PRAGMA table_xinfo("${table}")`).all() as { name: string }[]).some(
    (entry) => entry.name === column,
  );
}

function fault(seam: string): never {
  throw new Error(`fault:${seam}`);
}
