// The route layer's HTML fragments — the small bits of markup the `/prompt` and
// build flows return or stream into the shell.
//
// The shell is dumb on purpose (CONTEXT.md "Shell"): the server sends fragments and
// the client places them. These renderers are the server side of that contract.

import {
  buildCancelUrl,
  buildStreamUrl,
  capabilityDeletionUrl,
  capabilityLogoAttemptUrl,
  capabilityLogoUrl,
  capabilityUrl,
} from "#shell/routes.js";
import { WINDOW_CONTENT_ID as WINDOW_CONTENT_ELEMENT_ID } from "#shell/shell-dom.js";
import { busyLabelAttribute } from "../../presentation/controls/busy-label.ts";
import {
  type CapabilityRow,
  canonicalCapabilityLabel,
  LOGO_MAX_CLAIMED_ATTEMPTS,
  MAX_CAPABILITY_LABEL_CHARS,
} from "../../registry/index.ts";
import { escapeHtml } from "./html.ts";

const CAPABILITY_LOGO_LAYER_TARGET = "#capability-logos";

/**
 * What Save says while its write waits in the coordinator's queue. A rename queues behind a
 * build, so the wait is real and long, and a control that only goes grey says nothing about it.
 */
const SAVING_LABEL = "Saving…";

/**
 * The element id one capability's logo carries; deletion addresses it too, so it is written
 * once (`src/lifecycle/deletion/presentation.ts`). Ids are `[a-z][a-z0-9_]*`: always valid CSS.
 */
export function capabilityLogoElementId(capabilityId: string): string {
  return `capability-logo-${capabilityId}`;
}

/**
 * The button inside that slot — tile, name, and the press that opens the capability. An
 * arriving picture replaces the face and never the slot, so an open rename form survives it.
 */
export function capabilityLogoFaceElementId(capabilityId: string): string {
  return `capability-logo-face-${capabilityId}`;
}

/** The menu that opens on one capability's logo. */
export function capabilityLogoMenuElementId(capabilityId: string): string {
  return `capability-logo-menu-${capabilityId}`;
}

/** The inline label form that same menu opens. */
export function capabilityRenameElementId(capabilityId: string): string {
  return `capability-rename-${capabilityId}`;
}

/** Where that form says why a name will not do. Client-side only: the server's own
 * refusals are structured and speak on the prompt bar (PLAN decision 26). */
export function capabilityRenameErrorElementId(capabilityId: string): string {
  return `capability-rename-error-${capabilityId}`;
}

/** The attribute the shell's `desk-logos.js` keys a provisional tile by. */
const PROVISIONAL_LOGO_ATTRIBUTE = "data-provisional-logo";

/**
 * The layer every capability logo stands in (`public/index.html`), and what an armed attempt
 * queues against, so the two cannot drift; `fragments.test.ts` pins that the shell carries it.
 */
export const DESK_LOGO_LAYER_ELEMENT_ID = "capability-logos";

/**
 * The window's one content region. It holds one thing at a time, so two requests aimed at it are
 * two answers for one slot: the later wins. Read from the one place the browser reads it from.
 */
export { WINDOW_CONTENT_ID as WINDOW_CONTENT_ELEMENT_ID } from "#shell/shell-dom.js";

// The shell's logo-layer placeholder comment (public/index.html) — where the on-load
// rehydration and direct `/capability/:id` navigation inject one logo per capability.
const SHELL_LOGO_PLACEHOLDER = "          <!-- Capability logos render here. -->";

// The prompt bar's one live slot (public/index.html), matched by id and open-tag-first: an exact
// tag copy makes one added attribute an outage on every page (`METRICS_SEED_TARGET` says why).
const SHELL_PROMPT_NOTICE_SLOT = /(<div\b[^>]*\bid="prompt-notice"[^>]*>)<\/div>/;

/**
 * Which of the developer panel's eight stages each preview event belongs to. A stage name, not
 * an element id: the panel is a window that may not be standing when a payload arrives.
 */
const PREVIEW_STAGES = [
  ["metrics-preview", "metrics"],
  ["spec-preview", "spec"],
  ["candidate-preview", "candidate"],
  ["behavioral-tests-preview", "behavioral-tests"],
  ["migration-preview", "migration"],
  ["units-preview", "units"],
  ["gate-preview", "gate"],
  ["build-error-preview", "commit"], // filed under gate, it overwrote the Gate's verdict
  ["commit-preview", "commit"],
] as const;

