// Recoverable cross-store activation (Module 4.5, decision 27).
//
// Filesystem publication has already completed before this module is entered.
// SQLite then owns the sole point of no return: additive migration, exact registry
// CAS, and success/activated metrics commit together or roll back together.

import type { Database } from "bun:sqlite";

import { withWriteTransaction } from "../db.ts";
import type { CapabilityRegistryExpectation, CapabilitySpec } from "../registry/index.ts";
import {
  assertVerifiedPublishedSnapshot,
  type VerifiedPublishedSnapshot,
} from "./artifact-lifecycle.ts";
import {
  type CommitCapabilityResult,
  commitCapability,
  FIRST_CAPABILITY_VERSION,
} from "./commit.ts";

export interface ActivationFaultHooks {
  /** Test-only seams pinning the exact pre-/in-/post-commit behavior. */
  readonly beforeTransaction?: () => void;
  readonly afterMigration?: () => void;
  readonly afterRegistryCas?: () => void;
  readonly afterMetricsFinalized?: () => void;
  readonly afterCommit?: () => void;
}

export interface ActivatePublishedSnapshotInput {
  readonly database: Database;
  readonly spec: CapabilitySpec;
  readonly publication: VerifiedPublishedSnapshot;
  readonly expected?: CapabilityRegistryExpectation;
  /** Apply only platform-derived additive DDL through the supplied write connection. */
  readonly applyMigration: (database: Database) => void;
  /** Finalize this publication's already-running lifecycle as success/activated. */
  readonly finalizeMetrics: (database: Database) => void;
  readonly faults?: ActivationFaultHooks;
}

/**
 * Activate one already-published snapshot. Throws leave the publication available
 * for guarded reconciliation. A throw from `afterCommit` is deliberately post-PONR:
 * callers must treat the committed registry and lifecycle row as authoritative.
 */
export async function activatePublishedSnapshot(
  input: ActivatePublishedSnapshotInput,
): Promise<CommitCapabilityResult> {
  // Reverify before SQLite begins so corrupt or substituted bytes never cause DDL.
  assertVerifiedPublishedSnapshot(input.publication);
  input.faults?.beforeTransaction?.();

  const committed = await withWriteTransaction(input.database, () => {
    input.applyMigration(input.database);
    input.faults?.afterMigration?.();

    const result = commitCapability({
      spec: input.spec,
      publication: input.publication,
      database: input.database,
      expected: input.expected ?? { state: "absent" },
    });
    input.faults?.afterRegistryCas?.();

    input.finalizeMetrics(input.database);
    input.faults?.afterMetricsFinalized?.();
    return result;
  });

  input.faults?.afterCommit?.();
  return committed;
}

export function expectedAbsentCapability(): CapabilityRegistryExpectation {
  return { state: "absent" };
}

export function expectedActiveCapability(input: {
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly version: number;
}): CapabilityRegistryExpectation {
  return {
    state: "active",
    capabilityId: input.capabilityId,
    incarnationId: input.incarnationId,
    version: input.version,
  };
}

export function nextCapabilityVersion(expected: CapabilityRegistryExpectation): number {
  return expected.state === "absent" ? FIRST_CAPABILITY_VERSION : expected.version + 1;
}
