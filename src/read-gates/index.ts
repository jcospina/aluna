/**
 * Per-incarnation read admission for dependency-safe capability deletion.
 *
 * Reads stay concurrent and outside the mutation coordinator. The only serialized
 * transition here is synchronous process-local bookkeeping: an operation either
 * owns its complete incarnation set or owns nothing, while deletion can atomically
 * move one exact incarnation from active to closing and drain its current readers.
 */

export const DEFAULT_READ_DRAIN_TIMEOUT_MS = 5_000;

export interface CapabilityIncarnation {
  readonly capabilityId: string;
  readonly incarnationId: string;
}

export interface AcquireReadTokensInput {
  /** One immutable active-registry view captured before generated work begins. */
  readonly catalog: readonly CapabilityIncarnation[];
  /** The complete set the operation can observe. */
  readonly incarnations: readonly CapabilityIncarnation[];
}

export interface ReadTokenSet {
  readonly incarnations: readonly CapabilityIncarnation[];
  /** Closing any owned incarnation asks this operation to stop cooperatively. */
  readonly signal: AbortSignal;
}

export interface ReadGateCloseLease {
  readonly incarnation: CapabilityIncarnation;
  readonly closedAt: number;
}

export interface ReadGateSnapshotEntry extends CapabilityIncarnation {
  readonly state: "active" | "closing";
  readonly readerCount: number;
}

export interface ReadGateCoordinatorOptions {
  readonly drainTimeoutMs?: number;
  readonly now?: () => number;
}

export interface CloseReadGateOptions {
  /** Test seam; production callers use the coordinator's one fixed deadline. */
  readonly timeoutMs?: number;
}

export class ReadGateError extends Error {
  override readonly name: string = "ReadGateError";
}

export class ReadGateCatalogError extends ReadGateError {
  override readonly name = "ReadGateCatalogError";
}

export class ReadGateUnavailableError extends ReadGateError {
  override readonly name = "ReadGateUnavailableError";
}

export class ReadGateClosingError extends ReadGateError {
  override readonly name = "ReadGateClosingError";
}

export class ReadGateReleasedError extends ReadGateError {
  override readonly name = "ReadGateReleasedError";
}

export class ReadGateDrainTimeoutError extends ReadGateError {
  override readonly name = "ReadGateDrainTimeoutError";
}

interface InternalTokenSet {
  readonly controller: AbortController;
  readonly keys: readonly string[];
  readonly tokenSet: ReadTokenSet;
}

interface InternalReadGate {
  readonly incarnation: CapabilityIncarnation;
  readonly readers: Set<ReadTokenSet>;
  readonly zeroReaderWaiters: Set<() => void>;
  closeLease?: ReadGateCloseLease;
  state: "active" | "closing";
}

function invalidateReleasedOwnership(owned: InternalTokenSet): void {
  if (owned.controller.signal.aborted) return;
  owned.controller.abort(
    new ReadGateReleasedError("Capability read ownership has already been released."),
  );
}

function copyIncarnation(incarnation: CapabilityIncarnation): CapabilityIncarnation {
  return Object.freeze({
    capabilityId: incarnation.capabilityId,
    incarnationId: incarnation.incarnationId,
  });
}

function incarnationKey(incarnation: CapabilityIncarnation): string {
  return `${incarnation.capabilityId}\u0000${incarnation.incarnationId}`;
}

function compareIncarnations(left: CapabilityIncarnation, right: CapabilityIncarnation): number {
  return (
    left.capabilityId.localeCompare(right.capabilityId) ||
    left.incarnationId.localeCompare(right.incarnationId)
  );
}

function validateIncarnation(incarnation: CapabilityIncarnation): void {
  if (
    incarnation.capabilityId.length === 0 ||
    incarnation.capabilityId.trim() !== incarnation.capabilityId ||
    incarnation.incarnationId.length === 0 ||
    incarnation.incarnationId.trim() !== incarnation.incarnationId
  ) {
    throw new ReadGateCatalogError(
      "Capability incarnation identities must be nonblank and trimmed.",
    );
  }
}

function canonicalCatalog(
  catalog: readonly CapabilityIncarnation[],
): ReadonlyMap<string, CapabilityIncarnation> {
  const byKey = new Map<string, CapabilityIncarnation>();
  const byCapability = new Map<string, string>();
  for (const entry of catalog) {
    validateIncarnation(entry);
    const key = incarnationKey(entry);
    if (byKey.has(key) || byCapability.has(entry.capabilityId)) {
      throw new ReadGateCatalogError(
        `Active read catalog contains duplicate capability "${entry.capabilityId}".`,
      );
    }
    const copy = copyIncarnation(entry);
    byKey.set(key, copy);
    byCapability.set(entry.capabilityId, entry.incarnationId);
  }
  return byKey;
}