/**
 * What an accepted prompt clears out of band. Only the notice: the shell clears the panel's
 * stages itself, since a window that is not open has no elements for an OOB swap to find.
 */
const CLEAR_ON_ACCEPT_TARGETS = [["div", "prompt-notice"]] as const;

/**
 * The line a blank submission is answered with; `public/prompt-bar.js` restates it and a test
 * pins the two. No `required`: the browser's bubble cannot tell an empty field from three spaces.
 */
export const BLANK_PROMPT_NOTICE = "What would you like me to make?";

/**
 * The other end of the same admission: a submission longer than anything a person types at the
 * bar. The body cap (`src/index.ts`) bounds bytes; this bounds the prompt, saving a provider call.
 */
export const MAX_PROMPT_LENGTH = 4000;
export const LONG_PROMPT_NOTICE =
  "That’s a lot to take in at once. Give me the short version and I’ll make a start.";

/**
 * Answers every address naming nothing (PLAN decision 21). Page assembly and `NOT_FOUND_FRAGMENT`
 * say the same sentence; deletion takes the row, so a stale bookmark and a typo look alike.
 */
export const NOT_FOUND_NOTICE = "Hmm — I can’t find that one.";

/**
 * Whether a sentence on the prompt bar is Aluna answering or turning something down. The message
 * carries it, so the shell needs no table of which sentences are refusals.
 */
export type PromptNoticeTone = "answer" | "refusal";

/**
 * The marker a refused sentence carries into the prompt bar's live slot. The shell flashes the
 * bar for 400ms when it lands (`public/app.js`, `.prompt.is-refused`; PLAN decision 24).
 */
export const PROMPT_REFUSAL_ATTRIBUTE = "data-prompt-refusal";

/**
 * The out-of-band `#prompt-notice` swap: one replaceable region, no timer; `public/app.js` clears
 * it each submission. A build's ending goes to {@link renderBuildEnding} (PLAN decision 23).
 */
export function renderPromptNotice(notice: string, tone: PromptNoticeTone = "answer"): string {
  const sentence =
    tone === "refusal"
      ? `<span ${PROMPT_REFUSAL_ATTRIBUTE}>${escapeHtml(notice)}</span>`
      : escapeHtml(notice);
  return `<div id="prompt-notice" hx-swap-oob="innerHTML">${sentence}</div>`;
}

/**
 * The one control a run offers: Cancel while it works, Continue once it has an ending. Keyed by
 * build id, since a fixed id would out-of-band one run's ending onto another run's live Cancel.
 */
function buildStreamControlElementId(buildId: string): string {
  return `build-stream-control-${buildId}`;
}

/**
 * A run's last line and the control that ends the wait: failure, stale refusal and measured no-op
 * all speak here (PLAN decision 23). Continue, not "Got it" — that word is Aluna's (CONTEXT.md).
 */
export function renderBuildEnding(buildId: string, line: string): string {
  const controlId = escapeHtml(buildStreamControlElementId(buildId));
  return [
    `<p class="build-stream__ending" data-build-ending>${escapeHtml(line)}</p>`,
    `<button id="${controlId}" class="btn btn--outline build-stream__dismiss" type="button" data-build-dismiss hx-swap-oob="outerHTML">Continue</button>`,
  ].join("\n");
}

/**
 * The three marks the shell finds the leave-a-run question by. `public/leaving-a-run.js` restates
 * the selectors and a platform test pins the two copies against each other.
 */
export const RUN_LEAVING_ATTRIBUTE = "data-run-leaving";
export const RUN_LEAVING_BACK_ATTRIBUTE = "data-run-leaving-back";
export const RUN_LEAVING_GO_ATTRIBUTE = "data-run-leaving-go";

/**
 * What the run asks before the person leaves it (design D3, ARCH §9.7). Focus lands on the
 * back-out, so it names what is kept: "Keep going" alone reads as the destructive answer.
 */
export const LEAVING_A_RUN_QUESTION =
  "If you leave now, I’ll stop making this. Nothing you already have will change.";
export const LEAVING_A_RUN_BACK_OUT = "Keep making it";
export const LEAVING_A_RUN_GO_AHEAD = "Stop and leave";

/**
 * The question's own copy, named so both answers are described by it. Keyed by build id for the
 * reason the control above is: one shared id would let one run's question describe the other's.
 */
