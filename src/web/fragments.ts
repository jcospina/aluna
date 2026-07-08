// The route layer's HTML fragments — the small bits of markup the `/prompt` and
// build flows return or stream into the shell.
//
// The shell is dumb on purpose (CONTEXT.md "Shell"): the server sends fragments and
// the client places them. These renderers are the server side of that contract.

import { type CapabilityRow, canonicalCapabilityLabel } from "../registry/index.ts";
import { escapeHtml } from "./html.ts";

/** The shell region a busy-notice retargets, via htmx `HX-Retarget` (see `/prompt`). */
export const PROMPT_NOTICE_TARGET = "#prompt-notice";
const CAPABILITY_TOOLBAR_TARGET = "#capability-toolbar";

// The shell's toolbar placeholder comment (public/index.html) — where the on-load
// rehydration and direct `/capability/:id` navigation inject capability entries.
const SHELL_TOOLBAR_PLACEHOLDER = "        <!-- Capability entries render here later. -->";

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
  return [
    "<button",
    '  type="button"',
    '  class="toolbar__entry"',
    "  data-capability-entry",
    `  data-capability-id="${id}"`,
    `  hx-get="/capability/${id}"`,
    '  hx-target="#spec-build-output"',
    '  hx-swap="innerHTML"',
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
 */
export function renderCapabilityShell(
  row: Pick<CapabilityRow, "id" | "label">,
  collectionHtml: string,
  shellHtml: string,
): string {
  const surface = renderCapabilitySurface(row, collectionHtml);
  const contentPlaceholder =
    '<div class="intro__output" id="spec-build-output" aria-live="polite"></div>';

  const withContent = shellHtml.replace(
    contentPlaceholder,
    `<div class="intro__output" id="spec-build-output" aria-live="polite">${surface}</div>`,
  );
  if (withContent === shellHtml) {
    throw new Error("The shell content target placeholder is missing.");
  }

  return injectToolbarEntries(withContent, indent(renderCapabilityToolbarEntry(row), 8));
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
  if (rows.length === 0) {
    return shellHtml;
  }

  const entries = rows.map((row) => indent(renderCapabilityToolbarEntry(row), 8)).join("\n");
  return injectToolbarEntries(shellHtml, entries);
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
