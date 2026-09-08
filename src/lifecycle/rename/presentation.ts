import { renderCapabilityLogo } from "../../server/http/index.ts";
import type { CapabilityRenameOutcome } from "./front-half.ts";

/**
 * htmx will not swap a 4xx unaided, so an unmarked refusal is one nobody sees. `public/app.js`
 * speaks this on the prompt bar and swaps nothing, leaving the typed value (PLAN decision 26).
 */
export const CAPABILITY_RENAME_ERROR_CODE = "rename_refused";

/**
 * Why a rename did not happen, in the product's voice and naming no internal. A bad name is worth
 * retyping; one that is no longer the capability the menu opened on is not, so it asks for a look.
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
 * The logo re-rendered with its new label, and inert: a rename never enters the logo path, and a
 * faceless capability would collect a free attempt per rename. L7 forbids redrawing the artwork.
 */
export function renderRenamedCapabilityLogo(
  row: Parameters<typeof renderCapabilityLogo>[0],
): string {
  return renderCapabilityLogo(row, { armLogoAttempt: false });
}
