import type { CapabilityRow } from "../../registry/index.ts";
import { canonicalCapabilityLabel, SQL_NAME_PATTERN } from "../../registry/index.ts";
import { escapeHtml } from "../../server/http/html.ts";
import { capabilityLogoElementId, renderPromptNotice } from "../../server/http/index.ts";

function deletionUrl(capabilityId: string): string {
  return `/capability-deletion/${encodeURIComponent(capabilityId)}`;
}

function sentenceList(labels: readonly string[]): string {
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1) ?? ""}`;
}

export function dependentCapabilityNames(dependents: readonly CapabilityRow[]): string {
  return sentenceList(dependents.map(canonicalCapabilityLabel));
}

/**
 * The advisory preflight's dependency warning, not the refusal: the lease-held revalidation on
 * Confirm is authoritative, and speaks through {@link renderCapabilityDeletionRefusal}.
 */
function renderDependencyNotice(targetLabel: string, dependents: readonly CapabilityRow[]): string {
  if (dependents.length === 0) return "";
  const names = dependentCapabilityNames(dependents);
  const copy = `${names} currently ${dependents.length === 1 ? "uses" : "use"} ${targetLabel}. I’ll check again before deleting anything.`;
  return `<p class="capability-deletion__notice" data-deletion-dependency-notice>${escapeHtml(copy)}</p>`;
}

function renderDeletionPanel(
  target: Pick<CapabilityRow, "id" | "label" | "display_label_override" | "incarnation_id">,
  body: string,
  actions: string,
): string {
  const label = canonicalCapabilityLabel(target);
  return [
    `<section class="capability-deletion" aria-labelledby="capability-deletion-title" data-capability-deletion>`,
    `  <h1 id="capability-deletion-title" tabindex="-1" data-capability-deletion-focus>Delete ${escapeHtml(label)} permanently?</h1>`,
    `  <div class="capability-deletion__body">${body}</div>`,
    `  <div class="capability-deletion__actions">${actions}</div>`,
    `</section>`,
  ].join("\n");
}

/**
 * **Keep it** goes back to the carried restoration, never a guessed target, and carries no
 * `hx-push-url`: the restoration route's `HX-Replace-Url` wins over the attribute (design D14).
 */
function renderBackAction(restoration: CapabilityDeletionRestorationEvidence): string {
  const url = capabilityDeletionRestorationUrl(restoration);
  return `<button class="btn btn--outline capability-deletion__keep" type="button" ${DELETION_EXIT_ATTRIBUTE} hx-get="${escapeHtml(url)}" hx-target="#spec-build-output" hx-swap="innerHTML">Keep it</button>`;
}

/**
 * The mark on every way out of a deletion — **Keep it**, **Continue**, the commit. Each press
 * destroys its control, so `public/capability-deletion.js` hands the keyboard back to the desk.
 */
export const DELETION_EXIT_ATTRIBUTE = "data-capability-deletion-exit";

/**
 * The ending's own two marks: the panel that holds the window, and the sentence inside it
 * that the shell carries to the prompt bar if the window goes before it is read.
 */
export const DELETION_ENDING_ATTRIBUTE = "data-capability-deletion-ending";
export const DELETION_SENTENCE_ATTRIBUTE = "data-capability-deletion-sentence";

function capabilityDeletionRestorationUrl(
  restoration: CapabilityDeletionRestorationEvidence,
): string {
  const query = new URLSearchParams({ restore_surface: restoration.kind });
  if (restoration.kind === "capability") {
    query.set("restore_capability_id", restoration.capabilityId);
    query.set("restore_incarnation_id", restoration.incarnationId);
  }
  return `/capability-deletion-restoration?${query.toString()}`;
}

export type CapabilityDeletionRestorationEvidence =
  | { readonly kind: "neutral" }
  | {
      readonly kind: "capability";
      readonly capabilityId: string;
      readonly incarnationId: string;
    };

export function renderCapabilityDeletionConfirmation(
  target: CapabilityRow,
  dependents: readonly CapabilityRow[],
  restoration: CapabilityDeletionRestorationEvidence = {
    kind: "capability",
    capabilityId: target.id,
    incarnationId: target.incarnation_id,
  },
): string {
  const label = canonicalCapabilityLabel(target);
  const lossCopy =
    "This deletes all records, every past setup, saved files and anything else it owns, plus its activity history. You can’t undo this.";
  const metricsCopy = `I keep a few measurements about creating or changing ${label}, but never your content.`;
  const body = [
    `<p>${escapeHtml(lossCopy)}</p>`,
    `<p class="capability-deletion__retention">${escapeHtml(metricsCopy)}</p>`,
    renderDependencyNotice(label, dependents),
  ].join("");
  const actions = [
    renderBackAction(restoration),
    // The marker lets the shell recognise a confirm whose response never arrived: a severed request
    // swaps nothing, so the panel would sit unchanged while the capability is permanently gone.
    `<form method="post" hx-post="${escapeHtml(deletionUrl(target.id))}/confirm" hx-target="#spec-build-output" hx-swap="innerHTML" hx-disabled-elt="find button" data-capability-deletion-confirm="${escapeHtml(deletionUrl(target.id))}">`,
    `  <input type="hidden" name="incarnation_id" value="${escapeHtml(target.incarnation_id)}">`,
    `  <input type="hidden" name="restore_surface" value="${restoration.kind}">`,
    restoration.kind === "capability"
      ? `  <input type="hidden" name="restore_capability_id" value="${escapeHtml(restoration.capabilityId)}">\n  <input type="hidden" name="restore_incarnation_id" value="${escapeHtml(restoration.incarnationId)}">`
      : "",
    // A permanent deletion drains readers, crosses the commit, clears what it owns. Say so while it
    // runs, the way the prompt bar says "Making it", and stop the control being pressed twice.
    `  <button class="btn btn--danger" type="submit" ${DELETION_EXIT_ATTRIBUTE}>`,
    `    <span class="capability-deletion__label" data-deletion-idle-label>Delete permanently</span>`,
    `    <span class="capability-deletion__label" data-deletion-busy-label>Erasing…</span>`,
    `  </button>`,
    `</form>`,
  ].join("\n");
  return renderDeletionPanel(target, body, actions);
}

// The id must be a *capability id* before it becomes a selector: on the already-gone branch no
// row proved it, and `escapeHtml` passes `capability-logo-x, body`, which htmx would delete too.
function renderLogoRemoval(capabilityId: string): string {
  if (!SQL_NAME_PATTERN.test(capabilityId)) return "";
  // Escaped once, at the attribute boundary. Escaping the id builder's *input* was wrong: the
  // result is an htmx selector, which the HTML parser decodes back before htmx reads it.
  const target = `#${capabilityLogoElementId(capabilityId)}`;
  return `<div data-capability-deletion-logo-removal hx-swap-oob="${escapeHtml(`delete:${target}`)}"></div>`;
}

