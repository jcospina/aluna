// The Module 6 acceptance fake for the owned-resource cleanup seam (PLAN decision 35,
// ADR-0006, ARCH §6.3 Object Store).
//
// A test fixture, and only that — the `.test-support.ts` suffix keeps bun from running it
// and keeps it out of the server's module graph. It must never join the live cleanup
// adapter inventory: a manifest entry is durable and names the adapter that owes it, so a
// fake that reached a real deletion would write an obligation only a dev process could
// discharge.
//
// M4 owns the *seam*: collect a deduplicated, incarnation-bound manifest while the
// capability's table still exists, then discharge it idempotently after the database's
// point of no return. M6 will own the real object store. This fake stands in for that
// store so the seam is proven now rather than assumed, and it deliberately models every
// file lifecycle state the plan says the manifest must absorb before table drop:
//
//   - `committed`        — a reference held by a live record, through an **active** or an
//                          **inactive** `file`/`file[]`-shaped field. Inactive fields are
//                          the ones a manifest built from the visible form would miss.
//   - `pending`          — ownership claimed by an in-flight create/update that has not
//                          committed. Bytes exist; no record points at them yet.
//   - `cleanup_enqueued` — already handed to the store's own cleanup queue. Deletion must
//                          still absorb it, or the queue outlives the capability.
//
// The fake is strict where the real store will be strict: it refuses a reference naming a
// field the capability does not declare, refuses a committed reference whose record is
// unreadable (which is what collecting *after* the drop would look like), and never yields
// a resource belonging to another capability or another incarnation of the same one.

import type { Database } from "bun:sqlite";
import {
  type CapabilityDeletionTombstone,
  type CapabilityRow,
  capabilitySpecFromRow,
  type OwnedResourceEntry,
} from "../../registry/index.ts";
import { deriveCapabilityTableDdl } from "../../runtime/data/schema/ddl.ts";
import {
  OWNED_RESOURCE_ADAPTER,
  type OwnedResourceCleanupAdapter,
} from "../two-phase-destruction.ts";

/** The fake claims the name M6 will install for real, so the manifest shape matches. */
export const FAKE_OWNED_RESOURCE_ADAPTER = OWNED_RESOURCE_ADAPTER;

export type OwnedResourceOwnershipState = "cleanup_enqueued" | "committed" | "pending";

/** The two file-shaped field types M6 will add to the spec vocabulary. */
export type FileFieldShape = "file" | "file[]";

export interface StagedOwnedResource {
  /** The object-store key. The same key may be referenced by several fields. */
  readonly key: string;
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly fieldName: string;
  readonly fieldLifecycle: "active" | "inactive";
  readonly shape: FileFieldShape;
  readonly state: OwnedResourceOwnershipState;
  /** Required for `committed`: the live record holding the reference. */
  readonly recordId?: string;
}

export interface AbsorbedOwnedResource {
  readonly key: string;
  readonly fieldName: string;
  readonly fieldLifecycle: "active" | "inactive";
  readonly shape: FileFieldShape;
  readonly state: OwnedResourceOwnershipState;
}

export interface CleanedOwnedResource {
  readonly key: string;
  /** True when the resource was already gone — still a success (idempotent cleanup). */
  readonly alreadyAbsent: boolean;
}

function referenceId(reference: StagedOwnedResource): string {
  return [reference.capabilityId, reference.incarnationId, reference.fieldName, reference.key].join(
    "\u0000",
  );
}

function objectId(capabilityId: string, incarnationId: string, key: string): string {
  return [capabilityId, incarnationId, key].join("\u0000");
}

