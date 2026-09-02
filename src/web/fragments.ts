// The route layer's HTML fragments — the small bits of markup the `/prompt` and
// build flows return or stream into the shell.
//
// The shell is dumb on purpose (CONTEXT.md "Shell"): the server sends fragments and
// the client places them. These renderers are the server side of that contract.

import {
  type CapabilityRow,
  canonicalCapabilityLabel,
  LOGO_MAX_CLAIMED_ATTEMPTS,
  MAX_CAPABILITY_LABEL_CHARS,
} from "../registry/index.ts";
import { escapeHtml } from "./html.ts";

const CAPABILITY_LOGO_LAYER_TARGET = "#capability-logos";

/**
 * What Save says while its write waits its turn in the coordinator's queue. A rename goes
 * behind a build that is already queued, so the wait is real and occasionally long — and a
 * control that only goes grey has not said anything about it.
 */
const SAVING_LABEL = "Saving…";

/**
 * The element id one capability's logo carries. Deletion addresses it to take the logo
 * off the desk (`src/capability-deletion/presentation.ts`), so it is written once rather
 * than assembled the same way in two places. Capability ids are `[a-z][a-z0-9_]*`
 * (`src/registry/spec.ts`), so this is always a valid CSS identifier.
 */
export function capabilityLogoElementId(capabilityId: string): string {
  return `capability-logo-${capabilityId}`;
}

/**
 * The button inside that slot — the tile and the name, and the press that opens the
 * capability. Named separately because it is what one swap and only one is addressed at:
 * an arriving picture replaces the face, never the whole slot, so a rename form standing
 * open beside it survives artwork landing underneath it.
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
 * The layer every capability logo stands in (`public/index.html`). Named here because it is
 * what an armed attempt queues against, so the two cannot drift; `fragments.test.ts` pins
 * that the shell still carries it.
 */
export const DESK_LOGO_LAYER_ELEMENT_ID = "capability-logos";

/**
 * The window's one content region — the target every desk control that opens something
 * swaps into (`WINDOW_CONTENT_ID`, `public/desk-window.js`). It is also what those controls
 * *synchronise* against: the region holds one thing at a time, so two requests aimed at it
 * are two answers for one slot, and the later press must win.
 */
export const WINDOW_CONTENT_ELEMENT_ID = "spec-build-output";

// The shell's logo-layer placeholder comment (public/index.html) — where the on-load
// rehydration and direct `/capability/:id` navigation inject one logo per capability.
const SHELL_LOGO_PLACEHOLDER = "          <!-- Capability logos render here. -->";

// The prompt bar's one live slot, empty, as the shell ships it (public/index.html). Page
// assembly seeds a sentence into it for the one load that arrives already having something
// to say — a link to a capability that is not there (PLAN decision 21). Every other
// sentence reaches it as the out-of-band swap `renderPromptNotice` writes.
//
// Matched by id and kept open-tag-first, for the reason `METRICS_SEED_TARGET` gives one
// module over (`src/web/cached-view.ts`): this is a real element that CSS styles, that
// `public/prompt-bar.js` writes into and that `public/logo-menu.js` measures, so it is the
// likeliest element in the shell to gain an attribute one day. An exact tag copy would
// turn that attribute into an outage on every page, `/` included.
const SHELL_PROMPT_NOTICE_SLOT = /(<div\b[^>]*\bid="prompt-notice"[^>]*>)<\/div>/;

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
 * The product-voice line a blank submission is answered with.
 *
 * The bar answers it without asking (`public/prompt-bar.js` restates this line, and a
 * platform test pins that the two agree): nothing to build is nothing to open a window
 * for, so an empty field and one holding only spaces are the same submission and neither
 * reaches the wire. This is what every submission that did not come from that bar gets —
 * a non-browser POST, and anything the bar's own reading let through.
 *
 * The field carries no `required`. The browser's bubble is not the desk's voice, it
 * cannot tell an empty field from one holding three spaces, and it answers the first
 * while ignoring the second — so the bar says the same true thing for both instead.
 */
