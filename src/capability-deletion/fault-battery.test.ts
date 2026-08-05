// The epic 4.9 deletion fault battery (PLAN decision 35, module acceptance).
//
// One file, one case per fault the plan names, so the acceptance list is checkable by
// reading the test names:
//
//   1. failure before the database commit          6. read-token timeout and reopen
//   2. failure after the database commit           7. late stale Event Log ingestion
//   3. partial cleanup                             8. path traversal / symlink rejection
//   4. restart                                        → `artifact-path-safety.test.ts`
//   5. same-id recreation with a new incarnation   9. repeated (idempotent) cleanup
//
// Case 8 needs no database, only a directory and the adapter, so it lives in its own file;
// everything else shares the scratch-runtime lifecycle below.
//
// Generation metrics are asserted in every case here: they are content-free,
// incarnation-keyed experiment data and are explicitly outside the cleanup seam
// (ARCH §6.3, §9 principle 3).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { applyCapabilityTableDdl } from "../capability-data/ddl.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import {
  createReadGateCoordinator,
  ReadGateDrainTimeoutError,
  type ReadTokenSet,
} from "../read-gates/index.ts";
import {
  getCapability,
  insertCapability,
  listCapabilityDeletionTombstones,
  readActiveRegistryCatalog,
} from "../registry/index.ts";
import {
  boomRow,
  install,
  notesRow,
  rowSpec,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import {
  expectGenerationMetricSurvives,
  incarnationOf,
  seedGenerationMetric,
  stagePending,
  tableExists,
} from "./fault-battery.test-support.ts";
import {
  type AdmittedEventContext,
  ingestCapabilityEvents,
  installFakeEventLogStore,
  listFakeEventLogRows,
} from "./seam-fakes/event-log.test-support.ts";
import {
  createFakeOwnedResourceCleanupAdapter,
  createFakeOwnedResourceStore,
  type FakeOwnedResourceStore,
} from "./seam-fakes/owned-resources.test-support.ts";
import {
  createArtifactCleanupAdapter,
  destroyCapability,
  type OwnedResourceCleanupAdapter,
  recoverCapabilityDeletionTombstones,
} from "./two-phase-destruction.ts";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the battery is one acceptance list; splitting it would hide which faults are covered.
describe("the capability-deletion fault battery", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let store: FakeOwnedResourceStore;
  let adapters: readonly OwnedResourceCleanupAdapter[];

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
    store = createFakeOwnedResourceStore();
    adapters = [createFakeOwnedResourceCleanupAdapter(store)];
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("1. a fault before the database commit leaves the capability, its records, and its reads untouched", async () => {
    const target = notesRow();
    install(conns, target);
    conns.readwrite.run("INSERT INTO cap_notes (id, text, pinned) VALUES ('r1', 'kept', 0)");
    seedGenerationMetric(conns, target.incarnation_id);
    stagePending(store, target, "cover");
    const readGates = createReadGateCoordinator();

    await expect(
      destroyCapability({
        target,
        database: conns.readwrite,
        readonlyDatabase: conns.readonly,
        readGates,
        adapters,
        faults: {
          afterManifestCollected: () => {
            throw new Error("lost the process before commit");
          },
        },
      }),
    ).rejects.toThrow("lost the process before commit");

    expect(getCapability(target.id, conns.readonly)).toEqual(target);
    expect(tableExists(conns, "cap_notes")).toBe(true);
    expect(conns.readonly.query("SELECT id FROM cap_notes").all()).toEqual([{ id: "r1" }]);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
    expect(readGates.snapshot()).toEqual([
      { ...incarnationOf(target), state: "active", readerCount: 0 },
    ]);
    // Nothing was cleaned, so the staged resource is still the store's to own.
    expect(store.hasObject(target.id, target.incarnation_id, "cover")).toBe(true);
    expectGenerationMetricSurvives(conns, target.incarnation_id);
  });

  test("2. a fault after the database commit leaves a durable tombstone, not a live capability", async () => {
    const target = notesRow();
    install(conns, target);
    seedGenerationMetric(conns, target.incarnation_id);
    stagePending(store, target, "cover");
    const readGates = createReadGateCoordinator();

    await expect(
      destroyCapability({
        target,
        database: conns.readwrite,
        readonlyDatabase: conns.readonly,
        readGates,
        adapters,
        faults: {
          afterCommit: () => {
            throw new Error("lost the process after commit");
          },
        },
      }),
    ).rejects.toThrow("lost the process after commit");

    expect(getCapability(target.id, conns.readonly)).toBeNull();
    expect(tableExists(conns, "cap_notes")).toBe(false);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toHaveLength(1);
    // The drained gate was retired at the point of no return, never reopened.
    expect(readGates.snapshot()).toEqual([]);
    expectGenerationMetricSurvives(conns, target.incarnation_id);
  });

  test("3. partial cleanup keeps the capability logically deleted and the remaining work durable", async () => {
    const target = notesRow();
    install(conns, target);
    seedGenerationMetric(conns, target.incarnation_id);
    stagePending(store, target, "alpha");
    stagePending(store, target, "zulu");
    store.failCleanupOf("zulu");

    const result = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters,
    });

    expect(result.status).toBe("cleanup_pending");
    expect(getCapability(target.id, conns.readonly)).toBeNull();
    expect(store.hasObject(target.id, target.incarnation_id, "alpha")).toBe(false);
    expect(store.hasObject(target.id, target.incarnation_id, "zulu")).toBe(true);
    // The tombstone keeps its complete manifest, so the retry re-runs `alpha` too.
    const [tombstone] = listCapabilityDeletionTombstones(conns.readonly);
    expect(tombstone?.manifest.map((entry) => entry.key)).toEqual(["alpha", "zulu"]);
    expectGenerationMetricSurvives(conns, target.incarnation_id);
  });

  test("4. a restart finishes the pending obligation through a cold store and a rebuilt gate catalog", async () => {
    const target = notesRow();
    const survivor = boomRow();
    install(conns, target);
    install(conns, survivor);
    seedGenerationMetric(conns, target.incarnation_id);
    stagePending(store, target, "alpha");
    stagePending(store, target, "zulu");
    store.failCleanupOf("zulu");
    await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters,
    });

    // Restart: process-local state is gone. A cold object store knows nothing about the
    // staged resources, which is exactly why cleanup treats absence as success. This runs
    // the entrypoint's order — recover tombstones, then rebuild gates from the *current*
    // active catalog, which no longer contains the deleted incarnation.
    const rebootedStore = createFakeOwnedResourceStore();
    const rebootedGates = createReadGateCoordinator();
    const recovered = await recoverCapabilityDeletionTombstones({
      database: conns.readwrite,
      adapters: [createFakeOwnedResourceCleanupAdapter(rebootedStore)],
    });
    rebootedGates.recoverAtBoot(
      readActiveRegistryCatalog(conns.readonly).capabilities.map(incarnationOf),
    );

    expect(recovered.map((entry) => entry.status)).toEqual(["deleted"]);
    expect(rebootedStore.cleaned()).toEqual([
      { key: "alpha", alreadyAbsent: true },
      { key: "zulu", alreadyAbsent: true },
    ]);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
    // Boot recovery rebuilds the surviving capability's gate and never resurrects the
    // deleted one, even though the catalog it reads is the same registry.
    expect(rebootedGates.snapshot()).toEqual([
      { ...incarnationOf(survivor), state: "active", readerCount: 0 },
    ]);
    expect(getCapability(target.id, conns.readonly)).toBeNull();
    expect(getCapability(survivor.id, conns.readonly)).toEqual(survivor);
    expectGenerationMetricSurvives(conns, target.incarnation_id);
  });

  test("5. the same semantic id is reserved until cleanup finishes, then recreates as a new incarnation", async () => {
    const target = notesRow();
    install(conns, target);
    seedGenerationMetric(conns, target.incarnation_id);
    stagePending(store, target, "cover");
    store.failCleanupOf("cover");
    await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters,
    });

    const rebuilt = notesRow({
      incarnation_id: "99999999-9999-4999-8999-999999999999",
      artifacts_path: "capabilities/notes/99999999-9999-4999-8999-999999999999/v1/",
    });
    expect(() => insertCapability(rebuilt, conns.readwrite)).toThrow("deletion cleanup reserves");

    store.allowCleanupOf("cover");
    await recoverCapabilityDeletionTombstones({ database: conns.readwrite, adapters });
    applyCapabilityTableDdl(rowSpec(rebuilt), conns.readwrite);
    insertCapability(rebuilt, conns.readwrite);

    // The rebuilt capability owns its own resources; the purged incarnation's key is not
    // re-adopted just because the semantic id came back.
    stagePending(store, rebuilt, "cover");
    const rebuiltStore = store.stagedFor(rebuilt.id, rebuilt.incarnation_id);
    expect(rebuiltStore.map((reference) => reference.incarnationId)).toEqual([
      rebuilt.incarnation_id,
    ]);
    expect(store.hasObject(target.id, target.incarnation_id, "cover")).toBe(false);
    expect(getCapability(target.id, conns.readonly)?.incarnation_id).toBe(rebuilt.incarnation_id);
    expectGenerationMetricSurvives(conns, target.incarnation_id);
  });

  test("6. a read that will not drain times the close out and reopens the gate", async () => {
    const target = notesRow();
    install(conns, target);
    conns.readwrite.run("INSERT INTO cap_notes (id, text, pinned) VALUES ('r1', 'kept', 0)");
    seedGenerationMetric(conns, target.incarnation_id);
    stagePending(store, target, "cover");
    const readGates = createReadGateCoordinator({ drainTimeoutMs: 25 });
    const catalog = [incarnationOf(target)];
    const held: ReadTokenSet | undefined = readGates.tryAcquire({
      catalog,
      incarnations: catalog,
    });
    expect(held).toBeDefined();

    await expect(
      destroyCapability({
        target,
        database: conns.readwrite,
        readonlyDatabase: conns.readonly,
        readGates,
        adapters,
      }),
    ).rejects.toBeInstanceOf(ReadGateDrainTimeoutError);

    // The in-flight read was asked to stop, the gate reopened, and nothing was collected.
    expect(held?.signal.aborted).toBe(true);
    expect(readGates.snapshot()).toEqual([
      { ...incarnationOf(target), state: "active", readerCount: 1 },
    ]);
    expect(held && readGates.release(held)).toBe(true);
    expect(getCapability(target.id, conns.readonly)).toEqual(target);
    expect(tableExists(conns, "cap_notes")).toBe(true);
    expect(store.hasObject(target.id, target.incarnation_id, "cover")).toBe(true);
    // A reopened gate takes new readers again.
    expect(readGates.tryAcquire({ catalog, incarnations: catalog })).toBeDefined();
    expectGenerationMetricSurvives(conns, target.incarnation_id);
  });

  test("7. a late Event Log batch is refused after the purge and cannot resurrect payloads", async () => {
    const target = notesRow();
    install(conns, target);
    installFakeEventLogStore(conns.readwrite);
    seedGenerationMetric(conns, target.incarnation_id);
    const readGates = createReadGateCoordinator();
    const catalog = [incarnationOf(target)];
    const tokens = readGates.tryAcquire({ catalog, incarnations: catalog });
    if (!tokens) throw new Error("the test could not acquire its read-token set");
    ingestCapabilityEvents(
      { kind: "live", route: "/capability/notes", action: "read", tokens },
      [{ id: "event-1", records: [{ text: "private" }] }],
      { database: conns.readwrite, registryReadonly: conns.readonly, readGates },
    );
    readGates.release(tokens);
    const late: AdmittedEventContext = {
      kind: "queued",
      route: "/capability/notes",
      action: "read",
      derivedAt: new Date().toISOString(),
      ownership: catalog,
    };

    const destroyed = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates,
      adapters,
    });

    expect(destroyed.payloads).toEqual({ redactedEvents: 1, releasedOwnership: 1 });
    expect(
      ingestCapabilityEvents(late, [{ id: "event-2", records: [{ text: "private" }] }], {
        database: conns.readwrite,
        registryReadonly: conns.readonly,
        readGates,
      }),
    ).toMatchObject({ status: "rejected", reason: "incarnation_not_current" });
    expect(listFakeEventLogRows(conns.readonly)).toEqual([
      {
        id: "event-1",
        route: "/capability/notes",
        action: "read",
        payload: "",
        redacted: true,
        ownership: [],
      },
    ]);
    expectGenerationMetricSurvives(conns, target.incarnation_id);
  });

  test("9. repeated cleanup is idempotent: artifacts, resources, and recovery all succeed twice", async () => {
    const artifactsRoot = join(dir, "artifacts");
    const base = notesRow();
    const target = notesRow({
      artifacts_path: join(artifactsRoot, base.id, base.incarnation_id, "v1"),
    });
    install(conns, target);
    mkdirSync(target.artifacts_path, { recursive: true });
    writeFileSync(join(target.artifacts_path, "read.ts"), "export default 'old';");
    seedGenerationMetric(conns, target.incarnation_id);
    stagePending(store, target, "cover");
    const inventory = [createArtifactCleanupAdapter(artifactsRoot), ...adapters];

    const result = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters: inventory,
    });
    expect(result.status).toBe("deleted");
    expect(existsSync(join(artifactsRoot, target.id, target.incarnation_id))).toBe(false);

    // Second pass over an already-discharged deletion: no tombstones, nothing to redo.
    expect(
      await recoverCapabilityDeletionTombstones({
        database: conns.readwrite,
        adapters: inventory,
      }),
    ).toEqual([]);
    // Re-running the artifact adapter directly on the absent directory is still success.
    expect(() =>
      inventory[0]?.clean(
        {
          adapter: "version_artifacts",
          key: "incarnation_root",
          capabilityId: target.id,
          incarnationId: target.incarnation_id,
        },
        {
          capabilityId: target.id,
          incarnationId: target.incarnation_id,
          manifest: [],
          createdAt: "2026-08-04 00:00:00",
        },
      ),
    ).not.toThrow();
    expectGenerationMetricSurvives(conns, target.incarnation_id);
  });
});
