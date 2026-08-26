// What a desk load resolves before it draws: claims nobody is running any more, and
// artwork that has gone from under a `present` row.
//
// The retry sweep itself needs no code of its own — a fresh desk render arms one
// load-triggered POST on every `absent` tile, which is the whole self-healing mechanism
// ([ADR-0007](../../docs/adr/0007-capability-logo-contract.md): "a load offers one
// incarnation-bound tile POST to every capability that has no artwork"). What the sweep
// does need is for the durable lifecycle to be *true* before those tiles are rendered,
// because only `absent` arms. A row stranded in `generating` by a crash renders a resting
// placeholder and would never be offered another attempt: recovery is what returns it to
// the sweep, and it has to happen before serving rather than inside the POST that only an
// already-recovered row can send.
//
// Three reconciliations, and each is bookkeeping around artwork rather than a decision to
// make any:
//
//   - **An interrupted claim, read from the final file and the consumed count.** If the
//     no-overwrite drawing is there the claim did succeed and only its finalizing write
//     was lost, so the row becomes `present`. If it is not, the attempt is spent: back to
//     `absent` for a later load, or `abandoned` once the spend was the third. Nothing is
//     decremented and no call is made.
//   - **The wreckage that claim left behind.** Its staging temp, and a final file holding
//     no drawing at all. Removed *before* the state changes, so a row never returns to
//     `absent` over bytes that would fail the next attempt on EEXIST.
//     `artifact-reconciliation.ts` deliberately tolerates the temp's name rather than
//     sweeping it, because it also runs at the head of a build where an attempt may be
//     mid-write; here the claim registry proves nothing is running.
//   - **A `present` row whose file has gone.** It becomes `abandoned` and wears the
//     permanent placeholder. L7's once-accepted rule still applies after loss, so no
//     attempt is spent trying to draw a replacement.
//
// **Nothing here runs for an incarnation with an attempt in flight.** A live claim and a
// crashed one leave the same durable row, and only this process can tell them apart
// (`claims.ts`). Recovery also holds the incarnation's read token while it looks at the
// tree, so a deletion draining its readers is not raced for the files it is removing.

import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import type { CapabilityIncarnation, ReadGateCoordinator } from "../read-gates/index.ts";
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
} from "../registry/index.ts";
import type { RunningLogoClaims } from "./claims.ts";
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
 * How long one whole pass will wait for mutation ownership before leaving the rest to the
 * next load.
 *
 * A platform write queues behind a build reservation, and a build holds its lease for as
 * long as a build takes. Awaiting one unconditionally would make the sweep the thing that
 * blocks the desk from rendering — the one behaviour the contract names outright — for a
 * capability that is finished, usable and already wearing its placeholder.
 *
 * So the budget belongs to the pass rather than to each row: a deadline shared by every
 * write means a desk with forty capabilities cannot wait forty times, and a pass that
 * gives up leaves rows exactly as it found them for the next load to reconcile. Generous
 * enough that an uncontended write — every ordinary load — is never refused.
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
 * Reconcile every active capability's logo lifecycle with what is actually on disk, and
 * answer with the rows that moved. Rows already agreeing with their artwork cost a single
 * `stat` and produce nothing.
 *
 * Never throws for one bad row: a desk that cannot render because a logo could not be
 * reconciled is a worse outcome than a tile that stays a placeholder one load longer.
 */
export async function recoverCapabilityLogos(
  deps: CapabilityLogoRecoveryDeps,
): Promise<readonly CapabilityLogoRecoveryEntry[]> {
  if (!isRegistryInitialized(deps.databases.readonly)) return [];

  // One read of the rows, and the gate catalog derived from it rather than read again.
  // Two reads are two moments: a capability activated between them is in the row list and
  // not in the catalog, and its read token would be refused for a reason that has nothing
  // to do with it.
  const rows = listCapabilities(deps.databases.readonly);
  const catalog = rows.map(capabilityIncarnation);
  const admission = AbortSignal.timeout(deps.admissionMs ?? LOGO_RECOVERY_ADMISSION_MS);
  const recovered: CapabilityLogoRecoveryEntry[] = [];
  let deferred = 0;
  for (const row of rows) {
    // The budget is spent, so every remaining write would be refused on arrival. Counted
    // rather than attempted: a pass must not clear a row's staging bytes it can no longer
    // move the row for.
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
 * One row, with every failure absorbed. A desk that cannot render because a logo could
 * not be reconciled is a worse outcome than a tile that stays a placeholder one load
 * longer, so nothing from here reaches the caller as a throw.
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
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** The gate identity of one row. */
function capabilityIncarnation(row: CapabilityRow): CapabilityIncarnation {
  return { capabilityId: row.id, incarnationId: row.incarnation_id };
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

  // Outside the read token by construction: the coordinator write is a queued
  // acquisition, and awaiting one inside a read-token scope deadlocks against a deletion
  // that takes its lease and then closes the gate.
  const moved = await deps.mutationCoordinator.withPlatformWrite(
    () => (stillTrue(row, deps) ? applyRecoveryAction(row, action, deps) : null),
    { signal: admission },
  );
  // The row moved out from under this pass — deleted, reconciled by a concurrent load, or
  // claimed by an attempt that started while this one waited for the lease. Reporting the
  // transition that did not happen would be a lie in a boot log.
  if (!moved) return null;

  return {
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    action,
    removedTemps: looked.removedTemps,
  };
}

/**
 * Whether a `present` row's missing file is really a loss.
 *
 * It is not, when the incarnation's whole artifact tree is absent: that is a root pointing
 * somewhere the platform's artifacts are not, and abandoning on it would take every
 * capability's face away at once, irreversibly. Only asked for the answer that is
 * terminal — a `generating` row with no tree yet is ordinary, and releases its attempt.
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
 * Whether the row this pass decided from is still the row about to be written.
 *
 * Read inside the lease body, where a read and the write that follows it are one
 * uninterrupted step. The snapshot was taken before the queue, and a claim that arrived
 * while this write waited would satisfy the transition's own `generating` predicate just
 * as the dead one does — releasing a paid call's row out from under it, which is how one
 * incarnation ends up with two drawings in flight.
 *
 * Asked on the write connection, so the row read is exactly the row about to be written
 * and no question of when a second connection sees a commit arises.
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
 * The one look at the incarnation's tree, under its read token: what is at the logo path,
 * and what did a dead claim leave behind.
 *
 * Both removals happen here rather than after the state moves, so a row never returns to
 * `absent` over the wreckage of the attempt that failed it — staging bytes it would then
 * have to be told to tolerate, and a truncated final file that would refuse every
 * remaining attempt the installer's EEXIST. Returns null when the gate is closing, or
 * when the budget ran out before the tree was touched: work removed for a row this pass
 * can no longer move is work done for nothing.
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
    if (row.logo.status !== "generating") {
      return { stored: provenLoss(row, stored, deps) ? stored : "unknown", removedTemps: 0 };
    }
    if (stored === "unknown") return { stored, removedTemps: 0 };

    if (stored === "truncated") {
      discardTruncatedCapabilityLogo(deps.artifactsRoot, row.id, row.incarnation_id);
    }
    const removed = removeLogoAttemptTemps(deps.artifactsRoot, row.id, row.incarnation_id);
    return { stored, removedTemps: removed.length };
  } finally {
    deps.readGates.release(tokens);
  }
}

/**
 * Which transition the tree and the durable count earn. `null` means the row is honest —
 * or that the tree could not answer, in which case nothing is reconciled from a question
 * that was never answered.
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
