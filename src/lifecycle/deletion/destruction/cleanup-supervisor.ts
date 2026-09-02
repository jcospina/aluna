// Post-commit cleanup retry (ARCH §6.3 cross-store lifecycle recovery, PLAN decision 34).
//
// Deletion crosses its point of no return in one SQLite transaction and then owes durable
// external work: delete the incarnation's artifacts and any other owned resource, then
// remove the tombstone. Until that work is discharged the tombstone reserves the semantic
// id, so the capability can be neither used nor rebuilt.
//
// Boot recovery alone is not enough. It made "I still have a little tidying up to do" a
// promise the running process never kept — a cleanup that failed at 10:00 sat untouched
// until the next restart, and a cleanup that fails for a *reproducing* reason (a
// permission the process no longer has, an adapter this build does not carry) retried
// identically forever, reserving the id with it and reporting nothing but a console line.
//
// So: retry here, on a bounded backoff, and when the retries are exhausted stop guessing
// and leave the reason on the tombstone where `GET /` can show it. Every attempt runs
// under a platform write lease — cleanup deletes the tombstone row, so it is a write on
// the shared connection and must queue with every other one.
//
// "Stop guessing" is not "give up": `forceRetry` is how a person asks again, and a desk
// load presses it. That matters because the tombstone reserving the id is what stops the
// capability being rebuilt, and the build path now says so as soon as it knows the id
// (`registry/deletion-tombstones.ts`, `CapabilityIdReservedError`) instead of paying for a
// whole generation and being refused by the activation CAS.

import type { Database } from "bun:sqlite";
import {
  type CapabilityDeletionTombstone,
  listCapabilityDeletionTombstones,
  recordCapabilityDeletionCleanupFailure,
} from "../../../registry/index.ts";
import type { MutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import {
  type CapabilityDeletionRecoveryResult,
  type OwnedResourceCleanupAdapter,
  recoverCapabilityDeletionTombstones,
} from "./two-phase-destruction.ts";

/**
 * Spread out rather than hammering: a transient cause (a file still held open) clears in
 * seconds, and anything still failing after the last delay is not going to clear on its
 * own. Attempts beyond this are an operator's call, not a timer's.
 */
export const DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 30_000];

export type ScheduleRetry = (run: () => void, delayMs: number) => void;

export interface DeletionCleanupSupervisorOptions {
  readonly database: Database;
  readonly adapters: readonly OwnedResourceCleanupAdapter[];
  readonly mutationCoordinator: MutationCoordinator;
  readonly retryDelaysMs?: readonly number[];
  /** Test seam; production uses `setTimeout`. */
  readonly schedule?: ScheduleRetry;
}

export interface PendingDeletionCleanup {
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly attempts: number;
  readonly lastError: string | null;
  /** True once the backoff is spent: this one needs a person, not another timer. */
  readonly exhausted: boolean;
}

function defaultSchedule(run: () => void, delayMs: number): void {
  const timer = setTimeout(run, delayMs);
  // A pending retry must never be the reason the process refuses to exit.
  timer.unref?.();
}

export class DeletionCleanupSupervisor {
  private readonly options: DeletionCleanupSupervisorOptions;
  private readonly retryDelaysMs: readonly number[];
  private readonly schedule: ScheduleRetry;
  private running = false;
  private scheduled = false;
  private stopped = false;
  /** A retry asked for while a pass was in flight, to be honoured when that pass ends. */
  private retryOwed = false;

