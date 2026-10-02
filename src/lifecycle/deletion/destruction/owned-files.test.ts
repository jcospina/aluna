// The files adapter against a battery shaped like the one M4's acceptance fake models
// (`seam-fakes/owned-resources.test.ts`), over a real ledger and a real local store. The fake's
// `committed` is the ledger's `owned`. The ledger, not the capability's table, is what collection
// reads, so the fake's checks against the table (collection after the drop, a reference with no
// record, an undeclared field) have no real counterpart, and neither has one key in two fields.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedFileLedgerRow } from "../../../platform/files/store/ledger.test-support.ts";
import {
  FILE_LEDGER_TABLE,
  type FileLedgerState,
  readFileLedgerRow,
} from "../../../platform/files/store/ledger.ts";
import {
  createLocalObjectStore,
  type ObjectStore,
} from "../../../platform/files/store/object-store.ts";
import { STAGING_DIRECTORY } from "../../../platform/files/store/object-store-root.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { REGISTRY_TABLE } from "../../../platform/persistence/table-names.ts";
import { EIGHTH_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import {
  type CapabilityDeletionTombstone,
  getCapability,
  insertCapabilityDeletionTombstone,
  listCapabilityDeletionTombstones,
} from "../../../registry/index.ts";
import { createReadGateCoordinator } from "../../../runtime/concurrency/read-gates.ts";
import {
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../../../runtime/router/dispatch/router.test-support.ts";
import { tableExists } from "./fault-battery.test-support.ts";
import {
  cleansFilesThrough,
  createOwnedFileCleanupAdapter,
  OWNED_RESOURCE_ADAPTER,
} from "./owned-files.ts";
import {
  type CapabilityDestructionFaults,
  createProductionCapabilityDeletionAdapters,
  destroyCapability,
  type OwnedResourceCleanupAdapter,
  recoverCapabilityDeletionTombstones,
} from "./two-phase-destruction.ts";

const FOREIGN_INCARNATION = EIGHTH_INCARNATION_ID;

/** A notes row carrying one retired field, so a key owned only through it is provably collected. */
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

let dir: string;
let conns: PlatformDatabase;
let store: ObjectStore;
const root = () => join(dir, "storage");

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  store = createLocalObjectStore(root());
});

afterEach(() => teardownRouterTest(dir, conns));

/** A ledger row in `state` through `field`, with its bytes in place, or still staged. */
function admitted(
  incarnationId: string,
  field: string,
  state: FileLedgerState,
  staged = false,
  capabilityId = "notes",
): string {
  const key = seedFileLedgerRow(conns.readwrite, {
    capabilityId,
    incarnationId,
    field,
    state,
    ...(state === "owned" ? { recordId: "record-1" } : {}),
  });
  const at = staged ? join(root(), STAGING_DIRECTORY) : root();
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, key), "bytes");
  return key;
}

/** The adapter under test, deleting through `objectStore`. */
const filesAdapter = (objectStore: Pick<ObjectStore, "delete"> = store, deleteTimeoutMs?: number) =>
  createOwnedFileCleanupAdapter({
    objectStore,
    ledger: conns.readonly,
    ...(deleteTimeoutMs === undefined ? {} : { deleteTimeoutMs }),
  });

const onDisk = (key: string) =>
  existsSync(join(root(), key)) || existsSync(join(root(), STAGING_DIRECTORY, key));

function destroy(
  target: ReturnType<typeof notesRow>,
  adapters: readonly OwnedResourceCleanupAdapter[] = [filesAdapter()],
  faults?: CapabilityDestructionFaults,
) {
  return destroyCapability({
    target,
    database: conns.readwrite,
    readonlyDatabase: conns.readonly,
    readGates: createReadGateCoordinator(),
    adapters,
    ...(faults ? { faults } : {}),
  });
}

/** A store whose delete of `failing` throws until `failing` is cleared. */
function failingStore(failing: Set<string>): ObjectStore {
  return {
    ...store,
    delete: async (key) => {
      if (failing.has(key)) throw new Error(`could not delete ${key}`);
      await store.delete(key);
    },
  };
}

