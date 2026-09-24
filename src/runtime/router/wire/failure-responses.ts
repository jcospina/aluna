// Every product-voice failure and refusal the router answers with (CONTEXT.md
// "Product voice", ARCH §9.7).
//
// Two rules hold across all of them. The copy never names an internal — no "handler",
// "action", "capability", "route" — because the user need not, and must not, learn which
// check failed. And any refusal the shell is expected to *show* carries a
// `data-error-code`: htmx will not swap a 4xx unaided, so an unmarked refusal body is one
// the user never sees (see the rescue list in `public/app.js`).
//
// Both rules are mechanical here rather than remembered: every shown refusal is built by
// `refusalFragment` from the marker vocabulary generated handlers are held to, and every
// mutation refusal retargets through `retargetMutationError`. A hand-written copy is how one
// comes to be missed.

import type { Context } from "hono";
import { errorDetail } from "../../../platform/errors.ts";
import { ADD_FILE_AGAIN_SENTENCE } from "../../../platform/files/refusal-copy.ts";
import {
  capabilityCreateErrorId,
  capabilityDeleteErrorId,
  capabilityEditErrorId,
} from "../../../presentation/index.ts";
import { BEHAVIORAL_ERROR_MARKERS } from "../../../registry/index.ts";
import { escapeHtml } from "../../../server/http/html.ts";
import { NOT_FOUND_NOTICE } from "../../../server/http/index.ts";
import { ReadGateClosingError } from "../../concurrency/read-gates.ts";
import type {
  ChoiceDisabledError,
  InvalidChoiceError,
  InvalidFileReferenceError,
  MaxLengthExceededError,
  MissingRequiredFieldsError,
  RecordChangedError,
  RecordNotFoundError,
} from "../../data/index.ts";
import type { WireProtocolAction } from "./wire-protocol.ts";

type MutationAction = "create" | "update" | "delete";

/**
 * The refusal codes the platform itself emits, as opposed to the ones a capability declares.
 * `public/app.js` carries them as literals because a classic script can import nothing; a test
 * holds that list to this one.
 */
export const READ_UNAVAILABLE_ERROR_CODE = "read_unavailable";
export const MUTATION_BUSY_ERROR_CODE = "mutation_busy";
export const MUTATION_FAILED_ERROR_CODE = "mutation_failed";
export const NOT_FOUND_ERROR_CODE = "not_found";

/**
 * One shown refusal, marked the way a generated handler's own refusals are marked. Building it
 * from `BEHAVIORAL_ERROR_MARKERS` is what keeps the platform's copies and the generated ones
 * speaking the same attribute vocabulary.
 */
function refusalFragment(code: string, copy: string, fields?: readonly string[]): string {
  const { role_attribute, role, code_attribute, fields_attribute, fields_separator } =
    BEHAVIORAL_ERROR_MARKERS;
  const named =
    fields === undefined
      ? ""
      : ` ${fields_attribute}="${escapeHtml(fields.join(fields_separator))}"`;
  return `<p class="notice" ${role_attribute}="${role}" ${code_attribute}="${code}"${named}>${copy}</p>`;
}

const READ_UNAVAILABLE_COPY =
  "I’m making a careful change here. Give me a moment, then try that again.";

// Carries `data-error-code` because htmx refuses to swap a 4xx by default: the rescue in
// `public/app.js` needs the marker, or this copy is written and never reaches a screen.
export const READ_UNAVAILABLE_FRAGMENT = refusalFragment(
  READ_UNAVAILABLE_ERROR_CODE,
  READ_UNAVAILABLE_COPY,
);

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
    return c.html(READ_UNAVAILABLE_FRAGMENT, 422);
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
    refusalFragment(
      MUTATION_BUSY_ERROR_CODE,
      "I’m still putting something together. Give me a moment, then try that again.",
    ),
    422,
  );
}

/**
 * Aim a refusal at the region the action's own form shows errors in. The typed validation
 * failures below all carry `action: "create" | "update"`, so the delete branch is theirs only if
 * a delete-shaped validation error is ever added — which is a decision, not a default.
 */
