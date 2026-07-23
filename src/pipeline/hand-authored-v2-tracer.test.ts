import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  eventData,
  readSse,
} from "../app.test-support.ts";
import { createApp } from "../app.ts";
import { gateInput, generatedUnitsFor, notesSpec } from "../builder/gate.test-support.ts";
import { type CapabilityGateResult, runCapabilityGate } from "../builder/gate.ts";
import {
  activatePublishedSnapshot,
  expectedAbsentCapability,
  publishCapabilitySnapshot,
  verifyCapabilitySnapshot,
} from "../builder/index.ts";
import { applyCapabilityTableDdl } from "../capability-data/index.ts";
import { openDatabase, type PlatformDatabase } from "../db.ts";
import {
  reconcileRunningGenerationLifecycles,
  startGenerationLifecycle,
} from "../metrics/index.ts";
import { makeMetricsRecorder } from "../metrics-test-recorder.ts";
import { runMigrations } from "../migrations.ts";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import { getCapability } from "../registry/index.ts";
import { runHandAuthoredV2Tracer } from "./hand-authored-v2-tracer.ts";
import { createMetricsRecorder } from "./metrics-recorder.ts";

const INCARNATION_ID = "11111111-1111-4111-8111-111111111111";
let tierOffGate: CapabilityGateResult;
let tierOnGate: CapabilityGateResult;

