// One claimed logo attempt, end to end.
//
// This is the operation [ADR-0007](../../docs/adr/0007-capability-logo-contract.md)
// describes as a post-build follow-up to a successful v1, and the same operation the
// desk-load sweep (5.5/04) will run. It is deliberately one path: a build's follow-up
// and a recovery sweep differ only in what triggers them.
//
// The ordering here is the contract, not a preference:
//
//   0. **Nothing is claimed that cannot possibly succeed.** A missing key or an already
//      closing read gate is checked first, because a claim spends its attempt the instant
//      it is won and nothing ever decrements one.
//   1. **A short coordinator write claims the attempt.** `withPlatformWrite` queues in
//      ordinary FIFO order, so a follow-up arriving while the build lease is still
//      releasing simply waits its turn. The claim moves `absent → generating` and spends
//      the attempt in one statement, before any provider is called.
//   2. **Provider I/O and installation hold the incarnation's read token** and observe
//      its cancellation signal. Deletion closing the gate therefore aborts the call and
//      no late response can write into a tombstoned tree.
//   3. **The token is released before finalization reacquires mutation ownership.** A
//      queued acquisition awaited inside a read-token scope deadlocks against deletion,
//      which takes its lease and *then* closes the gate; the coordinator's own doc
//      comment names this exact hazard.
//
// A failure never fails the build. The capability is already activated, usable and
// placeholdered; the attempt returns the row to `absent` for a later try, or to
// `abandoned` once the third claimed attempt has failed.

import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import type { CapabilityIncarnation, ReadGateCoordinator } from "../read-gates/index.ts";
import {
  type CapabilityRow,
  claimLogoGeneration,
  getCapability,
  type LogoGenerationClaim,
  listActiveIncarnations,
  releaseLogoClaim,
  settleLogoGeneration,
} from "../registry/index.ts";
import {
  generateCapabilityLogo,
  LogoGenerationError,
  type LogoGenerationProvider,
} from "./provider.ts";
import { discardUnacknowledgedLogo, type InstalledLogo, installCapabilityLogo } from "./storage.ts";

/**
 * Three claimed attempts and then never (ADR-0007, PLAN decision 38). The guard that
 * matters is the attempt cap rather than a spend ceiling: at ~$0.08 a call the expensive
 * failure is a retry loop, and a cap kills the loop where a budget only bounds it.
 */
export const LOGO_MAX_CLAIMED_ATTEMPTS = 3;

export interface CapabilityLogoAttemptDeps {
  readonly databases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
  readonly artifactsRoot: string;
  readonly provider: LogoGenerationProvider;
  readonly maxAttempts?: number;
}

/** What one attempt did. Every value leaves a finished, usable capability behind. */
export type CapabilityLogoAttemptOutcome =
  /** The claim was not available: not `absent`, already claimed, settled, or gone. */
  | "unclaimed"
  /** Accepted artwork is installed and the lifecycle is `present`. */
  | "installed"
  /** The attempt failed and the row is back at `absent` for a later try. */
  | "failed"
  /** The last allowed attempt failed; the placeholder is permanent. */
  | "abandoned"
  /**
   * The attempt was spent but the row it belonged to moved underneath it — deleted, or
   * settled by something else while the drawing was being made. Distinct from
   * `installed`/`failed` because the registry records neither: a late reply must not be
   * reported as having changed a state it could not reach.
   */
  | "superseded";

/**
 * Run one attempt for the exact active incarnation. Never throws for an ordinary
 * failure — a provider outage, a malformed response, a cancelled call and a refused
 * install all resolve to an outcome, because none of them is the caller's problem to
 * handle differently.
 */
export async function runCapabilityLogoAttempt(
  target: CapabilityIncarnation,
  deps: CapabilityLogoAttemptDeps,
): Promise<CapabilityLogoAttemptOutcome> {
  // Asked before the claim, because a claim spends an attempt the moment it is won and
  // nothing ever decrements one. Two ways an attempt can be doomed before it starts — no
  // key, and a gate already closing for a deletion — would otherwise burn attempts
  // without a single request leaving the process, and three of those reach the permanent
  // placeholder for a capability nobody deleted on a machine nobody configured.
  if (!canReachTheProvider(target, deps)) return "unclaimed";

  const claim = await deps.mutationCoordinator.withPlatformWrite(() =>
    claimLogoGeneration(target.capabilityId, target.incarnationId, deps.databases.readwrite),
  );
  if (!claim) return "unclaimed";

  const installed = await attemptUnderReadToken(claim, deps);
  return finalizeAttempt(claim, installed, deps);
}

/** The active-registry view every read token in this module is acquired against. */
export function readActiveIncarnationCatalog(
  readonly: PlatformDatabase["readonly"],
): readonly CapabilityIncarnation[] {
  // Identities only. A gate validates membership and one-incarnation-per-id, so the
  // resolver's parsed-and-fingerprinted view is work nothing here reads.
  return listActiveIncarnations(readonly).map((row) => ({
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
  }));
}

