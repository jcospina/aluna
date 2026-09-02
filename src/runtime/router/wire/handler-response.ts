// How a generated Handler's returned fragment becomes an HTTP answer.
//
// Two things happen between the string a Handler returns and `c.html(...)`.
//
// **It is scrubbed.** The enforcer runs on the item renderer's output inside `present()`;
// nothing looked at the wrapper markup a Handler composes around those items, which htmx
// swaps into a live page with `allowScriptTags` on. `enforceHandlerFragment` is that
// wrapper's render-time last line (src/presentation/fragment-safety.ts).
//
// **A declared refusal is read as one.** A capability authors its validation errors in
// `behavioral_errors`, and a Handler signals one by returning a fragment carrying the
// spec's own markers — `data-role="error"` plus a `data-error-code` the spec declared for
// this Action. Until now that fragment was answered as a bare 200 with `hx-swap="none"` on
// the form, so the browser could not tell a capability-declared refusal from a committed
// write: `record-mutations.js` reads htmx's `detail.successful`, true for any 2xx. The
// platform's own typed refusals escape that only because the router catches their error
// *classes* and answers 422 + `HX-Retarget` — a path a Handler's plain return value never
// entered.
//
// So a declared refusal is delivered the way the platform's own are, which also means the
// mutation's transaction rolls back: the router commits on `response.ok`, and a refusal is
// not a commit. The code must be one the *spec* declared for the *running Action* — a
// Handler cannot invent a refusal, and record data cannot spell one by accident.

import type { Context } from "hono";

import { enforceHandlerFragment } from "../../../presentation/index.ts";
import { BEHAVIORAL_ERROR_MARKERS, type CapabilitySpec } from "../../../registry/index.ts";
import { declaredRefusal } from "./failure-responses.ts";
import type { WireProtocolAction } from "./wire-protocol.ts";

export interface HandlerFragmentOutcome {
  readonly html: string;
  /** True when executable markup had to be removed — logged, never shown to the user. */
  readonly neutralized: boolean;
  /** The declared behavioral-error code this fragment refuses with, if it refuses. */
  readonly refusalCode?: string;
}

/**
 * Scrub the fragment and decide whether it is a declared refusal.
 *
 * @param spec the running capability's spec — the only source of admissible refusal codes
 */
export function readHandlerFragment(
  fragment: string,
  spec: CapabilitySpec,
  action: WireProtocolAction,
): HandlerFragmentOutcome {
  const { html, neutralized } = enforceHandlerFragment(fragment);
  const declared = declaredErrorCodes(spec, action);
  const refusalCode = declared.size === 0 ? undefined : findDeclaredRefusal(html, declared);
  return refusalCode === undefined ? { html, neutralized } : { html, neutralized, refusalCode };
}

function declaredErrorCodes(spec: CapabilitySpec, action: WireProtocolAction): ReadonlySet<string> {
  return new Set(
    spec.behavioral_errors
      .filter((errorCase) => errorCase.action === action)
      .map((errorCase) => errorCase.code),
  );
}

/**
 * The first element carrying both markers with a declared code, or `undefined`.
 *
 * Parsed rather than pattern-matched: the two markers have to be on the *same element* for
 * the shell to read them as one refusal, and a regex over the whole fragment cannot say
 * that — a record whose text happened to contain `data-role="error"` would answer for a
 * `data-error-code` written somewhere else entirely.
 */
function findDeclaredRefusal(html: string, declared: ReadonlySet<string>): string | undefined {
  let found: string | undefined;
  new HTMLRewriter()
    .on("*", {
      element(element) {
        if (found !== undefined) return;
        if (
          element.getAttribute(BEHAVIORAL_ERROR_MARKERS.role_attribute) !==
          BEHAVIORAL_ERROR_MARKERS.role
        ) {
          return;
        }
        const code = element.getAttribute(BEHAVIORAL_ERROR_MARKERS.code_attribute);
        if (code !== null && declared.has(code)) found = code;
      },
    })
    .transform(html);
  return found;
}

/**
 * Deliver a Handler's fragment: scrubbed of executable markup, and — when it carries one of
 * the capability's own declared behavioral-error markers — delivered the way the platform's
 * typed refusals are, so the browser can tell a refusal from a commit.
 */
export function answerWithHandlerFragment(
  c: Context,
  id: string,
  spec: CapabilitySpec,
  action: WireProtocolAction,
  fragment: string,
): Response {
  const outcome = readHandlerFragment(fragment, spec, action);
  if (outcome.neutralized) {
    // Precise for the developer, invisible to the user: the fragment still renders, minus
    // whatever executed. A generated Handler emitting this is a contract violation the fix
    // loop should have caught.
    console.error(
      `Capability ${id}/${action} returned executable markup; it was neutralized before the response.`,
    );
  }
  if (outcome.refusalCode !== undefined && isRefusableAction(action)) {
    return declaredRefusal(c, id, action, outcome.html);
  }
  return c.html(outcome.html);
}

/** Only a mutation has a form error region for a refusal to be retargeted into. */
function isRefusableAction(action: WireProtocolAction): action is "create" | "update" | "delete" {
  return action === "create" || action === "update" || action === "delete";
}
