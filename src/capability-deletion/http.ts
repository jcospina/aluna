import type { Database } from "bun:sqlite";
import type { Context } from "hono";

import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import type { ReadGateCoordinator } from "../read-gates/index.ts";
import { type CapabilityRow, getCapability } from "../registry/index.ts";
import { renderCachedCapabilitySurface } from "../web/index.ts";
import type { DeletionCleanupSupervisor } from "./cleanup-supervisor.ts";
import { admitCapabilityDeletion } from "./front-half.ts";
import {
  type CapabilityDeletionRefusal,
  renderCapabilityDeletionAlreadyGone,
  renderCapabilityDeletionCommitted,
  renderCapabilityDeletionPreCommitFailure,
  renderCapabilityDeletionRefusalRestoration,
} from "./presentation.ts";
import {
  type CapabilityDestructionFaults,
  type CapabilityDestructionResult,
  destroyCapability,
  type OwnedResourceCleanupAdapter,
} from "./two-phase-destruction.ts";

export interface CapabilityDeletionHttpDeps {
  readonly registryReadwrite: Database;
  readonly registryReadonly: Database;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
  readonly capabilityDeletionAdapters: readonly OwnedResourceCleanupAdapter[];
  readonly capabilityDestructionFaults?: CapabilityDestructionFaults;
  /** Asked for another pass whenever a deletion commits but leaves cleanup owed. */
  readonly deletionCleanup?: DeletionCleanupSupervisor;
}

interface CapabilityDeletionConfirmationRequest {
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly restoration: CapabilityDeletionRestoration;
  readonly visibleTarget: CapabilityRow;
}

export type CapabilityDeletionRestoration =
  | { readonly kind: "neutral" }
  | { readonly kind: "capability"; readonly row: CapabilityRow };

type CapabilityDeletionExecution =
  | {
      readonly kind: "admission";
      readonly outcome: Awaited<ReturnType<typeof admitCapabilityDeletion>>;
      readonly destruction?: CapabilityDestructionResult;
    }
  | { readonly kind: "precommit_failure"; readonly current: CapabilityRow }
  | { readonly kind: "postcommit_failure" };

export async function handleCapabilityDeletionConfirmation(
  c: Context,
  deps: CapabilityDeletionHttpDeps,
): Promise<Response> {
  const request = await readCapabilityDeletionConfirmation(c, deps);
  if (request instanceof Response) return request;
  const execution = await executeCapabilityDeletion(request, deps);
  return presentCapabilityDeletionExecution(c, request, execution, deps.registryReadonly);
}

async function readCapabilityDeletionConfirmation(
  c: Context,
  deps: CapabilityDeletionHttpDeps,
): Promise<CapabilityDeletionConfirmationRequest | Response> {
  const capabilityId = c.req.param("id") ?? "";
  const visibleTarget = getCapability(capabilityId, deps.registryReadonly);
  if (!visibleTarget) return alreadyGoneResponse(c, capabilityId);
  const form = await c.req.raw.formData();
  const incarnationValues = form.getAll("incarnation_id");
  const incarnationId =
    incarnationValues.length === 1 && typeof incarnationValues[0] === "string"
      ? incarnationValues[0]
      : "";
  return {
    capabilityId,
    incarnationId,
    restoration: resolveCapabilityDeletionRestoration(
      stringFormValues(form, "restore_capability_id"),
      stringFormValues(form, "restore_incarnation_id"),
      deps.registryReadonly,
      stringFormValues(form, "restore_surface"),
    ),
    visibleTarget,
  };
}

/** A target that is already gone lands on the neutral home state, never a dead URL. */
function alreadyGoneResponse(c: Context, capabilityId: string): Response {
  return c.html(renderCapabilityDeletionAlreadyGone(capabilityId), 200, {
    "cache-control": "no-store",
    "HX-Replace-Url": "/",
  });
}

function stringFormValues(
  form: { getAll(name: string): readonly unknown[] },
  name: string,
): string[] {
  return form.getAll(name).filter((value): value is string => typeof value === "string");
}

async function executeCapabilityDeletion(
  request: CapabilityDeletionConfirmationRequest,
  deps: CapabilityDeletionHttpDeps,
): Promise<CapabilityDeletionExecution> {
  let destruction: CapabilityDestructionResult | undefined;
  try {
    const outcome = await admitCapabilityDeletion(
      { capabilityId: request.capabilityId, incarnationId: request.incarnationId },
      {
        database: deps.registryReadwrite,
        mutationCoordinator: deps.mutationCoordinator,
        onAdmitted: async (target) => {
          destruction = await destroyCapability({
            target,
            database: deps.registryReadwrite,
            readonlyDatabase: deps.registryReadonly,
            readGates: deps.readGates,
            adapters: deps.capabilityDeletionAdapters,
            faults: deps.capabilityDestructionFaults,
          });
        },
      },
    );
    // "I still have a little tidying up to do" has to be true of *this* process, not
    // just of the next boot.
    if (destruction?.status === "cleanup_pending") deps.deletionCleanup?.requestRetry();
    return { kind: "admission", outcome, destruction };
  } catch {
    const current = getCapability(request.capabilityId, deps.registryReadonly);
    return current ? { kind: "precommit_failure", current } : { kind: "postcommit_failure" };
  }
}