function buildStreamLeavingElementId(buildId: string): string {
  return `build-stream-leaving-${buildId}`;
}

/**
 * The question a navigation asks before it takes the live run away (PLAN decision 17). It ships
 * hidden, because fetching it would be the teardown it asks about. Not a modal (design D2).
 */
function renderLeavingWarning(jobId: string): string {
  const questionId = escapeHtml(buildStreamLeavingElementId(jobId));
  const describedBy = `aria-describedby="${questionId}"`;
  return [
    `  <div class="build-stream__leaving" ${RUN_LEAVING_ATTRIBUTE} hidden>`,
    // No `role` on the panel: a `group` with no accessible name is ignored by assistive
    // technology, so the description that reaches the person is the one on each answer.
    `    <div class="build-stream__leaving-panel">`,
    `      <p id="${questionId}">${LEAVING_A_RUN_QUESTION}</p>`,
    `      <div class="build-stream__leaving-actions">`,
    `        <button class="btn btn--warm" type="button" ${RUN_LEAVING_BACK_ATTRIBUTE} ${describedBy}>${LEAVING_A_RUN_BACK_OUT}</button>`,
    `        <button class="btn btn--outline" type="button" ${RUN_LEAVING_GO_ATTRIBUTE} ${describedBy}>${LEAVING_A_RUN_GO_AHEAD}</button>`,
    `      </div>`,
    `    </div>`,
    `  </div>`,
  ].join("\n");
}

/**
 * The per-build SSE subscriber an accepted `/prompt` returns. Without `sse-close="done"` the
 * extension's EventSource reconnects when the server closes the stream, and re-runs the build.
 */