beforeAll(async () => {
  const units = generatedUnitsFor(notesSpec());
  const handlers = Object.fromEntries(
    units.filter((unit) => unit.kind === "handler").map((unit) => [unit.name, unit.content]),
  );
  const itemRenderer = units.find((unit) => unit.kind === "item-renderer")?.content;
  if (!itemRenderer) throw new Error("Missing item renderer.");
  tierOffGate = await runCapabilityGate(
    gateInput({ spec: notesSpec(), handlers, itemRenderer, behavioralTier: { enabled: false } }),
  );
  tierOnGate = await runCapabilityGate(gateInput({ spec: notesSpec(), handlers, itemRenderer }));
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: this focused fault matrix intentionally shares one v1 fixture.
describe("hand-authored v2 tracer", () => {
  let root: string;
  let artifactsRoot: string;
  let conns: PlatformDatabase;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "omni-crud-v2-tracer-"));
    artifactsRoot = join(root, "capabilities");
    conns = openDatabase(join(root, "platform.db"));
    runMigrations(conns.readwrite);
    const publication = publishCapabilitySnapshot({
      buildId: "v1",
      spec: notesSpec(),
      incarnationId: INCARNATION_ID,
      version: 1,
      units: generatedUnitsFor(notesSpec()),
      gate: tierOffGate,
      artifactsRoot,
    });
    await activatePublishedSnapshot({
      database: conns.readwrite,
      spec: notesSpec(),
      publication,
      expected: expectedAbsentCapability(),
      applyMigration: (database) => void applyCapabilityTableDdl(notesSpec(), database),
      finalizeMetrics: () => undefined,
    });
    conns.readwrite.run('INSERT INTO "cap_notes" ("id", "text", "pinned") VALUES (?, ?, ?)', [
      "note-1",
      "survives",
      0,
    ]);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("publishes a complete v2, preserves v1 history and records tier-off absent test stages", async () => {
    const { recordMetrics, lifecycles } = makeMetricsRecorder();
    const active = getCapability("notes", conns.readonly);
    if (!active) throw new Error("v1 did not activate");
    const result = await runHandAuthoredV2Tracer({
      active,
      candidate: candidate(tierOffGate),
      buildId: "v2-off",
      database: conns,
      artifactsRoot,
      recordMetrics,
    });

    expect(result.commit.row).toMatchObject({
      version: 2,
      artifacts_path: `${artifactsRoot}/notes/${INCARNATION_ID}/v2/`,
    });
    expect(
      conns.readonly.query('SELECT "text" FROM "cap_notes" WHERE "id" = ?').get("note-1"),
    ).toEqual({ text: "survives" });
    expect(
      verifyCapabilitySnapshot(join(artifactsRoot, "notes", INCARNATION_ID, "v1")).spec,
    ).toEqual(notesSpec());
    expect(result.publication.files).not.toContain("tests/behavioral.json");
    expect(lifecycles.at(-1)).toMatchObject({ lifecycleStatus: "success", outcome: "activated" });
    expect(lifecycles.at(-1)?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "behavioral_test_generation", state: "absent" }),
        expect.objectContaining({ stage: "behavioral_test_execution", state: "absent" }),
      ]),
    );
  });

  test("tier-on freezes the behavioral artifact and every pre-commit fault leaves v1 live", async () => {
    for (const [name, faults] of Object.entries({
      beforeTransaction: {
        beforeTransaction: () => {
          throw new Error("fault:beforeTransaction");
        },
      },
      afterMigration: {
        afterMigration: () => {
          throw new Error("fault:afterMigration");
        },
      },
      afterRegistryCas: {
        afterRegistryCas: () => {
          throw new Error("fault:afterRegistryCas");
        },
      },
      afterMetricsFinalized: {
        afterMetricsFinalized: () => {
          throw new Error("fault:afterMetricsFinalized");
        },
      },
    })) {
      const recordMetrics = createMetricsRecorder(conns.readwrite);
      const active = getCapability("notes", conns.readonly);
      if (!active) throw new Error("v1 did not activate");
      await expect(
        runHandAuthoredV2Tracer({
          active,
          candidate: candidate(tierOnGate),
          buildId: `v2-${name}`,
          database: conns,
          artifactsRoot,
          recordMetrics,
          faults,
        }),
      ).rejects.toThrow(`fault:${name}`);
      expect(getCapability("notes", conns.readonly)?.version).toBe(1);
      expect(recordMetrics.get(`v2-${name}`, INCARNATION_ID)).toMatchObject({
        lifecycleStatus: "failed",
        outcome: "activation_failed",
      });
      rmSync(join(artifactsRoot, "notes", INCARNATION_ID, "v2"), { recursive: true, force: true });
    }

    const { recordMetrics } = makeMetricsRecorder();
    const active = getCapability("notes", conns.readonly);
    if (!active) throw new Error("v1 did not activate");
    const result = await runHandAuthoredV2Tracer({
      active,
      candidate: candidate(tierOnGate),
      buildId: "v2-on",
      database: conns,
      artifactsRoot,
      recordMetrics,
    });
    expect(result.publication.files).toContain("tests/behavioral.json");
  });

  test("staging and historical corruption fail closed before v2 can activate", async () => {
    const active = getCapability("notes", conns.readonly);
    if (!active) throw new Error("v1 did not activate");
    const stagedMetrics = makeMetricsRecorder();
    await expect(
      runHandAuthoredV2Tracer({
        active,
        candidate: candidate(tierOffGate),
        buildId: "v2-publish",
        database: conns,
        artifactsRoot,
        recordMetrics: stagedMetrics.recordMetrics,
        beforePublish: () => {
          throw new Error("fault:publish");
        },
      }),
    ).rejects.toThrow("fault:publish");
    expect(getCapability("notes", conns.readonly)?.version).toBe(1);
    expect(stagedMetrics.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "publication_failed",
    });

    writeFileSync(join(artifactsRoot, "notes", INCARNATION_ID, "v1", "read.ts"), "corrupted\n");
    expect(() =>
      verifyCapabilitySnapshot(join(artifactsRoot, "notes", INCARNATION_ID, "v1")),
    ).toThrow(/content verification/);
    await expect(
      runHandAuthoredV2Tracer({
        active,
        candidate: candidate(tierOffGate),
        buildId: "v2-corrupt-history",
        database: conns,
        artifactsRoot,
        recordMetrics: makeMetricsRecorder().recordMetrics,
      }),
    ).rejects.toThrow(/corrupt/i);
    expect(getCapability("notes", conns.readonly)?.version).toBe(1);
    writeFileSync(
      join(artifactsRoot, "notes", INCARNATION_ID, "v1", "read.ts"),
      readFileSync(join(artifactsRoot, "notes", INCARNATION_ID, "v1", "create.ts")),
    );
    // Restore the fixture by starting a clean v1/v2 battery: historical corruption is
    // intentionally terminal for this incarnation and must not permit activation.
    expect(() =>
      verifyCapabilitySnapshot(join(artifactsRoot, "notes", INCARNATION_ID, "v1")),
    ).toThrow();
    expect(existsSync(join(artifactsRoot, "notes", INCARNATION_ID, "v1"))).toBe(true);
  });

  test("a lazy candidate Gate failure is durable failure evidence before publication", async () => {
    const recordMetrics = createMetricsRecorder(conns.readwrite);
    const active = getCapability("notes", conns.readonly);
    if (!active) throw new Error("v1 did not activate");

    await expect(
      runHandAuthoredV2Tracer({
        active,
        candidate: () => {
          throw new Error("fault:gate");
        },
        buildId: "v2-gate-failure",
        database: conns,
        artifactsRoot,
        recordMetrics,
      }),
    ).rejects.toThrow("fault:gate");

    expect(recordMetrics.get("v2-gate-failure", INCARNATION_ID)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "gate_failed",
    });
    expect(getCapability("notes", conns.readonly)?.version).toBe(1);
  });

  test("a post-commit tracer fault leaves v2 and success authoritative", async () => {
    const { recordMetrics, lifecycles } = makeMetricsRecorder();
    const active = getCapability("notes", conns.readonly);
    if (!active) throw new Error("v1 did not activate");

    await expect(
      runHandAuthoredV2Tracer({
        active,
        candidate: candidate(tierOffGate),
        buildId: "v2-after-commit",
        database: conns,
        artifactsRoot,
        recordMetrics,
        faults: {
          afterCommit: () => {
            throw new Error("fault:afterCommit");
          },
        },
      }),
    ).rejects.toThrow("fault:afterCommit");

    expect(getCapability("notes", conns.readonly)).toMatchObject({ version: 2 });
    expect(lifecycles.at(-1)).toMatchObject({ lifecycleStatus: "success", outcome: "activated" });
  });

  test("reconciles an interrupted never-activated v2 candidate before retrying", async () => {
    const active = getCapability("notes", conns.readonly);
    if (!active) throw new Error("v1 did not activate");
    const crashedBuildId = "v2-interrupted";
    publishCapabilitySnapshot({
      buildId: crashedBuildId,
      spec: notesSpec(),
      incarnationId: INCARNATION_ID,
      version: 2,
      units: candidate(tierOffGate).units,
      gate: tierOffGate,
      artifactsRoot,
    });
    startGenerationLifecycle(
      { buildId: crashedBuildId, incarnationId: INCARNATION_ID, capabilityId: "notes" },
      conns.readwrite,
    );
    expect(reconcileRunningGenerationLifecycles(conns.readwrite)).toBe(1);

    const { recordMetrics } = makeMetricsRecorder();
    const result = await runHandAuthoredV2Tracer({
      active,
      candidate: candidate(tierOffGate),
      buildId: "v2-after-interruption",
      database: conns,
      artifactsRoot,
      recordMetrics,
    });
    expect(result.publication.manifest.build_id).toBe("v2-after-interruption");
    expect(getCapability("notes", conns.readonly)?.version).toBe(2);
  });

  test("a connected cancellation restores v1 without sending a v2 commit", async () => {
    const { recordMetrics } = makeMetricsRecorder();
    const coordinator = createMutationCoordinator();
    const app = createApp({
      buildDatabases: conns,
      artifactsRoot,
      recordMetrics,
      capabilityRouter: { databases: conns },
      mutationCoordinator: coordinator,
    });
    const subscriber = await app.request("/demo/hand-authored-v2/notes", { method: "POST" });
    const jobId = buildJobIdFromSubscriber(await subscriber.text());
    expect(
      await app.request(`/demo/hand-authored-v2/build/${jobId}/cancel`, { method: "POST" }),
    ).toMatchObject({ status: 202 });

    const events = collectSseEvents(
      await readSse(await app.request(`/demo/hand-authored-v2/build/${jobId}/stream`)),
    );
    expect(events.map((event) => event.event)).not.toContain("commit");
    expect(eventData(events, "fragment")).toContain('data-build-restoration="capability"');
    expect(events.at(-1)).toMatchObject({ event: "done", data: "error" });
    expect(getCapability("notes", conns.readonly)?.version).toBe(1);
    expect(coordinator.snapshot().activeLease).toBeNull();
  });

  test("an empty v2 read stays childless so the platform empty state remains visible", async () => {
    conns.readwrite.run('DELETE FROM "cap_notes"');
    const app = createApp({
      buildDatabases: conns,
      artifactsRoot,
      recordMetrics: createMetricsRecorder(conns.readwrite),
      capabilityRouter: { databases: conns },
      mutationCoordinator: createMutationCoordinator(),
    });

    const subscriber = await app.request("/demo/hand-authored-v2/notes", { method: "POST" });
    const jobId = buildJobIdFromSubscriber(await subscriber.text());
    await readSse(await app.request(`/demo/hand-authored-v2/build/${jobId}/stream`));

    const read = await app.request("/capability/notes/read");
    expect(read.status).toBe(200);
    expect(await read.text()).toBe("");
  });

  test("the homepage dev affordance performs one complete v2 View swap and routes surviving records through v2", async () => {
    const recordMetrics = createMetricsRecorder(conns.readwrite);
    const loadedPaths: string[] = [];
    const app = createApp({
      buildDatabases: conns,
      artifactsRoot,
      recordMetrics,
      capabilityRouter: {
        databases: conns,
        loadHandler: async (artifactsPath, action) => {
          loadedPaths.push(artifactsPath);
          const module = (await import(
            pathToFileURL(join(artifactsPath, `${action}.ts`)).href
          )) as {
            default: () => Promise<string>;
          };
          return module.default;
        },
        loadItemRenderer: async (artifactsPath) => {
          loadedPaths.push(artifactsPath);
          const module = (await import(pathToFileURL(join(artifactsPath, "item.ts")).href)) as {
            default: (record: Record<string, unknown>) => string;
          };
          return module.default;
        },
      },
      mutationCoordinator: createMutationCoordinator(),
    });

    const v1Page = await app.request("/capability/notes");
    const v1Html = await v1Page.text();
    expect(v1Html).toContain("Trace next version");
    expect(v1Html).toContain('hx-swap="beforeend"');

    const subscriber = await app.request("/demo/hand-authored-v2/notes", { method: "POST" });
    const html = await subscriber.text();
    expect(subscriber.status).toBe(200);
    expect(html).toContain('sse-connect="/demo/hand-authored-v2/build/');
    const jobId = buildJobIdFromSubscriber(html);
    const events = collectSseEvents(
      await readSse(await app.request(`/demo/hand-authored-v2/build/${jobId}/stream`)),
    );
    expect(events.map((event) => event.event)).toEqual([
      "narration",
      "metrics-preview",
      "commit-preview",
      "commit",
      "done",
    ]);
    expect(eventData(events, "commit")).toContain('data-active-capability-version="2"');
    expect(eventData(events, "commit")).not.toContain("Trace next version");
    expect(eventData(events, "commit-preview")).toContain('"version":2');
    expect(getCapability("notes", conns.readonly)?.artifacts_path).toContain("/v2/");
    expect(recordMetrics.get(jobId, INCARNATION_ID)).toMatchObject({
      lifecycleStatus: "success",
      outcome: "activated",
    });

    const repeatTrace = await app.request("/demo/hand-authored-v2/notes", { method: "POST" });
    expect(repeatTrace.status).toBe(409);
    expect(await repeatTrace.text()).toContain("already been completed");

    const read = await app.request("/capability/notes/read");
    const readHtml = await read.text();
    expect(read.status).toBe(200);
    expect(readHtml).toContain("survives");
    expect(readHtml).toContain('data-v2-tracer="true"');
    expect(loadedPaths).toEqual([
      `${artifactsRoot}/notes/${INCARNATION_ID}/v2/`,
      `${artifactsRoot}/notes/${INCARNATION_ID}/v2/`,
    ]);

    const directCapabilityPage = await app.request("/capability/notes");
    const directHtml = await directCapabilityPage.text();
    expect(directCapabilityPage.status).toBe(200);
    expect(directHtml.match(/id="developer-v2-tracer-control"/g)).toHaveLength(1);
    expect(directHtml.indexOf('id="developer-panel"')).toBeLessThan(
      directHtml.indexOf('id="developer-v2-tracer-control"'),
    );
    expect(directHtml).not.toContain("Trace next version");
  });
});

function candidate(gate: CapabilityGateResult) {
  return {
    spec: notesSpec(),
    units: generatedUnitsFor(notesSpec()).map((unit) => ({
      ...unit,
      attempts: [
        { attempt: 1, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      ],
    })),
    gate,
  };
}
