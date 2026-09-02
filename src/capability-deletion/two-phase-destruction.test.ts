import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import {
  compareAndSwapCapability,
  getCapability,
  insertCapability,
  listCapabilityDeletionTombstones,
} from "../registry/index.ts";
import { createReadGateCoordinator } from "../runtime/concurrency/read-gates.ts";
import { applyCapabilityTableDdl } from "../runtime/data/schema/ddl.ts";
import {
  install,
  notesRow,
  rowSpec,
  setupRouterTest,
  teardownRouterTest,
} from "../runtime/router/dispatch/router.test-support.ts";
import {
  createArtifactCleanupAdapter,
  destroyCapability,
  type OwnedResourceCleanupAdapter,
  recoverCapabilityDeletionTombstones,
} from "./two-phase-destruction.ts";

function tableExists(database: PlatformDatabase["readonly"], name: string): boolean {
  return (
    database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    null
  );
}

function incarnation(target: ReturnType<typeof notesRow>) {
  return { capabilityId: target.id, incarnationId: target.incarnation_id };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one scratch-database lifecycle keeps the pre/post-commit evidence coherent.
describe("two-phase capability destruction", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("collects while inactive fields and the table still exist, deduplicates, commits, and cleans artifacts", async () => {
    const artifactsRoot = join(dir, "artifacts");
    const base = notesRow();
    const target = notesRow({
      schema: {
        fields: [
          ...base.schema.fields,
          {
            name: "retired_file",
            label: "Retired file",
            type: "string",
            required: false,
            lifecycle: "inactive",
          },
        ],
      },
      artifacts_path: join(artifactsRoot, "notes", base.incarnation_id, "v1"),
    });
    install(conns, target);
    mkdirSync(target.artifacts_path, { recursive: true });
    writeFileSync(join(target.artifacts_path, "read.ts"), "export default 'old';");
    conns.readwrite.run(
      "INSERT INTO generation_metrics (id, outcome, intent_type, intent_confidence, model, incarnation_id) VALUES (?, ?, ?, ?, ?, ?)",
      ["old-metric", "success", "new_capability", 1, "fake", target.incarnation_id],
    );

    const cleaned: string[] = [];
    const fieldAdapter: OwnedResourceCleanupAdapter = {
      name: "field_resources",
      collect: ({ target: collected, database }) => {
        expect(collected.schema.fields.some((field) => field.lifecycle === "inactive")).toBe(true);
        expect(
          database
            .query('PRAGMA table_xinfo("cap_notes")')
            .all()
            .some((column) => (column as { name: string }).name === "retired_file"),
        ).toBe(true);
        return ["retired-key", "active-key", "retired-key"];
      },
      clean: (entry) => {
        cleaned.push(`${entry.adapter}:${entry.key}`);
      },
    };
    const readGates = createReadGateCoordinator();
    let committedManifest: readonly string[] = [];
    let committedRegistryState = "";
    const result = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates,
      adapters: [createArtifactCleanupAdapter(artifactsRoot), fieldAdapter],
      faults: {
        afterCommit: () => {
          committedRegistryState = (
            conns.readonly
              .query("SELECT lifecycle_state FROM capability_registry WHERE id = ?")
              .get(target.id) as { lifecycle_state: string }
          ).lifecycle_state;
          committedManifest =
            listCapabilityDeletionTombstones(conns.readonly)[0]?.manifest.map(
              (entry) => `${entry.adapter}:${entry.key}`,
            ) ?? [];
        },
      },
    });

    expect(result.status).toBe("deleted");
    expect(committedRegistryState).toBe("deletion_tombstone");
    expect(committedManifest).toEqual([
      "field_resources:active-key",
      "field_resources:retired-key",
      "version_artifacts:incarnation_root",
    ]);
    expect(cleaned).toEqual(["field_resources:active-key", "field_resources:retired-key"]);
    expect(getCapability(target.id, conns.readonly)).toBeNull();
    expect(tableExists(conns.readonly, "cap_notes")).toBe(false);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
    expect(readGates.snapshot()).toEqual([]);
    expect(existsSync(join(artifactsRoot, target.id, target.incarnation_id))).toBe(false);
    expect(
      conns.readonly.query("SELECT id FROM generation_metrics WHERE id = ?").get("old-metric"),
    ).toEqual({ id: "old-metric" });
  });

  test("a slow but well-behaved reader delays the deletion instead of failing it", async () => {
    const target = notesRow();
    install(conns, target);
    // What this pins is the behaviour, not the numbers: a reader that has not yet reached
    // a point where it could notice the close is waited for rather than refused. The
    // production ordering the behaviour depends on — the drain deadline sitting above the
    // longest a single Handler may run — is asserted in `src/runtime/concurrency/read-gates.test.ts`.
    // The deadline here is far above the hold so the assertion can never turn into a race.
    const HELD_MS = 100;
    const DRAIN_MS = 5_000;
    const readGates = createReadGateCoordinator({ drainTimeoutMs: DRAIN_MS });
    const identity = incarnation(target);
    const tokens = readGates.tryAcquire({ catalog: [identity], incarnations: [identity] });
    expect(tokens).toBeDefined();
    if (!tokens) throw new Error("the slow reader did not acquire its read token");
    const startedAt = Date.now();
    setTimeout(() => readGates.release(tokens), HELD_MS);

    const result = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates,
      adapters: [],
    });

    expect(result.status).toBe("deleted");
    // The drain waited for the reader instead of giving up on it.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(HELD_MS);
    expect(getCapability(target.id, conns.readonly)).toBeNull();
    expect(tableExists(conns.readonly, "cap_notes")).toBe(false);
    expect(readGates.snapshot()).toEqual([]);
  });

  test("a collector failure is pre-commit: registry, table, and reads reopen unchanged", async () => {
    const target = notesRow();
    install(conns, target);
    const readGates = createReadGateCoordinator();
    const failing: OwnedResourceCleanupAdapter = {
      name: "files",
      collect: () => {
        throw new Error("collect failed");
      },
      clean: () => undefined,
    };

    expect(
      destroyCapability({
        target,
        database: conns.readwrite,
        readonlyDatabase: conns.readonly,
        readGates,
        adapters: [failing],
      }),
    ).rejects.toThrow("collect failed");

    expect(getCapability(target.id, conns.readonly)).toEqual(target);
    expect(tableExists(conns.readonly, "cap_notes")).toBe(true);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
    expect(readGates.snapshot()).toEqual([
      { ...incarnation(target), state: "active", readerCount: 0 },
    ]);
    const tokens = readGates.tryAcquire({
      catalog: [incarnation(target)],
      incarnations: [incarnation(target)],
    });
    expect(tokens).toBeDefined();
    if (!tokens) throw new Error("the reopened read gate did not issue a token");
    expect(readGates.release(tokens)).toBe(true);
  });

  test("collectors are physically read-only and cannot corrupt live records before failing", async () => {
    const target = notesRow();
    install(conns, target);
    conns.readwrite.run(
      "INSERT INTO cap_notes (id, text, pinned) VALUES ('record-1', 'still here', 0)",
    );
    const readGates = createReadGateCoordinator();
    const destructiveCollector: OwnedResourceCleanupAdapter = {
      name: "destructive_collector",
      collect: ({ database }) => {
        database.run("DELETE FROM cap_notes");
        throw new Error("collector should never reach this line");
      },
      clean: () => undefined,
    };

    expect(
      destroyCapability({
        target,
        database: conns.readwrite,
        readonlyDatabase: conns.readonly,
        readGates,
        adapters: [destructiveCollector],
      }),
    ).rejects.toThrow();
    expect(conns.readonly.query("SELECT id, text FROM cap_notes").all()).toEqual([
      { id: "record-1", text: "still here" },
    ]);
    expect(getCapability(target.id, conns.readonly)).toEqual(target);
    expect(readGates.snapshot()[0]).toMatchObject({ state: "active", readerCount: 0 });
  });

  test("a transaction failure after DROP rolls tombstone, purge, registry, and table back together", async () => {
    const target = notesRow();
    install(conns, target);
    conns.readwrite.exec(
      "CREATE TABLE fake_events (id TEXT PRIMARY KEY); INSERT INTO fake_events VALUES ('event-1');",
    );
    const readGates = createReadGateCoordinator();
    const adapter: OwnedResourceCleanupAdapter = {
      name: "resources",
      collect: () => ["one"],
      clean: () => undefined,
    };

    expect(
      destroyCapability({
        target,
        database: conns.readwrite,
        readonlyDatabase: conns.readonly,
        readGates,
        adapters: [adapter],
        faults: {
          afterEventPayloadsPurged: () => {
            conns.readwrite.run("DELETE FROM fake_events");
          },
          afterTableDropped: () => {
            throw new Error("before commit");
          },
        },
      }),
    ).rejects.toThrow("before commit");

    expect(getCapability(target.id, conns.readonly)).toEqual(target);
    expect(tableExists(conns.readonly, "cap_notes")).toBe(true);
    expect(conns.readonly.query("SELECT id FROM fake_events").all()).toEqual([{ id: "event-1" }]);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
    expect(readGates.snapshot()[0]).toMatchObject({ state: "active", readerCount: 0 });
  });

  test("artifact cleanup refuses a symlinked parent without touching the outside directory", async () => {
    const target = notesRow();
    install(conns, target);
    const artifactsRoot = join(dir, "artifacts");
    const outside = join(dir, "outside");
    const outsideIncarnation = join(outside, target.incarnation_id);
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(outsideIncarnation, { recursive: true });
    writeFileSync(join(outsideIncarnation, "keep.txt"), "safe");
    symlinkSync(outside, join(artifactsRoot, target.id), "dir");
    const readGates = createReadGateCoordinator();

    expect(
      destroyCapability({
        target,
        database: conns.readwrite,
        readonlyDatabase: conns.readonly,
        readGates,
        adapters: [createArtifactCleanupAdapter(artifactsRoot)],
      }),
    ).rejects.toThrow("refuses symlinked");
    expect(existsSync(join(outsideIncarnation, "keep.txt"))).toBe(true);
    expect(getCapability(target.id, conns.readonly)).toEqual(target);
    expect(tableExists(conns.readonly, "cap_notes")).toBe(true);
  });

  test("artifact cleanup refuses a mismatched configured root before deleting the registry", async () => {
    const actualRoot = join(dir, "actual-artifacts");
    const configuredRoot = join(dir, "wrong-artifacts");
    const base = notesRow();
    const target = notesRow({
      artifacts_path: join(actualRoot, base.id, base.incarnation_id, "v1"),
    });
    install(conns, target);
    mkdirSync(target.artifacts_path, { recursive: true });
    writeFileSync(join(target.artifacts_path, "read.ts"), "authoritative history");
    const readGates = createReadGateCoordinator();

    expect(
      destroyCapability({
        target,
        database: conns.readwrite,
        readonlyDatabase: conns.readonly,
        readGates,
        adapters: [createArtifactCleanupAdapter(configuredRoot)],
      }),
    ).rejects.toThrow("do not match the configured root and exact incarnation");
    expect(existsSync(join(target.artifacts_path, "read.ts"))).toBe(true);
    expect(getCapability(target.id, conns.readonly)).toEqual(target);
    expect(tableExists(conns.readonly, "cap_notes")).toBe(true);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
  });

  test("cleanup failure stays logically deleted, reserves the id, and boot recovery is idempotent", async () => {
    const target = notesRow();
    install(conns, target);
    const readGates = createReadGateCoordinator();
    const failing: OwnedResourceCleanupAdapter = {
      name: "resources",
      collect: () => ["same", "same", "inactive"],
      clean: () => {
        throw new Error("external cleanup unavailable");
      },
    };
    const pending = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates,
      adapters: [failing],
    });

    expect(pending.status).toBe("cleanup_pending");
    expect(getCapability(target.id, conns.readonly)).toBeNull();
    expect(tableExists(conns.readonly, "cap_notes")).toBe(false);
    expect(readGates.snapshot()).toEqual([]);
    const [tombstone] = listCapabilityDeletionTombstones(conns.readonly);
    expect(tombstone?.manifest.map((entry) => entry.key)).toEqual(["inactive", "same"]);

    const recreatedWhilePending = notesRow({
      incarnation_id: "99999999-9999-4999-8999-999999999999",
      artifacts_path: "capabilities/notes/99999999-9999-4999-8999-999999999999/v1/",
      seed: 184206,
      logo: { status: "absent", attempts: 0 },
    });
    expect(() => insertCapability(recreatedWhilePending, conns.readwrite)).toThrow(
      "deletion cleanup reserves notes",
    );
    expect(() =>
      compareAndSwapCapability(recreatedWhilePending, { state: "absent" }, conns.readwrite),
    ).toThrow("expected absent");

    const cleaned: string[] = [];
    const recoveryAdapter: OwnedResourceCleanupAdapter = {
      name: "resources",
      collect: () => [],
      clean: (entry) => {
        cleaned.push(entry.key);
      },
    };
    const recovered = await recoverCapabilityDeletionTombstones({
      database: conns.readwrite,
      adapters: [recoveryAdapter],
    });
    expect(recovered.map((entry) => entry.status)).toEqual(["deleted"]);
    expect(cleaned).toEqual(["inactive", "same"]);
    expect(
      await recoverCapabilityDeletionTombstones({
        database: conns.readwrite,
        adapters: [recoveryAdapter],
      }),
    ).toEqual([]);

    applyCapabilityTableDdl(rowSpec(recreatedWhilePending), conns.readwrite);
    insertCapability(recreatedWhilePending, conns.readwrite);
    const recreated = getCapability(target.id, conns.readonly);
    expect(recreated?.incarnation_id).not.toBe(target.incarnation_id);
    expect(recreated?.artifacts_path).not.toBe(target.artifacts_path);
    expect(recreated?.version).toBe(1);
  });

  test("a crash hook after commit leaves a durable tombstone without reopening the gate", async () => {
    const target = notesRow();
    install(conns, target);
    const readGates = createReadGateCoordinator();
    const adapter: OwnedResourceCleanupAdapter = {
      name: "resources",
      collect: () => ["one"],
      clean: () => {
        throw new Error("must not run");
      },
    };

    expect(
      destroyCapability({
        target,
        database: conns.readwrite,
        readonlyDatabase: conns.readonly,
        readGates,
        adapters: [adapter],
        faults: {
          afterCommit: () => {
            throw new Error("process lost");
          },
        },
      }),
    ).rejects.toThrow("process lost");
    expect(getCapability(target.id, conns.readonly)).toBeNull();
    expect(tableExists(conns.readonly, "cap_notes")).toBe(false);
    expect(listCapabilityDeletionTombstones(conns.readonly)).toHaveLength(1);
    expect(readGates.snapshot()).toEqual([]);
  });
});
