// @ts-check

/**
 * Leaving a run, and the question that comes first.
 *
 * Three things on the desk remove a build or an evolution that is still going: putting
 * the window away, pressing another capability's logo, and Back or Forward. All three
 * are navigations, all three make the run unreachable, and until now all three took it
 * away without asking — the lamp by cancelling it outright, the other two by orphaning
 * it on a server nobody was watching. This module is the one place that asks, and the
 * one place a run the person is leaving actually ends (PLAN decision 17, amending
 * design D3).
 *
 * Three properties are the whole of the subject, and each is here for a reason:
 *
 *   - **The question does not swap anything.** It is a row that already ships hidden
 *     inside the run's own surface (`renderBuildSubscriber`, `src/web/fragments.ts`) and
 *     the desk only stops hiding it. A question fetched into the content region, or a
 *     surface opened over it, would be the very teardown it exists to ask about: the
 *     region rule releases whatever a region's content started the moment that content
 *     is replaced, so *asking* would cancel the run.
 *   - **One run ends one way.** `endRunIn` is that way — the run's own cancel route,
 *     pressed on the person's behalf, and then the story taken down through htmx's own
 *     cleanup so the stream closes, the prompt bar unlocks and the provisional tile
 *     comes down exactly as they do for every other ending. Nothing else in the desk
 *     may end a live run.
 *   - **The run is over before the navigation happens.** The person asked to leave, and
 *     what a cancelled run streams back is the surface they are leaving; promoting it
 *     first would paint the window they have already left. Closing the stream here is
 *     what stops that terminal from ever arriving.
 *
 * The primitives a run is recognised by live here too, because this is the module that
 * owns "there is a run, and leaving costs you it".
 *
 * Named for the act rather than for a thing, and deliberately: what it owns is not a part
 * of the desk but something a person does to one. `region-scope.js`, `swap-target.js` and
 * `logo-attempt.js` are the neighbours it keeps.
 *
 * Nothing here asks whether a node is an `Element`. Every rule is written against the
 * DOM facts it actually needs — the way the tile's and the release scope's are — so a
 * real document satisfies them and so does a plain object, which is what lets the whole
 * of this run in Bun without a browser.
 */

import { releaseRegionContent } from "./region-scope.js";

/** One run's subscriber — the node the run's id is written on. */
const BUILD_SUBSCRIBER_SELECTOR = "[data-build-job-id]";

/**
 * The two things a run that is over is holding the window with, and neither is something
 * leaving can cost you: the ending it is waiting to have read (PLAN decision 25), and the
 * capability surface a successful activation committed into it.
 *
 * The commit is here for a reason a test would not have found. It lands one event before
 * the stream closes, and in that gap the run still carries a job id — while the stylesheet
 * has already taken the question out of the page along with the rest of the story
 * (`demo.css`). A question raised there is a question nobody can see, holding a navigation
 * nobody can answer: the lamp would simply stop working for as long as the gap lasted.
 */
const BUILD_ENDING_SELECTOR = "[data-build-ending]";
const BUILD_COMMIT_SELECTOR = ".build-stream__commit";

/** The run's own control, whose place the question takes while it stands. */
const RUN_CONTROL_SELECTOR = ".build-stream__cancel";

/**
 * Where the run's control goes once the run has something to tell you: the same place,
 * wearing the other face (`renderBuildEnding`, `src/web/fragments.ts`). It is where focus
 * lands when a question is retired by the run ending underneath it, because by then the
 * control the question replaced is the one thing no longer there.
 */
const RUN_DISMISS_SELECTOR = "[data-build-dismiss]";

/**
 * The question and its two answers, restated from `src/web/fragments.ts` the way this
 * shell restates every mark the server authors; a platform test pins the two copies.
 */
export const LEAVING_WARNING_SELECTOR = "[data-run-leaving]";
export const LEAVING_BACK_SELECTOR = "[data-run-leaving-back]";
export const LEAVING_GO_SELECTOR = "[data-run-leaving-go]";

/**
 * Where focus goes when a confirmed navigation left it on nothing. The same landing the
 * dismissal of an ending uses (`public/app.js`), restated here for the same reason.
 */
export const PROMPT_FIELD_ID = "spec-build-prompt";

/**
 * The DOM facts these rules need, and no more.
 *
 * @typedef {{
 *   hidden?: boolean,
 *   focus?: () => void,
 *   childNodes?: { length: number },
 *   querySelector?: (selector: string) => Answerable | null,
 * }} Answerable
 * @typedef {{
 *   getAttribute(name: string): string | null,
 *   querySelector(selector: string): Answerable | null,
 * }} RunNode
 * @typedef {{ querySelector(selector: string): RunNode | null }} WindowNode
 */

