import { type CapabilityRow, canonicalCapabilityLabel } from "../../registry/index.ts";
import { escapeHtml } from "../../server/http/html.ts";
import { renderCapabilityLogo } from "../../server/http/index.ts";
import type { CapabilityRenameOutcome } from "./front-half.ts";

/**
 * htmx will not swap a 4xx unaided, so an unmarked refusal is one nobody sees. `public/app.js`
 * speaks this on the prompt bar and swaps nothing, leaving the typed value (PLAN decision 26).
 */
export const CAPABILITY_RENAME_ERROR_CODE = "rename_refused";

/** The notice speaks on the prompt bar, away from the logo, so it names what changed. */
export function staleRenameSentence(label: string): string {
  return `${label} changed after you opened this page, so I didn't rename it. Refresh and try again?`;
}

/** No active row is left to name, and after a refresh there is nothing to try again on. */
export const DELETED_RENAME_SENTENCE =
  "That was deleted after you opened this page, so I didn't rename it.";

/**
 * Why a rename did not happen, in the product's voice and naming no internal. A bad name is worth
 * retyping. A stale one needs a refresh: the refusal swaps nothing, the editor still carries what
 * it opened on, and nothing pushes a change made elsewhere to this page.
 */
export function renderCapabilityRenameRefusal(
  outcome: Extract<CapabilityRenameOutcome, { status: "refused" | "stale" }>,
  current: CapabilityRow | null = null,
): string {
  const sentence =
    outcome.status === "refused"
      ? "That name won't work here — something short, in a few words?"
      : current === null
        ? DELETED_RENAME_SENTENCE
        : staleRenameSentence(canonicalCapabilityLabel(current));
  return `<p class="notice" data-role="error" data-error-code="${CAPABILITY_RENAME_ERROR_CODE}">${escapeHtml(sentence)}</p>`;
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
