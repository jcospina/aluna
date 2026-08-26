// The route layer's HTML fragments — the small bits of markup the `/prompt` and
// build flows return or stream into the shell.
//
// The shell is dumb on purpose (CONTEXT.md "Shell"): the server sends fragments and
// the client places them. These renderers are the server side of that contract.

import { renderDetailModal } from "../presentation/detail-modal.ts";
import { type CapabilityRow, canonicalCapabilityLabel } from "../registry/index.ts";
import { escapeHtml } from "./html.ts";

const CAPABILITY_LOGO_LAYER_TARGET = "#capability-logos";

/**
 * The element id one capability's logo carries. Deletion addresses it to take the logo
 * off the desk (`src/capability-deletion/presentation.ts`), so it is written once rather
 * than assembled the same way in two places. Capability ids are `[a-z][a-z0-9_]*`
 * (`src/registry/spec.ts`), so this is always a valid CSS identifier.
 */
export function capabilityLogoElementId(capabilityId: string): string {
  return `capability-logo-${capabilityId}`;
}

/** The attribute the shell's `desk-logos.js` keys a provisional tile by. */
const PROVISIONAL_LOGO_ATTRIBUTE = "data-provisional-logo";

// The shell's logo-layer placeholder comment (public/index.html) — where the on-load
// rehydration and direct `/capability/:id` navigation inject one logo per capability.
const SHELL_LOGO_PLACEHOLDER = "          <!-- Capability logos render here. -->";

// The shell's detail-modal placeholder comment (public/index.html) — where every
// server-rendered shell mounts the one shared read-only detail modal instance (epic
// so a clicked capability item always has the modal to open.
const SHELL_DETAIL_MODAL_PLACEHOLDER = "    <!-- Shared detail modal mounts here. -->";

const PREVIEW_TARGETS = [
  ["metrics-preview", "spec-metrics-preview"],
  ["spec-preview", "spec-build-preview"],
  ["candidate-preview", "spec-candidate-preview"],
  ["behavioral-tests-preview", "spec-behavioral-tests-preview"],
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
  ["pre", "spec-behavioral-tests-preview"],
  ["pre", "spec-migration-preview"],
  ["pre", "spec-units-preview"],
  ["pre", "spec-gate-preview"],
  ["pre", "spec-commit-preview"],
] as const;

/**
 * The product-voice line `/prompt` answers a blank submission with. `required` on the
 * shell's prompt field (public/index.html) is the first line of defence; this is what a
 * whitespace/invisible/control-only string — which may pass HTML5 validation — and any
 * unusable non-browser POST get.
 */
export const BLANK_PROMPT_NOTICE = "What would you like me to make?";

/**
 * The out-of-band `#prompt-notice` swap: the one shape every warm, non-building answer
 * speaks in, whether it is a terminal build outcome (`terminal-presentation.ts`), a
 * restoration notice, or the blank-prompt refusal. Single-sourced here so the id and the
 * swap mode cannot drift between the paths that emit it — the shell clears this element
 * on every submission (`public/app.js`), so the line retires by itself.
 */
export function renderPromptNotice(notice: string): string {
  return `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml(notice)}</div>`;
}

/**
 * The per-build SSE subscriber fragment returned by an accepted `/prompt`. It opens
 * an htmx-ext-sse connection to the build's stream, appends `narration` events as
 * they arrive, and lets final `fragment` events land in the same content surface.
 * Hidden preview listeners keep the developer panel live through HTMX's SSE event
 * bus without reopening the old raw-EventSource path in the shell.
 *
 * `sse-close="done"` is the htmx-ext-sse equivalent of the raw-EventSource path's
 * `source.close` on `done`: the extension wraps a native EventSource,
 * which auto-reconnects with backoff whenever the server closes the stream. Without
 * closing on `done` the browser would reconnect after the server-closed stream and
 * re-run the build. The `commit` region receives the terminal success swap:
 * committed content in the content area plus the capability's logo as an OOB sidecar.
 *
 * The tile an admitted build stands on the desk rides `fragment`, which is the name
 * ADR-0002 gives a non-terminal fragment placed into a targeted region — so it needs no
 * listener of its own and no fifth event name. Its payload is a lone out-of-band sidecar,
 * so what htmx has left to place after lifting the sidecar out is nothing at all.
 */