/**
 * The one thing this module borrows from htmx, and the same call `tearDownWindow` makes
 * for the same reason: `swap` runs htmx's cleanup over the node *while it is still
 * connected*, which is what closes the run's `EventSource` and lets the `htmx:sseClose`
 * that unlocks the prompt bar and takes the build's tile down bubble to the document.
 * `remove` would be `removeChild` and would leak the stream.
 *
 * @typedef {{
 *   swap?: (target: unknown, content: string, spec: { swapStyle: string, swapDelay: number, settleDelay: number }) => void,
 * }} Htmx
 * @returns {Htmx | undefined}
 */
function htmx() {
  return /** @type {Window & { htmx?: Htmx }} */ (window).htmx;
}

/**
 * A run standing in the window, whether it is still going or has ended and is waiting to
 * be read. What a press has to know about, because either one is holding the window.
 *
 * @param {WindowNode} el
 * @returns {RunNode | null}
 */
export function buildRunIn(el) {
  return el.querySelector(BUILD_SUBSCRIBER_SELECTOR);
}

/**
 * Whether a run is *using* the window rather than only standing in it.
 *
 * The one line two guards have to draw the same way: the desk refuses a piece of desk
 * furniture that would take the window from a run (`public/app.js`), and the doorway
 * decides whether to stand a window up and rename it for the answer that press is about
 * to get (`public/desk-doorway.js`). Asked differently they disagree over a run that has
 * activated but not yet closed its stream — the refusal turns the press down while the
 * doorway has already renamed the window over the run's own content, which is the press
 * changing something after all.
 *
 * A run holding an ending is not using the window: it has stopped, and the desk lets it
 * be displaced. The line `buildJobIdIn` draws is a different one — work still in flight
 * — and it may not be borrowed for this.
 *
 * @param {WindowNode} el
 * @returns {boolean}
 */
export function runIsUsingWindow(el) {
  const run = buildRunIn(el);
  return run !== null && run.querySelector(BUILD_ENDING_SELECTOR) === null;
}

/**
 * The build the window is narrating, if it is narrating one.
 *
 * A run that ended and is only waiting to be read does not count. Its subscriber stays
 * standing until the ending is dismissed (PLAN decision 25), and everything that asks
 * *this* question is asking about work in progress: what leaving has to cancel, and what
 * it has to warn about first. Neither is owed for a run that is already over, and a
 * warning about losing a build that finished minutes ago is worse than no warning at
 * all. Whether the window is *held* is `buildRunIn`.
 *
 * @param {WindowNode} el
 * @returns {string | null}
 */
export function buildJobIdIn(el) {
  const run = buildRunIn(el);
  if (run === null || run.querySelector(BUILD_ENDING_SELECTOR) !== null) return null;
  if (holdsSomething(run.querySelector(BUILD_COMMIT_SELECTOR))) return null;
  return run.getAttribute("data-build-job-id");
}

/**
 * Whether a surface has anything in it. Asked of the commit region, which is empty for
 * every run that has not activated and carries the capability's own collection for the
 * one that has.
 *
 * @param {Answerable | null} surface
 * @returns {boolean}
 */
function holdsSomething(surface) {
  return (surface?.childNodes?.length ?? 0) > 0;
}

/**
 * Where a build is cancelled. The same route the run's own Cancel control posts to.
 * @param {string} jobId
 * @returns {string}
 */
export const buildCancelUrl = (jobId) => `/build/${encodeURIComponent(jobId)}/cancel`;

/**
 * `keepalive`, because the node that would have carried an htmx request is about to be
 * detached and the page may be on its way out behind it.
 *
 * @param {string} url
 */
function postCancel(url) {
  void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
}

/**
 * The run's cancel route, pressed on the person's behalf, and the one place anything
 * outside the run's own control row stops it. A desk action may never grow a second.
 *
 * @param {WindowNode} el the window
 * @param {(url: string) => void} [post]
 * @returns {string | null} the run it cancelled, if one was going
 */
export function cancelBuildIn(el, post = postCancel) {
  const jobId = buildJobIdIn(el);
  if (jobId === null) return null;
  post(buildCancelUrl(jobId));
  return jobId;
}