/**
 * Join a restoration with its out-of-band notice without inventing primary bytes: a lone separator
 * is a text node, and `#spec-build-output` holding one stops matching `:empty` — an empty bar.
 */
function joinRestorationWithNotice(restoredSurface: string, notice: string): string {
  return restoredSurface ? `${restoredSurface}\n${notice}` : notice;
}

export function renderCapabilityDeletionCommitted(
  target: Pick<CapabilityRow, "id" | "label" | "display_label_override">,
  restoredSurface: string,
  cleanupPending: boolean,
): string {
  const label = canonicalCapabilityLabel(target);
  const notice = cleanupPending
    ? `I deleted ${label} permanently. It won’t come back, even though I still have a little tidying up to do.`
    : `I deleted ${label} permanently.`;
  const outOfBandUpdates = [renderLogoRemoval(target.id), renderPromptNotice(notice)];
  return joinRestorationWithNotice(restoredSurface, outOfBandUpdates.join(""));
}

/**
 * A deletion that did not happen, said in the window that asked (PLAN decision 20). No heading
 * over the sentence: it takes the keyboard itself, read out on arrival; Continue names the act.
 */
function renderCapabilityDeletionEnding(
  sentence: string,
  restoration: CapabilityDeletionRestorationEvidence,
): string {
  const url = capabilityDeletionRestorationUrl(restoration);
  return [
    `<section class="capability-deletion capability-deletion--ending" aria-labelledby="${DELETION_ENDING_ELEMENT_ID}" ${DELETION_ENDING_ATTRIBUTE}>`,
    `  <p class="capability-deletion__ending" id="${DELETION_ENDING_ELEMENT_ID}" tabindex="-1" data-capability-deletion-focus ${DELETION_SENTENCE_ATTRIBUTE}>${escapeHtml(sentence)}</p>`,
    `  <div class="capability-deletion__actions"><button class="btn btn--outline" type="button" ${DELETION_EXIT_ATTRIBUTE} hx-get="${escapeHtml(url)}" hx-target="#spec-build-output" hx-swap="innerHTML">Continue</button></div>`,
    `</section>`,
  ].join("\n");
}

