// How a generated Handler's returned fragment becomes an HTTP answer. Two things happen to it.
//
// It is scrubbed. The enforcer runs on the item renderer's output inside `present()`, and nothing
// looked at the wrapper markup a Handler composes around those items, which htmx swaps into a live
// page with `allowScriptTags` on. `enforceHandlerFragment` is that wrapper's render-time last line.
//
// And a declared refusal is read as one. A Handler signals a `behavioral_errors` refusal by
// returning a fragment carrying the spec's markers; answered as a bare 200 under `hx-swap="none"`,
// `record-mutations.js` could not tell it from a commit, reading htmx's `detail.successful`.
// Delivering it as the platform's own 422 also rolls the mutation back, because the router commits
// on `response.ok`. The code must be one the spec declared for the running Action, so a Handler
// cannot invent a refusal and record data cannot spell one by accident.

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
 * The first element carrying both markers with a declared code, or `undefined`. Parsed rather
 * than pattern-matched: a regex cannot say the two markers sit on the *same* element.
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
 * Deliver a Handler's fragment, scrubbed, and as a platform refusal when it carries a declared
 * marker. `countSidecar` reads the scrubbed fragment; the enforcer's subject is the model's markup.
 */
export function answerWithHandlerFragment(
  c: Context,
  id: string,
  spec: CapabilitySpec,
  action: WireProtocolAction,
  fragment: string,
  countSidecar: (html: string) => string,
): Response {
  const outcome = readHandlerFragment(fragment, spec, action);
  if (outcome.neutralized) {
    // Precise for the developer, invisible to the user: the fragment still renders minus whatever
    // executed. A Handler emitting this is a contract violation the fix loop should have caught.
    console.error(
      `Capability ${id}/${action} returned executable markup; it was neutralized before the response.`,
    );
  }
  if (outcome.refusalCode !== undefined && isRefusableAction(action)) {
    return declaredRefusal(c, id, action, outcome.html);
  }
  return c.html(`${countSidecar(outcome.html)}${outcome.html}`);
}

/** Only a mutation has a form error region for a refusal to be retargeted into. */
function isRefusableAction(action: WireProtocolAction): action is "create" | "update" | "delete" {
  return action === "create" || action === "update" || action === "delete";
}
