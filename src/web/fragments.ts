// The route layer's HTML fragments — the small bits of markup the `/prompt` and
// build flows return or stream into the shell.
//
// The shell is dumb on purpose (CONTEXT.md "Shell"): the server sends fragments and
// the client places them. These renderers are the server side of that contract.

import { renderDetailModal } from "../presentation/detail-modal.ts";
import { type CapabilityRow, canonicalCapabilityLabel } from "../registry/index.ts";
import { escapeHtml } from "./html.ts";

const CAPABILITY_TOOLBAR_TARGET = "#capability-toolbar";

// The shell's toolbar placeholder comment (public/index.html) — where the on-load
// rehydration and direct `/capability/:id` navigation inject capability entries.
const SHELL_TOOLBAR_PLACEHOLDER = "        <!-- Capability entries render here later. -->";

// The shell's detail-modal placeholder comment (public/index.html) — where every
// server-rendered shell mounts the one shared read-only detail modal instance (epic
// 3.2/04), so a clicked capability item (epic 3.3/02) always has the modal to open.
const SHELL_DETAIL_MODAL_PLACEHOLDER = "    <!-- Shared detail modal mounts here. -->";

const PREVIEW_TARGETS = [
  ["metrics-preview", "spec-metrics-preview"],
  ["spec-preview", "spec-build-preview"],
  ["candidate-preview", "spec-candidate-preview"],
  ["migration-preview", "spec-migration-preview"],
  ["units-preview", "spec-units-preview"],
  ["gate-preview", "spec-gate-preview"],
  ["build-error-preview", "spec-gate-preview"],
  ["commit-preview", "spec-commit-preview"],
] as const;

const CLEAR_ON_ACCEPT_TARGETS = [
  ["div", "prompt-notice"],
  ["pre", "spec-metrics-preview"],
  ["pre", "spec-build-preview"],
  ["pre", "spec-candidate-preview"],
  ["pre", "spec-migration-preview"],
  ["pre", "spec-units-preview"],
  ["pre", "spec-gate-preview"],
  ["pre", "spec-commit-preview"],
] as const;

/**
 * The per-build SSE subscriber fragment returned by an accepted `/prompt`. It opens
 * an htmx-ext-sse connection to the build's stream, appends `narration` events as
 * they arrive, and lets final `fragment` events land in the same content surface.
 * Hidden preview listeners keep the developer panel live through HTMX's SSE event
 * bus without reopening the old raw-EventSource path in the shell.
 *
 * `sse-close="done"` is the htmx-ext-sse equivalent of the raw-EventSource path's
 * `source.close()` on `done` (ADR-0002): the extension wraps a native EventSource,
 * which auto-reconnects with backoff whenever the server closes the stream. Without
 * closing on `done` the browser would reconnect after the server-closed stream and
 * re-run the build. The `commit` region receives the terminal success swap:
 * committed content in the content area plus the toolbar entry as an OOB sidecar.
 */
export function renderBuildSubscriber(
  jobId: string,
  paths: { readonly streamPath?: string; readonly cancelPath?: string } = {},
): string {
  const encodedJobId = encodeURIComponent(jobId);
  const streamPath = paths.streamPath ?? `/build/${encodedJobId}/stream`;
  const cancelPath = paths.cancelPath ?? `/build/${encodedJobId}/cancel`;
  return [
    `<section class="build-stream" data-build-job-id="${escapeHtml(jobId)}" hx-ext="sse" sse-connect="${escapeHtml(streamPath)}" sse-close="done">`,
    '  <div class="build-stream__narration" aria-live="polite" sse-swap="narration" hx-swap="beforeend"></div>',
    `  <button class="btn btn--ghost build-stream__cancel" type="button" hx-post="${escapeHtml(cancelPath)}" hx-swap="none">Cancel</button>`,
    '  <div class="build-stream__fragment" sse-swap="fragment" hx-swap="beforeend"></div>',
    '  <div class="build-stream__commit" aria-live="polite" sse-swap="commit" hx-swap="innerHTML"></div>',
    ...PREVIEW_TARGETS.map(
      ([event, target]) =>
        `  <span hidden aria-hidden="true" sse-swap="${event}" data-preview-target="${target}"></span>`,
    ),
    "</section>",
    ...CLEAR_ON_ACCEPT_TARGETS.map(
      ([tag, target]) => `<${tag} id="${target}" hx-swap-oob="innerHTML"></${tag}>`,
    ),
  ].join("\n");
}

/**
 * The canonical capability-toolbar entry. Commit-time OOB insertion and later
 * load-time rehydration both use this renderer so the two paths cannot drift.
 */
export function renderCapabilityToolbarEntry(row: Pick<CapabilityRow, "id" | "label">): string {
  const id = escapeHtml(row.id);
  const label = canonicalCapabilityLabel(row);
  const url = `/capability/${id}`;
  return [
    "<button",
    `  id="capability-toolbar-entry-${id}"`,
    '  type="button"',
    '  class="toolbar__entry"',
    "  data-capability-entry",
    `  data-capability-id="${id}"`,
    `  hx-get="${url}"`,
    '  hx-target="#spec-build-output"',
    '  hx-swap="innerHTML"',
    `  hx-push-url="${url}"`,
    ">",
    `  ${escapeHtml(label)}`,
    "</button>",
  ].join("\n");
}

