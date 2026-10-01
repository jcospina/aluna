// The file cleanup worker (Module 7 PLAN decisions 13, 30 and 31). The ledger is the queue: a row
// moves to `cleanup_enqueued` inside the transaction that displaces it, and whoever commits that
// transaction wakes the worker after the commit, never before. Nothing moves a row out of
// `cleanup_enqueued` but the worker, so its bytes go without any lease, staging path first. Only
// deleting the row, or counting the failure, takes a short platform write, which waits out a
// running build as every platform write does. The delays are `DeletionCleanupSupervisor`'s, but
// each key keeps its own place on them: its attempts on the ledger row, and here, when it is next
// due, so a wake for another key never spends its retries. A key gets one retry per delay after
// its first try, and then waits for a desk load.

import {
  DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS,
  type ScheduleRetry,
  scheduleUnrefTimer,
} from "../../../lifecycle/deletion/index.ts";
import { errorDetail, errorMessage } from "../../../platform/errors.ts";
import {
  deleteCleanedFile,
  type EnqueuedFile,
  readEnqueuedFiles,
  recordFileCleanupFailure,
} from "../../../platform/files/store/ledger.ts";
import type { ObjectStore } from "../../../platform/files/store/object-store.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { MutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";

/** Long enough for any local unlink; a store that hangs past it counts as a failed attempt. */
export const DEFAULT_FILE_DELETE_TIMEOUT_MS = 60_000;

export interface FileCleanupOptions {
  /** The queue is read on `readonly`, so a save still open on `readwrite` is never seen. */
  readonly databases: PlatformDatabase;
  readonly objectStore: Pick<ObjectStore, "delete">;
  readonly mutationCoordinator: MutationCoordinator;
  /** The wait before each retry of a key that failed. */
  readonly retryDelaysMs?: readonly number[];
  readonly deleteTimeoutMs?: number;
  /** Test seams; production uses `setTimeout` and `performance.now`. */
  readonly schedule?: ScheduleRetry;
  readonly now?: () => number;
}

export interface FileCleanupOutcome {
  readonly key: string;
  readonly error?: string;
}

/** A pass asked for while one runs, and what its asker is waiting on. */
interface OwedPass {
  forced: boolean;
  readonly promise: Promise<readonly FileCleanupOutcome[]>;
  readonly resolve: (outcomes: Promise<readonly FileCleanupOutcome[]>) => void;
}

export class FileCleanupWorker {
  private readonly options: FileCleanupOptions;
  private readonly retryDelaysMs: readonly number[];
  private readonly schedule: ScheduleRetry;
  private readonly now: () => number;
  private current: Promise<readonly FileCleanupOutcome[]> | null = null;
  private owed: OwedPass | null = null;
  private waking = false;
  /** When each key that has failed in this process may be tried again. */
  private readonly due = new Map<string, number>();
  /** Passes in a row that threw before their outcomes were written, so none counted. */
  private failedPasses = 0;
  private timer: { readonly at: number } | null = null;

  constructor(options: FileCleanupOptions) {
    this.options = options;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS;
    this.schedule = options.schedule ?? scheduleUnrefTimer;
    this.now = options.now ?? (() => performance.now());
  }

  /**
   * After a commit that may have enqueued keys: a pass once the committing request has answered,
   * or straight after the one running.
   */
  wake(): void {
    if (this.waking) return;
    this.waking = true;
    setImmediate(() => {
      this.waking = false;
      void this.start(false);
    });
  }

  /**
   * A pass over every key that is due, the exhausted included; one still waiting out a delay keeps
   * its place. A desk load presses it, as it presses the deletion supervisor's, and boot awaits it.
   */
  drain(): Promise<readonly FileCleanupOutcome[]> {
    return this.start(true);
  }

  /** Settles once no pass is running, owed or about to start. */
  async idle(): Promise<void> {
    while (this.current || this.waking) {
      await (this.current ?? new Promise((resolve) => setImmediate(resolve)));
    }
  }

  /** Whether this worker cleans `databases` through `objectStore` under `mutationCoordinator`. */
  drives(wiring: Pick<FileCleanupOptions, "databases" | "objectStore" | "mutationCoordinator">) {
    const { databases, objectStore, mutationCoordinator } = this.options;
    return (
      databases.readwrite === wiring.databases.readwrite &&
      databases.readonly === wiring.databases.readonly &&
      objectStore === wiring.objectStore &&
      mutationCoordinator === wiring.mutationCoordinator
    );
  }

  private exhausted(file: EnqueuedFile): boolean {
    return file.attempts > this.retryDelaysMs.length;
  }

  /** When an enqueued key may next be tried: at once, unless it failed here and its delay runs. */
  private dueAt(file: EnqueuedFile, now: number): number {
    return file.attempts === 0 ? now : (this.due.get(file.key) ?? now);
  }

