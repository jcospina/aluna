import type { Database } from "bun:sqlite";
import {
  type CapabilityRow,
  getCapability,
  isCapabilityNameLabel,
  renameCapability,
} from "../registry/index.ts";
import type { MutationCoordinator } from "../runtime/concurrency/mutation-coordinator.ts";

/**
 * The exact capability the menu opened on. Both halves are load-bearing: the incarnation
 * says this is the same lifetime (a delete-and-recreate under the same id is a different
 * one and must not inherit a name chosen for its predecessor), and the version says this
 * is the same spec the person was looking at when they typed.
 */
export interface CapabilityRenameExpectation {
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly version: number;
  /**
   * The override the menu opened on — the empty string when the capability had never been
   * renamed. A rename does not bump the version, so without this two menus opened on the
   * same version both matched and the second silently overwrote the first.
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
 * Rename one capability, under the mutation coordinator, as a short platform write.
 *
 * A **platform write** and not a build: no generation row, no version, no artwork, no
 * route change. It queues where every other short platform write queues, so a rename
 * asked for while a build is already waiting goes behind it — the coordinator's FIFO
 * order is what it was, and renaming desk furniture is not a way past it.
 *
 * The name is checked before the queue is joined. A name that will not do costs nobody a
 * lease, and refusing it here rather than after admission is also what makes "no partial
 * update" trivially true: the only statement that touches the registry is the one
 * conditional UPDATE below, which either matches the exact incarnation and version or
 * matches nothing at all.
 */
export async function renameCapabilityLabel(
  expectation: CapabilityRenameExpectation,
  label: string,
  deps: CapabilityRenameDeps,
): Promise<CapabilityRenameOutcome> {
  const name = label.trim();
  if (!isCapabilityNameLabel(name)) return { status: "refused" };
  if (!looksRenameable(expectation, deps)) return { status: "stale" };

  const write = deps.rename ?? renameCapability;
  const row = await deps.mutationCoordinator.withPlatformWrite(
    () => write({ ...expectation, previousOverride: overrideOf(expectation) }, name, deps.database),
    { signal: deps.signal },
  );
  return row ? { status: "renamed", row } : { status: "stale" };
}

/**
 * A cheap readonly look, taken before the queue is joined.
 *
 * This cannot decide the rename — the conditional UPDATE still does that, under the lease,
 * and a row that moves in between is refused there. What it decides is whether a
 * submission that provably cannot match is allowed to cost a coordinator ticket.
 *
 * That matters more than it sounds. Short writes and deletion are non-queued try-acquires
 * that refuse while *anything* is queued, so a stream of submissions naming capabilities
 * that do not exist would hold the platform queue permanently non-empty and turn every
 * record write and every deletion on the desk into `mutation_busy` for as long as it ran.
 * The logo attempt guards its own paid claim the same way and for the same reason
 * (`looksClaimable`, `src/capability-logo/attempt.ts`).
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