export const BLANK_PROMPT_NOTICE = "What would you like me to make?";

/**
 * The other end of the same admission: a submission far longer than anything a person
 * types at the bar.
 *
 * The prompt is read as one string, trimmed into a second copy and scanned with a Unicode
 * regex before anything looks at it, and the resolver is then paid to classify it. The
 * server-wide body cap (`src/index.ts`) bounds the bytes; this bounds the *prompt*, so a
 * body that is within the cap and still absurd is turned down at the desk in the desk's own
 * voice rather than spending a provider call.
 */
export const MAX_PROMPT_LENGTH = 4000;
export const LONG_PROMPT_NOTICE =
  "That’s a lot to take in at once. Give me the short version and I’ll make a start.";

/**
 * What every address and every press that names nothing is answered with — a link to a
 * capability that is gone, a tile a second tab is still standing for one, a name Aluna
 * never had (PLAN decision 21). One sentence, so the two carriers cannot drift into two
 * voices on the one surface they both speak on: page assembly seeds it below, and
 * `NOT_FOUND_FRAGMENT` (`src/router/failure-responses.ts`) marks it for the shell to lift
 * onto the prompt bar or into the window, whichever asked.
 *
 * Brief, and it stops where the truth stops. A deletion that finished takes its registry
 * row with it, so most of the time a bookmark to a capability deleted an hour ago and a
 * mistyped one arrive indistinguishable — the tombstone only outlives the row while its
 * cleanup is still outstanding, which is not a distinction to hang copy on. A sentence
 * claiming the capability *used to* be there would be guessing, and one narrating the
 * desk the person is already looking at would be spending the second half of a brief
 * notice on what the viewport already says.
 */
export const NOT_FOUND_NOTICE = "Hmm — I can’t find that one.";

/**
 * Whether a sentence on the prompt bar is Aluna answering or Aluna turning something
 * down. It is the message that knows, so the message says so, and the shell needs no
 * table of which sentences are refusals.
 */
export type PromptNoticeTone = "answer" | "refusal";

/**
 * The marker a refused sentence carries into the prompt bar's one live slot. The shell
 * flashes the bar for 400ms when it lands (`public/app.js`, `.prompt.is-refused`) —
 * the attention cue kept from the design, no longer the whole message (PLAN decision 24).
 */
export const PROMPT_REFUSAL_ATTRIBUTE = "data-prompt-refusal";

/**
 * The out-of-band `#prompt-notice` swap: the one shape every warm answer that never
 * became a build speaks in — a warm deflection, a deletion's outcome, the blank-prompt
 * refusal. Single-sourced here so the id and the swap mode cannot drift between the
 * paths that emit it — the shell clears this element on every submission
 * (`public/app.js`), so the line retires by itself.
 *
 * The slot is one replaceable `aria-live` region rather than a stack or a timer: each
 * sentence replaces the one before it, and nothing schedules its own removal.
 *
 * A build's own terminal outcome no longer speaks here. A failure, a stale refusal and a
 * measured no-op end the narration instead ({@link renderBuildEnding}) and the window
 * holds there, because the log is already the live region and is already where the person
 * is looking (PLAN decision 23).
 */