describe("the files adapter collecting", () => {
  test("collects owned, retired-field, pending and enqueued keys, and every one's bytes go", async () => {
    const target = notesWithRetiredField();
    install(conns, target);
    const incarnation = target.incarnation_id;
    const owned = [
      admitted(incarnation, "text", "owned"),
      admitted(incarnation, "retired_photo", "owned"),
      admitted(incarnation, "text", "pending"),
      admitted(incarnation, "text", "pending", true),
      admitted(incarnation, "text", "cleanup_enqueued"),
    ];
    const foreign = admitted(FOREIGN_INCARNATION, "text", "pending");
    let committed: CapabilityDeletionTombstone | undefined;

    const result = await destroy(target, undefined, {
      afterCommit: () => {
        committed = listCapabilityDeletionTombstones(conns.readonly)[0];
      },
    });

    expect(result.status).toBe("deleted");
    expect(committed?.manifest).toEqual(
      [...owned].sort().map((key) => ({
        adapter: OWNED_RESOURCE_ADAPTER,
        key,
        capabilityId: target.id,
        incarnationId: incarnation,
      })),
    );
    expect(owned.filter(onDisk)).toEqual([]);
    expect(owned.map((key) => readFileLedgerRow(conns.readonly, key))).toEqual(
      owned.map(() => null),
    );
    expect(onDisk(foreign)).toBe(true);
    expect(readFileLedgerRow(conns.readonly, foreign)?.state).toBe("pending");
  });

  test("collects before the tombstone commits, because the commit retires the rows it reads", async () => {
    const target = notesRow();
    install(conns, target);
    const key = admitted(target.incarnation_id, "text", "owned");
    const adapter = filesAdapter(store);
    let afterCommit: readonly string[] = [];

    await destroy(target, [adapter], {
      afterCommit: async () => {
        afterCommit = await adapter.collect({ target, database: conns.readonly });
      },
    });

    expect(afterCommit).toEqual([]);
    expect(onDisk(key)).toBe(false);
  });

  test("takes nothing of another capability, even under the same incarnation id", async () => {
    const target = notesRow();
    install(conns, target);
    const theirs = admitted(target.incarnation_id, "text", "owned", false, "recipes");

    expect((await destroy(target)).status).toBe("deleted");

    expect(readFileLedgerRow(conns.readonly, theirs)?.state).toBe("owned");
    expect(onDisk(theirs)).toBe(true);
  });

  test("refuses before anything commits when the ledger holds a key no delete accepts", async () => {
    const target = notesRow();
    install(conns, target);
    const kept = admitted(target.incarnation_id, "text", "owned");
    const malformed = admitted(target.incarnation_id, "text", "pending");
    conns.readwrite.run(`UPDATE ${FILE_LEDGER_TABLE} SET "key" = 'not-a-key' WHERE "key" = ?`, [
      malformed,
    ]);

    await expect(destroy(target)).rejects.toThrow();

    expect(getCapability(target.id, conns.readonly)?.incarnation_id).toBe(target.incarnation_id);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
    expect(readFileLedgerRow(conns.readonly, kept)?.state).toBe("owned");
    expect(onDisk(kept)).toBe(true);
  });

  for (const fault of ["afterFileLedgerPurged", "afterTableDropped"] as const) {
    test(`retires the rows inside the tombstone transaction, which a failure at ${fault} undoes`, async () => {
      const target = notesRow();
      install(conns, target);
      const key = admitted(target.incarnation_id, "text", "owned");

      await expect(
        destroy(target, undefined, {
          [fault]: () => {
            throw new Error("power lost");
          },
        }),
      ).rejects.toThrow("power lost");

      expect(readFileLedgerRow(conns.readonly, key)?.state).toBe("owned");
      expect(getCapability(target.id, conns.readonly)?.incarnation_id).toBe(target.incarnation_id);
      expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
      expect(tableExists(conns, "cap_notes")).toBe(true);
      expect(onDisk(key)).toBe(true);
    });
  }
});

