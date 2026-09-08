// One claimed logo attempt, end to end — the post-build follow-up ADR-0007 describes, and the
// same operation the desk-load sweep runs: they differ only in what triggers them.
//
// The ordering is the contract. A claim spends its attempt the instant it is won and nothing ever
// decrements one, so a missing key or an already closing read gate is checked first. Provider I/O
// and installation hold the incarnation's read token and observe its cancellation signal, so a
// deletion closing the gate aborts the call. The token is released before finalization reacquires
// mutation ownership, because a queued acquisition awaited inside a read-token scope deadlocks
// against deletion, which takes its lease and then closes the gate.
//
// A failure never reaches the caller: the capability is already activated, usable and
// placeholdered, so the attempt returns the row to `absent`, or to `abandoned` after the third.

import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  type CapabilityRow,
  claimLogoGeneration,
  getCapability,
  getCapabilityLogoState,
  LOGO_MAX_CLAIMED_ATTEMPTS,
  type LogoGenerationClaim,
  listActiveIncarnations,
  releaseLogoClaim,
  settleLogoGeneration,
} from "../../../registry/index.ts";
import type { MutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import type {
  CapabilityIncarnation,
  ReadGateCoordinator,
} from "../../../runtime/concurrency/read-gates.ts";
import {
  discardUnacknowledgedLogo,
  type InstalledLogo,
  installCapabilityLogo,
} from "../storage/storage.ts";
import type { RunningLogoClaims } from "./claims.ts";
import {
  generateCapabilityLogo,
  LogoGenerationError,
  type LogoGenerationProvider,
} from "./provider.ts";

export interface CapabilityLogoAttemptDeps {
  readonly databases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
  readonly artifactsRoot: string;
  readonly provider: LogoGenerationProvider;
  /** What recovery reads to tell a running claim from an interrupted one. */
  readonly claims: RunningLogoClaims;
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
   * The attempt was spent but its row moved underneath it — deleted, or settled by something else.
   * Distinct from `installed`/`failed` because the registry recorded neither.
   */
  | "superseded";

/**
 * Run one attempt for the exact active incarnation, never throwing for an ordinary failure: a
 * provider outage, a malformed response, a cancelled call, a refused install all become outcomes.
 */
export async function runCapabilityLogoAttempt(
  target: CapabilityIncarnation,
  deps: CapabilityLogoAttemptDeps,
): Promise<CapabilityLogoAttemptOutcome> {
  // Asked before the claim: no key and an already closing gate would otherwise burn attempts with
  // no request leaving the process, and three burnt attempts are a permanent placeholder.
  if (!canReachTheProvider(target, deps)) return "unclaimed";
  // A row the claim would refuse anyway costs nothing here. The conditional UPDATE still decides;
  // this stops a stale tile queueing a ticket per request and suppressing its own recovery.
  if (!looksClaimable(target, deps)) return "unclaimed";

  // Tracked from *before* the claim to after the finalizing write: registering after the commit
  // leaves a window where a concurrent recovery releases a `generating` row out from under a call.
  const ticket = deps.claims.begin(target);
  try {
    const claim = await deps.mutationCoordinator.withPlatformWrite(() =>
      claimLogoGeneration(target.capabilityId, target.incarnationId, deps.databases.readwrite),
    );
    if (!claim) return "unclaimed";
    ticket.claimed();

    const installed = await attemptUnderReadToken(claim, deps);
    return await finalizeAttempt(claim, installed, deps);
  } finally {
    ticket.end();
  }
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
 * Whether the durable row is in a shape a claim could win: `absent`, and under the cap.
 * A read with no lock and no lease, so it decides nothing and only avoids work.
 */
function looksClaimable(target: CapabilityIncarnation, deps: CapabilityLogoAttemptDeps): boolean {
  const state = getCapabilityLogoState(
    target.capabilityId,
    target.incarnationId,
    deps.databases.readonly,
  );
  return state?.status === "absent" && state.attempts < LOGO_MAX_CLAIMED_ATTEMPTS;
}

/**
 * A non-blocking look at whether the attempt could reach the service: provider configured, gate
 * open. `tryAcquire`, never a queued acquisition; it closes the common cases, not the race.
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
 * The paid half: generate and install while holding the incarnation's read token. Nothing here
 * touches the registry, so the token is released before mutation ownership is asked for again.
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
    // Every failure consumes the claimed attempt, and none is fatal. A cancellation is designed
    // (deletion closed the gate), so it stays quiet; a silent spend leaves three burnt attempts.
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
 * The second short coordinator write, revalidating by construction: every transition binds
 * `id + incarnation_id + lifecycle_state = 'active'`, so a moved row settles nothing.
 */
async function finalizeAttempt(
  claim: LogoGenerationClaim,
  installed: InstalledLogo | null,
  deps: CapabilityLogoAttemptDeps,
): Promise<CapabilityLogoAttemptOutcome> {
  const settlement = resolveSettlement(
    installed !== null,
    claim.attempts >= LOGO_MAX_CLAIMED_ATTEMPTS,
  );

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
      // Bytes nobody acknowledged: no lifecycle ever said `present`, so left there they would be
      // unservable for ever and would make every later attempt fail on EEXIST.
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