function canonicalRequested(
  incarnations: readonly CapabilityIncarnation[],
): readonly CapabilityIncarnation[] {
  const unique = new Map<string, CapabilityIncarnation>();
  for (const incarnation of incarnations) {
    validateIncarnation(incarnation);
    const key = incarnationKey(incarnation);
    if (!unique.has(key)) unique.set(key, copyIncarnation(incarnation));
  }
  return Object.freeze([...unique.values()].sort(compareIncarnations));
}

/** One process-local read coordinator. Every state transition before an await is atomic. */
export class ReadGateCoordinator {
  private readonly activeTokenSets = new Map<ReadTokenSet, InternalTokenSet>();
  private readonly closeLeases = new Map<ReadGateCloseLease, string>();
  private readonly drainTimeoutMs: number;
  private readonly gates = new Map<string, InternalReadGate>();
  private readonly now: () => number;
  /**
   * Incarnations retired by {@link finalizeClose} — deletion's point of no return.
   * Their tables are gone, so no catalog may ever bring their gate back: without this,
   * a caller holding a catalog captured before the commit would re-create the gate as
   * active and receive a live read token for a dropped table. The set only grows by one
   * entry per completed deletion, and recreation uses a new incarnation, so a rebuilt
   * capability is never shadowed by its predecessor's retirement.
   */
  private readonly retired = new Set<string>();