describe("the files adapter cleaning", () => {
  test("a mid-manifest failure leaves the untried keys owed, and a retry finishes them", async () => {
    const target = notesRow();
    install(conns, target);
    const keys = [0, 1, 2].map(() => admitted(target.incarnation_id, "text", "owned")).sort();
    const failing = new Set([keys[1] ?? ""]);

    const result = await destroy(target, [filesAdapter(failingStore(failing))]);

    expect(result.status).toBe("cleanup_pending");
    expect(keys.map(onDisk)).toEqual([false, true, true]);
    expect(listCapabilityDeletionTombstones(conns.readonly)[0]?.manifest.map((e) => e.key)).toEqual(
      keys,
    );

    failing.clear();
    const recovered = await recoverCapabilityDeletionTombstones({
      database: conns.readwrite,
      adapters: [filesAdapter(failingStore(failing))],
    });
    expect(recovered.map((entry) => entry.status)).toEqual(["deleted"]);
    expect(keys.filter(onDisk)).toEqual([]);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
  });

  test("a delete that hangs counts as failed, so deletion's lease is never held forever", async () => {
    const target = notesRow();
    install(conns, target);
    admitted(target.incarnation_id, "text", "owned");
    const hanging: ObjectStore = { ...store, delete: () => new Promise(() => {}) };

    const result = await destroy(target, [filesAdapter(hanging, 5)]);

    expect(result.status).toBe("cleanup_pending");
    expect(listCapabilityDeletionTombstones(conns.readonly)).toHaveLength(1);
  });

  test("never deletes a key another owner holds, another incarnation's, or a malformed one", async () => {
    const target = notesRow();
    const deleted: string[] = [];
    const spy: Pick<ObjectStore, "delete"> = {
      delete: async (key) => {
        deleted.push(key);
      },
    };
    const owing = async (key: string, incarnationId: string) => {
      conns.readwrite.run(`DELETE FROM ${REGISTRY_TABLE} WHERE id = ?`, [target.id]);
      install(conns, target);
      insertCapabilityDeletionTombstone(
        {
          capabilityId: target.id,
          incarnationId: target.incarnation_id,
          manifest: [
            { adapter: OWNED_RESOURCE_ADAPTER, key, capabilityId: target.id, incarnationId },
          ],
        },
        conns.readwrite,
      );
      return (
        await recoverCapabilityDeletionTombstones({
          database: conns.readwrite,
          adapters: [filesAdapter(spy)],
        })
      ).map((result) => result.status);
    };

    const live = admitted(FOREIGN_INCARNATION, "text", "owned");
    expect(await owing(live, target.incarnation_id)).toEqual(["cleanup_pending"]);
    expect(await owing(live, FOREIGN_INCARNATION)).toEqual(["cleanup_pending"]);
    expect(await owing("../../app.db", target.incarnation_id)).toEqual(["cleanup_pending"]);
    expect(deleted).toEqual([]);
    expect(onDisk(live)).toBe(true);
  });

  test("an already-absent key is success, so a retry after a lost process completes", async () => {
    const target = notesRow();
    install(conns, target);
    const keys = [0, 1].map(() => admitted(target.incarnation_id, "text", "owned"));

    await expect(
      destroy(target, undefined, {
        afterCommit: () => {
          throw new Error("process lost");
        },
      }),
    ).rejects.toThrow("process lost");
    await store.delete(keys[0] ?? "");

    const recovered = await recoverCapabilityDeletionTombstones({
      database: conns.readwrite,
      adapters: [filesAdapter(store)],
    });
    expect(recovered.map((entry) => entry.status)).toEqual(["deleted"]);
    expect(keys.filter(onDisk)).toEqual([]);
  });

  test("is in the production inventory beside the version artifacts", () => {
    const names = createProductionCapabilityDeletionAdapters(
      { objectStore: store, ledger: conns.readonly },
      join(dir, "capabilities"),
    ).map((adapter) => adapter.name);
    expect(names).toEqual(["version_artifacts", OWNED_RESOURCE_ADAPTER]);
  });

  test("says which store and ledger it works on, so a supervisor wired elsewhere is refused", () => {
    const elsewhere = createLocalObjectStore(join(dir, "elsewhere"));
    const wiring = { objectStore: store, ledger: conns.readonly };
    expect(cleansFilesThrough([filesAdapter(store)], wiring)).toBe(true);
    expect(cleansFilesThrough([filesAdapter(store)], { ...wiring, objectStore: elsewhere })).toBe(
      false,
    );
    expect(cleansFilesThrough([filesAdapter(store)], { ...wiring, ledger: conns.readwrite })).toBe(
      false,
    );
    expect(cleansFilesThrough([filesAdapter(store), filesAdapter(elsewhere)], wiring)).toBe(false);
    expect(cleansFilesThrough([], wiring)).toBe(false);
  });
});