function tablePresent(database: Database, name: string): boolean {
  return (
    database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    null
  );
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * An in-memory stand-in for M6's object store: references (what points at bytes) and
 * objects (the bytes themselves) are tracked separately, so cleaning a key twice is
 * observably a success rather than an error.
 */
export class FakeOwnedResourceStore {
  private readonly references = new Map<string, StagedOwnedResource>();
  private readonly objects = new Set<string>();
  private readonly failingKeys = new Set<string>();
  private absorbedByIncarnation = new Map<string, readonly AbsorbedOwnedResource[]>();
  private cleanedLog: CleanedOwnedResource[] = [];

  stage(reference: StagedOwnedResource): void {
    if (reference.state === "committed" && !reference.recordId) {
      throw new Error("A committed owned-resource reference must name the record holding it.");
    }
    this.references.set(referenceId(reference), reference);
    this.objects.add(objectId(reference.capabilityId, reference.incarnationId, reference.key));
  }

  /** Make one key's cleanup fail, so partial-cleanup recovery can be exercised. */
  failCleanupOf(key: string): void {
    this.failingKeys.add(key);
  }

  allowCleanupOf(key: string): void {
    this.failingKeys.delete(key);
  }

  stagedFor(capabilityId: string, incarnationId: string): readonly StagedOwnedResource[] {
    return [...this.references.values()].filter(
      (reference) =>
        reference.capabilityId === capabilityId && reference.incarnationId === incarnationId,
    );
  }

  staged(): readonly StagedOwnedResource[] {
    return [...this.references.values()];
  }

  hasObject(capabilityId: string, incarnationId: string, key: string): boolean {
    return this.objects.has(objectId(capabilityId, incarnationId, key));
  }

  /** What the last collection for this incarnation absorbed, in manifest order. */
  absorbedFor(capabilityId: string, incarnationId: string): readonly AbsorbedOwnedResource[] {
    return this.absorbedByIncarnation.get(objectId(capabilityId, incarnationId, "")) ?? [];
  }

  cleaned(): readonly CleanedOwnedResource[] {
    return [...this.cleanedLog];
  }

  forgetCleanupLog(): void {
    this.cleanedLog = [];
  }

  /**
   * Every owned-resource key for this exact incarnation, in every lifecycle state.
   * Duplicates are returned deliberately: deduplication is the manifest's job, and
   * leaving it to the collector would hide a regression there.
   */
  collectFor(target: CapabilityRow, database: Database): readonly string[] {
    const references = this.stagedFor(target.id, target.incarnation_id);
    this.absorbedByIncarnation.set(
      objectId(target.id, target.incarnation_id, ""),
      Object.freeze([]),
    );
    if (references.length === 0) return [];

    const tableName = deriveCapabilityTableDdl(capabilitySpecFromRow(target)).tableName;
    if (!tablePresent(database, tableName)) {
      throw new Error(
        `Owned-resource collection ran after ${target.id}'s table was dropped; the manifest would be incomplete.`,
      );
    }
    const lifecycles = new Map(target.schema.fields.map((field) => [field.name, field.lifecycle]));
    const absorbed: AbsorbedOwnedResource[] = [];
    const keys: string[] = [];
    for (const reference of references) {
      this.assertReferenceIsCollectable(reference, lifecycles, tableName, database);
      absorbed.push({
        key: reference.key,
        fieldName: reference.fieldName,
        fieldLifecycle: reference.fieldLifecycle,
        shape: reference.shape,
        state: reference.state,
      });
      keys.push(reference.key);
    }
    this.absorbedByIncarnation.set(
      objectId(target.id, target.incarnation_id, ""),
      Object.freeze(absorbed),
    );
    return keys;
  }

  /** Idempotent: an already-absent object is success, and a cleaned key stays cleaned. */
  cleanEntry(entry: OwnedResourceEntry, tombstone: CapabilityDeletionTombstone): void {
    if (
      entry.capabilityId !== tombstone.capabilityId ||
      entry.incarnationId !== tombstone.incarnationId
    ) {
      throw new Error("Owned-resource cleanup received an entry from another incarnation.");
    }
    if (this.failingKeys.has(entry.key)) {
      throw new Error(`The object store is unavailable for ${entry.key}.`);
    }
    const alreadyAbsent = !this.objects.delete(
      objectId(entry.capabilityId, entry.incarnationId, entry.key),
    );
    for (const [id, reference] of this.references) {
      if (
        reference.capabilityId === entry.capabilityId &&
        reference.incarnationId === entry.incarnationId &&
        reference.key === entry.key
      ) {
        this.references.delete(id);
      }
    }
    this.cleanedLog.push({ key: entry.key, alreadyAbsent });
  }

  private assertReferenceIsCollectable(
    reference: StagedOwnedResource,
    lifecycles: ReadonlyMap<string, "active" | "inactive">,
    tableName: string,
    database: Database,
  ): void {
    const lifecycle = lifecycles.get(reference.fieldName);
    if (lifecycle === undefined) {
      throw new Error(
        `Owned resource ${reference.key} names field ${reference.fieldName}, which the capability does not declare.`,
      );
    }
    if (lifecycle !== reference.fieldLifecycle) {
      throw new Error(
        `Owned resource ${reference.key} claims a ${reference.fieldLifecycle} field, but ${reference.fieldName} is ${lifecycle}.`,
      );
    }
    if (reference.state !== "committed") return;
    const owner = database
      .query(`SELECT 1 FROM ${quoteSqlIdentifier(tableName)} WHERE id = ?`)
      .get(reference.recordId ?? "");
    if (owner === null) {
      throw new Error(
        `Committed owned resource ${reference.key} has no readable record; collection must precede the table drop.`,
      );
    }
  }
}

export function createFakeOwnedResourceStore(): FakeOwnedResourceStore {
  return new FakeOwnedResourceStore();
}

export function createFakeOwnedResourceCleanupAdapter(
  store: FakeOwnedResourceStore,
): OwnedResourceCleanupAdapter {
  return {
    name: FAKE_OWNED_RESOURCE_ADAPTER,
    collect: ({ target, database }) => store.collectFor(target, database),
    clean: (entry, tombstone) => store.cleanEntry(entry, tombstone),
  };
}
