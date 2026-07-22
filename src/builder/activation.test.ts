import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyCapabilityTableDdl } from "../capability-data/index.ts";
import { openDatabase, type PlatformDatabase } from "../db.ts";
import {
  finalizeGenerationLifecycleFailure,
  finalizeGenerationLifecycleSuccess,
  getGenerationLifecycle,
  startGenerationLifecycle,
} from "../metrics/index.ts";
import { runMigrations } from "../migrations.ts";
import { getCapability } from "../registry/index.ts";
import { activatePublishedSnapshot, expectedActiveCapability } from "./activation.ts";
import { publishCapabilitySnapshot } from "./artifact-lifecycle.ts";
import { gateInput, generatedUnitsFor, notesSpec } from "./gate.test-support.ts";
import { type CapabilityGateResult, runCapabilityGate } from "./gate.ts";

const INCARNATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_INCARNATION_ID = "22222222-2222-4222-8222-222222222222";

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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the seam matrix shares one isolated database fixture.
describe("activatePublishedSnapshot — point of no return", () => {
  let dir: string;
  let artifactsRoot: string;
  let conns: PlatformDatabase;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-activation-"));
    artifactsRoot = join(dir, "capabilities");
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
    await activateV1(conns, artifactsRoot);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
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
