// Every product-voice failure and refusal the router answers with (CONTEXT.md
// "Product voice", ARCH §9.7).
//
// Two rules hold across all of them. The copy never names an internal — no "handler",
// "action", "capability", "route" — because the user need not, and must not, learn which
// check failed. And any refusal the shell is expected to *show* carries a
// `data-error-code`: htmx will not swap a 4xx unaided, so an unmarked refusal body is one
// the user never sees (see the rescue list in `public/app.js`).

import type { Context } from "hono";
import type { MissingRequiredFieldsError, RecordNotFoundError } from "../capability-data/index.ts";
import {
  capabilityCreateErrorId,
  capabilityDeleteErrorId,
  capabilityEditErrorId,
} from "../presentation/index.ts";
import { ReadGateClosingError } from "../read-gates/index.ts";
import type { WireProtocolAction } from "./wire-protocol.ts";

type MutationAction = "create" | "update" | "delete";

// Carries `data-error-code` for the same reason the mutation branch below does: htmx
// refuses to swap any 4xx by default, so the shell's rescue in `public/app.js` needs a
// structured marker to recognise this as a refusal worth showing. Without it the copy
// below is written but never reaches a screen.
const READ_UNAVAILABLE_FRAGMENT =
  '<p class="notice" data-role="error" data-error-code="read_unavailable">I’m making a careful change here. Give me a moment, then try that again.</p>';

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

/**
 * Product-voice failures (CONTEXT.md). The not-found copy is deliberately the same
 * for an unknown capability and an undeclared action — the user need not, and must
 * not, learn which internal check failed. Neither names an internal (no "handler",
 * "action", "capability", "route").
 */
export const NOT_FOUND_FRAGMENT =
  "<p class=\"notice\">Hmm — I can't find that here. It might be something I haven't made yet.</p>";
export const INTERNAL_ERROR_FRAGMENT =
  '<p class="notice">Hmm, something went sideways on my end just now. Mind trying again?</p>';
export const MUTATION_FAILURE_FRAGMENT =
  '<p class="notice" data-role="error" data-error-code="mutation_failed">Hmm, something went sideways on my end just now. Mind trying again?</p>';
export const WIRE_PROTOCOL_ERROR_FRAGMENT =
  '<p class="notice">Hmm — I couldn\'t make sense of that submission. Mind trying again?</p>';

export function missingRequiredFieldsFailure(
  c: Context,
  capabilityId: string,
  error: MissingRequiredFieldsError,
): Response {
  const fields = error.fields.join(" ");
  if (error.action === "create") {
    c.header("HX-Retarget", `#${capabilityCreateErrorId(capabilityId)}`);
    c.header("HX-Reswap", "innerHTML");
  } else if (error.action === "update") {
    c.header("HX-Retarget", `#${capabilityEditErrorId(capabilityId)}`);
    c.header("HX-Reswap", "innerHTML");
  }
  const copy =
    error.action === "create"
      ? "I still need a little more before I can add this."
      : "I still need a little more before I can save this.";
  return c.html(
    `<p class="notice" data-role="error" data-error-code="${error.code}" data-error-fields="${fields}">${copy}</p>`,
    422,
  );
}

export function recordNotFoundFailure(
  c: Context,
  capabilityId: string,
  action: WireProtocolAction,
  error: RecordNotFoundError,
): Response {
  if (action === "update") {
    c.header("HX-Retarget", `#${capabilityEditErrorId(capabilityId)}`);
    c.header("HX-Reswap", "innerHTML");
  } else if (action === "delete") {
    c.header("HX-Retarget", `#${capabilityDeleteErrorId(capabilityId)}`);
    c.header("HX-Reswap", "innerHTML");
  }
  return c.html(
    `<p class="notice" data-role="error" data-error-code="${error.code}">I couldn’t find that entry anymore. It may already be gone.</p>`,
    404,
  );
}

/**
 * Surface a handler/internal failure: precise in the server log for the developer,
 * warm and jargon-free in the response (never a stack trace or internals).
 */
export function internalFailure(c: Context, id: string, action: string, error: unknown): Response {
  console.error(
    `Capability ${id}/${action} failed:`,
    error instanceof Error ? error.message : error,
  );
  if (action === "create" || action === "update" || action === "delete") {
    const errorId =
      action === "create"
        ? capabilityCreateErrorId(id)
        : action === "update"
          ? capabilityEditErrorId(id)
          : capabilityDeleteErrorId(id);
    c.header("HX-Retarget", `#${errorId}`);
    c.header("HX-Reswap", "innerHTML");
    return c.html(MUTATION_FAILURE_FRAGMENT, 500);
  }
  return c.html(INTERNAL_ERROR_FRAGMENT, 500);
}