export function renderPromptNotice(notice: string, tone: PromptNoticeTone = "answer"): string {
  const sentence =
    tone === "refusal"
      ? `<span ${PROMPT_REFUSAL_ATTRIBUTE}>${escapeHtml(notice)}</span>`
      : escapeHtml(notice);
  return `<div id="prompt-notice" hx-swap-oob="innerHTML">${sentence}</div>`;
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
 * The three marks the shell finds the leave-a-run question by, and the id its copy is
 * announced through. `public/leaving-a-run.js` restates the selectors and a platform test
 * pins the two copies against each other, the way every other shell/server pair is pinned.
 */
export const RUN_LEAVING_ATTRIBUTE = "data-run-leaving";
export const RUN_LEAVING_BACK_ATTRIBUTE = "data-run-leaving-back";
export const RUN_LEAVING_GO_ATTRIBUTE = "data-run-leaving-go";

/**
 * What the run asks before the person leaves it, and what the two answers are called.
 *
 * Leaving the live run kills it, so the desk says the one true cost and the one true
 * reassurance: the making stops, and nothing that already exists is touched — which is
 * design D3's promise, still kept (`design/index.html`). No "build", no "cancel", no
 * "job": the run is *this*, the thing being made (ARCH §9.7).
 *
 * Both answers name the act from the person's side, and both name their object. **Keep
 * going** on its own reads as *yes, go on with what I asked* — which is the destructive
 * reading, on the answer focus lands on so that an answer given blind loses nothing. So it
 * says what is being kept, the way **Keep it** does on a deletion.
 */
export const LEAVING_A_RUN_QUESTION =
  "If you leave now, I’ll stop making this. Nothing you already have will change.";
export const LEAVING_A_RUN_BACK_OUT = "Keep making it";
export const LEAVING_A_RUN_GO_AHEAD = "Stop and leave";

/**
 * The question's own copy, named so both its answers are described by it. Keyed by the
 * build id for the same reason the control above is: the shell admits one subscriber at a
 * time but can only refuse one that has already landed, and two ids the same would let one
 * run's question describe the other's.
 */
function buildStreamLeavingElementId(buildId: string): string {
  return `build-stream-leaving-${buildId}`;
}

/**
 * The question that asks before a navigation takes the live run away (PLAN decision 17).
 *
 * It ships with the run and stands hidden, exactly the way the record form's deletion
 * confirmation does (`src/presentation/record-view.ts`): a surface that has to appear
 * *without* the region changing hands cannot be fetched or swapped in, because the swap
 * that delivered it would be the very teardown it exists to ask about. So the answer is
 * already in the page, and the desk only stops hiding it.
 *
 * Two elements, because it is asked over the window rather than under the story: the
 * outer one is the ground it darkens, and the panel inside it is what is read. It is not
 * a modal and it is not a second surface (design D2) — nothing opens over the desk, the
 * page is not made inert, focus is not trapped, and the whole of it stays inside the run
 * it is about. It is the run's own surface saying one thing loudly, over its own window
 * and no further. The run's control is hidden for as long as it stands, because a Cancel
 * beside a question about stopping is two ways to say one thing.
 */
function renderLeavingWarning(jobId: string): string {
  const questionId = escapeHtml(buildStreamLeavingElementId(jobId));
  const describedBy = `aria-describedby="${questionId}"`;
  return [
    `  <div class="build-stream__leaving" ${RUN_LEAVING_ATTRIBUTE} hidden>`,
    // No `role` and no description on the panel. A `group` with no accessible name is
    // ignored by assistive technology, and a description hung on an ignored element is
    // read by nobody; what actually reaches the person is the description on each answer,
    // which is why both carry it.
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
  "id" | "label" | "display_label_override" | "incarnation_id" | "version" | "logo"
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
    // The slot, not the button, is what the id names. Everything that addresses one
    // capability's place on the desk — the attempt's own swap, evolution's replacement,
    // deletion's `delete:` — means the whole of it, and a menu left standing where its
    // logo used to be is exactly what naming the button instead would leave behind.
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
    // The later press owns the region. Two presses in one tick left two requests running
    // against the same slot with no ownership between them: if the first answered last, the
    // window showed A while the bar said B, and the swap's own `HX-Replace-Url` then
    // *replaced* the address with A — silently discarding the entry the person pushed for B.
    // `replace` abandons the earlier request instead, which is also what frees its read
    // token on the server.
    `    hx-sync="#${WINDOW_CONTENT_ELEMENT_ID}:replace"`,
    '    hx-swap="innerHTML"',
    `    aria-label="Open ${escapeHtml(label)}"`,
    // A menu opens on this button, and a reader that is only told "Open Notes, button"
    // has no way to learn that. `aria-expanded` is moved by the shell as the menu opens
    // and closes (`public/logo-menu.js`).
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
 * Just the face: the tile and the name under it, with nothing the menu hangs on the slot
 * beside them.
 *
 * What an arriving picture swaps, and the only swap that is not the user's own doing —
 * which is exactly why it is narrow. A load-triggered attempt answers seconds after the
 * desk renders, and replacing the whole slot with it would take away a rename form the
 * person had opened and typed into in the meantime, with no message and nothing to
 * recover the value from.
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
 * The two things you can do to a capability rather than with it, and nothing else.
 *
 * Ships with the logo and hidden, the way the record view ships its delete confirmation:
 * the shell un-hides it and no round trip stands between a right-click and the menu. It
 * is a sibling of the button rather than a child because a `<button>` may not contain
 * interactive content, which is also why the rename editor below is one.
 *
 * Delete is the doorway 4.x built and 5.9 finally hangs: the confirmation it opens fills
 * the window (5.9/02), so this control asks for the window like any other piece of desk
 * furniture and is refused on the prompt bar when a run still owns it (PLAN decision 20).
 * Nothing destructive appears in window chrome, which is what leaves D3 standing.
 */
function renderCapabilityLogoMenu(row: RenderableCapabilityLogo, label: string): string {
  const id = escapeHtml(row.id);
  const deletionUrl = escapeHtml(`/capability-deletion/${encodeURIComponent(row.id)}`);
  return [
    "<div",
    `  id="${capabilityLogoMenuElementId(id)}"`,
    '  class="logo-menu"',
    "  data-logo-menu",
    // Drawn rather than ruled, like every other boundary on this surface. The menu is
    // hidden until it opens, so it has no box to measure at load; the ink system watches
    // `hidden` and draws it the moment it has one.
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
    // The window is made by the client and does not exist until something asks for one, so
    // a control on the ground that swaps into it says so and the desk opens one first
    // (`WINDOW_DOORWAY_SELECTOR`, `public/desk-window.js`). The id is what lets the window
    // it opens be called what the capability is called.
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
 * The one inline rename form, anchored where the label already lives.
 *
 * It stands under the tile with the label hidden beside it, so nothing about the
 * capability's place on the desk moves and no modal opens — Aluna has none. The value it
 * opens with is the effective label, which is what the person is looking at.
 *
 * The incarnation and version it was opened on ride with the submission. They are what
 * binds the write to the exact capability the menu opened on: a delete-and-recreate under
 * the same id, or an evolution that landed in between, is refused rather than renamed.
 *
 * It answers into the slot rather than the window. A refusal is a 4xx, which htmx does not
 * swap, so the typed value and the editor's focus survive one untouched while its sentence
 * goes to the prompt bar (PLAN decision 26).
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
    // The name this editor opened on, so the write is a compare-and-swap on it. A rename
    // does not bump the version, so the version alone cannot tell two menus opened on the
    // same one apart, and the second used to overwrite the first in silence.
    `  <input type="hidden" name="previous_label" value="${escapeHtml(row.display_label_override ?? "")}">`,
    '  <div class="logo-rename__actions">',
    '    <button type="submit" class="btn btn--primary btn--sm" data-logo-rename-save',
    `      data-busy-label="${escapeHtml(SAVING_LABEL)}"`,
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
    // One attempt at a time across the whole desk. Every faceless tile arms on `load`, so a
    // desk with N of them fired N simultaneous claims and N concurrent 90-second provider
    // calls — and a provider-side 429 caused by the platform's own burst releases the claim
    // with the attempt already spent. Three rounds of that and a capability wears the
    // permanent placeholder having produced no artwork at all: the 3-attempt cap is never
    // exceeded, the budget is simply destroyed inside it. Queued against the layer they all
    // stand in, so they take their turns instead of racing.
    `  hx-sync="${escapeHtml(`#${DESK_LOGO_LAYER_ELEMENT_ID}:queue all`)}"`,
    `  hx-target="${escapeHtml(`#${capabilityLogoFaceElementId(row.id)}`)}"`,
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

// An evolution. **Inert**: evolution never enters the logo path, so re-rendering a still
// faceless tile here must not become a third way to arm an attempt. Only a fresh desk
// render or a newly activated tile may do that.
//
// Sent whether or not the label moved. It used to be skipped for an evolution that kept
// its name, on the reasoning that the label was the only thing on the desk an evolution
// could change. Since 5.9/01 the slot also carries the version a rename is bound to, and
// a desk left holding the old number refuses every rename of that capability — for ever,
// with the stale sentence, until the page is reloaded. The saving was one small fragment;
// the cost was a control that silently stopped working.
function renderCapabilityLogoReplacement(row: RenderableCapabilityLogo): string {
  const targetId = capabilityLogoElementId(row.id);
  return renderCapabilityLogo(row, { armLogoAttempt: false }).replace(
    "<div",
    () => `<div hx-swap-oob="${escapeHtml(`outerHTML:#${targetId}`)}"`,
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
 * Two anchors are what remain, and both still fail loudly. The prompt bar's slot is
 * required on every page whether or not that page has a sentence for it: an anchor
 * checked only when a notice is passed would fail loudly only for the one load that
 * carries one, which is the data-dependence the empty-desk case below exists to close.
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
 * one — including the navigation whose capability is not there, which loads this desk
 * with `notice` speaking on the prompt bar (PLAN decision 21).
 */
export function renderRehydratedShell(
  rows: readonly RenderableCapabilityLogo[],
  shellHtml: string,
  notice?: string,
): string {
  const spoken = withPromptNotice(shellHtml, notice);
  if (rows.length === 0) {
    // An empty desk inserts no logos — but the anchor the first commit will need is
    // checked here, on the page a fresh user actually loads, rather than left to fail on
    // that commit. An anchor whose check is data-dependent is an anchor that fails loudly
    // only for users who already have capabilities.
    requireLogoLayerAnchor(spoken);
    return spoken;
  }

  return injectCapabilityLogos(spoken, renderCapabilityLogos(rows));
}

/**
 * Seed the prompt bar's slot with the sentence this load arrives having, and require the
 * slot either way.
 *
 * The sentence is placed rather than swapped because there is nothing to swap into yet:
 * an out-of-band `#prompt-notice` div in a document the browser is loading is inert
 * markup, not an htmx swap, so a full page load is the one path `renderPromptNotice`
 * cannot serve. The element, its `aria-live` and every attribute it carries are the
 * shell's own — the open tag is taken from the shell rather than restated here — and only
 * the text arrives from this, which is why this adds no notice component.
 *
 * A seeded sentence is always an answer and never a refusal, so it carries no
 * `data-prompt-refusal`. That is not a shortcut: the 400ms cue fires on
 * `htmx:oobAfterSwap` (`public/prompt-bar.js`), which a page load never dispatches, and a
 * marker whose cue can never run would be a claim the bar could not honour. Nothing on
 * this path is a refusal anyway — the person followed a link, and Aluna is answering it.
 */
function withPromptNotice(shellHtml: string, notice: string | undefined): string {
  if (!SHELL_PROMPT_NOTICE_SLOT.test(shellHtml)) {
    throw new Error("The shell prompt-bar notice slot is missing.");
  }
  if (notice === undefined) return shellHtml;
  // A replacer function for the same reason the logo injection uses one: `$&`, `` $` ``
  // and `$'` are substitution patterns in a replacement *string*, and escaping the
  // sentence manufactures them rather than avoiding them.
  return shellHtml.replace(
    SHELL_PROMPT_NOTICE_SLOT,
    (_slot, openTag: string) => `${openTag}${escapeHtml(notice)}</div>`,
  );
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
