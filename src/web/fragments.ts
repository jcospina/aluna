// The route layer's HTML fragments — the small bits of markup the `/prompt` and
// build flows return or stream into the shell.
//
// The shell is dumb on purpose (CONTEXT.md "Shell"): the server sends fragments and
// the client places them. These renderers are the server side of that contract.

import {
  type CapabilityRow,
  canonicalCapabilityLabel,
  LOGO_MAX_CLAIMED_ATTEMPTS,
} from "../registry/index.ts";
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

/**
 * Which of the developer panel's eight stages each preview event belongs to.
 *
 * A stage name rather than an element id, because the panel is a window now
 * (`public/desk-dev-panel.js`): it may not be standing when a payload arrives, and the
 * eight `<pre>` elements these once addressed no longer exist in the shell. The client
 * files the payload under the stage and the panel shows it whenever it opens — so a
 * developer who starts a build and then reaches for the tile still finds every stage
 * that has already run. The stage keys are `design/scripts/devpanel.js`'s.
 *
 * A failed build's `build-error-preview` files under `commit`, not under `gate`. It
 * arrives at the terminal, after the Gate has already sent its verdict for a build
 * that got that far — so filing it under `gate` overwrote the verdict with the error
 * that followed it, and the Gate block ended up captioned as a verdict it no longer
 * held. `commit` is the block a build fills when it lands; a build that did not land
 * says why there instead, and every block above it still reads.
 */
const PREVIEW_STAGES = [
  ["metrics-preview", "metrics"],
  ["spec-preview", "spec"],
  ["candidate-preview", "candidate"],
  ["behavioral-tests-preview", "behavioral-tests"],
  ["migration-preview", "migration"],
  ["units-preview", "units"],
  ["gate-preview", "gate"],
  ["build-error-preview", "commit"],
  ["commit-preview", "commit"],
] as const;

/**
 * What an accepted prompt clears out of band. Only the notice: the panel's stages are
 * cleared by the shell when it accepts the submission, because a window that is not
 * open has no elements for an out-of-band swap to find.
 */
const CLEAR_ON_ACCEPT_TARGETS = [["div", "prompt-notice"]] as const;

/**
 * The product-voice line `/prompt` answers a blank submission with. `required` on the
 * shell's prompt field (public/index.html) is the first line of defence; this is what a
 * whitespace/invisible/control-only string — which may pass HTML5 validation — and any
 * unusable non-browser POST get.
 */
export const BLANK_PROMPT_NOTICE = "What would you like me to make?";

/**
 * The out-of-band `#prompt-notice` swap: the one shape every warm answer that never
 * became a build speaks in — a warm deflection, a deletion's outcome, the blank-prompt
 * refusal. Single-sourced here so the id and the swap mode cannot drift between the
 * paths that emit it — the shell clears this element on every submission
 * (`public/app.js`), so the line retires by itself.
 *
 * A build's own terminal outcome no longer speaks here. A failure, a stale refusal and a
 * measured no-op end the narration instead ({@link renderBuildEnding}) and the window
 * holds there, because the log is already the live region and is already where the person
 * is looking (PLAN decision 23).
 */
export function renderPromptNotice(notice: string): string {
  return `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml(notice)}</div>`;
}

/**
 * The one control a run offers, and the id both of its faces share. While the run is
 * working it stops the run; once the run has something to tell you it gives the window
 * back.
 *
 * Keyed by the build id rather than fixed. The shell admits one subscriber at a time,
 * but it can only refuse a subscriber that has already landed — two submissions inside
 * one round trip are exactly the queued-submit window that guard exists for, and with a
 * fixed id one run's ending would out-of-band its way onto the *other* run's Cancel and
 * offer to dismiss a build that is still going. A build id is a `crypto.randomUUID`
 * behind a `build-` prefix, so this is a valid element id, and htmx matches an
 * out-of-band swap by the element's own id rather than through a selector.
 */
function buildStreamControlElementId(buildId: string): string {
  return `build-stream-control-${buildId}`;
}

