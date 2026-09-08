import type { Database } from "bun:sqlite";
import type { Context } from "hono";

import {
  MutationAdmissionError,
  type MutationCoordinator,
} from "../../runtime/concurrency/mutation-coordinator.ts";
import { type CapabilityRenameOutcome, renameCapabilityLabel } from "./front-half.ts";
import { renderCapabilityRenameRefusal, renderRenamedCapabilityLogo } from "./presentation.ts";

export interface CapabilityRenameHttpDeps {
  readonly registryReadwrite: Database;
  readonly registryReadonly: Database;
  readonly mutationCoordinator: MutationCoordinator;
}

/**
 * A top-level platform route, not a generated capability Action: it loads no Handler, asks no
 * resolver, builds no provider. Renaming is zero-AI, and the conditional UPDATE is the check.
 */
export async function handleCapabilityRename(
  c: Context,
  deps: CapabilityRenameHttpDeps,
): Promise<Response> {
  const form = await c.req.raw.formData();
  const version = Number(singleFormValue(form, "version"));
  const expectation = {
    capabilityId: c.req.param("id") ?? "",
    incarnationId: singleFormValue(form, "incarnation_id"),
    version,
    // The name the menu opened on: a rename does not bump the version, so this is the only thing
    // telling two submissions against the same version apart.
    previousLabel: singleFormValue(form, "previous_label"),
  };

  // A version that is not one refuses as stale rather than as a bad name: nothing about
  // the name is wrong, and the submission does not describe a capability that exists.
  const outcome = Number.isSafeInteger(version)
    ? await admit(expectation, singleFormValue(form, "label"), deps, c.req.raw.signal)
    : ({ status: "stale" } as const);

  if (outcome.status === "renamed") {
    return c.html(renderRenamedCapabilityLogo(outcome.row), 200, { "cache-control": "no-store" });
  }
  // Swapped nowhere: a refusal is read on the prompt bar (PLAN decision 26). The request targets
  // the logo's whole slot, so a body reaching it would put a sentence where a capability was.
  return c.html(renderCapabilityRenameRefusal(outcome), outcome.status === "refused" ? 422 : 409, {
    "cache-control": "no-store",
    "HX-Reswap": "none",
  });
}

/**
 * The write, plus the one thing on the way to it that is not an outcome: a submission whose caller
 * has gone leaves the queue, answered here because a 500 for a closed connection says nothing.
 */
async function admit(
  expectation: Parameters<typeof renameCapabilityLabel>[0],
  label: string,
  deps: CapabilityRenameHttpDeps,
  signal: AbortSignal,
): Promise<CapabilityRenameOutcome> {
  try {
    return await renameCapabilityLabel(expectation, label, {
      database: deps.registryReadwrite,
      readonlyDatabase: deps.registryReadonly,
      mutationCoordinator: deps.mutationCoordinator,
      signal,
    });
  } catch (error) {
    if (error instanceof MutationAdmissionError) return { status: "stale" };
    throw error;
  }
}

/**
 * One value, or none. A repeated field is a submission this form does not make, and taking the
 * first of several would let an injected duplicate decide which capability a rename binds to.
 */
function singleFormValue(form: { getAll(name: string): readonly unknown[] }, name: string): string {
  const values = form.getAll(name);
  const only = values.length === 1 ? values[0] : undefined;
  return typeof only === "string" ? only : "";
}
