// The route layer's HTML fragments — the small bits of markup the `/prompt` and
// build flows return or stream into the shell.
//
// The shell is dumb on purpose (CONTEXT.md "Shell"): the server sends fragments and
// the client places them. These renderers are the server side of that contract.

import { escapeHtml } from "./html.ts";

/** The shell region a busy-notice retargets, via htmx `HX-Retarget` (see `/prompt`). */
export const PROMPT_NOTICE_TARGET = "#prompt-notice";

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
 * re-run the build. The `commit` swap region (content + toolbar oob) is added when
 * Epic 2.6c wires the commit swap.
 */
export function renderBuildSubscriber(jobId: string): string {
  const streamPath = `/build/${encodeURIComponent(jobId)}/stream`;
  return [
    `<section class="build-stream" data-build-job-id="${escapeHtml(jobId)}" hx-ext="sse" sse-connect="${escapeHtml(streamPath)}" sse-close="done">`,
    '  <div class="build-stream__narration" aria-live="polite" sse-swap="narration" hx-swap="beforeend"></div>',
    '  <div class="build-stream__fragment" sse-swap="fragment" hx-swap="beforeend"></div>',
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
 * The one user-visible line confirming a build produced a usable capability. Only
 * the user-facing `label` crosses into the UI (escaped); everything else about the
 * spec stays in the console (ARCH §9.7).
 */
export function renderSpecBuiltConfirmation(label: string): string {
  return `<p class="intro__invitation">All set — I've made a place for your ${escapeHtml(label)}.</p>`;
}
