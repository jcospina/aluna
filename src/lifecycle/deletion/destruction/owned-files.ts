// The files adapter (Module 7 PLAN decision 33; ADR-0009): deletion's owned-resource seam for the
// object store. It collects every key the incarnation holds in the file ledger, whatever its state
// or field, before the tombstone transaction retires those rows, and cleans each key as the 7.3/01
// worker does: both paths, staging first, and a key already gone is success. Deletion runs it
// inline under its lease and retries it under a platform write, so these deletes hold saves and
// uploads while they run; a cloud store would batch its deletes.

import type { Database } from "bun:sqlite";
import {
  isFileKey,
  readFileLedgerRow,
  readIncarnationFileKeys,
} from "../../../platform/files/store/ledger.ts";
import type { ObjectStore } from "../../../platform/files/store/object-store.ts";
import { deleteObjectWithin } from "../../../platform/files/store/timed-delete.ts";
import type { OwnedResourceCleanupAdapter } from "./two-phase-destruction.ts";

/** The name M4 reserved for the object store. An unknown adapter fails hard. */
export const OWNED_RESOURCE_ADAPTER = "owned_files";

export interface OwnedFileCleanupWiring {
  readonly objectStore: Pick<ObjectStore, "delete">;
  /** Read once the tombstone commits: a key that still has a row there belongs to a live owner. */
  readonly ledger: Database;
  readonly deleteTimeoutMs?: number;
}

type FilesWiring = Pick<OwnedFileCleanupWiring, "objectStore" | "ledger">;
const wiringOf = new WeakMap<OwnedResourceCleanupAdapter, FilesWiring>();

export function createOwnedFileCleanupAdapter(
  wiring: OwnedFileCleanupWiring,
): OwnedResourceCleanupAdapter {
  const adapter: OwnedResourceCleanupAdapter = {
    name: OWNED_RESOURCE_ADAPTER,
    collect: ({ target, database }) => {
      const keys = readIncarnationFileKeys(database, {
        capabilityId: target.id,
        incarnationId: target.incarnation_id,
      });
      // Refused before the point of no return, where a key no delete accepts would wedge the
      // tombstone and keep the capability's id reserved for good.
      if (!keys.every(isFileKey)) throw new Error("The file ledger holds a malformed key.");
      return keys;
    },
    clean: (entry) => {
      if (!isFileKey(entry.key)) throw new Error("File cleanup received an unknown resource key.");
      if (readFileLedgerRow(wiring.ledger, entry.key)) {
        throw new Error("File cleanup received a key another owner still holds.");
      }
      return deleteObjectWithin(wiring.objectStore, entry.key, wiring.deleteTimeoutMs);
    },
  };
  wiringOf.set(adapter, { objectStore: wiring.objectStore, ledger: wiring.ledger });
  return adapter;
}

/** Whether every files adapter among `adapters`, and there is one, works on `wiring`. */
export function cleansFilesThrough(
  adapters: readonly OwnedResourceCleanupAdapter[],
  wiring: FilesWiring,
): boolean {
  const wired = adapters
    .filter((adapter) => adapter.name === OWNED_RESOURCE_ADAPTER)
    .map((adapter) => wiringOf.get(adapter));
  return (
    wired.length > 0 &&
    wired.every((each) => each?.objectStore === wiring.objectStore && each.ledger === wiring.ledger)
  );
}
