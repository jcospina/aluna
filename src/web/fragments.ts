// The route layer's HTML fragments — the small bits of markup the `/prompt` and
// build flows return or stream into the shell.
//
// The shell is dumb on purpose (CONTEXT.md "Shell"): the server sends fragments and
// the client places them. These renderers are the server side of that contract.

import { renderDetailModal } from "../presentation/detail-modal.ts";
import { type CapabilityRow, canonicalCapabilityLabel } from "../registry/index.ts";
import { escapeHtml } from "./html.ts";

/** The shell region a busy-notice retargets, via htmx `HX-Retarget` (see `/prompt`). */
export const PROMPT_NOTICE_TARGET = "#prompt-notice";
const CAPABILITY_TOOLBAR_TARGET = "#capability-toolbar";

// The shell's toolbar placeholder comment (public/index.html) — where the on-load
// rehydration and direct `/capability/:id` navigation inject capability entries.
const SHELL_TOOLBAR_PLACEHOLDER = "        <!-- Capability entries render here later. -->";

// The shell's detail-modal placeholder comment (public/index.html) — where every
// server-rendered shell mounts the one shared read-only detail modal instance (epic
// 3.2/04), so a clicked capability item (epic 3.3/02) always has the modal to open.
const SHELL_DETAIL_MODAL_PLACEHOLDER = "    <!-- Shared detail modal mounts here. -->";

const BUSY_NOTICE =
  "I'm already putting something together. Give me a moment and I'll be ready for the next one.";

const PREVIEW_TARGETS = [
  ["spec-preview", "spec-build-preview"],
  ["migration-preview", "spec-migration-preview"],
  ["units-preview", "spec-units-preview"],
  ["gate-preview", "spec-gate-preview"],
  ["build-error-preview", "spec-gate-preview"],
  ["commit-preview", "spec-commit-preview"],
] as const;

const CLEAR_ON_ACCEPT_TARGETS = [
  ["div", "prompt-notice"],
  ["pre", "spec-build-preview"],
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
export function renderBuildSubscriber(jobId: string): string {
  const streamPath = `/build/${encodeURIComponent(jobId)}/stream`;
  return [
    `<section class="build-stream" data-build-job-id="${escapeHtml(jobId)}" hx-ext="sse" sse-connect="${escapeHtml(streamPath)}" sse-close="done">`,
    '  <div class="build-stream__narration" aria-live="polite" sse-swap="narration" hx-swap="beforeend"></div>',
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
 * The notice returned when `/prompt` is rejected because a build is already in
 * flight. Retargeted to {@link PROMPT_NOTICE_TARGET} so it lands in the prompt-bar
 * status region rather than the content area.
 */
export function renderBusyNotice(): string {
  return `<p id="prompt-notice" role="status" aria-live="polite">${escapeHtml(BUSY_NOTICE)}</p>`;
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

/**
 * The content-area surface for an active capability: the platform list scaffolding
 * (rendered live from the spec by the list container, 3.2/02–03) wrapped in the marker
 * the shell keys the active capability on. The scaffolding is data-free — records
 * arrive through the `read` action into its live region (ADR-0004, as amended by
 * ADR-0005), never baked in here. The wrapped `<section>` already labels the region,
 * so this marker carries no redundant landmark name of its own.
 */
export function renderCapabilitySurface(
  row: Pick<CapabilityRow, "id">,
  collectionHtml: string,
): string {
  return [
    `<section class="capability-surface" data-active-capability-id="${escapeHtml(row.id)}">`,
    collectionHtml,
    "</section>",
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
  activeRow: Pick<CapabilityRow, "id" | "label">,
  allRows: ReadonlyArray<Pick<CapabilityRow, "id" | "label">>,
  collectionHtml: string,
  shellHtml: string,
): string {
  const surface = renderCapabilitySurface(activeRow, collectionHtml);
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

  return injectToolbarEntries(withContent, renderToolbarEntries(allRows));
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
  row: Pick<CapabilityRow, "id" | "label">,
  collectionHtml: string,
): string {
  return [renderCapabilitySurface(row, collectionHtml), renderCapabilityToolbarOobEntry(row)].join(
    "\n",
  );
}

function indent(value: string, spaces: number): string {
  const padding = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${padding}${line}`)
    .join("\n");
}