function presentCapabilityDeletionExecution(
  c: Context,
  request: CapabilityDeletionConfirmationRequest,
  execution: CapabilityDeletionExecution,
  database: Database,
): Response {
  if (execution.kind === "postcommit_failure") {
    return committedCapabilityDeletionResponse(
      c,
      request.visibleTarget,
      request.restoration,
      true,
      database,
    );
  }
  if (execution.kind === "precommit_failure") {
    const restored = resolveCurrentCapabilityDeletionRestoration(request.restoration, database);
    return c.html(
      renderCapabilityDeletionPreCommitFailure(
        execution.current,
        restored ? renderCachedCapabilitySurface(restored) : "",
      ),
      200,
      {
        "cache-control": "no-store",
        "HX-Replace-Url": capabilityUrlForDeletionRestoration(restored),
      },
    );
  }
  return presentCapabilityDeletionAdmission(c, request, execution, database);
}

function presentCapabilityDeletionAdmission(
  c: Context,
  request: CapabilityDeletionConfirmationRequest,
  execution: Extract<CapabilityDeletionExecution, { readonly kind: "admission" }>,
  database: Database,
): Response {
  const { outcome } = execution;
  if (outcome.status === "busy") {
    return capabilityDeletionRefusalResponse(
      c,
      request.visibleTarget,
      request.restoration,
      { kind: "busy" },
      database,
    );
  }
  if (outcome.status === "stale") {
    const current = getCapability(request.capabilityId, database);
    return current
      ? capabilityDeletionRefusalResponse(
          c,
          current,
          request.restoration,
          { kind: "stale" },
          database,
        )
      : alreadyGoneResponse(c, request.capabilityId);
  }
  if (outcome.status === "blocked") {
    return capabilityDeletionRefusalResponse(
      c,
      outcome.target,
      request.restoration,
      { kind: "blocked", dependents: outcome.dependents },
      database,
    );
  }
  if (!execution.destruction) {
    throw new Error("Admitted capability deletion did not run its destruction lifecycle.");
  }
  // Nothing was destroyed and the gate is open again, so this is a refusal that reads
  // like one — not the generic failure, which cannot say what the user should do next.
  if (execution.destruction.status === "deletion_drain_timeout") {
    return capabilityDeletionRefusalResponse(
      c,
      outcome.target,
      request.restoration,
      { kind: "drain_timeout" },
      database,
    );
  }
  return committedCapabilityDeletionResponse(
    c,
    outcome.target,
    request.restoration,
    execution.destruction.status === "cleanup_pending",
    database,
  );
}

function capabilityDeletionRefusalResponse(
  c: Context,
  target: CapabilityRow,
  restoration: CapabilityDeletionRestoration,
  refusal: CapabilityDeletionRefusal,
  database: Database,
): Response {
  const restored = resolveCurrentCapabilityDeletionRestoration(restoration, database);
  return c.html(
    renderCapabilityDeletionRefusalRestoration(
      target,
      restored ? renderCachedCapabilitySurface(restored) : "",
      refusal,
    ),
    200,
    {
      "cache-control": "no-store",
      "HX-Replace-Url": capabilityUrlForDeletionRestoration(restored),
    },
  );
}

export function resolveCapabilityDeletionRestoration(
  capabilityIds: readonly string[],
  incarnationIds: readonly string[],
  database: Database,
  surfaces: readonly string[] = [],
): CapabilityDeletionRestoration {
  if (
    surfaces.length === 1 &&
    surfaces[0] === "neutral" &&
    capabilityIds.length === 0 &&
    incarnationIds.length === 0
  ) {
    return { kind: "neutral" };
  }
  if (surfaces.length > 1 || (surfaces.length === 1 && surfaces[0] !== "capability")) {
    return { kind: "neutral" };
  }
  if (capabilityIds.length !== 1 || incarnationIds.length !== 1) {
    return { kind: "neutral" };
  }
  const row = getCapability(capabilityIds[0] ?? "", database);
  if (!row || row.incarnation_id !== incarnationIds[0]) return { kind: "neutral" };
  return { kind: "capability", row };
}

function capabilityUrlForDeletionRestoration(restoration: CapabilityRow | null): string {
  return restoration ? `/capability/${encodeURIComponent(restoration.id)}` : "/";
}

function committedCapabilityDeletionResponse(
  c: Context,
  target: CapabilityRow,
  restoration: CapabilityDeletionRestoration,
  cleanupPending: boolean,
  database: Database,
): Response {
  const currentRestoration = resolveCurrentCapabilityDeletionRestoration(restoration, database);
  const restoredSurface = currentRestoration
    ? renderCachedCapabilitySurface(currentRestoration)
    : "";
  return c.html(renderCapabilityDeletionCommitted(target, restoredSurface, cleanupPending), 200, {
    "cache-control": "no-store",
    "HX-Replace-Url": capabilityUrlForDeletionRestoration(currentRestoration),
  });
}

function resolveCurrentCapabilityDeletionRestoration(
  restoration: CapabilityDeletionRestoration,
  database: Database,
): CapabilityRow | null {
  if (restoration.kind === "neutral") return null;
  const current = getCapability(restoration.row.id, database);
  return current?.incarnation_id === restoration.row.incarnation_id ? current : null;
}