function renderCapabilityToolbarOobEntry(row: Pick<CapabilityRow, "id" | "label">): string {
  const entry = renderCapabilityToolbarEntry(row);
  return [
    `<div data-capability-toolbar-oob hx-swap-oob="beforeend:${CAPABILITY_TOOLBAR_TARGET}">`,
    indent(entry, 2),
    "</div>",
  ].join("\n");
}

function renderCapabilityToolbarReplacement(row: Pick<CapabilityRow, "id" | "label">): string {
  const targetId = `capability-toolbar-entry-${escapeHtml(row.id)}`;
  return renderCapabilityToolbarEntry(row).replace(
    "<button",
    `<button hx-swap-oob="outerHTML:#${targetId}"`,
  );
}

/**
 * The content-area surface for an active capability: the platform list scaffolding
 * (rendered live from the spec by the list container, 3.2/02–03) wrapped in the marker
 * the shell keys the active capability on. The scaffolding is data-free — records
 * arrive through the `read` action into its live region (ADR-0004, as amended by
 * ADR-0005), never baked in here. The wrapped `<section>` already labels the region,
 * so this marker carries no redundant landmark name of its own.
 */
export function renderCapabilitySurface(
  row: Pick<CapabilityRow, "id" | "incarnation_id" | "version">,
  collectionHtml: string,
  includeDeveloperControl = true,
): string {
  return [
    `<section class="capability-surface" data-active-capability-id="${escapeHtml(row.id)}"` +
      ` data-active-capability-incarnation="${escapeHtml(row.incarnation_id)}"` +
      ` data-active-capability-version="${row.version}">`,
    collectionHtml,
    "</section>",
    ...(includeDeveloperControl
      ? [
          renderDeveloperV2TracerControl(row, true),
          renderDeveloperEvolutionCandidateControl(row, true),
        ]
      : []),
  ].join("\n");
}

/**
 * The evolution-candidate dev tracer affordance — Module 4.6/01. A developer
 * targets the open capability with a hand-typed intent; the trace shows the
 * accepted candidate (or the warm rejection) in the panel's Evolution candidate
 * block. Unlike the one-shot v2 tracer above, any live version is a valid
 * target. The typed text stands in for the resolved intent until epic 4.8.
 */
function renderDeveloperEvolutionCandidateControl(
  row: Pick<CapabilityRow, "id">,
  outOfBand: boolean,
): string {
  return [
    `<div id="developer-evolution-candidate-control"${outOfBand ? ' hx-swap-oob="innerHTML"' : ""}>`,
    `  <form class="capability-evolution-candidate" data-dev-only hx-post="/demo/evolution-candidate/${encodeURIComponent(row.id)}" hx-target="#spec-build-output" hx-swap="beforeend">`,
    '    <label class="devbar__block-label" for="evolution-candidate-intent">Describe a change</label>',
    '    <input id="evolution-candidate-intent" name="intent" type="text" required autocomplete="off" placeholder="Add a rating field" />',
    '    <button type="submit" class="btn btn--ghost">Trace candidate</button>',
    "  </form>",
    "</div>",
  ].join("\n");
}

function renderDeveloperV2TracerControl(
  row: Pick<CapabilityRow, "id" | "incarnation_id" | "version">,
  outOfBand: boolean,
): string {
  // This issue deliberately proves exactly one v1 → v2 transition. Keep the
  // temporary affordance absent once v2 is live so it cannot masquerade as a
  // general evolution path before Module 4.6 owns that responsibility.
  const form =
    row.version === 1
      ? [
          `  <form class="capability-v2-tracer" data-dev-only hx-post="/demo/hand-authored-v2/${encodeURIComponent(row.id)}" hx-target="#spec-build-output" hx-swap="beforeend">`,
          '    <button type="submit" class="btn btn--ghost">Trace next version</button>',
          "  </form>",
        ]
      : [];
  return [
    `<div id="developer-v2-tracer-control"${outOfBand ? ' hx-swap-oob="innerHTML"' : ""}>`,
    ...form,
    "</div>",
  ].join("\n");
}

/**
 * Direct browser navigation to `/capability/:id` needs the fixed shell around the
 * capability surface so authored CSS, HTMX, Alpine, the prompt bar, and both sidebars
 * are present. HTMX toolbar clicks still receive only the fragment.
 *
 * The toolbar is rehydrated from the *whole* registry (`allRows`), not just the opened
 * capability — a full-page load of `/capability/:id` must show every sibling entry, the
 * same set `GET /` restores. `activeRow` drives only the content surface. Passing just
 * the one row here was the toolbar-hydration bug: opening or refreshing a capability by
 * URL dropped every other entry, so the toolbar looked like the registry had lost them.
 */