function retargetMutationError(c: Context, capabilityId: string, action: MutationAction): void {
  if (action === "create") c.header("HX-Retarget", `#${capabilityCreateErrorId(capabilityId)}`);
  else if (action === "update") c.header("HX-Retarget", `#${capabilityEditErrorId(capabilityId)}`);
  else c.header("HX-Retarget", `#${capabilityDeleteErrorId(capabilityId)}`);
  c.header("HX-Reswap", "innerHTML");
}

function isMutationAction(action: string): action is MutationAction {
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
export const NOT_FOUND_FRAGMENT = refusalFragment(NOT_FOUND_ERROR_CODE, NOT_FOUND_NOTICE);
export const INTERNAL_ERROR_FRAGMENT =
  '<p class="notice">Hmm, something went sideways on my end just now. Mind trying again?</p>';
export const MUTATION_FAILURE_FRAGMENT = refusalFragment(
  MUTATION_FAILED_ERROR_CODE,
  "Hmm, something went sideways on my end just now. Mind trying again?",
);
export const WIRE_PROTOCOL_ERROR_FRAGMENT =
  '<p class="notice">Hmm — I couldn\'t make sense of that submission. Mind trying again?</p>';

export function missingRequiredFieldsFailure(
  c: Context,
  capabilityId: string,
  error: MissingRequiredFieldsError,
): Response {
  retargetMutationError(c, capabilityId, error.action);
  const copy =
    error.action === "create"
      ? "I still need a little more before I can add this."
      : "I still need a little more before I can save this.";
  return c.html(refusalFragment(error.code, copy, error.fields), 422);
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
  retargetMutationError(c, capabilityId, error.action);
  return c.html(
    refusalFragment(
      error.code,
      "That isn't one of the options I can store here. Mind picking one from the list?",
      error.fields,
    ),
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
  retargetMutationError(c, capabilityId, error.action);
  return c.html(
    refusalFragment(
      error.code,
      "That option isn't open any more. Mind picking a different one?",
      error.fields,
    ),
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
  retargetMutationError(c, capabilityId, error.action);
  return c.html(
    refusalFragment(
      error.code,
      "That's longer than this field holds. Mind trimming it a little?",
      error.fields,
    ),
    422,
  );
}

/**
 * A file the save may not claim: gone before the save, another field's, or already saved. Each
 * reason has the same remedy, adding the file in this field, so one sentence asks for that.
 */
export function invalidFileReferenceFailure(
  c: Context,
  capabilityId: string,
  error: InvalidFileReferenceError,
): Response {
  retargetMutationError(c, capabilityId, error.action);
  return c.html(refusalFragment(error.code, ADD_FILE_AGAIN_SENTENCE, error.fields), 422);
}

/**
 * An edit whose file field no longer matches what its record holds: another window saved the field
 * after this form was drawn. Nothing was written, and opening the entry again shows what it holds.
 */
export function recordChangedFailure(
  c: Context,
  capabilityId: string,
  error: RecordChangedError,
): Response {
  retargetMutationError(c, capabilityId, error.action);
  return c.html(
    refusalFragment(
      error.code,
      "This entry changed in another window. Mind opening it again?",
      error.fields,
    ),
    422,
  );
}

export function recordNotFoundFailure(
  c: Context,
  capabilityId: string,
  action: WireProtocolAction,
  error: RecordNotFoundError,
): Response {
  // Not `create`: there is no record to miss on the way in, and the create form has no region
  // this belongs in.
  if (action === "update" || action === "delete") {
    retargetMutationError(c, capabilityId, action);
  }
  return c.html(
    refusalFragment(error.code, "I couldn’t find that entry anymore. It may already be gone."),
    404,
  );
}

/**
 * Surface a handler/internal failure: precise in the server log for the developer,
 * warm and jargon-free in the response (never a stack trace or internals).
 */
export function internalFailure(c: Context, id: string, action: string, error: unknown): Response {
  console.error(`Capability ${id}/${action} failed:`, errorDetail(error));
  if (isMutationAction(action)) {
    retargetMutationError(c, id, action);
    return c.html(MUTATION_FAILURE_FRAGMENT, 500);
  }
  return c.html(INTERNAL_ERROR_FRAGMENT, 500);
}
