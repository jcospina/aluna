import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import type { CapabilityDeletionTombstone } from "../../registry/index.ts";
import {
  insertCapabilityDeletionTombstone,
  listCapabilityDeletionTombstones,
} from "../../registry/index.ts";
import { createReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import {
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../../runtime/router/dispatch/router.test-support.ts";
import {
  destroyCapability,
  recoverCapabilityDeletionTombstones,
} from "../two-phase-destruction.ts";
import {
  createFakeOwnedResourceCleanupAdapter,
  createFakeOwnedResourceStore,
  FAKE_OWNED_RESOURCE_ADAPTER,
  type FakeOwnedResourceStore,
  type StagedOwnedResource,
} from "./owned-resources.test-support.ts";

const FOREIGN_INCARNATION = "88888888-8888-4888-8888-888888888888";

/** A notes row carrying one retired field, so inactive-field absorption is provable. */
function notesWithRetiredField() {
  const base = notesRow();
  return notesRow({
    schema: {
      fields: [
        ...base.schema.fields,
        {
          name: "retired_photo",
          label: "Retired photo",
          type: "string",
          required: false,
          lifecycle: "inactive",
        },
      ],
    },
  });
}

/** Every file lifecycle state the plan says the manifest must absorb before table drop. */
function everyLifecycleState(
  capabilityId: string,
  incarnationId: string,
  recordId: string,
): readonly StagedOwnedResource[] {
  const owner = { capabilityId, incarnationId } as const;
  return [
    // Committed through an active `file` field, and the *same key* again through an
    // inactive `file[]` field: two references, one resource.
    {
      ...owner,
      key: "cover",
      fieldName: "text",
      fieldLifecycle: "active",
      shape: "file",
      state: "committed",
      recordId,
    },
    {
      ...owner,
      key: "cover",
      fieldName: "retired_photo",
      fieldLifecycle: "inactive",
      shape: "file[]",
      state: "committed",
      recordId,
    },
    // Committed only through the retired field — the reference a manifest built from the
    // visible form would miss entirely.
    {
      ...owner,
      key: "retired-only",
      fieldName: "retired_photo",
      fieldLifecycle: "inactive",
      shape: "file[]",
      state: "committed",
      recordId,
    },
    // Ownership claimed by an in-flight write that never committed.
    {
      ...owner,
      key: "pending-upload",
      fieldName: "text",
      fieldLifecycle: "active",
      shape: "file",
      state: "pending",
    },
    // Already handed to the store's own cleanup queue.
    {
      ...owner,
      key: "enqueued-orphan",
      fieldName: "text",
      fieldLifecycle: "active",
      shape: "file[]",
      state: "cleanup_enqueued",
    },
    // A different incarnation of the same semantic id: never this deletion's business.
    {
      capabilityId,
      incarnationId: FOREIGN_INCARNATION,
      key: "other-incarnation",
      fieldName: "text",
      fieldLifecycle: "active",
      shape: "file",
      state: "pending",
    },
  ];
}

function stageAll(store: FakeOwnedResourceStore, references: readonly StagedOwnedResource[]): void {
  for (const reference of references) store.stage(reference);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one scratch-database lifecycle keeps the absorption and cleanup evidence coherent.
describe("the Module 6 owned-resource acceptance fake", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("the manifest absorbs committed, pending, and enqueued state, deduplicated and incarnation-bound", async () => {
    const target = notesWithRetiredField();
    install(conns, target);
    conns.readwrite.run("INSERT INTO cap_notes (id, text, pinned) VALUES ('record-1', 'note', 0)");
    const store = createFakeOwnedResourceStore();
    stageAll(store, everyLifecycleState(target.id, target.incarnation_id, "record-1"));

    let committed: CapabilityDeletionTombstone | undefined;
    const result = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters: [createFakeOwnedResourceCleanupAdapter(store)],
      faults: {
        afterCommit: () => {
          committed = listCapabilityDeletionTombstones(conns.readonly)[0];
        },
      },
    });

    expect(result.status).toBe("deleted");
    // Every lifecycle state reached the collection, including both references to `cover`.
    expect(store.absorbedFor(target.id, target.incarnation_id)).toEqual([
      {
        key: "cover",
        fieldName: "text",
        fieldLifecycle: "active",
        shape: "file",
        state: "committed",
      },
      {
        key: "cover",
        fieldName: "retired_photo",
        fieldLifecycle: "inactive",
        shape: "file[]",
        state: "committed",
      },
      {
        key: "retired-only",
        fieldName: "retired_photo",
        fieldLifecycle: "inactive",
        shape: "file[]",
        state: "committed",
      },
      {
        key: "pending-upload",
        fieldName: "text",
        fieldLifecycle: "active",
        shape: "file",
        state: "pending",
      },
      {
        key: "enqueued-orphan",
        fieldName: "text",
        fieldLifecycle: "active",
        shape: "file[]",
        state: "cleanup_enqueued",
      },
    ]);
    // …and the tombstone carries each *resource* once, bound to this exact incarnation.
    expect(committed?.manifest).toEqual([
      {
        adapter: FAKE_OWNED_RESOURCE_ADAPTER,
        key: "cover",
        capabilityId: target.id,
        incarnationId: target.incarnation_id,
      },
      {
        adapter: FAKE_OWNED_RESOURCE_ADAPTER,
        key: "enqueued-orphan",
        capabilityId: target.id,
        incarnationId: target.incarnation_id,
      },
      {
        adapter: FAKE_OWNED_RESOURCE_ADAPTER,
        key: "pending-upload",
        capabilityId: target.id,
        incarnationId: target.incarnation_id,
      },
      {
        adapter: FAKE_OWNED_RESOURCE_ADAPTER,
        key: "retired-only",
        capabilityId: target.id,
        incarnationId: target.incarnation_id,
      },
    ]);
    expect(store.cleaned()).toEqual([
      { key: "cover", alreadyAbsent: false },
      { key: "enqueued-orphan", alreadyAbsent: false },
      { key: "pending-upload", alreadyAbsent: false },
      { key: "retired-only", alreadyAbsent: false },
    ]);
    // The other incarnation's resource is untouched by id-shaped collateral damage.
    expect(store.hasObject(target.id, FOREIGN_INCARNATION, "other-incarnation")).toBe(true);
    expect(store.stagedFor(target.id, target.incarnation_id)).toEqual([]);
  });

  test("collection refuses to run once the table is gone, because the manifest would be short", () => {
    const target = notesWithRetiredField();
    install(conns, target);
    conns.readwrite.run("INSERT INTO cap_notes (id, text, pinned) VALUES ('record-1', 'note', 0)");
    const store = createFakeOwnedResourceStore();
    stageAll(store, everyLifecycleState(target.id, target.incarnation_id, "record-1"));

    expect(() => store.collectFor(target, conns.readonly)).not.toThrow();
    conns.readwrite.exec("DROP TABLE cap_notes;");
    expect(() => store.collectFor(target, conns.readonly)).toThrow(
      "after notes's table was dropped",
    );
  });

  test("a committed reference with no readable record refuses collection", () => {
    const target = notesWithRetiredField();
    install(conns, target);
    const store = createFakeOwnedResourceStore();
    store.stage({
      capabilityId: target.id,
      incarnationId: target.incarnation_id,
      key: "orphan",
      fieldName: "text",
      fieldLifecycle: "active",
      shape: "file",
      state: "committed",
      recordId: "never-existed",
    });

    expect(() => store.collectFor(target, conns.readonly)).toThrow("has no readable record");
  });

  test("a reference naming an undeclared field refuses collection", () => {
    const target = notesRow();
    install(conns, target);
    const store = createFakeOwnedResourceStore();
    store.stage({
      capabilityId: target.id,
      incarnationId: target.incarnation_id,
      key: "ghost",
      fieldName: "not_a_field",
      fieldLifecycle: "active",
      shape: "file",
      state: "pending",
    });

    expect(() => store.collectFor(target, conns.readonly)).toThrow(
      "which the capability does not declare",
    );
  });

  test("a mid-manifest failure stops the run, leaving the untried entries still owed", async () => {
    const target = notesRow();
    install(conns, target);
    const store = createFakeOwnedResourceStore();
    // Manifest order is by key, so the failure lands in the middle and `zulu` is never
    // attempted — the tombstone still owes it.
    for (const key of ["alpha", "mike", "zulu"]) {
      store.stage({
        capabilityId: target.id,
        incarnationId: target.incarnation_id,
        key,
        fieldName: "text",
        fieldLifecycle: "active",
        shape: "file",
        state: "pending",
      });
    }
    store.failCleanupOf("mike");

    const result = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters: [createFakeOwnedResourceCleanupAdapter(store)],
    });

    expect(result.status).toBe("cleanup_pending");
    // `alpha` was discharged, `mike` failed, and `zulu` was never attempted — but the
    // tombstone keeps the complete manifest, so a retry re-runs all three.
    expect(store.cleaned()).toEqual([{ key: "alpha", alreadyAbsent: false }]);
    expect(store.hasObject(target.id, target.incarnation_id, "alpha")).toBe(false);
    expect(store.hasObject(target.id, target.incarnation_id, "mike")).toBe(true);
    expect(store.hasObject(target.id, target.incarnation_id, "zulu")).toBe(true);
    expect(listCapabilityDeletionTombstones(conns.readonly)[0]?.manifest.map((e) => e.key)).toEqual(
      ["alpha", "mike", "zulu"],
    );
  });

  test("cleanup refuses an entry belonging to another incarnation, at both guards", async () => {
    const target = notesRow();
    install(conns, target);
    const store = createFakeOwnedResourceStore();
    const foreign = {
      adapter: FAKE_OWNED_RESOURCE_ADAPTER,
      key: "not-yours",
      capabilityId: target.id,
      incarnationId: FOREIGN_INCARNATION,
    };
    const tombstone: CapabilityDeletionTombstone = {
      capabilityId: target.id,
      incarnationId: target.incarnation_id,
      manifest: [foreign],
      createdAt: "2026-08-04 00:00:00",
      cleanupAttempts: 0,
      cleanupError: null,
    };

    // The store's own guard.
    expect(() => store.cleanEntry(foreign, tombstone)).toThrow("from another incarnation");

    // …and deletion's, for a manifest that reached the tombstone some other way.
    insertCapabilityDeletionTombstone(
      { capabilityId: target.id, incarnationId: target.incarnation_id, manifest: [foreign] },
      conns.readwrite,
    );
    const recovered = await recoverCapabilityDeletionTombstones({
      database: conns.readwrite,
      adapters: [createFakeOwnedResourceCleanupAdapter(store)],
    });
    expect(recovered.map((entry) => entry.status)).toEqual(["cleanup_pending"]);
    expect(String(recovered[0]?.error)).toContain("owned by another incarnation");
    expect(listCapabilityDeletionTombstones(conns.readonly)).toHaveLength(1);
  });

  test("cleanup is idempotent: the same manifest run twice succeeds with nothing left to remove", async () => {
    const target = notesRow();
    install(conns, target);
    const store = createFakeOwnedResourceStore();
    // Manifest order is by key, so `alpha` is cleaned before `zulu` fails. That leaves the
    // tombstone alive carrying its *complete* manifest — the partial-cleanup shape every
    // retry has to tolerate without treating an already-removed resource as an error.
    for (const key of ["alpha", "zulu"]) {
      store.stage({
        capabilityId: target.id,
        incarnationId: target.incarnation_id,
        key,
        fieldName: "text",
        fieldLifecycle: "active",
        shape: "file",
        state: "pending",
      });
    }
    store.failCleanupOf("zulu");

    const adapter = createFakeOwnedResourceCleanupAdapter(store);
    const pending = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters: [adapter],
    });
    expect(pending.status).toBe("cleanup_pending");
    expect(store.cleaned()).toEqual([{ key: "alpha", alreadyAbsent: false }]);
    expect(store.hasObject(target.id, target.incarnation_id, "zulu")).toBe(true);

    store.forgetCleanupLog();
    const stillBlocked = await recoverCapabilityDeletionTombstones({
      database: conns.readwrite,
      adapters: [adapter],
    });
    expect(stillBlocked.map((entry) => entry.status)).toEqual(["cleanup_pending"]);
    // The retry re-ran `alpha`, which was already gone — and that is a success, not a fault.
    expect(store.cleaned()).toEqual([{ key: "alpha", alreadyAbsent: true }]);

    store.allowCleanupOf("zulu");
    store.forgetCleanupLog();
    const recovered = await recoverCapabilityDeletionTombstones({
      database: conns.readwrite,
      adapters: [adapter],
    });
    expect(recovered.map((entry) => entry.status)).toEqual(["deleted"]);
    expect(store.cleaned()).toEqual([
      { key: "alpha", alreadyAbsent: true },
      { key: "zulu", alreadyAbsent: false },
    ]);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
  });
});