/**
 * A run's last line, and the control that ends the wait.
 *
 * A build that fails, is refused as stale or comes back a measured no-op says so where
 * the person is already looking — the narration is the live region, and the desk gains no
 * surface of its own for it (PLAN decision 23). The line stands on its own rather than
 * running on from the working prose, because it is the ending and not another step.
 *
 * The control rides with it as an out-of-band sidecar so the two can never disagree:
 * the moment the ending is on screen, Cancel is no longer a thing there is to do, and
 * the same place in the control row offers the way back instead. What that press
 * actually gives back is the restoration the same terminal already streamed, which the
 * shell holds rather than places (PLAN decision 25).
 *
 * **Continue**, not "Got it": "Got it" is Aluna's word — it opens every build
 * (`build-jobs.ts`) and CONTEXT.md's voice table uses it as the exemplar of Aluna
 * speaking — so a button wearing it puts both parties' words in one voice inside a single
 * scroll. Every other control in the product names the act from the person's side.
 */
export function renderBuildEnding(buildId: string, line: string): string {
  const controlId = escapeHtml(buildStreamControlElementId(buildId));
  return [
    `<p class="build-stream__ending" data-build-ending>${escapeHtml(line)}</p>`,
    `<button id="${controlId}" class="btn btn--outline build-stream__dismiss" type="button" data-build-dismiss hx-swap-oob="outerHTML">Continue</button>`,
  ].join("\n");
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
 * committed content in the window plus the capability's logo as an OOB sidecar.
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
    '  <div class="build-stream__fragment" sse-swap="fragment" hx-swap="beforeend"></div>',
    '  <div class="build-stream__commit" aria-live="polite" sse-swap="commit" hx-swap="innerHTML"></div>',
    // Last, so it stands where every other action in the window stands: on the
    // window's own bottom edge, under the story rather than beside it.
    `  <button id="${escapeHtml(buildStreamControlElementId(jobId))}" class="btn btn--outline build-stream__cancel" type="button" hx-post="${escapeHtml(cancelPath)}" hx-swap="none">Cancel</button>`,
    ...PREVIEW_STAGES.map(
      ([event, stage]) =>
        `  <span hidden aria-hidden="true" sse-swap="${event}" data-preview-stage="${stage}"></span>`,
    ),
    "</section>",
    ...CLEAR_ON_ACCEPT_TARGETS.map(
      ([tag, target]) => `<${tag} id="${target}" hx-swap-oob="innerHTML"></${tag}>`,
    ),
  ].join("\n");
}

/**
 * What the window is called while a run has it, once the run knows what it is.
 *
 * The title is information, not decoration: a window titled with the capability that
 * happens to be open is actively wrong while a build is making something *else*, and
 * "Making it" is wrong while the run is still working out what was asked for. So the
 * desk names the window `Thinking…` at submit — its own word, before any of this has
 * been reached — and the server names it here the moment resolution settles the
 * question: **Building…** for a new capability, and the capability's own label for an
 * evolution, which is the name the window will keep.
 *
 * It rides `fragment` and lands nowhere, the way the provisional tile does
 * ({@link renderProvisionalLogo}) — so it adds no app-level SSE event name (ADR-0002).
 * The shell reads it and hands it to the desk, which owns the window; nothing is placed
 * in the region.
 */
export const BUILD_WINDOW_TITLE_ATTRIBUTE = "data-build-window-title";

/** What a window is called while something new is being made in it. */
export const BUILDING_WINDOW_TITLE = "Building…";

export function renderBuildWindowTitle(title: string): string {
  return `<div ${BUILD_WINDOW_TITLE_ATTRIBUTE}="${escapeHtml(title)}"></div>`;
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
  // URI-encoded rather than only HTML-escaped, and no `hx-push-url`. The desk builds this
  // same string from `data-capability-id` when the logo is pressed (`capabilityAddress` in
  // `public/desk-window.js`) and pushes it itself — htmx would push on every press, the
  // open logo's included, and only the desk knows whether the address already names this
  // capability (design D14; PLAN decision 6).
  const url = escapeHtml(`/capability/${encodeURIComponent(row.id)}`);
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
  if (!arm || !hasAnAttemptLeft(row)) {
    return '<span class="logo-tile logo-tile--pending"></span>';
  }
  // Armed, so a picture is on its way to *this* element: the tile keeps working until its
  // own attempt answers. That is what closes the gap at commit, where the provisional
  // tile comes down and this one goes up while the logo request is still in flight.
  return [
    '<span class="logo-tile logo-tile--pending logo-tile--working"',
    `  hx-post="${escapeHtml(capabilityLogoAttemptUrl(row))}"`,
    '  hx-trigger="load"',
    `  hx-target="${escapeHtml(`#${capabilityLogoElementId(row.id)}`)}"`,
    '  hx-swap="outerHTML"',
    "></span>",
  ].join("\n");
}