  private start(forced: boolean): Promise<readonly FileCleanupOutcome[]> {
    if (this.current) return this.owe(forced);
    const pass = this.pass(forced)
      .catch((error): readonly FileCleanupOutcome[] => {
        this.failedPasses += 1;
        console.error("omni-crud file cleanup pass failed:", errorDetail(error));
        return [];
      })
      .finally(() => this.settle());
    this.current = pass;
    return pass;
  }

  private owe(forced: boolean): Promise<readonly FileCleanupOutcome[]> {
    if (this.owed) {
      this.owed.forced ||= forced;
      return this.owed.promise;
    }
    let resolve: OwedPass["resolve"] = () => {};
    const promise = new Promise<readonly FileCleanupOutcome[]>((settle) => (resolve = settle));
    this.owed = { forced, promise, resolve };
    return promise;
  }

  private settle(): void {
    this.current = null;
    const owed = this.owed;
    this.owed = null;
    if (owed) {
      owed.resolve(this.start(owed.forced));
      return;
    }
    try {
      this.scheduleRetry();
    } catch (error) {
      console.error("omni-crud could not schedule a file cleanup retry:", errorDetail(error));
    }
  }

  private async pass(forced: boolean): Promise<readonly FileCleanupOutcome[]> {
    const started = this.now();
    const owed = readEnqueuedFiles(this.options.databases.readonly).filter((file) =>
      this.exhausted(file) ? forced : this.dueAt(file, started) <= started,
    );
    const outcomes: FileCleanupOutcome[] = [];
    for (const { key } of owed) {
      try {
        await this.deleteBytes(key);
        outcomes.push({ key });
      } catch (error) {
        outcomes.push({ key, error: errorMessage(error) });
      }
    }
    if (outcomes.length > 0) await this.record(outcomes);
    this.failedPasses = 0;
    for (const [at, file] of owed.entries()) this.remember(file, outcomes[at]?.error);
    return outcomes;
  }

  private async deleteBytes(key: string): Promise<void> {
    const limit = this.options.deleteTimeoutMs ?? DEFAULT_FILE_DELETE_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The delete took longer than ${limit} ms.`)),
        limit,
      );
      timer.unref?.();
    });
    try {
      await Promise.race([this.options.objectStore.delete(key), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private record(outcomes: readonly FileCleanupOutcome[]): Promise<void> {
    const { readwrite } = this.options.databases;
    return this.options.mutationCoordinator.withPlatformWrite(() =>
      readwrite.transaction(() => {
        for (const { key, error } of outcomes) {
          if (error === undefined) deleteCleanedFile(readwrite, key);
          else recordFileCleanupFailure(readwrite, key, error);
        }
      })(),
    );
  }

  /** A failed key's next due time, or, as its last retry fails, a word that it is waiting. */
  private remember(file: EnqueuedFile, error: string | undefined): void {
    this.due.delete(file.key);
    if (error === undefined) return;
    const delayMs = this.retryDelaysMs[file.attempts];
    if (delayMs !== undefined) this.due.set(file.key, this.now() + delayMs);
    else if (file.attempts === this.retryDelaysMs.length) {
      console.error(`omni-crud stopped retrying file ${file.key} until a desk load:`, error);
    }
  }

  /**
   * The next retry: when the soonest failed key is due, or, after a pass that could not write its
   * outcomes, on the same delays counted by passes.
   */
  private scheduleRetry(): void {
    const now = this.now();
    const at = this.failedPasses > 0 ? this.passRetryAt(now) : this.soonestDue(now);
    if (at === undefined || (this.timer && this.timer.at <= at)) return;
    const timer = { at };
    this.timer = timer;
    this.schedule(
      () => {
        if (this.timer === timer) this.timer = null;
        void this.start(false);
      },
      Math.max(at - now, 0),
    );
  }

  private passRetryAt(now: number): number | undefined {
    const delayMs = this.retryDelaysMs[this.failedPasses - 1];
    return delayMs === undefined ? undefined : now + delayMs;
  }

  private soonestDue(now: number): number | undefined {
    const enqueued = readEnqueuedFiles(this.options.databases.readonly);
    const keys = new Set(enqueued.map((file) => file.key));
    for (const key of this.due.keys()) if (!keys.has(key)) this.due.delete(key);
    let soonest: number | undefined;
    for (const file of enqueued) {
      if (this.exhausted(file)) continue;
      const at = this.dueAt(file, now);
      if (soonest === undefined || at < soonest) soonest = at;
    }
    return soonest;
  }
}

export function createFileCleanupWorker(options: FileCleanupOptions): FileCleanupWorker {
  return new FileCleanupWorker(options);
}
