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
 * The whole of the rename route.
 *
 * Deliberately a top-level platform route rather than a generated capability Action, for
 * the reason permanent deletion is one: it never loads a Handler, asks the resolver, or
 * constructs a provider. Renaming desk furniture is a zero-AI path and stays one.
 *
 * The submission carries the incarnation and version the menu opened on. Nothing here
 * reads the row first to check them — the conditional UPDATE is the check, taken under
 * the lease, which is the only reading that cannot go stale between looking and writing.
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
    // The name the menu opened on. A rename does not bump the version, so this is the only
    // thing that tells two submissions made against the same version apart: without it the
    // second silently overwrote the first, and neither person was told.
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
  // Swapped nowhere, whatever the shell decides to do with it. A refusal is read on the
  // prompt bar (PLAN decision 26) and the editor behind it keeps the typed value; the
  // request's own target is the logo's whole slot, so a body that reached it would put a
  // sentence where a capability used to be.
  return c.html(renderCapabilityRenameRefusal(outcome), outcome.status === "refused" ? 422 : 409, {
    "cache-control": "no-store",
    "HX-Reswap": "none",
  });
}

/**
 * The write, and the one thing that can go wrong on the way to it that is not an outcome.
 *
 * A submission whose caller has gone leaves the queue rather than landing whenever it
 * eventually drains, on a desk nobody is looking at any more — and leaving is a rejection,
 * not a refusal. It is answered here rather than raised, because a 500 for a connection
 * that closed itself is a log line about nothing.
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
 * One value, or none. A repeated field is a submission this form does not make, and
 * taking the first of several would let an injected duplicate decide which capability a
 * rename is bound to.
 */
function singleFormValue(form: { getAll(name: string): readonly unknown[] }, name: string): string {
  const values = form.getAll(name);
  const only = values.length === 1 ? values[0] : undefined;
  return typeof only === "string" ? only : "";
}