export function renderBuildSubscriber(jobId: string): string {
  const streamPath = buildStreamUrl(jobId);
  const cancelPath = buildCancelUrl(jobId);
  return [
    `<section class="build-stream" data-build-job-id="${escapeHtml(jobId)}" hx-ext="sse" sse-connect="${escapeHtml(streamPath)}" sse-close="done">`,
    '  <div class="build-stream__narration" aria-live="polite" sse-swap="narration" hx-swap="beforeend"></div>',
    '  <div class="build-stream__fragment" sse-swap="fragment" hx-swap="beforeend"></div>',
    '  <div class="build-stream__commit" aria-live="polite" sse-swap="commit" hx-swap="innerHTML"></div>',
    // Last, so it stands where every other action in the window stands: on the
    // window's own bottom edge, under the story rather than beside it.
    `  <button id="${escapeHtml(buildStreamControlElementId(jobId))}" class="btn btn--outline build-stream__cancel" type="button" hx-post="${escapeHtml(cancelPath)}" hx-swap="none">Cancel</button>`,
    // Beside the control rather than instead of it, and hidden until a navigation asks
    // for it. It takes the control's place on the bottom edge while it stands.
    renderLeavingWarning(jobId),
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
 * What the window is called once resolution settles it: Building… for a new capability, its own
 * label for an evolution. Rides `fragment` like {@link renderProvisionalLogo} (ADR-0002).
 */
export const BUILD_WINDOW_TITLE_ATTRIBUTE = "data-build-window-title";

/** What a window is called while something new is being made in it. */
export const BUILDING_WINDOW_TITLE = "Building…";

export function renderBuildWindowTitle(title: string): string {
  return `<div ${BUILD_WINDOW_TITLE_ATTRIBUTE}="${escapeHtml(title)}"></div>`;
}

/**
 * One capability's logo on the desk: its permanent identity and, with no taskbar, the only
 * standing list of what exists. A real `<button>`, so its menu opens from the keyboard.
 */
export interface CapabilityLogoRenderOptions {
  /**
   * Whether an `absent` tile may arm its one load-triggered attempt (ADR-0007). Default: it may;
   * false in the markup an attempt answers with, so one failure cannot spend all three at once.
   */
  readonly armLogoAttempt?: boolean;
}

export type RenderableCapabilityLogo = Pick<
  CapabilityRow,
  "id" | "label" | "display_label_override" | "incarnation_id" | "version" | "logo"
>;

export function renderCapabilityLogo(
  row: RenderableCapabilityLogo,
  options: CapabilityLogoRenderOptions = {},
): string {
  const id = escapeHtml(row.id);
  const label = canonicalCapabilityLabel(row);
  // No `hx-push-url`: the desk pushes this address itself (`public/desk-window.js`), because only
  // it knows whether it already names this capability (design D14, PLAN decision 6).
  const url = escapeHtml(capabilityUrl(row.id));
  return [
    // The slot, not the button, is what the id names: deletion and evolution address the
    // whole of it, and naming the button would leave a menu standing where the logo was.
    "<div",
    `  id="${capabilityLogoElementId(id)}"`,
    '  class="logo-slot"',
    "  data-logo-slot",
    `  data-capability-id="${id}"`,
    ">",
    "  <button",
    '    type="button"',
    `    id="${capabilityLogoFaceElementId(id)}"`,
    '    class="logo"',
    "    data-capability-logo",
    `    data-capability-id="${id}"`,
    `    hx-get="${url}"`,
    `    hx-target="#${WINDOW_CONTENT_ELEMENT_ID}"`,
    // The later press owns the region: two presses in one tick raced, and the first answering
    // last put A in the window and in the address. `replace` also frees the earlier read token.
    `    hx-sync="#${WINDOW_CONTENT_ELEMENT_ID}:replace"`,
    '    hx-swap="innerHTML"',
    `    aria-label="Open ${escapeHtml(label)}"`,
    // A menu opens on this button, which "Open Notes, button" alone would not say. The shell
    // moves `aria-expanded` as the menu opens and closes (`public/logo-menu.js`).
    '    aria-haspopup="menu"',
    '    aria-expanded="false"',
    "  >",
    indent(renderCapabilityLogoTile(row, options.armLogoAttempt !== false), 4),
    `    <span class="logo-label" data-logo-label>${escapeHtml(label)}</span>`,
    "  </button>",
    indent(renderCapabilityLogoMenu(row, label), 2),
    indent(renderCapabilityRenameEditor(row, label), 2),
    "</div>",
  ].join("\n");
}

/**
 * Just the face: the tile and the name, without the menu and the rename form beside them. An
 * arriving picture swaps this and not the slot, so a rename form typed into meanwhile survives.
 */
export function renderCapabilityLogoFace(
  row: RenderableCapabilityLogo,
  options: CapabilityLogoRenderOptions = {},
): string {
  const slot = renderCapabilityLogo(row, options);
  const opened = slot.indexOf("  <button");
  const closed = slot.indexOf("  </button>") + "  </button>".length;
  return slot.slice(opened, closed).replace(/^ {2}/gm, "");
}

/**
 * The two things you can do to a capability rather than with it, shipped hidden beside the logo
 * rather than inside the button, since a `<button>` may not contain interactive content.
 */
function renderCapabilityLogoMenu(row: RenderableCapabilityLogo, label: string): string {
  const id = escapeHtml(row.id);
  const deletionUrl = escapeHtml(capabilityDeletionUrl(row.id));
  return [
    "<div",
    `  id="${capabilityLogoMenuElementId(id)}"`,
    '  class="logo-menu"',
    "  data-logo-menu",
    // Drawn rather than ruled. The menu is hidden until it opens and so has no box to measure
    // at load; the ink system watches `hidden` and draws it the moment there is one.
    "  data-ink",
    "  hidden",
    '  role="menu"',
    `  aria-label="${escapeHtml(label)}"`,
    ">",
    '  <button type="button" class="logo-menu__item" role="menuitem" data-logo-menu-rename>',
    "    Rename",
    "  </button>",
    '  <button type="button" class="logo-menu__item" role="menuitem"',
    "    data-capability-delete",
    // The window is made by the client on demand, so a control on the ground says so and the desk
    // opens one first (`WINDOW_DOORWAY_SELECTOR`, `public/desk-window.js`); the id names it.
    "    data-window-doorway",
    `    data-capability-id="${id}"`,
    `    hx-get="${deletionUrl}"`,
    `    hx-target="#${WINDOW_CONTENT_ELEMENT_ID}"`,
    // The same ownership a logo press takes: the doorway swaps into the same one slot.
    `    hx-sync="#${WINDOW_CONTENT_ELEMENT_ID}:replace"`,
    '    hx-swap="innerHTML"',
    "  >",
    "    Delete",
    "  </button>",
    "</div>",
  ].join("\n");
}

/**
 * One inline rename form. Incarnation and version ride with it: a recreate or a later evolution is
 * refused, not renamed. htmx will not swap a 4xx, so the typed value survives (PLAN decision 26).
 */
function renderCapabilityRenameEditor(row: RenderableCapabilityLogo, label: string): string {
  const id = escapeHtml(row.id);
  const renameUrl = escapeHtml(`/capability-rename/${encodeURIComponent(row.id)}`);
  const slot = escapeHtml(`#${capabilityLogoElementId(id)}`);
  return [
    "<form",
    `  id="${capabilityRenameElementId(id)}"`,
    '  class="logo-rename"',
    "  data-logo-rename",
    "  data-ink",
    "  hidden",
    `  hx-post="${renameUrl}"`,
    `  hx-target="${slot}"`,
    '  hx-swap="outerHTML"',
    '  hx-disabled-elt="find button"',
    ">",
    '  <span class="field__control logo-rename__control">',
    '    <input class="field__input" type="text"',
    '      name="label"',
    "      data-logo-rename-input",
    `      value="${escapeHtml(label)}"`,
    `      maxlength="${MAX_CAPABILITY_LABEL_CHARS}"`,
    '      autocomplete="off"',
    '      spellcheck="false"',
    `      aria-label="Rename ${escapeHtml(label)}"`,
    `      aria-describedby="${capabilityRenameErrorElementId(id)}"`,
    "    >",
    "  </span>",
    `  <input type="hidden" name="incarnation_id" value="${escapeHtml(row.incarnation_id)}">`,
    `  <input type="hidden" name="version" value="${row.version}">`,
    // The name this editor opened on, so the write is a compare-and-swap. A rename does not bump
    // the version, so version alone cannot tell two menus apart: the second overwrote the first.
    `  <input type="hidden" name="previous_label" value="${escapeHtml(row.display_label_override ?? "")}">`,
    '  <div class="logo-rename__actions">',
    '    <button type="submit" class="btn btn--primary btn--sm" data-logo-rename-save',
    `     ${busyLabelAttribute(SAVING_LABEL)}`,
    "    >Save</button>",
    '    <button type="button" class="btn btn--outline btn--sm" data-logo-rename-cancel>',
    "      Cancel",
    "    </button>",
    "  </div>",
    `  <p class="logo-rename__error" id="${capabilityRenameErrorElementId(id)}"`,
    '    data-logo-rename-error role="alert"></p>',
    "</form>",
  ].join("\n");
}

/** The incarnation-keyed address of one capability's accepted artwork. */
function logoUrlForRow(row: Pick<CapabilityRow, "id" | "incarnation_id">): string {
  return capabilityLogoUrl(row.id, row.incarnation_id);
}

/** Where an `absent` tile claims its one attempt. A paid mutation, so never a GET. */
function logoAttemptUrlForRow(row: Pick<CapabilityRow, "id" | "incarnation_id">): string {
  return capabilityLogoAttemptUrl(row.id, row.incarnation_id);
}

/**
 * The tile: artwork for a `present` row, else the placeholder, working only while an attempt is
 * armed; with none left it stays faceless (L11). The POST rides the `<span>`: htmx allows one verb.
 */
function renderCapabilityLogoTile(row: RenderableCapabilityLogo, arm: boolean): string {
  if (row.logo.status === "present") {
    return `<span class="logo-tile" style="background-image: url('${escapeHtml(logoUrlForRow(row))}')"></span>`;
  }
  if (!arm || !hasAnAttemptLeft(row)) {
    return '<span class="logo-tile logo-tile--pending"></span>';
  }
  // Armed, so a picture is on its way to this element and the tile keeps working until its own
  // attempt answers — which covers the commit gap, where the provisional tile has come down.
  return [
    '<span class="logo-tile logo-tile--pending logo-tile--working"',
    `  hx-post="${escapeHtml(logoAttemptUrlForRow(row))}"`,
    '  hx-trigger="load"',
    // One attempt at a time across the desk. Every faceless tile arms on `load`, so N of them fired
    // N concurrent 90-second calls, and a 429 from the platform's own burst spends the attempt.
    `  hx-sync="${escapeHtml(`#${DESK_LOGO_LAYER_ELEMENT_ID}:queue all`)}"`,
    `  hx-target="${escapeHtml(`#${capabilityLogoFaceElementId(row.id)}`)}"`,
    '  hx-swap="outerHTML"',
    "></span>",
  ].join("\n");
}

/**
 * Whether a tile still has an attempt. `absent` alone is not enough: the cap lives in the claim's
 * `WHERE`, so a spent row would arm a POST that can never win, animating for ever (decision 38).
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
 * The tile a new capability stands on the ground while it is being made — presentation only,
 * keyed by build id, and nameless until {@link renderProvisionalLogoName} fills the label in.
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
 * The name, once the spec has authored one: at admission there is none to write. It replaces the
 * label span alone, since replacing the button would restart the tile's animation mid-crawl.
 */
export function renderProvisionalLogoName(buildId: string, label: string): string {
  const labelId = provisionalLogoLabelElementId(escapeHtml(buildId));
  return `<span class="logo-label" id="${labelId}" hx-swap-oob="outerHTML">${escapeHtml(label)}</span>`;
}

// A newly activated capability on the ground for the first time: one of the two moments ADR-0007
// arms a load-triggered attempt (the other is a fresh desk render), so the tile keeps its default.
function renderCapabilityLogoOob(row: RenderableCapabilityLogo): string {
  return [
    `<div data-capability-logo-oob hx-swap-oob="beforeend:${CAPABILITY_LOGO_LAYER_TARGET}">`,
    indent(renderCapabilityLogo(row), 2),
    "</div>",
  ].join("\n");
}

// An evolution. Inert: evolution never enters the logo path, so this must not become a third way
// to arm an attempt. Sent even when the label held: a stale version refuses every rename (5.9/01).
function renderCapabilityLogoReplacement(row: RenderableCapabilityLogo): string {
  const targetId = capabilityLogoElementId(row.id);
  return renderCapabilityLogo(row, { armLogoAttempt: false }).replace(
    "<div",
    () => `<div hx-swap-oob="${escapeHtml(`outerHTML:#${targetId}`)}"`,
  );
}

/**
 * The in-window surface for an active capability: data-free scaffolding, records arriving through
 * the `read` action into its live region (ADR-0004, ADR-0005). The `<section>` already names it.
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
 * The literal anchors page assembly replaces, each paired with what a shell missing it looks like.
 * Both are checked on every page: one checked only with a notice would fail only for that load.
 */
export const PAGE_ASSEMBLY_ANCHORS = [
  {
    name: "the logo-layer placeholder",
    remove: (shellHtml: string) => shellHtml.replace(SHELL_LOGO_PLACEHOLDER, ""),
  },
  {
    name: "the prompt bar's notice slot",
    remove: (shellHtml: string) => shellHtml.replace(SHELL_PROMPT_NOTICE_SLOT, ""),
  },
] as const;

/**
 * The on-load shell, its logo layer rehydrated by the renderer the commit-time OOB path also uses.
 * No window is composed in, so `/capability/:id` renders this same desk (PLAN decision 21).
 */
export function renderRehydratedShell(
  rows: readonly RenderableCapabilityLogo[],
  shellHtml: string,
  notice?: string,
): string {
  const spoken = withPromptNotice(shellHtml, notice);
  if (rows.length === 0) {
    // An empty desk inserts no logos, but the anchor the first commit will need is checked here
    // anyway: a data-dependent check fails loudly only for users who already have capabilities.
    requireLogoLayerAnchor(spoken);
    return spoken;
  }

  return injectCapabilityLogos(spoken, renderCapabilityLogos(rows));
}

/**
 * Seeds the prompt bar's slot, requiring it either way. An out-of-band div in a loading document
 * is inert, and the 400ms cue fires on `htmx:oobAfterSwap`, which a page load never dispatches.
 */
function withPromptNotice(shellHtml: string, notice: string | undefined): string {
  if (!SHELL_PROMPT_NOTICE_SLOT.test(shellHtml)) {
    throw new Error("The shell prompt-bar notice slot is missing.");
  }
  if (notice === undefined) return shellHtml;
  // A replacer function for the reason the logo injection uses one: `$&`, `$\`` and `$'` are
  // substitution patterns in a replacement string, and escaping manufactures them.
  return shellHtml.replace(
    SHELL_PROMPT_NOTICE_SLOT,
    (_slot, openTag: string) => `${openTag}${escapeHtml(notice)}</div>`,
  );
}

// One canonical logo per registry row, shell-indented and joined. Every full-shell path shares
// it, so a full-page load always shows the complete desk the registry holds, never a subset.
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
  // A replacer function, not a replacement string: `escapeHtml` turns a label's `\'` into
  // `&#39;`, so a label reading `$\'` becomes the `$&` pattern, and `$\`` splices the document in.
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
