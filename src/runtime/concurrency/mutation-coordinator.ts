/**
 * Atomic admission for every write that can use the shared read-write connection.
 *
 * Resolved builds reserve FIFO tickets and later exchange the head ticket for the
 * one active lease. Record writes are short, non-queued try-acquires. Platform
 * writes queue behind existing work, while capability deletion is a non-queued
 * try-acquire. Reads never enter this module.
 */

export type MutationLeaseKind = "build" | "record" | "platform" | "deletion";

export interface BuildReservation {
  readonly ticketId: string;
  readonly expiresAt: number;
}

export interface MutationLease {
  readonly leaseId: string;
  readonly kind: MutationLeaseKind;
  readonly acquiredAt: number;
  readonly expiresAt: number | null;
  /** Build ownership aborts if it outlives its bounded lease. */
  readonly signal: AbortSignal;
}

export interface MutationCoordinatorSnapshot {
  readonly queuedTickets: readonly {
    readonly ticketId: string;
    readonly kind: "build" | "platform";
    readonly expiresAt: number | null;
  }[];
  readonly activeLease: {
    readonly leaseId: string;
    readonly kind: MutationLeaseKind;
    readonly acquiredAt: number;
    readonly expiresAt: number | null;
  } | null;
}

export interface MutationCoordinatorOptions {
  readonly buildReservationTtlMs?: number;
  readonly buildLeaseTtlMs?: number;
  readonly createId?: () => string;
  readonly now?: () => number;
}

export interface AcquireMutationOptions {
  readonly signal?: AbortSignal;
}

export class MutationAdmissionError extends Error {
  override readonly name: string = "MutationAdmissionError";
}

export class MutationReservationExpiredError extends MutationAdmissionError {
  override readonly name = "MutationReservationExpiredError";
}

export class MutationReservationCancelledError extends MutationAdmissionError {
  override readonly name = "MutationReservationCancelledError";
}

export class MutationLeaseExpiredError extends MutationAdmissionError {
  override readonly name = "MutationLeaseExpiredError";
}

export class MutationOwnershipError extends MutationAdmissionError {
  override readonly name = "MutationOwnershipError";
}

interface QueueEntry {
  readonly ticketId: string;
  readonly kind: "build" | "platform";
  readonly reservation?: BuildReservation;
  /** Cleared the moment an owner starts waiting; see {@link MutationCoordinator.acquireBuild}. */
  expiresAt: number | null;
  readonly deferred: DeferredLease;
  acquireWaiting: boolean;
  expiryTimer?: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
}

interface DeferredLease {
  readonly promise: Promise<MutationLease>;
  readonly resolve: (lease: MutationLease) => void;
  readonly reject: (error: Error) => void;
}

/**
 * How long a reservation may sit with *no owner waiting on it*.
 *
 * It bounds abandonment, not queueing. A ticket is reserved and then acquired a moment
 * later on the same call path, so the only thing this window covers is a caller that
 * reserved and then went away — and a build reservation blocks the head of the queue until
 * its owner asks for the lease, so an abandoned one has to time out or nothing behind it
 * ever runs.
 *
 * It deliberately does **not** bound how long a queued build waits for the lease. It used
 * to: the clock started at `reserveBuild()` and kept running, so a second build queued
 * behind a real one — which takes minutes — always died at 30 seconds with
 * `MutationReservationExpiredError`, rendered to the person as "Hmm, that didn't work.
 * Mind trying again?" after they had waited and paid for a resolver call. The documented
 * bounded FIFO queue could not hold anyone at depth ≥ 2. What bounds a genuinely stuck
 * queue is the holder's own whole-build lease expiry below.
 */
const DEFAULT_BUILD_RESERVATION_TTL_MS = 30_000;
// A build may legally spend the five-minute provider budget across spec generation,
// behavioral freezing, twelve sequential unit attempts, and bounded Gate repairs. The
// whole-owner failsafe therefore sits well above that roughly two-hour maximum path; it is
// independent of the short per-call deadline, not a competing normal build budget.
export const DEFAULT_BUILD_LEASE_TTL_MS = 4 * 60 * 60_000;