/** The active-registry view both the preflight and the paid half acquire against. */
function readCatalog(deps: CapabilityLogoAttemptDeps): readonly CapabilityIncarnation[] {
  return readActiveIncarnationCatalog(deps.databases.readonly);
}

/**
 * A non-blocking look at whether this attempt could reach the service at all: the
 * provider is configured, and this incarnation's gate is open. The read token is taken
 * and released at once.
 *
 * It closes the common cases, not the race: a gate that closes in the moment between
 * this and the real acquisition still spends its attempt, which is the cancellation the
 * contract already counts.
 *
 * Deliberately `tryAcquire` and not a queued acquisition — nothing here may block, and
 * nothing is held across the coordinator write that follows.
 */
function canReachTheProvider(
  target: CapabilityIncarnation,
  deps: CapabilityLogoAttemptDeps,
): boolean {
  if (deps.provider.isConfigured?.() === false) return false;
  const tokens = deps.readGates.tryAcquire({
    catalog: readCatalog(deps),
    incarnations: [target],
  });
  if (!tokens) return false;
  deps.readGates.release(tokens);
  return true;
}

/**
 * The paid half: generate and install while holding the incarnation's read token. Returns
 * whether accepted bytes reached their final path; nothing here touches the registry, so
 * the token can be released before mutation ownership is asked for again.
 */
async function attemptUnderReadToken(
  claim: LogoGenerationClaim,
  deps: CapabilityLogoAttemptDeps,
): Promise<InstalledLogo | null> {
  const incarnation: CapabilityIncarnation = {
    capabilityId: claim.capabilityId,
    incarnationId: claim.incarnationId,
  };
  try {
    return await deps.readGates.withTokens(
      { catalog: readCatalog(deps), incarnations: [incarnation] },
      async (tokens) => {
        const bytes = await generateCapabilityLogo(deps.provider, claim, tokens.signal);
        // Re-checked after the call: a gate that closed while the service was drawing
        // must not have its tombstoned tree recreated by an install.
        if (tokens.signal.aborted) return null;
        return installCapabilityLogo({
          artifactsRoot: deps.artifactsRoot,
          capabilityId: claim.capabilityId,
          incarnationId: claim.incarnationId,
          attempt: claim.attempts,
          bytes,
        });
      },
    );
  } catch (error) {
    // Timeout, cancellation, a malformed envelope, a refused install, a closed gate —
    // every one of them consumes the claimed attempt, and none of them is fatal to the
    // capability, which is already built and usable.
    //
    // A cancellation is a designed outcome — deletion closed the gate — so it is not
    // shouted about. Everything else is: a spend that fails silently leaves an operator
    // with three burnt attempts and no reason.
    if (!(error instanceof LogoGenerationError && error.reason === "cancelled")) {
      console.error(
        `omni-crud logo attempt ${claim.attempts} for ${claim.capabilityId}/${claim.incarnationId} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  }
}

/**
 * The second short coordinator write. It revalidates the exact active incarnation by
 * construction: every transition is bound to `id + incarnation_id + lifecycle_state
 * = 'active'`, so a deleted or superseded row settles nothing and returns `null` — which
 * is reported as `superseded` rather than as the transition that did not happen.
 */
async function finalizeAttempt(
  claim: LogoGenerationClaim,
  installed: InstalledLogo | null,
  deps: CapabilityLogoAttemptDeps,
): Promise<CapabilityLogoAttemptOutcome> {
  const maxAttempts = deps.maxAttempts ?? LOGO_MAX_CLAIMED_ATTEMPTS;
  const settlement = resolveSettlement(installed !== null, claim.attempts >= maxAttempts);

  return deps.mutationCoordinator.withPlatformWrite(() => {
    const moved =
      settlement.status === null
        ? releaseLogoClaim(claim.capabilityId, claim.incarnationId, deps.databases.readwrite)
        : settleLogoGeneration(
            claim.capabilityId,
            claim.incarnationId,
            settlement.status,
            deps.databases.readwrite,
          );
    if (moved) return settlement.outcome;
    if (installed) {
      // Bytes nobody acknowledged: the row moved out from under this attempt, so no
      // lifecycle ever said `present`. Left there they would be unservable forever and
      // would make every later attempt fail on EEXIST.
      discardUnacknowledgedLogo(installed);
    }
    return "superseded";
  });
}

/** Which transition this attempt earned. `null` means release back to `absent`. */
function resolveSettlement(
  installed: boolean,
  exhausted: boolean,
): { status: "present" | "abandoned" | null; outcome: CapabilityLogoAttemptOutcome } {
  if (installed) return { status: "present", outcome: "installed" };
  if (exhausted) return { status: "abandoned", outcome: "abandoned" };
  return { status: null, outcome: "failed" };
}

/** The active row an attempt's response renders its tile from, or null if it is gone. */
export function readAttemptTarget(
  target: CapabilityIncarnation,
  databases: PlatformDatabase,
): CapabilityRow | null {
  const row = getCapability(target.capabilityId, databases.readonly);
  return row && row.incarnation_id === target.incarnationId ? row : null;
}
