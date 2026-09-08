// Every product-voice failure and refusal the router answers with (CONTEXT.md
// "Product voice", ARCH §9.7).
//
// Two rules hold across all of them. The copy never names an internal — no "handler",
// "action", "capability", "route" — because the user need not, and must not, learn which
// check failed. And any refusal the shell is expected to *show* carries a
// `data-error-code`: htmx will not swap a 4xx unaided, so an unmarked refusal body is one
// the user never sees (see the rescue list in `public/app.js`).

import type { Context } from "hono";
import {
  capabilityCreateErrorId,
  capabilityDeleteErrorId,
  capabilityEditErrorId,
} from "../../../presentation/index.ts";
import { escapeHtml } from "../../../server/http/html.ts";
import { NOT_FOUND_NOTICE } from "../../../server/http/index.ts";
import { ReadGateClosingError } from "../../concurrency/read-gates.ts";
import type {
  ChoiceDisabledError,
  InvalidChoiceError,
  MaxLengthExceededError,
  MissingRequiredFieldsError,
  RecordNotFoundError,
} from "../../data/index.ts";
import type { WireProtocolAction } from "./wire-protocol.ts";

type MutationAction = "create" | "update" | "delete";

// Carries `data-error-code` because htmx refuses to swap a 4xx by default: the rescue in
// `public/app.js` needs the marker, or this copy is written and never reaches a screen.
export const READ_UNAVAILABLE_FRAGMENT =
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
      '<p class="notice" data-role="error" data-error-code="read_unavailable">I’m making a careful change here. Give me a moment, then try that again.</p>',
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
    '<p class="notice" data-role="error" data-error-code="mutation_busy">I’m still putting something together. Give me a moment, then try that again.</p>',
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
 * A capability's own declared refusal, delivered as the platform's typed ones are: 422, retargeted
 * into the form's error region. A bare 200 under `hx-swap="none"` read to the client as a commit.
 */
export function declaredRefusal(
  c: Context,
  capabilityId: string,
  action: MutationAction,
  fragment: string,
): Response {
  retargetMutationError(c, capabilityId, action);
  return c.html(fragment, 422);
}

/**
 * Product-voice failures (CONTEXT.md). One copy for an unknown capability and an undeclared
 * action, so nobody learns which check failed.
 */
export const NOT_FOUND_FRAGMENT = `<p class="notice" data-role="error" data-error-code="not_found">${NOT_FOUND_NOTICE}</p>`;
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
  const fields = escapeHtml(error.fields.join(" "));
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

/**
 * An undeclared choice value, refused with the affected field named. The picker only offers
 * admitted options, so reaching this means the submission did not come from the platform's form.
 */
export function invalidChoiceFailure(
  c: Context,
  capabilityId: string,
  error: InvalidChoiceError,
): Response {
  const fields = escapeHtml(error.fields.join(" "));
  const errorId =
    error.action === "create"
      ? capabilityCreateErrorId(capabilityId)
      : capabilityEditErrorId(capabilityId);
  c.header("HX-Retarget", `#${errorId}`);
  c.header("HX-Reswap", "innerHTML");
  return c.html(
    `<p class="notice" data-role="error" data-error-code="${error.code}" data-error-fields="${fields}">` +
      "That isn't one of the options I can store here. Mind picking one from the list?</p>",
    422,
  );
}

/**
 * A newly chosen option the field no longer offers. Unlike the undeclared-value refusal beside it
 * the value is real, so the sentence says the option closed rather than that the value is wrong.
 */
export function choiceDisabledFailure(
  c: Context,
  capabilityId: string,
  error: ChoiceDisabledError,
): Response {
  const fields = escapeHtml(error.fields.join(" "));
  const errorId =
    error.action === "create"
      ? capabilityCreateErrorId(capabilityId)
      : capabilityEditErrorId(capabilityId);
  c.header("HX-Retarget", `#${errorId}`);
  c.header("HX-Reswap", "innerHTML");
  return c.html(
    `<p class="notice" data-role="error" data-error-code="${error.code}" data-error-fields="${fields}">` +
      "That option isn't open any more. Mind picking a different one?</p>",
    422,
  );
}

/**
 * A string longer than the field said it had room for. The native attribute stops this on a filled
 * form, so the sentence is written for a value that arrived past the control.
 */
export function maxLengthExceededFailure(
  c: Context,
  capabilityId: string,
  error: MaxLengthExceededError,
): Response {
  const fields = escapeHtml(error.fields.join(" "));
  const errorId =
    error.action === "create"
      ? capabilityCreateErrorId(capabilityId)
      : capabilityEditErrorId(capabilityId);
  c.header("HX-Retarget", `#${errorId}`);
  c.header("HX-Reswap", "innerHTML");
  return c.html(
    `<p class="notice" data-role="error" data-error-code="${error.code}" data-error-fields="${fields}">` +
      "That's longer than this field holds. Mind trimming it a little?</p>",
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