export function renderCapabilityShell(
  activeRow: Pick<CapabilityRow, "id" | "label" | "incarnation_id" | "version">,
  allRows: ReadonlyArray<Pick<CapabilityRow, "id" | "label">>,
  collectionHtml: string,
  shellHtml: string,
): string {
  const surface = renderCapabilitySurface(activeRow, collectionHtml, false);
  const contentPlaceholder =
    '<div class="intro__output" id="spec-build-output" aria-live="polite"></div>';

  const withModal = injectDetailModal(shellHtml);
  const withContent = withModal.replace(
    contentPlaceholder,
    `<div class="intro__output" id="spec-build-output" aria-live="polite">${surface}</div>`,
  );
  if (withContent === withModal) {
    throw new Error("The shell content target placeholder is missing.");
  }

  const withDeveloperControl = withContent.replace(
    '<div id="developer-v2-tracer-control"></div>',
    renderDeveloperV2TracerControl(activeRow, false),
  );
  const withEvolutionControl = withDeveloperControl.replace(
    '<div id="developer-evolution-candidate-control"></div>',
    renderDeveloperEvolutionCandidateControl(activeRow, false),
  );
  return injectToolbarEntries(withEvolutionControl, renderToolbarEntries(allRows));
}

/**
 * The on-load shell with its capability toolbar rehydrated from the registry: one
 * canonical entry per row (the same renderer the commit-time out-of-band path uses,
 * so the load path and the OOB path can never drift). With at least one row the shell
 * flips to `has-capabilities` and the sidebar shows; an empty registry returns the
 * shell untouched, so a fresh user keeps the cold-start state. The content area is
 * left empty by design — the load path only restores chrome; a toolbar click serves
 * the cached, data-free view (ADR-0004).
 */
export function renderRehydratedShell(
  rows: ReadonlyArray<Pick<CapabilityRow, "id" | "label">>,
  shellHtml: string,
): string {
  // The shared detail modal mounts on every rendered shell — cold-start included — so
  // the first capability a fresh user builds can open it without a page refresh (the
  // commit swap adds content + a toolbar entry, not the modal). "Cold-start" means no
  // capabilities, never no modal: the modal is data-free platform chrome (ADR-0004).
  const withModal = injectDetailModal(shellHtml);
  if (rows.length === 0) {
    return withModal;
  }

  return injectToolbarEntries(withModal, renderToolbarEntries(rows));
}

// Render one canonical toolbar entry per registry row, shell-indented and joined.
// The single source of the toolbar's entry set, shared by every full-shell path
// (on-load rehydration and direct `/capability/:id` navigation) so a full-page load
// always shows the same complete toolbar the registry holds — never a subset.
function renderToolbarEntries(rows: ReadonlyArray<Pick<CapabilityRow, "id" | "label">>): string {
  return rows.map((row) => indent(renderCapabilityToolbarEntry(row), 8)).join("\n");
}

// Insert already-rendered toolbar entries at the shell's placeholder and flip the
// shell into its has-capabilities presentation state. Shared by the on-load
// rehydration path and direct `/capability/:id` navigation so the two cannot drift.
function injectToolbarEntries(shellHtml: string, entriesHtml: string): string {
  const withToolbar = shellHtml.replace(
    SHELL_TOOLBAR_PLACEHOLDER,
    `${SHELL_TOOLBAR_PLACEHOLDER}\n${entriesHtml}`,
  );
  if (withToolbar === shellHtml) {
    throw new Error("The shell toolbar placeholder is missing.");
  }

  return withToolbar.replace('class="shell"', 'class="shell has-capabilities"');
}

// Mount the one shared read-only detail modal instance at the shell's placeholder
// (public/index.html), rendered from the single renderDetailModal() source so the served
// markup can never drift from the module + its tests. Loud on a missing placeholder — same
// fail-fast contract as the toolbar injection — so a shell that silently dropped the modal
// (and with it every item's click-to-open, epic 3.3/02) is caught in tests, not in the UI.
function injectDetailModal(shellHtml: string): string {
  const withModal = shellHtml.replace(SHELL_DETAIL_MODAL_PLACEHOLDER, renderDetailModal());
  if (withModal === shellHtml) {
    throw new Error("The shell detail-modal placeholder is missing.");
  }
  return withModal;
}

/**
 * The terminal commit event payload: one SSE event swaps the active content view
 * while the `hx-swap-oob` sidecar appends the same canonical toolbar entry.
 */
export function renderCapabilityCommitSwap(
  row: Pick<CapabilityRow, "id" | "label" | "incarnation_id" | "version">,
  collectionHtml: string,
  previousLabel?: string,
): string {
  const toolbar =
    previousLabel === undefined
      ? renderCapabilityToolbarOobEntry(row)
      : previousLabel === row.label
        ? ""
        : renderCapabilityToolbarReplacement(row);
  return [renderCapabilitySurface(row, collectionHtml), toolbar].filter(Boolean).join("\n");
}

function indent(value: string, spaces: number): string {
  const padding = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${padding}${line}`)
    .join("\n");
}