/**
 * The order an ending owes, stated on its own so it can be proved without a browser —
 * the way `tearDownWindow` states the window's.
 *
 *   1. The cancel route ({@link cancelBuildIn}), so the server stops making something
 *      nobody will see.
 *   2. The region rule, while the story is still connected — the only moment an htmx
 *      request underneath it can be aborted.
 *   3. htmx's own cleanup, which closes the stream. Nothing the run has left to say can
 *      arrive after this, which is what keeps a cancelled run's restoration from being
 *      painted into a window the person has already asked to leave.
 *
 * What comes next belongs to the navigation that asked, not to this: the window's name
 * and the address are the continuation's to write.
 *
 * A missing way to detach stops the whole thing before the cancel, rather than after it.
 * Ending a run halfway — stopped on the server, still narrating on screen — is the worst
 * of the three outcomes, and it is the one that would send the navigation on top of a run
 * that is still standing there to be asked about again.
 *
 * @template T
 * @param {{
 *   run: T | null,
 *   cancel: () => string | null,
 *   release: (run: T) => void,
 *   detach: ((run: T) => void) | null,
 * }} ending
 * @returns {boolean} whether there was a run and it ended
 */
export function endTheRun({ run, cancel, release, detach }) {
  if (run === null || detach === null) return false;
  if (cancel() === null) return false;
  release(run);
  detach(run);
  return true;
}

/**
 * End the run this window is narrating.
 *
 * @param {WindowNode} el the window
 * @param {{ api?: Htmx | undefined, post?: (url: string) => void, release?: (run: never) => void }} [how]
 * @returns {boolean} whether there was a run to end
 */
export function endRunIn(el, how = {}) {
  const { api = htmx(), post = postCancel, release = releaseRegionContent } = how;
  return endTheRun({
    run: buildRunIn(el),
    cancel: () => cancelBuildIn(el, post),
    release: /** @type {(run: unknown) => void} */ (release),
    detach: api?.swap
      ? (run) => api.swap?.(run, "", { swapStyle: "outerHTML", swapDelay: 0, settleDelay: 0 })
      : null,
  });
}

/* ── the question ──────────────────────────────────────────────────────────── */

/**
 * Show or hide the question, and put focus where the answer leaves it.
 *
 * The row takes the run's control out of the page rather than standing beside it, so
 * nothing moves and the story stays readable above the question — the shape the record
 * form's deletion confirmation has, for the same reason. Focus follows the same rule in
 * both directions: it enters on the back-out, which is the answer that loses nothing,
 * and it lands back on the control when the question goes, because that is the place the
 * question was standing.
 *
 * Neither half touches the content region, and that is the load-bearing part: a question
 * that swapped anything would fire the very cleanup it exists to ask about. Two `hidden`
 * flags and a focus are the whole of it.
 *
 * @template {{ hidden?: boolean }} T
 * @param {{
 *   asking: boolean,
 *   control: T | null,
 *   warning: T | null,
 *   backOut: T | null,
 *   focus: (node: T) => void,
 * }} row
 */
export function applyLeavingQuestion({ asking, control, warning, backOut, focus }) {
  if (control !== null) control.hidden = asking;
  if (warning !== null) warning.hidden = !asking;
  const landing = asking ? backOut : control;
  if (landing !== null) focus(landing);
}

/**
 * Ask or unask the question standing in one run's surface.
 *
 * @param {RunNode} run
 * @param {boolean} asking
 * @returns {boolean} whether there was a question to move
 */
function setQuestion(run, asking) {
  const warning = run.querySelector(LEAVING_WARNING_SELECTOR);
  if (warning === null) return false;
  /* The control, or what has taken its place. A run that ended while the question was
   * standing had its Cancel swapped out of band for the way back, under the same id — so
   * the place the question was standing in is still there, wearing the other face, and
   * focus goes to it rather than being dropped on `<body>`. */
  const control =
    run.querySelector(RUN_CONTROL_SELECTOR) ?? run.querySelector(RUN_DISMISS_SELECTOR);
  applyLeavingQuestion({
    asking,
    control,
    warning,
    backOut: warning.querySelector?.(LEAVING_BACK_SELECTOR) ?? null,
    focus: (node) => node.focus?.(),
  });
  return true;
}

/**
 * The navigation the desk is holding while the person answers, or nothing.
 *
 * One at a time. A second press while the question stands is held and dropped rather
 * than queued: the person is being asked one thing, and answering it is what moves.
 *
 * @type {{ el: WindowNode, run: RunNode, go: () => void } | null}
 */
let asking = null;

/** Whether a navigation is being held. @returns {boolean} */
export function leavingIsBeingAsked() {
  return asking !== null;
}

/**
 * Ask before leaving, if there is a run to lose.
 *
 * @param {WindowNode | null} el the window the navigation would take
 * @param {() => void} go what to do once the person says to leave
 * @returns {boolean} whether the navigation is being held — the caller goes ahead itself
 *   when it is not, so a desk with nothing running behaves exactly as it always has
 */