  constructor(options: DeletionCleanupSupervisorOptions) {
    this.options = options;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  /** Every deletion whose durable cleanup is still owed, with why it has not landed. */
  pending(): readonly PendingDeletionCleanup[] {
    return listCapabilityDeletionTombstones(this.options.database).map((tombstone) => ({
      capabilityId: tombstone.capabilityId,
      incarnationId: tombstone.incarnationId,
      attempts: tombstone.cleanupAttempts,
      lastError: tombstone.cleanupError,
      exhausted: tombstone.cleanupAttempts >= this.retryDelaysMs.length,
    }));
  }

  /**
   * Discharge every outstanding tombstone once, under a platform write lease. A failure
   * is counted on the tombstone itself so the next pass — in this process or a later
   * one — knows how much patience is left.
   */
  async runOnce(): Promise<readonly CapabilityDeletionRecoveryResult[]> {
    if (this.running) return [];
    this.running = true;
    try {
      return await this.options.mutationCoordinator.withPlatformWrite(async () => {
        const results = await recoverCapabilityDeletionTombstones({
          database: this.options.database,
          adapters: this.options.adapters,
        });
        for (const result of results) {
          if (result.status === "deleted") continue;
          recordCapabilityDeletionCleanupFailure(
            result.tombstone,
            result.error,
            this.options.database,
          );
        }
        return results;
      });
    } finally {
      this.running = false;
      // Someone asked while this pass was in flight and was told to wait for it. This is
      // the moment it ended, so honour that ask now rather than leaving it dropped.
      if (this.retryOwed) {
        this.retryOwed = false;
        this.requestRetry();
      }
    }
  }

  /**
   * Ask for another pass. The delay comes from the most patient outstanding tombstone,
   * so one wedged deletion cannot starve a younger one of its early quick retries.
   *
   * A pass already in flight is not a reason to schedule a second one. It used to be: while
   * a build held the coordinator, `runOnce` short-circuited on `running`, the chained
   * `requestRetry` scheduled again, and — because no attempt had been counted — it scheduled
   * at the *first* rung, so the supervisor spun at one pass a second for as long as the build
   * ran. The ask is remembered instead and honoured when the running pass ends.
   */
  requestRetry(): void {
    this.scheduleRetry(this.pending().filter((entry) => !entry.exhausted));
  }

  /**
   * Ask for a pass over *everything* still owed, exhausted tombstones included.
   *
   * The backoff deliberately gives up: a cause that reproduces will reproduce again, and
   * attempts past it are a person's call rather than a timer's. This is how a person makes
   * that call. A desk load presses it, so refreshing the page is the recovery gesture — which
   * matters because a tombstone reserves its capability id, and until it is discharged the
   * capability can be neither used nor rebuilt. Before this, only a process restart tried
   * again and nothing a user could do reached it.
   */
  forceRetry(): void {
    this.scheduleRetry(this.pending());
  }

  private scheduleRetry(outstanding: readonly PendingDeletionCleanup[]): void {
    if (this.stopped || this.scheduled) return;
    if (outstanding.length === 0) return;
    if (this.running) {
      this.retryOwed = true;
      return;
    }
    const attempts = Math.min(...outstanding.map((entry) => entry.attempts));
    const delayMs = this.retryDelaysMs[Math.min(attempts, this.retryDelaysMs.length - 1)] ?? 0;

    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      if (this.stopped) return;
      void this.runOnce()
        .then(() => this.requestRetry())
        .catch((error) => {
          console.error("omni-crud deletion cleanup retry failed:", error);
        });
    }, delayMs);
  }

  stop(): void {
    this.stopped = true;
  }
}

export function createDeletionCleanupSupervisor(
  options: DeletionCleanupSupervisorOptions,
): DeletionCleanupSupervisor {
  return new DeletionCleanupSupervisor(options);
}

/** The tombstone shape the developer panel shows, derived from the registry alone. */
export function pendingDeletionCleanups(
  database: Database,
  retryDelays: readonly number[] = DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS,
): readonly PendingDeletionCleanup[] {
  return listCapabilityDeletionTombstones(database).map(
    (tombstone: CapabilityDeletionTombstone) => ({
      capabilityId: tombstone.capabilityId,
      incarnationId: tombstone.incarnationId,
      attempts: tombstone.cleanupAttempts,
      lastError: tombstone.cleanupError,
      exhausted: tombstone.cleanupAttempts >= retryDelays.length,
    }),
  );
}