export function renderBuildSubscriber(jobId: string): string {
  const encodedJobId = encodeURIComponent(jobId);
  const streamPath = `/build/${encodedJobId}/stream`;
  const cancelPath = `/build/${encodedJobId}/cancel`;
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
 * One capability's logo on the desk: its permanent identity, and — with no taskbar —
 * the only standing list of what exists. A real `<button>`, which is what lets 5.9 open
 * a context menu from the keyboard without hand-written key handling, and what carries
 * the live label a rename changes.
 *
 * The tile inside it is one of two things, read from the registry's durable logo
 * lifecycle ([ADR-0007](../../docs/adr/0007-capability-logo-contract.md)):
 *
 *   - **`present`** — the accepted artwork, addressed by its incarnation-keyed URL. The
 *     shell adds the 10% corner, the shadow and the label; the file itself is untouched.
 *   - **anything else** — the designed placeholder. A tile wears `logo-tile--working`
 *     for exactly as long as a picture is on its way to it, which is the armed `absent`
 *     tile and no other: it has an attempt in flight and that attempt answers with this
 *     same element. Every other placeholder rests. A capability that has spent its
 *     attempts is finished and usable with no face (L11) and must not claim otherwise,
 *     and a `generating` claimed elsewhere will never reach this element to settle it.
 *
 * An `absent` tile additionally **arms one attempt**: a load-triggered, same-origin POST
 * that claims the attempt and answers with this same tile, re-rendered. Two properties
 * hold it to one call per render:
 *
 *   - The POST lives on the tile `<span>`, never on the button. htmx allows one verb per
 *     element and the button already carries `hx-get` for the click that opens the
 *     capability; putting both on one element would silently fire the GET.
 *   - `armLogoAttempt` is false for the markup an attempt *answers* with, so a failure
 *     that returns the row to `absent` comes back inert. Only a fresh desk render or a
 *     newly activated tile arms one, which is what stops a tile swap from recursively
 *     spending all three attempts inside a single page load.
 *
 * Commit-time OOB insertion and later load-time rehydration both use this renderer so
 * the two paths cannot drift.
 */
export interface CapabilityLogoRenderOptions {
  /** Whether an `absent` tile may arm its one load-triggered attempt. Default: it may. */
  readonly armLogoAttempt?: boolean;
}

export type RenderableCapabilityLogo = Pick<
  CapabilityRow,
  "id" | "label" | "incarnation_id" | "logo"
>;

export function renderCapabilityLogo(
  row: RenderableCapabilityLogo,
  options: CapabilityLogoRenderOptions = {},
): string {
  const id = escapeHtml(row.id);
  const label = canonicalCapabilityLabel(row);
  const url = `/capability/${id}`;
  return [
    "<button",
    '  type="button"',
    `  id="${capabilityLogoElementId(id)}"`,
    '  class="logo"',
    "  data-capability-logo",
    `  data-capability-id="${id}"`,
    `  hx-get="${url}"`,
    '  hx-target="#spec-build-output"',
    '  hx-swap="innerHTML"',
    `  hx-push-url="${url}"`,
    `  aria-label="Open ${escapeHtml(label)}"`,
    ">",
    indent(renderCapabilityLogoTile(row, options.armLogoAttempt !== false), 2),
    `  <span class="logo-label">${escapeHtml(label)}</span>`,
    "</button>",
  ].join("\n");
}

/** The incarnation-keyed address of one capability's accepted artwork. */
function capabilityLogoUrl(row: Pick<CapabilityRow, "id" | "incarnation_id">): string {
  return `/capability/${encodeURIComponent(row.id)}/${encodeURIComponent(row.incarnation_id)}/logo.svg`;
}

/** Where an `absent` tile claims its one attempt. A paid mutation, so never a GET. */
function capabilityLogoAttemptUrl(row: Pick<CapabilityRow, "id" | "incarnation_id">): string {
  return `/capability/${encodeURIComponent(row.id)}/${encodeURIComponent(row.incarnation_id)}/logo-attempt`;
}

function renderCapabilityLogoTile(row: RenderableCapabilityLogo, arm: boolean): string {
  if (row.logo.status === "present") {
    return `<span class="logo-tile" style="background-image: url('${escapeHtml(capabilityLogoUrl(row))}')"></span>`;
  }
  if (row.logo.status !== "absent" || !arm) {
    return '<span class="logo-tile logo-tile--pending"></span>';
  }
  // Armed, so a picture is on its way to *this* element: the tile keeps working until its
  // own attempt answers. That is what closes the gap at commit, where the provisional
  // tile comes down and this one goes up while the logo request is still in flight.
  return [
    '<span class="logo-tile logo-tile--pending logo-tile--working"',
    `  hx-post="${escapeHtml(capabilityLogoAttemptUrl(row))}"`,
    '  hx-trigger="load"',
    `  hx-target="#${capabilityLogoElementId(escapeHtml(row.id))}"`,
    '  hx-swap="outerHTML"',
    "></span>",
  ].join("\n");
}

/** Where a provisional tile's name is written, once there is one to write. */
function provisionalLogoLabelElementId(buildId: string): string {
  return `provisional-logo-label-${buildId}`;
}

/** The tile's constant half of its accessible name — what it is, as opposed to which one. */
function provisionalLogoStatusElementId(buildId: string): string {
  return `provisional-logo-status-${buildId}`;
}

/**
 * The tile a new capability stands on the ground while it is still being made. It is
 * presentation only and keyed by the build id, because the capability it announces does
 * not exist yet — activation is what supplies a real incarnation, and the registry-backed
 * logo replaces this one there. Every non-activating terminal removes it (`public/app.js`).
 *
 * Only an admitted `new_capability` build gets one. An evolution already has its
 * capability's logo standing on the desk; `reject`, `data_query` and anything refused
 * before admission announce nothing, because nothing was admitted.
 *
 * **It stands nameless.** At admission there is no name — the resolver's
 * `user_facing_label` is one warm sentence about the request, not a name, and the
 * capability's authored label does not exist until the spec stage. Writing a stand-in
 * under it ("Something new") put a word on the desk that was never anybody's name, so the
 * ground simply stays blank until {@link renderProvisionalLogoName} fills it in.
 *
 * A nameless button still has to answer to something, so the accessible name is assembled
 * from two referenced spans rather than an `aria-label`: the empty visible one, and a
 * hidden one saying what this is. `aria-labelledby` reads directly referenced nodes even
 * when they are hidden, so the tile announces "being made" now and "<name> being made"
 * the moment the spec names it — and naming it needs to replace only the label span,
 * never the button, which would restart the tile's animation mid-crawl.
 */
export function renderProvisionalLogo(buildId: string): string {
  const id = escapeHtml(buildId);
  const labelId = provisionalLogoLabelElementId(id);
  const statusId = provisionalLogoStatusElementId(id);
  return [
    `<div data-provisional-logo-oob hx-swap-oob="beforeend:${CAPABILITY_LOGO_LAYER_TARGET}">`,
    "  <button",
    '    type="button"',
    '    class="logo"',
    `    ${PROVISIONAL_LOGO_ATTRIBUTE}="${id}"`,
    `    aria-labelledby="${labelId} ${statusId}"`,
    "  >",
    '    <span class="logo-tile logo-tile--pending logo-tile--working"></span>',
    `    <span class="logo-label" id="${labelId}"></span>`,
    `    <span id="${statusId}" hidden>being made</span>`,
    "  </button>",
    "</div>",
  ].join("\n");
}

/**
 * The name, once the spec has authored one, written under the tile already standing on the
 * desk. Addressed at the label span alone: the tile beside it is mid-animation and a swap
 * that replaced the button would restart it, which is the one thing the crawl must never
 * do. Inert on a desk whose tile has already come down, which is the ordinary shape of a
 * build the subscriber left.
 */
export function renderProvisionalLogoName(buildId: string, label: string): string {
  const labelId = provisionalLogoLabelElementId(escapeHtml(buildId));
  return `<span class="logo-label" id="${labelId}" hx-swap-oob="outerHTML">${escapeHtml(label)}</span>`;
}

// A newly activated capability standing on the ground for the first time. This is one of
// the two moments ADR-0007 allows a load-triggered attempt to be armed — the other is a
// fresh desk render — so the tile is rendered with its default arming.
function renderCapabilityLogoOob(row: RenderableCapabilityLogo): string {
  return [
    `<div data-capability-logo-oob hx-swap-oob="beforeend:${CAPABILITY_LOGO_LAYER_TARGET}">`,
    indent(renderCapabilityLogo(row), 2),
    "</div>",
  ].join("\n");
}

// An evolution moving the capability's label. **Inert**: evolution never enters the logo
// path, so re-rendering a still-faceless tile here must not become a third way to arm an
// attempt. Only a fresh desk render or a newly activated tile may do that.
function renderCapabilityLogoReplacement(row: RenderableCapabilityLogo): string {
  const targetId = capabilityLogoElementId(escapeHtml(row.id));
  return renderCapabilityLogo(row, { armLogoAttempt: false }).replace(
    "<button",
    `<button hx-swap-oob="outerHTML:#${targetId}"`,
  );
}

/**
 * The content-area surface for an active capability: the platform list scaffolding
 * (rendered live from the spec by the list container) wrapped in the marker
 * the shell keys the active capability on. The scaffolding is data-free — records
 * arrive through the `read` action into its live region (ADR-0004, as amended by
 * ADR-0005), never baked in here. The wrapped `<section>` already labels the region,
 * so this marker carries no redundant landmark name of its own.
 */
export function renderCapabilitySurface(
  row: Pick<CapabilityRow, "id" | "incarnation_id" | "version">,
  collectionHtml: string,
): string {
  return [
    `<section class="capability-surface" data-active-capability-id="${escapeHtml(row.id)}"` +
      ` data-active-capability-incarnation="${escapeHtml(row.incarnation_id)}"` +
      ` data-active-capability-version="${row.version}">`,
    collectionHtml,
    "</section>",
  ].join("\n");
}

/**
 * The shell's empty content target, matched by its id rather than by its exact opening
 * tag: the tag carries presentation attributes — the content region marker among them —
 * that the shell is free to change without this assembly silently failing to find it.
 */
const EMPTY_CONTENT_TARGET = /(<div\b[^>]*\bid="spec-build-output"[^>]*>)<\/div>/;

/**
 * The literal anchors page assembly composes a full page by replacing, each paired
 * with what a shell missing it looks like. Every one of them throws, and this is what
 * lets the developer preview force each case against the *real* shipped shell instead of
 * keeping its own copies of the strings, which would then be free to drift from the ones
 * the assembly actually matches. `renderCapabilityShell` exercises all of them.
 *
 * The shell root left this list with the rail: it was there only to be flipped into a
 * `has-capabilities` state, and an empty desk needs no gate.
 */
export const PAGE_ASSEMBLY_ANCHORS = [
  {
    name: "the logo-layer placeholder",
    remove: (shellHtml: string) => shellHtml.replace(SHELL_LOGO_PLACEHOLDER, ""),
  },
  {
    name: "the detail-modal placeholder",
    remove: (shellHtml: string) => shellHtml.replace(SHELL_DETAIL_MODAL_PLACEHOLDER, ""),
  },
  {
    name: "the content target",
    remove: (shellHtml: string) =>
      shellHtml.replace(EMPTY_CONTENT_TARGET, '<div id="the-content-target-is-gone"></div>'),
  },
] as const;

/**
 * Direct browser navigation to `/capability/:id` needs the fixed shell around the
 * capability surface so authored CSS, HTMX, Alpine, the prompt bar and the desk are
 * present. HTMX logo clicks still receive only the fragment.
 *
 * The logo layer is rehydrated from the *whole* registry (`allRows`), not just the opened
 * capability — a full-page load of `/capability/:id` must show every sibling logo, the
 * same set `GET /` restores. `activeRow` drives only the content surface. Passing just
 * the one row here was the rehydration bug: opening or refreshing a capability by
 * URL dropped every other logo, so the desk looked like the registry had lost them.
 */
export function renderCapabilityShell(
  activeRow: RenderableCapabilityLogo & Pick<CapabilityRow, "version">,
  allRows: readonly RenderableCapabilityLogo[],
  collectionHtml: string,
  shellHtml: string,
): string {
  const surface = renderCapabilitySurface(activeRow, collectionHtml);

  const withModal = injectDetailModal(shellHtml);
  requireContentTarget(withModal);
  const withContent = withModal.replace(
    EMPTY_CONTENT_TARGET,
    (_match, openingTag: string) => `${openingTag}${surface}</div>`,
  );

  return injectCapabilityLogos(withContent, renderCapabilityLogos(allRows));
}

/**
 * The on-load shell with its logo layer rehydrated from the registry: one canonical
 * logo per row (the same renderer the commit-time out-of-band path uses, so the load
 * path and the OOB path can never drift). An empty registry returns the shell with an
 * empty layer, which is the whole of what a fresh user sees: a wallpaper and a prompt
 * bar, with nothing gating them. The content area is left empty by design — the load
 * path only restores the desk; a logo click serves the cached, data-free view.
 */
export function renderRehydratedShell(
  rows: readonly RenderableCapabilityLogo[],
  shellHtml: string,
): string {
  // The shared detail modal mounts on every rendered shell — an empty desk included — so
  // the first capability a fresh user builds can open it without a page refresh (the
  // commit swap adds content + a logo, not the modal). An empty desk means no
  // capabilities, never no modal: the modal is data-free platform chrome.
  const withModal = injectDetailModal(shellHtml);
  requireContentTarget(withModal);
  if (rows.length === 0) {
    // An empty desk inserts no logos — but the anchor the first commit will need is
    // checked here, on the page a fresh user actually loads, rather than left to fail on
    // that commit. An anchor whose check is data-dependent is an anchor that fails loudly
    // only for users who already have capabilities.
    requireLogoLayerAnchor(withModal);
    return withModal;
  }

  return injectCapabilityLogos(withModal, renderCapabilityLogos(rows));
}

// Render one canonical logo per registry row, shell-indented and joined. The single
// source of the desk's logo set, shared by every full-shell path (on-load rehydration
// and direct `/capability/:id` navigation) so a full-page load always shows the same
// complete desk the registry holds — never a subset.
function renderCapabilityLogos(rows: readonly RenderableCapabilityLogo[]): string {
  return rows.map((row) => indent(renderCapabilityLogo(row), 10)).join("\n");
}

// The anchor the logo injection replaces, checked without applying anything, so the
// empty-desk page can hold itself to the same contract as one with logos.
function requireLogoLayerAnchor(shellHtml: string): void {
  if (!shellHtml.includes(SHELL_LOGO_PLACEHOLDER)) {
    throw new Error("The shell logo-layer placeholder is missing.");
  }
}

function injectCapabilityLogos(shellHtml: string, logosHtml: string): string {
  requireLogoLayerAnchor(shellHtml);
  return shellHtml.replace(SHELL_LOGO_PLACEHOLDER, `${SHELL_LOGO_PLACEHOLDER}\n${logosHtml}`);
}

// Every full-page assembly needs the content target, whether or not it is about to put
// something in it: the shell's own glue and every logo addresses it by that id.
function requireContentTarget(shellHtml: string): void {
  if (!EMPTY_CONTENT_TARGET.test(shellHtml)) {
    throw new Error("The shell content target placeholder is missing.");
  }
}

// Mount the one shared read-only detail modal instance at the shell's placeholder
// (public/index.html), rendered from the single renderDetailModal source so the served
// markup can never drift from the module + its tests. Loud on a missing placeholder — same
// fail-fast contract as the logo injection — so a shell that silently dropped the modal
// (and with it every item's click-to-open) is caught in tests, not in the UI.
function injectDetailModal(shellHtml: string): string {
  const withModal = shellHtml.replace(SHELL_DETAIL_MODAL_PLACEHOLDER, renderDetailModal());
  if (withModal === shellHtml) {
    throw new Error("The shell detail-modal placeholder is missing.");
  }
  return withModal;
}

/**
 * The terminal commit event payload: one SSE event swaps the active content view
 * while the `hx-swap-oob` sidecar stands the same canonical logo on the desk.
 */
export function renderCapabilityCommitSwap(
  row: RenderableCapabilityLogo & Pick<CapabilityRow, "version">,
  collectionHtml: string,
  previousLabel?: string,
): string {
  const logo =
    previousLabel === undefined
      ? renderCapabilityLogoOob(row)
      : previousLabel === row.label
        ? ""
        : renderCapabilityLogoReplacement(row);
  return [renderCapabilitySurface(row, collectionHtml), logo].filter(Boolean).join("\n");
}

function indent(value: string, spaces: number): string {
  const padding = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${padding}${line}`)
    .join("\n");
}