/**
 * Whether a tile still has an attempt the sweep could offer it.
 *
 * `absent` alone is not enough. The cap lives in the claim's own `WHERE`, so a row that
 * is `absent` with every attempt spent would arm a POST that can never win one — a tile
 * animating for a picture that is not coming, on every load, for ever. Saying it here as
 * well gives decision 38's cap a second expression on the surface the user looks at.
 */
function hasAnAttemptLeft(row: RenderableCapabilityLogo): boolean {
  return row.logo.status === "absent" && row.logo.attempts < LOGO_MAX_CLAIMED_ATTEMPTS;
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
 * logo replaces this one there. Every non-activating terminal removes it
 * (`public/desk-logos.js`).
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
  const targetId = capabilityLogoElementId(row.id);
  return renderCapabilityLogo(row, { armLogoAttempt: false }).replace(
    "<button",
    () => `<button hx-swap-oob="${escapeHtml(`outerHTML:#${targetId}`)}"`,
  );
}

/**
 * The in-window surface for an active capability: the platform list scaffolding
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
 * The literal anchors page assembly composes a full page by replacing, each paired
 * with what a shell missing it looks like. Every one of them throws, and this is what
 * lets the developer preview force each case against the *real* shipped shell instead of
 * keeping its own copies of the strings, which would then be free to drift from the ones
 * the assembly actually matches. `renderRehydratedShell` exercises all of them.
 *
 * The shell root left this list with the rail: it was there only to be flipped into a
 * `has-capabilities` state, and an empty desk needs no gate. The content target left it
 * with the shell's content area: the window is created by the client, so there is no
 * hole in the served page for a capability's collection to be composed into any more.
 * The detail-modal placeholder left with the modal: a record opens through an ordinary
 * view swap inside the window, so there is nothing left to mount.
 *
 * One anchor is what remains, and it still fails loudly.
 */
export const PAGE_ASSEMBLY_ANCHORS = [
  {
    name: "the logo-layer placeholder",
    remove: (shellHtml: string) => shellHtml.replace(SHELL_LOGO_PLACEHOLDER, ""),
  },
] as const;

/**
 * The on-load shell with its logo layer rehydrated from the registry: one canonical
 * logo per row (the same renderer the commit-time out-of-band path uses, so the load
 * path and the OOB path can never drift). An empty registry returns the shell with an
 * empty layer, which is the whole of what a fresh user sees: a wallpaper and a prompt
 * bar, with nothing gating them. No window is composed in — the load path restores
 * the desk and only the desk. The client opens the window, over the logo a click
 * lands on or over the one the address names, and the collection arrives in it as
 * the same fragment a logo click has always served.
 *
 * This is now the only full-page assembly there is: direct navigation to
 * `/capability/:id` renders this same desk, because a page with a capability already
 * composed into it would need a hole to compose it into, and the shell no longer has
 * one.
 */
export function renderRehydratedShell(
  rows: readonly RenderableCapabilityLogo[],
  shellHtml: string,
): string {
  if (rows.length === 0) {
    // An empty desk inserts no logos — but the anchor the first commit will need is
    // checked here, on the page a fresh user actually loads, rather than left to fail on
    // that commit. An anchor whose check is data-dependent is an anchor that fails loudly
    // only for users who already have capabilities.
    requireLogoLayerAnchor(shellHtml);
    return shellHtml;
  }

  return injectCapabilityLogos(shellHtml, renderCapabilityLogos(rows));
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
  // A replacer function, not a replacement string: `logosHtml` carries model-authored
  // labels, and `$&`, `$\`` and `$'` in a replacement *string* are substitution patterns.
  // Escaping manufactures the hazard rather than avoiding it — `escapeHtml` turns a label's
  // `\'` into `&#39;`, so a label reading `$\'` becomes the `$&` pattern — and `$\`` splices
  // the whole preceding document into the `aria-label` it lands in.
  return shellHtml.replace(SHELL_LOGO_PLACEHOLDER, () => `${SHELL_LOGO_PLACEHOLDER}\n${logosHtml}`);
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
