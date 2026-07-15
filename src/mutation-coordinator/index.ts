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
  } | null;
}

export interface MutationCoordinatorOptions {
  readonly buildReservationTtlMs?: number;
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

export class MutationOwnershipError extends MutationAdmissionError {
  override readonly name = "MutationOwnershipError";
}

interface QueueEntry {
  readonly ticketId: string;
  readonly kind: "build" | "platform";
  readonly reservation?: BuildReservation;
  readonly expiresAt: number | null;
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

const DEFAULT_BUILD_RESERVATION_TTL_MS = 30_000;

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
  private readonly buildReservationTtlMs: number;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly queue: QueueEntry[] = [];
  private readonly reservations = new Map<BuildReservation, QueueEntry>();

  constructor(options: MutationCoordinatorOptions = {}) {
    this.buildReservationTtlMs = options.buildReservationTtlMs ?? DEFAULT_BUILD_RESERVATION_TTL_MS;
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

  /** Deletion is an atomic non-queued try-acquire for the future deletion seam. */
  tryAcquireDeletion(): MutationLease | undefined {
    return this.tryAcquireShort("deletion");
  }

  /** Release succeeds only for the exact active lease object. */
  release(lease: MutationLease): boolean {
    if (this.activeLease !== lease) return false;
    this.activeLease = undefined;
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
    const lease = this.makeLease(kind);
    this.activeLease = lease;
    return lease;
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
    const lease = this.makeLease(next.kind);
    this.activeLease = lease;
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

  private makeLease(kind: MutationLeaseKind): MutationLease {
    return Object.freeze({
      leaseId: `${kind}-lease-${this.createId()}`,
      kind,
      acquiredAt: this.now(),
    });
  }
}

export function createMutationCoordinator(
  options: MutationCoordinatorOptions = {},
): MutationCoordinator {
  return new MutationCoordinator(options);
}
