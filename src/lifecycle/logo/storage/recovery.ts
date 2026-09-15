// What a desk load resolves before it draws: claims nobody is running any more, and artwork
// that has gone from under a `present` row.
//
// The retry sweep needs no code of its own — a fresh desk render arms one load-triggered POST on
// every `absent` tile (ADR-0007). Only `absent` arms, so a row stranded in `generating` by a crash
// would never be offered another attempt: recovery runs before serving, not inside a POST only an
// already-recovered row can send.
//
// A dead claim's staging temp and truncated final file go before the state moves, so a row never
// returns to `absent` over bytes the next attempt would fail on EEXIST.
// `artifact-reconciliation.ts` tolerates the temp's name instead, since it runs where an attempt
// may be mid-write; here `claims.ts` proves nothing runs, under the incarnation's read token.

import { errorDetail } from "../../../platform/errors.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  abandonMissingCapabilityLogo,
  type CapabilityLogoState,
  type CapabilityRow,
  getCapabilityLogoState,
  isRegistryInitialized,
  LOGO_MAX_CLAIMED_ATTEMPTS,
  listCapabilities,
  releaseLogoClaim,
  settleLogoGeneration,
} from "../../../registry/index.ts";
import type { MutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import {
  type CapabilityIncarnation,
  capabilityIncarnation,
  type ReadGateCoordinator,
} from "../../../runtime/concurrency/read-gates.ts";
import type { RunningLogoClaims } from "../generation/claims.ts";
import {
  capabilityIncarnationTreeExists,
  discardTruncatedCapabilityLogo,
  inspectCapabilityLogoFile,
  removeLogoAttemptTemps,
  type StoredCapabilityLogo,
} from "./storage.ts";

export interface CapabilityLogoRecoveryDeps {
  readonly databases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
  readonly artifactsRoot: string;
  readonly claims: RunningLogoClaims;
  /** Test seam for {@link LOGO_RECOVERY_ADMISSION_MS}. */
  readonly admissionMs?: number;
}

/**
 * How long one whole pass waits for mutation ownership: a build holds its lease for as long as a
 * build takes, and a desk of forty capabilities must not wait forty times to render.
 */
export const LOGO_RECOVERY_ADMISSION_MS = 250;

/** What one row's reconciliation did. Every value leaves a usable capability behind. */
export type CapabilityLogoRecoveryAction =
  /** An interrupted claim whose drawing had in fact landed. Now `present`. */
  | "accepted"
  /** An interrupted claim with no drawing and attempts to spare. Back to `absent`. */
  | "released"
  /** An interrupted claim whose spend was the last one allowed. Now `abandoned`. */
  | "abandoned"
  /** A `present` row whose accepted file has gone. Now `abandoned`, never redrawn. */
  | "lost";

export interface CapabilityLogoRecoveryEntry {
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly action: CapabilityLogoRecoveryAction;
  /** Staging bytes the crashed claim left, removed before the state moved. */
  readonly removedTemps: number;
}

/**
 * Reconcile every active capability's logo lifecycle with what is on disk, answering with the rows
 * that moved. Never throws: a desk that cannot render is worse than a tile still a placeholder.
 */
export async function recoverCapabilityLogos(
  deps: CapabilityLogoRecoveryDeps,
): Promise<readonly CapabilityLogoRecoveryEntry[]> {
  if (!isRegistryInitialized(deps.databases.readonly)) return [];

  // One read of the rows, and the catalog derived from it: two reads are two moments, and a
  // capability activated between them would have its read token refused for no reason of its own.
  const rows = listCapabilities(deps.databases.readonly);
  const catalog = rows.map(capabilityIncarnation);
  const admission = AbortSignal.timeout(deps.admissionMs ?? LOGO_RECOVERY_ADMISSION_MS);
  const recovered: CapabilityLogoRecoveryEntry[] = [];
  let deferred = 0;
  for (const row of rows) {
    // The budget is spent, so every remaining write would be refused on arrival. Counted, not
    // attempted: a pass must not clear staging bytes for a row it can no longer move.
    if (admission.aborted) {
      deferred += 1;
      continue;
    }
    const outcome = await recoverOneRowQuietly(row, catalog, admission, deps);
    if (outcome === "deferred") deferred += 1;
    else if (outcome) recovered.push(outcome);
  }
  if (deferred > 0) {
    // Said out loud, because a pass that quietly did nothing looks exactly like a pass
    // that found nothing to do.
    console.log(
      `omni-crud deferred logo recovery for ${deferred} capability(ies): the platform was busy`,
    );
  }
  return recovered;
}

/**
 * One row, with every failure absorbed: nothing from here reaches the caller as a throw.
 */
async function recoverOneRowQuietly(
  row: CapabilityRow,
  catalog: readonly CapabilityIncarnation[],
  admission: AbortSignal,
  deps: CapabilityLogoRecoveryDeps,
): Promise<CapabilityLogoRecoveryEntry | "deferred" | null> {
  try {
    return await recoverOneCapabilityLogo(row, catalog, admission, deps);
  } catch (error) {
    // A write that never got its lease is the designed outcome of a busy platform, not a
    // fault: the row is untouched and the next load will find it exactly as it is.
    if (admission.aborted) return "deferred";
    console.error(
      `omni-crud could not recover the logo lifecycle for ${row.id}/${row.incarnation_id}:`,
      errorDetail(error),
    );
    return null;
  }
}

async function recoverOneCapabilityLogo(
  row: CapabilityRow,
  catalog: readonly CapabilityIncarnation[],
  admission: AbortSignal,
  deps: CapabilityLogoRecoveryDeps,
): Promise<CapabilityLogoRecoveryEntry | null> {
  if (row.logo.status !== "generating" && row.logo.status !== "present") return null;
  const target = capabilityIncarnation(row);
  // A running attempt owns this row and will settle it itself. Its temp is mid-write and
  // its final file may be seconds away, so every judgement below would be wrong.
  if (deps.claims.isAttempting(target)) return null;

  const looked = inspectIncarnationTree(row, target, catalog, deps, admission);
  // Either the gate is closing — deletion is taking this incarnation's tree, and the row
  // goes with it — or the tree could not be read. Neither is something to reconcile from.
  if (!looked) return null;

  const action = resolveRecoveryAction(row, looked.stored);
  if (!action) return null;

  // Outside the read token by construction: awaiting a queued acquisition inside a read-token
  // scope deadlocks against a deletion that takes its lease and then closes the gate.
  const moved = await deps.mutationCoordinator.withPlatformWrite(
    () => (stillTrue(row, deps) ? applyRecoveryAction(row, action, deps) : null),
    { signal: admission },
  );
  // The row moved out from under this pass — deleted, reconciled elsewhere, or claimed while this
  // one waited for the lease. Reporting the transition that did not happen would be a lie.
  if (!moved) return null;

  return {
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    action,
    removedTemps: looked.removedTemps,
  };
}

/**
 * Whether a `present` row's missing file is a loss. Not when the whole artifact tree is gone: that
 * is a misconfigured root, and abandoning on it takes every face away at once, irreversibly.
 */
function provenLoss(
  row: CapabilityRow,
  stored: StoredCapabilityLogo,
  deps: CapabilityLogoRecoveryDeps,
): boolean {
  if (stored !== "missing") return true;
  return capabilityIncarnationTreeExists(deps.artifactsRoot, row.id, row.incarnation_id);
}

/**
 * Read inside the lease body, on the write connection: a claim that arrived while this write waited
 * satisfies the same `generating` predicate, and releasing its row means two drawings in flight.
 */
function stillTrue(row: CapabilityRow, deps: CapabilityLogoRecoveryDeps): boolean {
  if (deps.claims.isAttempting(capabilityIncarnation(row))) return false;
  const now = getCapabilityLogoState(row.id, row.incarnation_id, deps.databases.readwrite);
  return now?.status === row.logo.status && now.attempts === row.logo.attempts;
}

/** The one transition this row earned, applied. */
function applyRecoveryAction(
  row: CapabilityRow,
  action: CapabilityLogoRecoveryAction,
  deps: CapabilityLogoRecoveryDeps,
): CapabilityLogoState | null {
  if (action === "released") {
    return releaseLogoClaim(row.id, row.incarnation_id, deps.databases.readwrite);
  }
  if (action === "lost") {
    return abandonMissingCapabilityLogo(row.id, row.incarnation_id, deps.databases.readwrite);
  }
  return settleLogoGeneration(
    row.id,
    row.incarnation_id,
    action === "accepted" ? "present" : "abandoned",
    deps.databases.readwrite,
  );
}

/**
 * A row with no attempt running: nothing is released here, but a proven loss holding an empty file
 * is going terminal, and the route 404s on that file while reconciliation accepts it as a sibling.
 */
function settleIdleTree(
  row: CapabilityRow,
  stored: StoredCapabilityLogo,
  deps: CapabilityLogoRecoveryDeps,
): { stored: StoredCapabilityLogo; removedTemps: number } {
  if (!provenLoss(row, stored, deps)) return { stored: "unknown", removedTemps: 0 };
  if (stored === "truncated") {
    discardTruncatedCapabilityLogo(deps.artifactsRoot, row.id, row.incarnation_id);
  }
  return { stored, removedTemps: 0 };
}

/**
 * The one look at the incarnation's tree, under its read token. Both removals happen before the
 * state moves, and null means the gate is closing or the budget ran out before anything was read.
 */
function inspectIncarnationTree(
  row: CapabilityRow,
  target: CapabilityIncarnation,
  catalog: readonly CapabilityIncarnation[],
  deps: CapabilityLogoRecoveryDeps,
  admission: AbortSignal,
): { stored: StoredCapabilityLogo; removedTemps: number } | null {
  if (admission.aborted) return null;
  const tokens = deps.readGates.tryAcquire({ catalog, incarnations: [target] });
  if (!tokens) return null;
  try {
    const stored = inspectCapabilityLogoFile(deps.artifactsRoot, row.id, row.incarnation_id);
    if (row.logo.status !== "generating") return settleIdleTree(row, stored, deps);
    if (stored === "unknown") return { stored, removedTemps: 0 };

    if (stored === "truncated") {
      // A failed removal leaves the path occupied, so releasing the row would spend its remaining
      // paid attempts on an installer EEXIST. `unknown` reconciles nothing; the next load asks.
      if (!discardTruncatedCapabilityLogo(deps.artifactsRoot, row.id, row.incarnation_id)) {
        return { stored: "unknown", removedTemps: 0 };
      }
    }
    const removed = removeLogoAttemptTemps(deps.artifactsRoot, row.id, row.incarnation_id);
    return { stored, removedTemps: removed.length };
  } finally {
    deps.readGates.release(tokens);
  }
}

/**
 * Which transition the tree and the durable count earn. `null` means the row is honest, or that
 * the tree could not answer — nothing is reconciled from a question that was never answered.
 */
function resolveRecoveryAction(
  row: CapabilityRow,
  stored: StoredCapabilityLogo,
): CapabilityLogoRecoveryAction | null {
  if (stored === "unknown") return null;
  if (row.logo.status === "present") return stored === "accepted" ? null : "lost";
  if (stored === "accepted") return "accepted";
  return row.logo.attempts >= LOGO_MAX_CLAIMED_ATTEMPTS ? "abandoned" : "released";
}
