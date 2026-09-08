import type { Database } from "bun:sqlite";
import {
  type CapabilityRow,
  getCapability,
  isCapabilityNameLabel,
  renameCapability,
} from "../../registry/index.ts";
import type { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";

/**
 * The exact capability the menu opened on. The incarnation pins the lifetime, so a recreation
 * under the same id inherits no name; the version pins the spec the person was looking at.
 */
export interface CapabilityRenameExpectation {
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly version: number;
  /**
   * The override the menu opened on, empty when never renamed. A rename does not bump the version,
   * so without this two menus on the same version both matched and the second overwrote the first.
   */
  readonly previousLabel: string;
}

export interface CapabilityRenameDeps {
  readonly database: Database;
  readonly mutationCoordinator: MutationCoordinator;
  /** The readonly connection the pre-queue look is taken on. Defaults to the platform's. */
  readonly readonlyDatabase?: Database;
  /** Dropped if the caller goes away before this write reaches the head of the queue. */
  readonly signal?: AbortSignal;
  /** Injectable so the queue's ordering is directly observable in tests. */
  readonly rename?: typeof renameCapability;
  readonly look?: typeof getCapability;
}

export type CapabilityRenameOutcome =
  /** Written. The row is what the registry now holds, override included. */
  | { readonly status: "renamed"; readonly row: CapabilityRow }
  /** The name will not do. Nothing was read and nothing was written. */
  | { readonly status: "refused" }
  /** No active row is the one the menu opened on — evolved, deleted, or recreated. */
  | { readonly status: "stale" };

/**
 * A short platform write, not a build: no generation row, version, artwork or route change, and it
 * queues FIFO behind one. The name is checked before the queue, so a bad name costs nobody a lease.
 */
export async function renameCapabilityLabel(
  expectation: CapabilityRenameExpectation,
  label: string,
  deps: CapabilityRenameDeps,
): Promise<CapabilityRenameOutcome> {
  const name = label.trim();
  if (!isCapabilityNameLabel(name)) return { status: "refused" };
  if (!looksRenameable(expectation, deps)) return { status: "stale" };

  // One conditional UPDATE touches the registry, matching the exact incarnation and version or
  // nothing at all, so "no partial update" holds without a transaction around it.
  const write = deps.rename ?? renameCapability;
  const row = await deps.mutationCoordinator.withPlatformWrite(
    () => write({ ...expectation, previousOverride: overrideOf(expectation) }, name, deps.database),
    { signal: deps.signal },
  );
  return row ? { status: "renamed", row } : { status: "stale" };
}

/**
 * A cheap readonly look before the queue, like `looksClaimable`; the conditional UPDATE decides.
 * Deletion and short writes refuse while anything is queued, so junk would mean `mutation_busy`.
 */
function looksRenameable(
  expectation: CapabilityRenameExpectation,
  deps: CapabilityRenameDeps,
): boolean {
  const readonlyDatabase = deps.readonlyDatabase;
  if (readonlyDatabase === undefined) return true;
  const row = (deps.look ?? getCapability)(expectation.capabilityId, readonlyDatabase);
  return (
    row !== null &&
    row.incarnation_id === expectation.incarnationId &&
    row.version === expectation.version &&
    row.display_label_override === overrideOf(expectation)
  );
}

/** The stored form of the name the menu opened on: never renamed is `null`, not `""`. */
function overrideOf(expectation: CapabilityRenameExpectation): string | null {
  return expectation.previousLabel.length > 0 ? expectation.previousLabel : null;
}