  constructor(options: ReadGateCoordinatorOptions = {}) {
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_READ_DRAIN_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Register newly active incarnations without disturbing an in-flight close.
   *
   * Additive on purpose: callers legitimately pass a *subset* (deletion passes the one
   * incarnation it is about to close), so this must never treat absence as a reason to
   * drop a gate. Gates for superseded incarnations are therefore retained until the
   * process restarts; only a completed deletion removes one.
   */
  synchronizeCatalog(catalog: readonly CapabilityIncarnation[]): void {
    for (const [key, incarnation] of canonicalCatalog(catalog)) {
      if (this.gates.has(key) || this.retired.has(key)) continue;
      this.gates.set(key, {
        incarnation,
        readers: new Set(),
        state: "active",
        zeroReaderWaiters: new Set(),
      });
    }
  }

  /**
   * Acquire the complete set synchronously. Every member is validated before any
   * reader count changes, so missing/stale/closing means all-or-nothing refusal.
   */
  tryAcquire(input: AcquireReadTokensInput): ReadTokenSet | undefined {
    const catalog = canonicalCatalog(input.catalog);
    this.synchronizeCatalog(input.catalog);
    const incarnations = canonicalRequested(input.incarnations);
    const gates: InternalReadGate[] = [];

    for (const incarnation of incarnations) {
      const key = incarnationKey(incarnation);
      const gate = this.gates.get(key);
      if (!catalog.has(key) || !gate || gate.state !== "active") return undefined;
      gates.push(gate);
    }

    const controller = new AbortController();
    const tokenSet = Object.freeze({
      incarnations,
      signal: controller.signal,
    });
    const keys = gates.map(({ incarnation }) => incarnationKey(incarnation));
    this.activeTokenSets.set(tokenSet, { controller, keys, tokenSet });
    for (const gate of gates) gate.readers.add(tokenSet);
    return tokenSet;
  }

  /** Acquire, run, and ownership-release an operation through one finally path. */
  async withTokens<T>(
    input: AcquireReadTokensInput,
    body: (tokens: ReadTokenSet) => T | Promise<T>,
  ): Promise<T> {
    const tokens = this.tryAcquire(input);
    if (!tokens) {
      throw new ReadGateUnavailableError(
        "The complete capability incarnation read set is not currently available.",
      );
    }
    try {
      return await body(tokens);
    } finally {
      this.release(tokens);
    }
  }

  /** Release succeeds only for the exact still-owned token-set object. */
  release(tokens: ReadTokenSet): boolean {
    const owned = this.activeTokenSets.get(tokens);
    if (!owned || owned.tokenSet !== tokens) return false;
    this.activeTokenSets.delete(tokens);
    invalidateReleasedOwnership(owned);
    for (const key of owned.keys) {
      const gate = this.gates.get(key);
      if (!gate) continue;
      gate.readers.delete(tokens);
      if (gate.readers.size === 0) {
        for (const notify of [...gate.zeroReaderWaiters]) notify();
      }
    }
    return true;
  }

  /**
   * Close one exact incarnation and wait for zero readers. A timeout or failure
   * automatically reopens in this method's finally; a successful drain hands the
   * caller an ownership-checked closing lease for the later destructive phase.
   */
  async closeAndDrain(
    incarnation: CapabilityIncarnation,
    options: CloseReadGateOptions = {},
  ): Promise<ReadGateCloseLease> {
    const key = incarnationKey(incarnation);
    const gate = this.gates.get(key);
    if (gate?.state !== "active") {
      throw new ReadGateUnavailableError(
        `Capability incarnation ${incarnation.capabilityId}/${incarnation.incarnationId} cannot close.`,
      );
    }

    // Ownership is the lease *object* itself: `closeLeases` is keyed by identity and
    // `gate.closeLease !== lease` rejects any other holder, so no separate id is needed.
    const lease = Object.freeze({
      incarnation: copyIncarnation(incarnation),
      closedAt: this.now(),
    });
    gate.state = "closing";
    gate.closeLease = lease;
    this.closeLeases.set(lease, key);
    for (const tokens of gate.readers) {
      this.activeTokenSets
        .get(tokens)
        ?.controller.abort(
          new ReadGateClosingError(
            `Capability incarnation ${incarnation.capabilityId}/${incarnation.incarnationId} is closing.`,
          ),
        );
    }

    let handedOff = false;
    try {
      await this.waitForZeroReaders(gate, options.timeoutMs ?? this.drainTimeoutMs);
      handedOff = true;
      return lease;
    } finally {
      if (!handedOff) this.reopen(lease);
    }
  }

  /** Reopen only the gate owned by this exact successful closing lease. */
  reopen(lease: ReadGateCloseLease): boolean {
    const key = this.closeLeases.get(lease);
    const gate = key ? this.gates.get(key) : undefined;
    if (!key || !gate || gate.closeLease !== lease || gate.state !== "closing") return false;
    this.closeLeases.delete(lease);
    gate.closeLease = undefined;
    gate.state = "active";
    return true;
  }

  /** Retire a drained gate permanently — called only after the database point of no return. */
  finalizeClose(lease: ReadGateCloseLease): boolean {
    const key = this.closeLeases.get(lease);
    const gate = key ? this.gates.get(key) : undefined;
    if (
      !key ||
      !gate ||
      gate.closeLease !== lease ||
      gate.state !== "closing" ||
      gate.readers.size !== 0
    ) {
      return false;
    }
    this.closeLeases.delete(lease);
    this.gates.delete(key);
    this.retired.add(key);
    return true;
  }

  /**
   * Boot-only recovery. Process-local readers died with the crashed process, so
   * rebuild exactly the active registry catalog as reopened zero-reader gates.
   */
  recoverAtBoot(catalog: readonly CapabilityIncarnation[]): void {
    const active = canonicalCatalog(catalog);
    for (const owned of this.activeTokenSets.values()) {
      owned.controller.abort(
        new ReadGateClosingError("Read ownership ended during boot recovery."),
      );
    }
    this.activeTokenSets.clear();
    this.closeLeases.clear();
    this.gates.clear();
    // The registry is authoritative across a restart: anything still active survived
    // deletion, and anything deleted is absent from this catalog anyway.
    this.retired.clear();
    for (const [key, incarnation] of active) {
      this.gates.set(key, {
        incarnation,
        readers: new Set(),
        state: "active",
        zeroReaderWaiters: new Set(),
      });
    }
  }

  snapshot(): readonly ReadGateSnapshotEntry[] {
    return [...this.gates.values()]
      .map(({ incarnation, readers, state }) => ({
        ...incarnation,
        state,
        readerCount: readers.size,
      }))
      .sort(compareIncarnations);
  }

  private waitForZeroReaders(gate: InternalReadGate, timeoutMs: number): Promise<void> {
    if (gate.readers.size === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        gate.zeroReaderWaiters.delete(onReadersChanged);
        if (error) reject(error);
        else resolve();
      };
      const onReadersChanged = () => {
        if (gate.readers.size === 0) finish();
      };
      const timer = setTimeout(
        () =>
          finish(
            new ReadGateDrainTimeoutError(
              `Read gate did not drain ${gate.readers.size} reader(s) before its deadline.`,
            ),
          ),
        Math.max(0, timeoutMs),
      );
      gate.zeroReaderWaiters.add(onReadersChanged);
      onReadersChanged();
    });
  }
}

export function createReadGateCoordinator(
  options: ReadGateCoordinatorOptions = {},
): ReadGateCoordinator {
  return new ReadGateCoordinator(options);
}