/** The sentence is the ending's own accessible name, so it is addressable. */
const DELETION_ENDING_ELEMENT_ID = "capability-deletion-ending";

export function renderCapabilityDeletionPreCommitFailure(
  target: Pick<CapabilityRow, "id" | "label" | "display_label_override">,
  restoration: CapabilityDeletionRestorationEvidence,
): string {
  const label = canonicalCapabilityLabel(target);
  return renderCapabilityDeletionEnding(
    `I couldn’t delete ${label}. Everything you had there is still safe.`,
    restoration,
  );
}

/**
 * Every way a deletion is turned down with everything it would have destroyed still there;
 * `drain_timeout` renders `destroyCapability`'s outcome of the same name, and invites a retry.
 */
export type CapabilityDeletionRefusal =
  | { readonly kind: "blocked"; readonly dependents: readonly CapabilityRow[] }
  | { readonly kind: "busy" }
  | { readonly kind: "drain_timeout" }
  | { readonly kind: "stale" };

/** The four authored sentences, one per way a deletion is turned down. */
function capabilityDeletionRefusalSentence(
  target: Pick<CapabilityRow, "id" | "label" | "display_label_override">,
  refusal: CapabilityDeletionRefusal,
): string {
  const label = canonicalCapabilityLabel(target);
  if (refusal.kind === "busy") {
    return `I’m making another change right now, so I didn’t delete ${label}. Try again when I’m finished.`;
  }
  if (refusal.kind === "drain_timeout") {
    return `Something in ${label} was still finishing, so I didn’t delete it. Everything you had there is still safe — try again in a moment.`;
  }
  if (refusal.kind === "stale") {
    return `${label} changed after you opened this page, so I didn’t delete it.`;
  }
  const names = dependentCapabilityNames(refusal.dependents);
  return `I can’t delete ${label} while ${names} ${refusal.dependents.length === 1 ? "uses" : "use"} it.`;
}

export function renderCapabilityDeletionRefusal(
  target: CapabilityRow,
  refusal: CapabilityDeletionRefusal,
  restoration: CapabilityDeletionRestorationEvidence,
): string {
  return renderCapabilityDeletionEnding(
    capabilityDeletionRefusalSentence(target, refusal),
    restoration,
  );
}

/**
 * Already gone: no panel, no ending, nothing to hold or decide. The answer plus whatever the
 * question displaced, because a deletion may never close a capability it was not about.
 */
export function renderCapabilityDeletionAlreadyGone(
  capabilityId: string,
  restoredSurface = "",
  after: CapabilityDeletionAbsence = "never-asked",
): string {
  return joinRestorationWithNotice(
    restoredSurface,
    [renderLogoRemoval(capabilityId), renderPromptNotice(ABSENCE_NOTICE[after])].join(""),
  );
}

/**
 * `never-asked`: a tile a second tab already deleted, so "I didn't delete anything" is true.
 * `after-confirm`: a Confirm whose reply never arrived, which may itself have crossed the commit.
 */
export type CapabilityDeletionAbsence = "never-asked" | "after-confirm";

/**
 * The query flag the client's recovery marks its preflight with (`public/capability-deletion.js`),
 * so the answer can tell the two absences apart. A platform test pins the two copies together.
 */
export const DELETION_RECHECK_PARAM = "after_confirm";

const ABSENCE_NOTICE: Readonly<Record<CapabilityDeletionAbsence, string>> = {
  "never-asked": "That’s already gone, so I didn’t delete anything.",
  "after-confirm":
    "It’s gone. I couldn’t tell you at the time, but there’s nothing left there now.",
};
