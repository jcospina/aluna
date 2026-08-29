import type { CapabilityRow } from "../registry/index.ts";
import { canonicalCapabilityLabel } from "../registry/index.ts";
import { escapeHtml } from "../web/html.ts";
import { capabilityLogoElementId, renderPromptNotice } from "../web/index.ts";

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
 * The advisory preflight's dependency warning. It is deliberately *not* the refusal:
 * the authoritative answer comes from the lease-held revalidation on Confirm, and that
 * one speaks through {@link renderCapabilityDeletionRefusal}.
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
 * **Keep it** always goes back to the carried restoration, never to a guessed target.
 *
 * It carries no `hx-push-url`. The restoration route answers with `HX-Replace-Url`
 * naming where it actually landed, and a response header wins over the attribute, so the
 * attribute never decided anything. Saying it twice would only be a second place for the
 * address to be written from — and Keep it is not a navigation: the window goes back to
 * what the confirmation displaced, at the address that never moved (design D14).
 */
function renderBackAction(restoration: CapabilityDeletionRestorationEvidence): string {
  const url = capabilityDeletionRestorationUrl(restoration);
  return `<button class="btn btn--outline capability-deletion__keep" type="button" ${DELETION_EXIT_ATTRIBUTE} hx-get="${escapeHtml(url)}" hx-target="#spec-build-output" hx-swap="innerHTML">Keep it</button>`;
}

/**
 * The one mark on every way out of a deletion — **Keep it**, **Continue**, and the commit
 * itself. Each press destroys the control behind it, and two of them destroy the menu item
 * it hung on, so the shell reads this to hand the keyboard back to the desk rather than
 * dropping it on `<body>` (`public/capability-deletion.js`).
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
    // The marker lets the shell recognise a confirm submission whose response never
    // arrived. A severed request swaps nothing, so without this the panel would sit
    // there unchanged while the capability is already permanently gone.
    `<form method="post" hx-post="${escapeHtml(deletionUrl(target.id))}/confirm" hx-target="#spec-build-output" hx-swap="innerHTML" hx-disabled-elt="find button" data-capability-deletion-confirm="${escapeHtml(deletionUrl(target.id))}">`,
    `  <input type="hidden" name="incarnation_id" value="${escapeHtml(target.incarnation_id)}">`,
    `  <input type="hidden" name="restore_surface" value="${restoration.kind}">`,
    restoration.kind === "capability"
      ? `  <input type="hidden" name="restore_capability_id" value="${escapeHtml(restoration.capabilityId)}">\n  <input type="hidden" name="restore_incarnation_id" value="${escapeHtml(restoration.incarnationId)}">`
      : "",
    // A permanent deletion takes real work — drain the readers, cross the commit, clear
    // what it owns. Say so while it runs, the way the prompt bar says "Making it": the
    // control names the act in progress and stops being pressable until it lands.
    `  <button class="btn btn--danger" type="submit" ${DELETION_EXIT_ATTRIBUTE}>`,
    `    <span class="capability-deletion__label" data-deletion-idle-label>Delete permanently</span>`,
    `    <span class="capability-deletion__label" data-deletion-busy-label>Erasing…</span>`,
    `  </button>`,
    `</form>`,
  ].join("\n");
  return renderDeletionPanel(target, body, actions);
}

// The logo goes with the capability. It is the whole of what a deleted capability leaves
// on the desk, so removing it is what makes the deletion visible there.
function renderLogoRemoval(capabilityId: string): string {
  // Escaped once, at the attribute boundary. Escaping the *input* of the id builder was
  // the wrong place: the result is an htmx selector, which the HTML parser decodes back
  // before htmx reads it.
  const target = `#${capabilityLogoElementId(capabilityId)}`;
  return `<div data-capability-deletion-logo-removal hx-swap-oob="${escapeHtml(`delete:${target}`)}"></div>`;
}

/**
 * Join a restoration with its out-of-band notice without inventing primary bytes.
 * An absent restoration must leave *nothing* behind once HTMX has consumed the
 * out-of-band update: a lone separator is still a text node, and a `#spec-build-output`
 * holding one stops matching `:empty`, which shows the bordered output frame as an
 * empty bar above the prompt.
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
 * A deletion that did not happen, said in the window that asked for it.
 *
 * The confirmation filled the window, so its answer belongs in the same place rather
 * than on the prompt bar behind it (PLAN decision 20): the sentence replaces the
 * question and the window holds until the person says they have read it. Only then does
 * the restoration run — and it is the *same* restoration **Keep it** takes, re-resolved
 * at the moment of the press against the then-current registry, so a held ending can
 * never give back a capability that has gone in the meantime.
 *
 * **One sentence and one control, with no heading over them**, the way a run's ending is
 * one line and its control (`renderBuildEnding`). A heading here could only say again
 * what the sentence says — and the stale refusal would have had it assert the capability
 * is unchanged in the same breath as the sentence saying it changed. The sentence is what
 * the window is for, so the sentence is what takes the keyboard: it is read out on
 * arrival rather than a title invented to sit above it.
 *
 * **Continue**, the way a held build ending names its control: this is the person saying
 * they have read it, and every control in the product names the act from their side.
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
 * Every way a deletion is turned down while everything it would have destroyed is still
 * there. `drain_timeout` — the refusal `destroyCapability`'s `deletion_drain_timeout`
 * outcome renders as — is a member in its own right rather than a shade of the generic
 * failure, because "something was still finishing" is a different thing to be told than
 * "it didn’t work", and it invites a retry the others do not.
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
 * A capability that is already gone has no page of its own left to stand on, so this is
 * not a panel and not an ending: there is nothing to hold and nothing to decide. It is
 * the answer, plus whatever the question displaced — an unrelated capability that was
 * open goes back where it was, because a deletion may never close a capability it was
 * not about, and with nothing behind it the window puts itself away. Anything else
 * strands the user on a dead capability URL that 404s the moment they reload.
 */
export function renderCapabilityDeletionAlreadyGone(
  capabilityId: string,
  restoredSurface = "",
): string {
  return joinRestorationWithNotice(
    restoredSurface,
    [
      renderLogoRemoval(capabilityId),
      renderPromptNotice("That’s already gone, so I didn’t delete anything."),
    ].join(""),
  );
}
