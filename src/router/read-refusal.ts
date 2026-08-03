import type { Context } from "hono";

import {
  capabilityCreateErrorId,
  capabilityDeleteErrorId,
  capabilityEditErrorId,
} from "../presentation/index.ts";
import { ReadGateClosingError } from "../read-gates/index.ts";
import type { WireProtocolAction } from "./wire-protocol.ts";

type MutationAction = "create" | "update" | "delete";

const READ_UNAVAILABLE_FRAGMENT =
  '<p class="notice">I’m making a careful change here. Give me a moment, then try that again.</p>';

export function assertReadOwnership(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason ?? new ReadGateClosingError("Capability read ownership was cancelled.");
}

export function readUnavailable(
  c: Context,
  capabilityId?: string,
  action?: WireProtocolAction,
): Response {
  if (capabilityId && action && isMutationAction(action)) {
    retargetMutationError(c, capabilityId, action);
    return c.html(
      '<p class="notice" data-role="error" data-error-code="read_unavailable">I\'m making a careful change here. Give me a moment, then try that again.</p>',
      422,
    );
  }
  return c.html(READ_UNAVAILABLE_FRAGMENT, 409);
}

export function recordMutationRefusal(
  c: Context,
  capabilityId: string,
  action: MutationAction,
): Response {
  retargetMutationError(c, capabilityId, action);
  return c.html(
    '<p class="notice" data-role="error" data-error-code="mutation_busy">I\'m still putting something together. Give me a moment, then try that again.</p>',
    422,
  );
}

function retargetMutationError(c: Context, capabilityId: string, action: MutationAction): void {
  if (action === "create") c.header("HX-Retarget", `#${capabilityCreateErrorId(capabilityId)}`);
  else if (action === "update") c.header("HX-Retarget", `#${capabilityEditErrorId(capabilityId)}`);
  else c.header("HX-Retarget", `#${capabilityDeleteErrorId(capabilityId)}`);
  c.header("HX-Reswap", "innerHTML");
}

function isMutationAction(action: WireProtocolAction): action is MutationAction {
  return action === "create" || action === "update" || action === "delete";
}
