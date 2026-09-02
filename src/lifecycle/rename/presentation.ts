import { renderCapabilityLogo } from "../../web/index.ts";
import type { CapabilityRenameOutcome } from "./front-half.ts";

/**
 * The marker every rename refusal wears.
 *
 * htmx will not swap a 4xx unaided, so an unmarked refusal body is one nobody ever sees
 * (`src/runtime/router/wire/failure-responses.ts` says the same of its own). The shell's rescue list
 * in `public/app.js` recognises this code, reads the sentence out of it, and — because
 * the rename asked from the desk rather than from inside the window — speaks it on the
 * prompt bar and swaps nothing (PLAN decision 26). Swapping nothing is what leaves the
 * editor holding the typed value, still focused, with a second try one keystroke away.
 */
export const CAPABILITY_RENAME_ERROR_CODE = "rename_refused";

/**
 * Why a rename did not happen, in the product's voice and naming no internal.
 *
 * Two sentences for two different truths. A name that will not do is about the name and
 * is worth trying again with a different one. A capability that is no longer the one the
 * menu opened on — evolved, deleted, or deleted and rebuilt — is not something to retype
 * past, so it says what happened and asks the person to look.
 */
export function renderCapabilityRenameRefusal(
  outcome: Extract<CapabilityRenameOutcome, { status: "refused" | "stale" }>,
): string {
  const sentence =
    outcome.status === "refused"
      ? "That name won’t work here — something short, in a few words?"
      : "That changed while I was getting to it, so I stopped rather than guess. Have a look and tell me again?";
  return `<p class="notice" data-role="error" data-error-code="${CAPABILITY_RENAME_ERROR_CODE}">${sentence}</p>`;
}

/**
 * What the desk gets back when the name is written: the logo, re-rendered, carrying its
 * new effective label.
 *
 * **Inert**, for the reason evolution's replacement is: a rename never enters the logo
 * path, and a still-faceless capability would otherwise collect a free extra attempt for
 * every rename. The artwork is untouched either way — L7 forbids redrawing it — so what
 * changes here is the name written under the same picture and nothing else.
 */
export function renderRenamedCapabilityLogo(
  row: Parameters<typeof renderCapabilityLogo>[0],
): string {
  return renderCapabilityLogo(row, { armLogoAttempt: false });
}
