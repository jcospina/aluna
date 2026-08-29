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
 * one speaks through {@link renderCapabilityDeletionRefusalRestoration}.
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
  return `<button class="btn btn--neutral capability-deletion__keep" type="button" hx-get="${escapeHtml(url)}" hx-target="#spec-build-output" hx-swap="innerHTML">Keep it</button>`;
}

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
    `  <button class="btn btn--danger" type="submit">`,
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

export function renderCapabilityDeletionPreCommitFailure(
  target: Pick<CapabilityRow, "id" | "label" | "display_label_override">,
  restoredSurface: string,
): string {
  const label = canonicalCapabilityLabel(target);
  return joinRestorationWithNotice(
    restoredSurface,
    renderPromptNotice(
      `I couldn’t delete ${label}. Everything you had there is still safe.`,
      "refusal",
    ),
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

export function renderCapabilityDeletionRefusalRestoration(
  target: CapabilityRow,
  restoredSurface: string,
  refusal: CapabilityDeletionRefusal,
): string {
  const label = canonicalCapabilityLabel(target);
  const notice = (() => {
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
  })();
  return joinRestorationWithNotice(restoredSurface, renderPromptNotice(notice, "refusal"));
}

/**
 * A capability that is already gone has no page of its own left to stand on, so this
 * is not a panel: it is the neutral home state plus an explanation. Anything else
 * strands the user on a dead capability URL that 404s the moment they reload.
 */
export function renderCapabilityDeletionAlreadyGone(capabilityId: string): string {
  return [
    renderLogoRemoval(capabilityId),
    renderPromptNotice("That’s already gone, so I didn’t delete anything."),
  ].join("");
}
