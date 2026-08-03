// Developer-only living preview for per-incarnation read admission (4.9/01).

import { escapeHtml } from "../web/html.ts";
import type { ReadGateSnapshotEntry } from "./index.ts";

export interface ReadGatePreviewCapability {
  readonly id: string;
  readonly incarnationId: string;
  readonly label: string;
}

function pollingAttributes(): string {
  return 'hx-get="/demo/read-gates/state" hx-trigger="load, every 400ms" hx-swap="outerHTML"';
}

export function renderReadGateSnapshot(
  snapshot: readonly ReadGateSnapshotEntry[],
  capabilities: readonly ReadGatePreviewCapability[],
): string {
  const labels = new Map(capabilities.map(({ id, label }) => [id, label]));
  const rows = snapshot
    .map(
      (entry) => `<tr>
        <td>${escapeHtml(labels.get(entry.capabilityId) ?? entry.capabilityId)}</td>
        <td><code>${escapeHtml(entry.incarnationId)}</code></td>
        <td><span class="gate-state gate-state--${entry.state}">${entry.state}</span></td>
        <td>${entry.readerCount}</td>
      </tr>`,
    )
    .join("");
  const body = rows || '<tr><td colspan="4">No active capability incarnations yet.</td></tr>';
  return `<div id="read-gate-snapshot" ${pollingAttributes()}>
    <table>
      <thead><tr><th>Capability</th><th>Incarnation</th><th>Gate</th><th>Readers</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function capabilityExercise(capability: ReadGatePreviewCapability): string {
  const id = encodeURIComponent(capability.id);
  return `<article class="exercise-card">
    <h2>${escapeHtml(capability.label)}</h2>
    <p><code>${escapeHtml(capability.incarnationId)}</code></p>
    <div class="exercise-actions">
      <a class="button" href="/capability/${id}" target="_blank" rel="noreferrer">Browse capability</a>
      <button class="button" type="button" hx-post="/demo/read-gates/${id}/hold" hx-target="#exercise-result">Hold a reader</button>
      <button class="button" type="button" hx-post="/demo/read-gates/${id}/close" hx-target="#exercise-result">Exercise close/reopen</button>
    </div>
  </article>`;
}

export function renderReadGatePreviewPage(
  capabilities: readonly ReadGatePreviewCapability[],
  snapshot: readonly ReadGateSnapshotEntry[],
): string {
  const exercises = capabilities.map(capabilityExercise).join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Aluna - read gate preview</title>
    <link rel="stylesheet" href="/static/app.css">
    <script defer src="/static/vendor/htmx.min.js"></script>
    <style>
      body { height: auto; min-height: 100dvh; max-width: 72rem; margin-inline: auto; padding: var(--space-4); }
      .preview-banner { margin: 0 0 var(--space-2); font: var(--meta); color: var(--color-text-muted); }
      h1 { margin-block: 0 var(--space-1); font: var(--h2); }
      .preview-note { max-width: 52rem; margin: 0 0 var(--space-4); color: var(--color-text-subtle); }
      table { width: 100%; border-collapse: collapse; background: var(--color-surface); }
      th, td { padding: var(--space-1) var(--space-2); text-align: left; border: var(--border-thin) solid var(--color-border); }
      code { overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .gate-state { display: inline-flex; padding: var(--space-0_5) var(--space-1); border: var(--border-thin) solid var(--color-border); border-radius: var(--radius-pill); }
      .gate-state--closing { color: var(--color-danger); }
      .exercise-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: var(--space-2); margin-top: var(--space-4); }
      .exercise-card { padding: var(--space-2); background: var(--color-surface); border: var(--border-thin) solid var(--color-border); border-radius: var(--radius-md); }
      .exercise-card h2, .exercise-card p { margin: 0 0 var(--space-1); }
      .exercise-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); }
      #exercise-result { min-height: 1.5rem; margin-top: var(--space-2); color: var(--color-text-subtle); }
    </style>
  </head>
  <body>
    <p class="preview-banner">Developer preview · process-local read ownership</p>
    <h1>Per-incarnation read gates</h1>
    <p class="preview-note">This surface is observational except for the two safe exercises below. Reader sets are acquired atomically; closing one incarnation leaves unrelated reads free.</p>
    ${renderReadGateSnapshot(snapshot, capabilities)}
    <p id="exercise-result" aria-live="polite"></p>
    <section class="exercise-grid">${exercises || "<p>Build a capability on the homepage to exercise its gate.</p>"}</section>
  </body>
</html>`;
}
