import type { Database } from "bun:sqlite";
import {
  type CapabilityRow,
  getCapability,
  listCapabilityDependents,
} from "../../registry/index.ts";
import type { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";

export interface CapabilityDeletionExpectation {
  readonly capabilityId: string;
  readonly incarnationId: string;
}

export interface CapabilityDeletionFrontHalfDeps {
  readonly database: Database;
  readonly mutationCoordinator: MutationCoordinator;
  /** Injectable reads keep lease-head ordering directly observable in tests. */
  readonly getTarget?: typeof getCapability;
  readonly listDependents?: typeof listCapabilityDependents;
  /**
   * The continuation seam. It runs only after authoritative validation,
   * while the exact deletion lease remains held.
   */
  readonly onAdmitted?: (target: CapabilityRow) => void | Promise<void>;
}

export type CapabilityDeletionAdmission =
  | { readonly status: "busy" }
  | { readonly status: "stale" }
  | {
      readonly status: "blocked";
      readonly target: CapabilityRow;
      readonly dependents: readonly CapabilityRow[];
    }
  | { readonly status: "admitted"; readonly target: CapabilityRow };

/**
 * Atomically admit the dependency-safe front half of permanent capability deletion.
 *
 * The preflight the deletion doorway shows is deliberately absent from this function: only
 * this lease-held read is authoritative. The continuation is invoked before
 * ownership releases so destructive work cannot race a newly queued build or write.
 */
export async function admitCapabilityDeletion(
  expectation: CapabilityDeletionExpectation,
  deps: CapabilityDeletionFrontHalfDeps,
): Promise<CapabilityDeletionAdmission> {
  const lease = deps.mutationCoordinator.tryAcquireDeletion();
  if (!lease) return { status: "busy" };

  try {
    const readTarget = deps.getTarget ?? getCapability;
    const readDependents = deps.listDependents ?? listCapabilityDependents;
    const target = readTarget(expectation.capabilityId, deps.database);
    if (!target || target.incarnation_id !== expectation.incarnationId) {
      return { status: "stale" };
    }

    const dependents = readDependents(target, deps.database);
    if (dependents.length > 0) {
      return { status: "blocked", target, dependents };
    }

    await deps.onAdmitted?.(target);
    return { status: "admitted", target };
  } finally {
    deps.mutationCoordinator.release(lease);
  }
}
