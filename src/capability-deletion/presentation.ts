import type { CapabilityRow } from "../registry/index.ts";
import { canonicalCapabilityLabel } from "../registry/index.ts";
import { escapeHtml } from "../web/html.ts";

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

function renderDependencyNotice(
  targetLabel: string,
  dependents: readonly CapabilityRow[],
  authoritative: boolean,
): string {
  if (dependents.length === 0) return "";
  const names = dependentCapabilityNames(dependents);
  const copy = authoritative
    ? `${targetLabel} can’t be deleted while ${names} ${dependents.length === 1 ? "uses" : "use"} it. Change ${names} so ${dependents.length === 1 ? "it no longer uses" : "they no longer use"} ${targetLabel}, then try again.`
    : `${names} currently ${dependents.length === 1 ? "uses" : "use"} ${targetLabel}. Aluna will check again before deleting anything.`;
  return `<p class="capability-deletion__notice" data-deletion-dependency-notice>${escapeHtml(copy)}</p>`;
}

function renderDeletionPanel(
  target: Pick<CapabilityRow, "id" | "label" | "incarnation_id">,
  body: string,
  actions: string,
  status = "",
): string {
  const label = canonicalCapabilityLabel(target);
  return [
    `<section class="capability-deletion" aria-labelledby="capability-deletion-title" data-capability-deletion>`,
    `  <h1 id="capability-deletion-title" tabindex="-1" data-capability-deletion-focus>Delete ${escapeHtml(label)} permanently?</h1>`,
    `  <div class="capability-deletion__body">${body}</div>`,
    status,
    `  <div class="capability-deletion__actions">${actions}</div>`,
    `</section>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderBackAction(target: Pick<CapabilityRow, "id">): string {
  const url = capabilityUrl(target.id);
  return `<button class="btn btn--neutral capability-deletion__keep" type="button" hx-get="${escapeHtml(url)}" hx-target="#spec-build-output" hx-swap="innerHTML" hx-push-url="${escapeHtml(url)}">Keep it</button>`;
}

export function renderCapabilityDeletionConfirmation(
  target: CapabilityRow,
  dependents: readonly CapabilityRow[],
): string {
  const label = canonicalCapabilityLabel(target);
  const lossCopy =
    "This deletes all records, every past setup, saved files and anything else it owns, plus its activity history. You can’t undo this.";
  const metricsCopy = `Aluna keeps a few measurements about creating or changing ${label}, but never your content.`;
  const body = [
    `<p>${escapeHtml(lossCopy)}</p>`,
    `<p class="capability-deletion__retention">${escapeHtml(metricsCopy)}</p>`,
    renderDependencyNotice(label, dependents, false),
  ].join("");
  const actions = [
    renderBackAction(target),
    `<form method="post" hx-post="${escapeHtml(deletionUrl(target.id))}/confirm" hx-target="#spec-build-output" hx-swap="innerHTML">`,
    `  <input type="hidden" name="incarnation_id" value="${escapeHtml(target.incarnation_id)}">`,
    `  <button class="btn btn--danger" type="submit">Delete permanently</button>`,
    `</form>`,
  ].join("\n");
  return renderDeletionPanel(target, body, actions);
}

export function renderCapabilityDeletionBlocked(
  target: CapabilityRow,
  dependents: readonly CapabilityRow[],
): string {
  const label = canonicalCapabilityLabel(target);
  const body = renderDependencyNotice(label, dependents, true);
  const retry = `<button class="btn btn--neutral" type="button" hx-get="${escapeHtml(deletionUrl(target.id))}" hx-target="#spec-build-output" hx-swap="innerHTML">Check again</button>`;
  return renderDeletionPanel(target, body, `${renderBackAction(target)}\n${retry}`);
}

export function renderCapabilityDeletionBusy(target: CapabilityRow): string {
  const label = canonicalCapabilityLabel(target);
  const body = `<p>${escapeHtml(`Aluna is making another change right now, so ${label} wasn’t deleted. Try again when it’s finished.`)}</p>`;
  const retry = `<button class="btn btn--neutral" type="button" hx-get="${escapeHtml(deletionUrl(target.id))}" hx-target="#spec-build-output" hx-swap="innerHTML">Try again</button>`;
  return renderDeletionPanel(target, body, `${renderBackAction(target)}\n${retry}`);
}

export function renderCapabilityDeletionStale(target: CapabilityRow): string {
  const label = canonicalCapabilityLabel(target);
  const body = `<p>${escapeHtml(`${label} changed after you opened this page, so Aluna didn’t delete it. Review the latest version before trying again.`)}</p>`;
  const reopen = `<button class="btn btn--neutral" type="button" hx-get="${escapeHtml(deletionUrl(target.id))}" hx-target="#spec-build-output" hx-swap="innerHTML">Review again</button>`;
  return renderDeletionPanel(target, body, `${renderBackAction(target)}\n${reopen}`);
}

export function renderCapabilityDeletionReady(target: CapabilityRow): string {
  const label = canonicalCapabilityLabel(target);
  const body = `<p>${escapeHtml(`Nothing else uses ${label}. It’s ready to be deleted, but this step hasn’t removed anything yet.`)}</p>`;
  return renderDeletionPanel(
    target,
    body,
    renderBackAction(target),
    `<p class="capability-deletion__status" role="status">Ready to delete</p>`,
  );
}

export function renderCapabilityDeletionUnavailable(): string {
  return [
    `<section class="capability-deletion" aria-labelledby="capability-deletion-title" data-capability-deletion>`,
    `  <h1 id="capability-deletion-title" tabindex="-1" data-capability-deletion-focus>That part of Aluna is already gone</h1>`,
    `  <div class="capability-deletion__body"><p>This request didn’t delete anything.</p></div>`,
    `  <div class="capability-deletion__actions"><a class="btn btn--neutral" href="/">Back to Aluna</a></div>`,
    `</section>`,
  ].join("\n");
}