export function askBeforeLeaving(el, go) {
  if (asking !== null) {
    /* A second navigation while the question stands is held and dropped rather than
     * queued — the person is being asked one thing, and answering it is what moves. Focus
     * goes back to the question so the press is answered rather than looking broken. */
    asking.run
      .querySelector(LEAVING_WARNING_SELECTOR)
      ?.querySelector?.(LEAVING_BACK_SELECTOR)
      ?.focus?.();
    return true;
  }
  if (el === null || buildJobIdIn(el) === null) return false;
  const run = buildRunIn(el);
  /* No row to ask with is not a reason to trap the person in the window. A shell that
   * served a run without one has a bug worth finding, and swallowing their navigation
   * would hide it behind a control that looks broken. */
  if (run === null || !setQuestion(run, true)) return false;
  asking = { el, run, go };
  return true;
}

/**
 * The person said to stay. Nothing was cancelled and nothing was navigated: the run is
 * exactly where it was, still going, in a window that never moved.
 *
 * @returns {boolean} whether there was a question to back out of
 */
export function backOutOfLeaving() {
  const held = asking;
  if (held === null) return false;
  asking = null;
  setQuestion(held.run, false);
  return true;
}

/**
 * The person said to leave. The run ends once, here, and then what they asked for
 * happens — with nothing of the run's own left to arrive in between.
 *
 * @param {{ activeElement?: unknown, body?: unknown, getElementById?: (id: string) => Answerable | null }} root
 * @param {{ api?: Htmx | undefined, post?: (url: string) => void, release?: (run: never) => void }} [how]
 * @returns {boolean} whether there was a question to answer
 */
export function goAheadAndLeave(root, how) {
  const held = asking;
  if (held === null) return false;
  asking = null;
  /* The navigation happens only where the run actually ended. A detach that could not run
   * — no htmx yet, a subscriber already off the page — leaves the run standing with its
   * job id intact, and continuing would re-enter the question with the same continuation:
   * one more cancel posted and one more question asked, for as long as the person kept
   * saying yes. */
  if (!endRunIn(held.el, how)) return false;
  held.go();
  settleFocus(root);
  return true;
}

/**
 * A run that ended on its own while the question was standing takes the question with
 * it. There is nothing left to lose, and the person never said they were leaving — so
 * the navigation is dropped rather than taken, and they are left where they are with
 * whatever the run has to tell them.
 *
 * @param {unknown} run
 * @returns {boolean} whether a question was standing for that run
 */
export function standDownWith(run) {
  if (asking === null || asking.run !== run) return false;
  const held = asking;
  asking = null;
  setQuestion(held.run, false);
  return true;
}

/**
 * A confirmed navigation takes its own focus with it — the lamp hands it back to
 * whatever opened the window, a logo keeps it. Where it does not, focus was on the
 * answer the person just pressed and that node has gone with the run; the prompt bar is
 * where the desk puts a person it has nowhere better to put.
 *
 * @param {{ activeElement?: unknown, body?: unknown, getElementById?: (id: string) => Answerable | null }} root
 */
function settleFocus(root) {
  const active = root.activeElement;
  if (active !== null && active !== undefined && active !== root.body) return;
  root.getElementById?.(PROMPT_FIELD_ID)?.focus?.();
}

/** Every root whose answers are already wired. */
const guarded = new WeakSet();

/**
 * Wire the question's two answers, its Escape, and the one thing that voids it.
 *
 * @param {Document} root
 */
export function startLeavingGuard(root) {
  /* Once per root. `startDeskWindow` is the one caller and runs once on a real desk, but
   * the listeners here are fresh closures that `addEventListener` cannot dedupe, and the
   * question they answer is module state shared by every root — so a second start would
   * put a second answer behind every press. */
  if (guarded.has(root)) return;
  guarded.add(root);

  root.addEventListener("click", (event) => {
    const pressed = /** @type {{ closest?: (selector: string) => unknown }} */ (event.target);
    if (typeof pressed?.closest !== "function") return;
    if (pressed.closest(LEAVING_BACK_SELECTOR) !== null) backOutOfLeaving();
    else if (pressed.closest(LEAVING_GO_SELECTOR) !== null) goAheadAndLeave(root);
  });

  /* Escape is the back-out, the way it is for the record form's deletion confirmation:
   * the exit a modal would have given for free, kept for a question that is not one.
   * Asked of the document rather than of what has focus — a person who clicked away
   * still means this question by Escape, because it is the only one standing. */
  root.addEventListener("keydown", (event) => {
    if (/** @type {KeyboardEvent} */ (event).key === "Escape") backOutOfLeaving();
  });

  /* Every real ending goes through this, whichever way the stream closed. */
  root.addEventListener("htmx:sseClose", (event) => {
    const node = /** @type {{ closest?: (selector: string) => unknown }} */ (event.target);
    const run = node?.closest?.(BUILD_SUBSCRIBER_SELECTOR);
    if (run) standDownWith(run);
  });
}
