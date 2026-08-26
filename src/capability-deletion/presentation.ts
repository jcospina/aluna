import type { CapabilityRow } from "../registry/index.ts";
import { canonicalCapabilityLabel } from "../registry/index.ts";
import { escapeHtml } from "../web/html.ts";
import { capabilityLogoElementId } from "../web/index.ts";

function deletionUrl(capabilityId: string): string {
  return `/capability-deletion/${encodeURIComponent(capabilityId)}`;
}

function capabilityUrl(capabilityId: string): string {
  return `/capability/${encodeURIComponent(capabilityId)}`;
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
  target: Pick<CapabilityRow, "id" | "label" | "incarnation_id">,
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

/** **Keep it** always goes back to the carried restoration, never to a guessed target. */
function renderBackAction(restoration: CapabilityDeletionRestorationEvidence): string {
  const url = capabilityDeletionRestorationUrl(restoration);
  const pushedUrl =
    restoration.kind === "capability" ? capabilityUrl(restoration.capabilityId) : "/";
  return `<button class="btn btn--neutral capability-deletion__keep" type="button" hx-get="${escapeHtml(url)}" hx-target="#spec-build-output" hx-swap="innerHTML" hx-push-url="${escapeHtml(pushedUrl)}">Keep it</button>`;
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
  target: Pick<CapabilityRow, "id" | "label">,
  restoredSurface: string,
  cleanupPending: boolean,
): string {
  const label = canonicalCapabilityLabel(target);
  const notice = cleanupPending
    ? `I deleted ${label} permanently. It won’t come back, even though I still have a little tidying up to do.`
    : `I deleted ${label} permanently.`;
  const outOfBandUpdates = [
    renderLogoRemoval(target.id),
    `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml(notice)}</div>`,
  ];
  return joinRestorationWithNotice(restoredSurface, outOfBandUpdates.join(""));
}

export function renderCapabilityDeletionPreCommitFailure(
  target: Pick<CapabilityRow, "id" | "label">,
  restoredSurface: string,
): string {
  const label = canonicalCapabilityLabel(target);
  return joinRestorationWithNotice(
    restoredSurface,
    `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml(`I couldn’t delete ${label}. Everything you had there is still safe.`)}</div>`,
  );
}

export function renderCapabilityDeletionRefusalRestoration(
  target: CapabilityRow,
  restoredSurface: string,
  refusal:
    | { readonly kind: "blocked"; readonly dependents: readonly CapabilityRow[] }
    | { readonly kind: "busy" }
    | { readonly kind: "stale" },
): string {
  const label = canonicalCapabilityLabel(target);
  const notice = (() => {
    if (refusal.kind === "busy") {
      return `I’m making another change right now, so I didn’t delete ${label}. Try again when I’m finished.`;
    }
    if (refusal.kind === "stale") {
      return `${label} changed after you opened this page, so I didn’t delete it.`;
    }
    const names = dependentCapabilityNames(refusal.dependents);
    return `I can’t delete ${label} while ${names} ${refusal.dependents.length === 1 ? "uses" : "use"} it.`;
  })();
  return joinRestorationWithNotice(
    restoredSurface,
    `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml(notice)}</div>`,
  );
}

/**
 * A capability that is already gone has no page of its own left to stand on, so this
 * is not a panel: it is the neutral home state plus an explanation. Anything else
 * strands the user on a dead capability URL that 404s the moment they reload.
 */
export function renderCapabilityDeletionAlreadyGone(capabilityId: string): string {
  return [
    renderLogoRemoval(capabilityId),
    `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml("That’s already gone, so I didn’t delete anything.")}</div>`,
  ].join("");
}