function deferredLease(): DeferredLease {
  let resolve!: (lease: MutationLease) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MutationLease>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function defaultId(): string {
  return crypto.randomUUID();
}

/** One process-local coordinator instance. Its state transitions are synchronous. */
export class MutationCoordinator {
  private activeLease: MutationLease | undefined;
  private activeLeaseController: AbortController | undefined;
  private activeLeaseExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly buildReservationTtlMs: number;
  private readonly buildLeaseTtlMs: number;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly queue: QueueEntry[] = [];
  private readonly reservations = new Map<BuildReservation, QueueEntry>();

  constructor(options: MutationCoordinatorOptions = {}) {
    this.buildReservationTtlMs = options.buildReservationTtlMs ?? DEFAULT_BUILD_RESERVATION_TTL_MS;
    this.buildLeaseTtlMs = options.buildLeaseTtlMs ?? DEFAULT_BUILD_LEASE_TTL_MS;
    this.createId = options.createId ?? defaultId;
    this.now = options.now ?? Date.now;
  }

  /** Reserve FIFO build admission. The reservation owns no active lease yet. */
  reserveBuild(): BuildReservation {
    const ticketId = `build-ticket-${this.createId()}`;
    const expiresAt = this.now() + this.buildReservationTtlMs;
    const reservation = Object.freeze({ ticketId, expiresAt });
    const deferred = deferredLease();
    const entry: QueueEntry = {
      ticketId,
      kind: "build",
      reservation,
      expiresAt,
      deferred,
      acquireWaiting: false,
    };

    // Keep rejection observed until acquireBuild hands the same promise to its caller.
    void deferred.promise.catch(() => undefined);
    this.queue.push(entry);
    this.reservations.set(reservation, entry);
    entry.expiryTimer = setTimeout(
      () => this.expireReservation(reservation),
      this.buildReservationTtlMs,
    );
    this.pump();
    return reservation;
  }

  /** Exchange an owned head reservation for the active build lease. */
  acquireBuild(
    reservation: BuildReservation,
    options: AcquireMutationOptions = {},
  ): Promise<MutationLease> {
    const entry = this.reservations.get(reservation);
    if (!entry) {
      return Promise.reject(
        new MutationOwnershipError(
          `Build reservation ${reservation.ticketId} is not owned or queued.`,
        ),
      );
    }
    if (entry.acquireWaiting) {
      return Promise.reject(
        new MutationOwnershipError(
          `Build reservation ${reservation.ticketId} already has an acquisition owner.`,
        ),
      );
    }
    // From here the ticket has an owner waiting on it, so the abandonment clock stops —
    // both the timer and the deadline `pruneExpiredReservations` reads. Waiting in the
    // queue is what a queue is for.
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.expiryTimer = undefined;
    entry.expiresAt = null;
    this.attachAbort(entry, options.signal, () => this.cancelBuild(reservation));
    this.pump();
    return entry.deferred.promise;
  }

  /** Cancel only a queued reservation. An active lease must be released separately. */
  cancelBuild(reservation: BuildReservation): boolean {
    const entry = this.reservations.get(reservation);
    if (!entry) return false;
    this.removeQueuedEntry(
      entry,
      new MutationReservationCancelledError(
        `Build reservation ${reservation.ticketId} was cancelled before admission.`,
      ),
    );
    return true;
  }

  /** Acquire, run, and ownership-release a resolved build in one finally-safe helper. */
  async withBuildLease<T>(
    reservation: BuildReservation,
    body: (lease: MutationLease) => T | Promise<T>,
    options: AcquireMutationOptions = {},
  ): Promise<T> {
    let lease: MutationLease | undefined;
    try {
      lease = await this.acquireBuild(reservation, options);
      return await body(lease);
    } finally {
      if (lease) this.release(lease);
    }
  }

  /** Record mutations never queue and cannot pass any existing reservation. */
  tryAcquireRecordWrite(): MutationLease | undefined {
    return this.tryAcquireShort("record");
  }

  /** Platform writes queue behind build reservations and release through finally. */
  async withPlatformWrite<T>(
    body: (lease: MutationLease) => T | Promise<T>,
    options: AcquireMutationOptions = {},
  ): Promise<T> {
    const lease = await this.acquirePlatformWrite(options);
    try {
      return await body(lease);
    } finally {
      this.release(lease);
    }
  }

  /**
   * Deletion is an atomic non-queued try-acquire.
   *
   * Ordering invariant: deletion takes this lease *then* closes the read gate, while a
   * record route takes read tokens *then* asks for a lease. That inversion is only safe
   * because every acquisition made while holding read tokens is non-blocking
   * ({@link tryAcquireRecordWrite}). Never `await` a queued acquisition — `withBuildLease`,
   * `withPlatformWrite` — inside a read-token scope, or the two will deadlock until
   * deletion's drain deadline expires.
   */
  tryAcquireDeletion(): MutationLease | undefined {
    return this.tryAcquireShort("deletion");
  }

  /** Release succeeds only for the exact active lease object. */
  release(lease: MutationLease): boolean {
    if (this.activeLease !== lease) return false;
    if (this.activeLeaseExpiryTimer) clearTimeout(this.activeLeaseExpiryTimer);
    this.activeLease = undefined;
    this.activeLeaseController = undefined;
    this.activeLeaseExpiryTimer = undefined;
    this.pump();
    return true;
  }

  snapshot(): MutationCoordinatorSnapshot {
    return {
      queuedTickets: this.queue.map(({ ticketId, kind, expiresAt }) => ({
        ticketId,
        kind,
        expiresAt,
      })),
      activeLease: this.activeLease
        ? {
            leaseId: this.activeLease.leaseId,
            kind: this.activeLease.kind,
            acquiredAt: this.activeLease.acquiredAt,
            expiresAt: this.activeLease.expiresAt,
          }
        : null,
    };
  }

  private acquirePlatformWrite(options: AcquireMutationOptions): Promise<MutationLease> {
    const deferred = deferredLease();
    const entry: QueueEntry = {
      ticketId: `platform-ticket-${this.createId()}`,
      kind: "platform",
      expiresAt: null,
      deferred,
      acquireWaiting: true,
    };
    this.queue.push(entry);
    this.attachAbort(entry, options.signal, () =>
      this.removeQueuedEntry(
        entry,
        new MutationReservationCancelledError(
          `Platform write ${entry.ticketId} was cancelled before admission.`,
        ),
      ),
    );
    this.pump();
    return deferred.promise;
  }

  private tryAcquireShort(kind: "record" | "deletion"): MutationLease | undefined {
    this.pruneExpiredReservations();
    if (this.activeLease || this.queue.length > 0) return undefined;
    return this.activateLease(kind);
  }

  private pump(): void {
    this.pruneExpiredReservations();
    if (this.activeLease) return;
    const next = this.queue[0];
    if (!next) return;

    // A build reservation intentionally blocks the head until its owner asks for
    // acquisition. Platform entries always attach their waiter before pump runs.
    if (next.kind === "build" && !next.acquireWaiting) return;

    this.queue.shift();
    this.finishQueuedEntry(next);
    if (next.reservation) this.reservations.delete(next.reservation);
    const lease = this.activateLease(next.kind);
    next.deferred.resolve(lease);
  }

  private attachAbort(
    entry: QueueEntry,
    signal: AbortSignal | undefined,
    cancel: () => void,
  ): void {
    entry.acquireWaiting = true;
    if (!signal) return;
    if (signal.aborted) {
      cancel();
      return;
    }
    const onAbort = () => cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    entry.removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  }

  private expireReservation(reservation: BuildReservation): void {
    const entry = this.reservations.get(reservation);
    if (!entry) return;
    this.removeQueuedEntry(
      entry,
      new MutationReservationExpiredError(
        `Build reservation ${reservation.ticketId} expired before admission.`,
      ),
    );
  }

  private pruneExpiredReservations(): void {
    const now = this.now();
    for (const entry of [...this.queue]) {
      if (entry.expiresAt !== null && entry.expiresAt <= now && entry.reservation) {
        this.expireReservation(entry.reservation);
      }
    }
  }

  private removeQueuedEntry(entry: QueueEntry, error: Error): void {
    const index = this.queue.indexOf(entry);
    if (index < 0) return;
    this.queue.splice(index, 1);
    if (entry.reservation) this.reservations.delete(entry.reservation);
    this.finishQueuedEntry(entry);
    entry.deferred.reject(error);
    this.pump();
  }

  private finishQueuedEntry(entry: QueueEntry): void {
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.removeAbortListener?.();
  }

  private activateLease(kind: MutationLeaseKind): MutationLease {
    const acquiredAt = this.now();
    const controller = new AbortController();
    const expiresAt = kind === "build" ? acquiredAt + this.buildLeaseTtlMs : null;
    const lease = Object.freeze({
      leaseId: `${kind}-lease-${this.createId()}`,
      kind,
      acquiredAt,
      expiresAt,
      signal: controller.signal,
    });
    this.activeLease = lease;
    this.activeLeaseController = controller;
    if (expiresAt !== null) {
      this.activeLeaseExpiryTimer = setTimeout(
        () => this.expireActiveLease(lease),
        this.buildLeaseTtlMs,
      );
    }
    return lease;
  }

  private expireActiveLease(lease: MutationLease): void {
    if (this.activeLease !== lease) return;
    const controller = this.activeLeaseController;
    this.activeLeaseExpiryTimer = undefined;
    controller?.abort(
      new MutationLeaseExpiredError(
        `${lease.kind} mutation lease ${lease.leaseId} expired before its owner released it.`,
      ),
    );
  }
}

export function createMutationCoordinator(
  options: MutationCoordinatorOptions = {},
): MutationCoordinator {
  return new MutationCoordinator(options);
}
