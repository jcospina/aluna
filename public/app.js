// @ts-check
//
// Authored shell glue — runs in the browser, so it is plain JavaScript served
// verbatim from /static/app.js (no transpile, no build step; the no-build rule).
// Type safety without a build: `// @ts-check` + JSDoc means the repo's existing
// `tsc --noEmit` typechecks this file with zero runtime change.
//
// Everything here is presentation-only (no product logic — the shell is dumb on purpose,
// ARCH §6.1), and it is what is left over from the shell's modules rather than a subject
// of its own:
//   1. Registers the `shell` Alpine component (prompt courtesy state).
//   2. Hands developer-preview SSE payloads to the developer panel's window.
//   3. Promotes a build's terminal presentation once its stream closes, and reports what
//      that did to the desk, which owns the address.
//   4. Holds a run that ended with something to tell you, and gives the window back on
//      the press — including the one-subscriber guard and the restoration capture that
//      an outgoing prompt goes through.
//
// It is a classic script because it has to run before Alpine starts, which is also why
// it can import nothing: every constant it shares with a module is restated here and
// pinned by a platform test. The tile an admitted build stands on the desk is
// `desk-logos.js`, a module of its own beside `region-scope.js` and `swap-target.js`.

/**
 * The two things the desk turns down while a run has the window: a second prompt, and a
 * desk action that would take the window from it. One opening sentence, because it is one
 * true thing; the second half names what the person just did, so the two are never each
 * other. Neither is `mutation_busy`'s "I'm still putting something together", which is a
 * record write refused inside the window (`src/router/failure-responses.ts`).
 */
const BUILD_IN_FLIGHT_REFUSAL =
  "I’m still making the last thing you asked for. Let me finish, then tell me the next one.";
const DESK_ACTION_REFUSAL =
  "I’m still making the last thing you asked for. Let me finish, then try that again.";

/**
 * A capability's logo, restated from `public/desk-window.js` the way this file restates
 * every constant it shares with a module; a platform test pins that the two agree.
 */
const CAPABILITY_LOGO_SELECTOR = "[data-capability-logo]";

/**
 * The prompt bar's ids and its one refusal marker, restated the way this file restates
 * every constant it shares with a module. The bar itself is `public/prompt-bar.js`.
 */
const PROMPT_FIELD_ID = "spec-build-prompt";
const PROMPT_FORM_ID = "spec-build-form";
const PROMPT_NOTICE_ID = "prompt-notice";
const PROMPT_REFUSAL_SELECTOR = "[data-prompt-refusal]";

/**
 * What the desk says on the prompt bar. The bar is a module of its own and this script can
 * import nothing, so the glue says what happened and the bar places it (ARCH §6.1). Kept
 * in sync with public/prompt-bar.js; a platform test pins that these strings match.
 *
 * `aboutTheRun` marks the two sentences the desk says *while a run has the window*, which
 * stop being true the moment that run ends.
 *
 * @param {string} sentence the empty string retires whatever is standing
 * @param {boolean} [refused] @param {boolean} [aboutTheRun]
 */
function tellThePromptBar(sentence, refused = false, aboutTheRun = false) {
  document.dispatchEvent(
    new CustomEvent("aluna:prompt-bar-message", { detail: { sentence, refused, aboutTheRun } }),
  );
}

/**
 * The shell's presentation state.
 * @typedef {Object} ShellState
 * @property {boolean} promptBusy - Courtesy presentation state while a build stream is open.
 * @property {() => void} init - Alpine lifecycle hook; wires the stream courtesy state.
 */

// Register on `alpine:init` (dispatched at the start of Alpine.start()). This
// file is loaded before alpine.min.js precisely so this listener is in place
// when Alpine starts. `Alpine` is a global from the vendored build.
document.addEventListener("alpine:init", () => {
  // @ts-expect-error - Alpine is a runtime global, not a typed import.
  window.Alpine.data("shell", shell);
});

/**
 * Factory for the `shell` Alpine component.
 * @returns {ShellState}
 */
function shell() {
  return {
    // Courtesy prompt-bar state only — Alpine mirrors HTMX SSE open/close events in
    // the UI and decides nothing. It is not a lock: the build queue admits every job
    // it is handed, and the one-subscriber guard below is what actually holds a
    // second build off while one is running.
    promptBusy: false,

    init() {
      /** @param {boolean} clear */
      const wakePrompt = (clear) => {
        this.promptBusy = false;
        requestAnimationFrame(() => {
          const promptField = document.getElementById(PROMPT_FIELD_ID);
          if (clear && promptField instanceof HTMLInputElement) promptField.value = "";
          promptField?.focus();
        });
      };

      document.addEventListener("htmx:sseOpen", () => {
        this.promptBusy = true;
      });
      document.addEventListener("htmx:sseClose", (event) => {
        // Only a stream the server finished. `nodeReplaced` and `nodeMissing` are the desk
        // taking a run down — a leave confirmed at 5.8/04's question, a logo switch — and
        // the navigation that did it has already put focus where it belongs. Waking here
        // would throw focus at the prompt bar a frame later, over the logo the window
        // handed it back to, and would wipe words the person had typed but not sent.
        if (closeTypeOf(event) !== "message") return;
        // A run that stopped with something to tell you is not finished with the person
        // yet. Unlock the bar, but keep the words that produced the ending — a line that
        // says "mind trying again?" beside a field that was just wiped is asking for
        // something it took away — and put the keyboard on the control the window is
        // waiting on, which is also the only way an assistive technology is told the
        // control is there at all.
        const ending = heldRunEnding();
        if (ending === null) {
          // A sentence about the run that just ended retires with it. The words in the
          // field are then the ones the person typed *while* they were told to wait, and
          // were never submitted — so those stay too, for the same reason the ending's do.
          wakePrompt(!aSentenceAboutTheRunWasRetired());
          return;
        }
        this.promptBusy = false;
        requestAnimationFrame(() => {
          const control = document.querySelector(BUILD_DISMISS_SELECTOR);
          if (control instanceof HTMLElement) control.focus();
        });
      });
      // `htmx:sseError` fires on every transient drop while the transport is still
      // retrying, so waking on it unlocked the prompt mid-build. Wake only once the
      // connection itself is dead; the field keeps its text either way.
      document.addEventListener("htmx:sseError", (event) => {
        const source = /** @type {{detail?: {source?: {readyState?: number}}}} */ (event).detail
          ?.source;
        if (source?.readyState === EventSource.CLOSED) wakePrompt(false);
      });
    },
  };
}

// Kept in sync with public/region-scope.js (RELEASE_REGION_EVENT); a platform test pins
// that these strings match. A plain string because this classic script cannot import the
// module. Dispatching it on a content region asks that region's scope to release
// everything its current content started — before the content is replaced, so an htmx
// request still in flight can be aborted while it is connected.
const RELEASE_REGION_EVENT = "aluna:release-region";

/** @param {Element} region */
function releaseRegionContent(region) {
  region.dispatchEvent(new CustomEvent(RELEASE_REGION_EVENT, { bubbles: true }));
}

/**
 * The window's content region, and the way this script asks for the window itself to
 * be put away. Both are kept in sync with public/desk-window.js (WINDOW_CONTENT_ID and
 * PUT_WINDOW_AWAY_EVENT); a platform test pins that these strings match. Plain strings
 * because this classic script cannot import the module.
 */
const WINDOW_REGION_ID = "spec-build-output";
const PUT_WINDOW_AWAY_EVENT = "aluna:put-window-away";

/**
 * The two ways this script reaches the developer panel's window, kept in sync with
 * public/desk-dev-panel.js (STAGE_PAYLOAD_EVENT and STAGES_CLEARED_EVENT) and pinned by
 * the same platform test. One stage's payload, and a new build starting from an empty
 * panel rather than the last build's leavings.
 */
const STAGE_PAYLOAD_EVENT = "aluna:stage-payload";
const STAGES_CLEARED_EVENT = "aluna:stages-cleared";

/** One build's subscriber — the node the run's id is written on. */
const BUILD_SUBSCRIBER_SELECTOR = "[data-build-job-id]";

/**
 * A run that ended with something to say, and the control that ends the wait. Both are
 * authored by the server (`renderBuildEnding`, `src/web/fragments.ts`); a platform test
 * pins that these strings match. A subscriber carrying an ending is a run that has
 * already stopped and is only waiting to be read — the window holds there until the
 * ending is dismissed, and only then does the run give back what it displaced.
 */
const BUILD_ENDING_SELECTOR = "[data-build-ending]";
const BUILD_DISMISS_SELECTOR = "[data-build-dismiss]";

/**
 * Where a held run keeps the restoration it was streamed. A `<template>`, because the
 * restored collection reads through its own `hx-trigger="load"` the moment htmx settles
 * over it: parked in the live document it would fetch records into a subscriber nobody
 * can see, and do it again when the dismissal moves it into the window. Template content
 * is inert and unsearchable from the document, so it does neither.
 */
const HELD_RESTORATION_ATTRIBUTE = "data-held-restoration";

/**
 * What the window is called while a run has it. The server names it the moment it knows
 * what the run is (`renderBuildWindowTitle`, `src/web/fragments.ts`); the desk owns the
 * window and is what actually writes it. Kept in sync with public/desk-window.js
 * (NAME_THE_WINDOW_EVENT) and the server's attribute; a platform test pins all three.
 *
 * A `null` name means *put back what the run took over* — what a run that ended without
 * activating owes the window, since nothing it was called during the work is true any
 * more.
 */
const BUILD_WINDOW_TITLE_ATTRIBUTE = "data-build-window-title";
const NAME_THE_WINDOW_EVENT = "aluna:name-the-window";

/**
 * Ask the prompt bar to retire anything it was still saying about the run that just ended.
 * Kept in sync with public/prompt-bar.js; a platform test pins that these strings match.
 * @returns {boolean} whether there was such a sentence
 */
function aSentenceAboutTheRunWasRetired() {
  const asked = new CustomEvent("aluna:retire-run-sentence", { cancelable: true });
  document.dispatchEvent(asked);
  return asked.defaultPrevented;
}

/** @param {string | null} title */
function nameTheWindow(title) {
  document.dispatchEvent(new CustomEvent(NAME_THE_WINDOW_EVENT, { detail: { title } }));
}

/**
 * Why a stream closed: `message` for one the server finished, `nodeReplaced` or
 * `nodeMissing` for one whose subscriber left the document (htmx's SSE extension).
 * @param {Event} event
 * @returns {string | undefined}
 */
function closeTypeOf(event) {
  return event instanceof CustomEvent && typeof event.detail === "object" && event.detail !== null
    ? event.detail.type
    : undefined;
}

/**
 * The ending a run in the window is holding, if it is holding one.
 * @returns {HTMLElement | null}
 */
function heldRunEnding() {
  const ending = document
    .getElementById(WINDOW_REGION_ID)
    ?.querySelector(`${BUILD_SUBSCRIBER_SELECTOR} ${BUILD_ENDING_SELECTOR}`);
  return ending instanceof HTMLElement ? ending : null;
}

/**
 * The class htmx puts on an element while its request is in flight, restated here the way
 * `region-scope.js` restates it; a platform test pins that the two agree.
 */
const HTMX_REQUEST_CLASS = "htmx-request";

/**
 * Whether the window is left holding nothing. Whitespace between swapped nodes is not
 * content; nothing else in there is invisible, because the region is the one surface
 * inside the window the ink system deliberately does not draw.
 * @param {Element} region
 * @returns {boolean}
 */
function regionHoldsNothing(region) {
  for (const node of region.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "") continue;
    return false;
  }
  return true;
}

/**
 * A window that holds nothing does not exist.
 *
 * Stated as that invariant rather than as a list of the flows that reach it, because
 * the list is longer than it looks and every entry wants the same answer. Every one
 * of them is a deletion whose restoration is neutral — nothing to go back to: a
 * capability deleted, one that turned out to be already gone, and the press that gives
 * the window back with nothing behind it, whether that is **Keep it** on the question
 * or **Continue** on the ending a refusal, a timeout or a pre-commit failure left
 * standing. In all of them the window is left empty, and an empty drawn frame on the
 * desk says less than no frame at all.
 *
 * A rule keyed on emptiness has one hazard: a swap that empties the region and then
 * refills it. That is why this is asked at settle — htmx's own "I am finished with
 * this target" — rather than the moment the first content lands.
 *
 * @param {Element | null | undefined} region
 */
function putAwayEmptyWindow(region) {
  if (!(region instanceof HTMLElement) || !regionHoldsNothing(region)) return;
  document.dispatchEvent(new CustomEvent(PUT_WINDOW_AWAY_EVENT));
}

/** @param {HTMLElement} surface @returns {boolean} */
function activeViewIsCanonical(surface) {
  const collection = surface.querySelector("[data-search-state]");
  const searchInput = surface.querySelector("[data-capability-search-input]");
  const createPanel = surface.querySelector(".capability-collection__create");
  const searchIsIdle =
    collection instanceof HTMLElement && collection.dataset.searchState === "idle";
  const searchIsEmpty = searchInput instanceof HTMLInputElement && searchInput.value === "";
  const createIsClosed =
    !(createPanel instanceof HTMLElement) ||
    window.getComputedStyle(createPanel).display === "none";
  // An open record needs no question of its own: it replaced the collection, so the
  // search state this asks for is not on the surface at all and the answer is already no.
  return searchIsIdle && searchIsEmpty && createIsClosed;
}

/**
 * The region is not drawn — the window's own frame is the only line around it — so
 * there are no ink layers in here to look past, the way there were while the shell
 * had a content area of its own.
 * @param {HTMLElement} output @param {HTMLElement} subscriber @returns {boolean}
 */
function outputHasOnlyDormantSubscriber(output, subscriber) {
  for (const node of output.childNodes) {
    if (node === subscriber) continue;
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "") continue;
    return false;
  }
  return true;
}

/**
 * @param {string | undefined} restorationKind
 * @param {{ id?: string, incarnation?: string, version?: string } | null} current
 * @param {{ id?: string, incarnation?: string, version?: string } | null} restored
 * @param {boolean} currentIsCanonical
 * @param {boolean} neutralOutput
 */
function shouldPreserveRestoration(
  restorationKind,
  current,
  restored,
  currentIsCanonical,
  neutralOutput,
) {
  if (restorationKind === "neutral") return current === null && neutralOutput;
  return (
    restorationKind === "capability" &&
    current !== null &&
    restored !== null &&
    current.id !== undefined &&
    current.incarnation !== undefined &&
    current.version !== undefined &&
    current.id === restored.id &&
    current.incarnation === restored.incarnation &&
    current.version === restored.version &&
    currentIsCanonical
  );
}

/**
 * A deterministic duplicate is a true no-op: keep the exact active View node in
 * place, surface only its product explanation, and let stream close remove the
 * dormant subscriber. Other terminal fragments retain canonical restoration.
 * @param {HTMLElement} listener
 * @param {string} raw
 * @returns {boolean}
 */
function preserveActiveView(listener, raw) {
  if (!listener.classList.contains("build-stream__fragment")) return false;

  const template = document.createElement("template");
  template.innerHTML = raw;
  const restoration = template.content.querySelector(
    '[data-build-restoration-behavior="preserve"]',
  );
  if (!(restoration instanceof HTMLElement)) return false;

  const subscriber = listener.closest("[data-build-job-id]");
  const output = subscriber?.closest(`#${WINDOW_REGION_ID}`);
  if (!(subscriber instanceof HTMLElement) || !(output instanceof HTMLElement)) return false;

  const current = output.querySelector(":scope > [data-active-capability-id]");
  const restored = restoration.querySelector("[data-active-capability-id]");
  const currentIdentity =
    current instanceof HTMLElement
      ? {
          id: current.dataset.activeCapabilityId,
          incarnation: current.dataset.activeCapabilityIncarnation,
          version: current.dataset.activeCapabilityVersion,
        }
      : null;
  const restoredIdentity =
    restored instanceof HTMLElement
      ? {
          id: restored.dataset.activeCapabilityId,
          incarnation: restored.dataset.activeCapabilityIncarnation,
          version: restored.dataset.activeCapabilityVersion,
        }
      : null;
  const shouldPreserve = shouldPreserveRestoration(
    restoration.dataset.buildRestoration,
    currentIdentity,
    restoredIdentity,
    current instanceof HTMLElement && activeViewIsCanonical(current),
    outputHasOnlyDormantSubscriber(output, subscriber),
  );
  if (!shouldPreserve) return false;

  const explanation = template.content.querySelector(`#${PROMPT_NOTICE_ID}`);
  if (explanation instanceof HTMLElement) {
    tellThePromptBar(
      explanation.textContent ?? "",
      explanation.querySelector(PROMPT_REFUSAL_SELECTOR) !== null,
    );
  }
  subscriber.dataset.preserveActiveView = "true";
  return true;
}

/**
 * The run saying what it turned out to be. It lands nowhere — the desk owns the window,
 * so this is told rather than placed (ARCH §6.1).
 *
 * @param {HTMLElement} listener
 * @param {string} raw
 * @returns {boolean}
 */
function nameTheWindowFrom(listener, raw) {
  if (!listener.classList.contains("build-stream__fragment")) return false;
  const template = document.createElement("template");
  template.innerHTML = raw;
  const named = template.content.querySelector(`[${BUILD_WINDOW_TITLE_ATTRIBUTE}]`);
  if (!(named instanceof HTMLElement)) return false;
  const title = named.getAttribute(BUILD_WINDOW_TITLE_ATTRIBUTE);
  if (title) nameTheWindow(title);
  return true;
}

/**
 * Park a held run's restoration instead of letting htmx place it.
 *
 * The ending arrives before the restoration does, so by the time this runs the
 * subscriber already says whether the run is one that waits. A held restoration is the
 * same fragment every other terminal gets — it is only given back later, when the
 * person has read the ending and asked for it.
 *
 * @param {HTMLElement} listener
 * @param {string} raw
 * @returns {boolean}
 */
function holdRestoration(listener, raw) {
  if (!listener.classList.contains("build-stream__fragment")) return false;
  const subscriber = listener.closest(BUILD_SUBSCRIBER_SELECTOR);
  if (!(subscriber instanceof HTMLElement)) return false;
  if (subscriber.querySelector(BUILD_ENDING_SELECTOR) === null) return false;

  subscriber.querySelector(`template[${HELD_RESTORATION_ATTRIBUTE}]`)?.remove();
  const held = document.createElement("template");
  held.setAttribute(HELD_RESTORATION_ATTRIBUTE, "");
  held.innerHTML = raw;
  subscriber.append(held);
  return true;
}

// ── Developer-preview delivery ──────────────────────────────────────────────
// HTMX owns the EventSource connection. Hidden `sse-swap` listener nodes cancel
// HTMX's HTML swap and hand the raw payload to the developer panel, naming which of
// the eight stages it belongs to.
//
// Handed over rather than written in place, because the panel is a window now: it may
// not be standing when a stage arrives, and a developer who starts a build and *then*
// opens it should still find every stage that has already run. The panel keeps them
// (`public/desk-dev-panel.js`); this only says what came down the wire. The event name
// is the seam a classic script can reach a module across, and a platform test pins the
// string at both ends.
document.addEventListener("htmx:sseBeforeMessage", (event) => {
  const listener = event.target;
  if (!(listener instanceof HTMLElement)) return;

  const message = /** @type {CustomEvent<MessageEvent<string>>} */ (event).detail;
  if (
    nameTheWindowFrom(listener, message.data) ||
    preserveActiveView(listener, message.data) ||
    holdRestoration(listener, message.data)
  ) {
    event.preventDefault();
    return;
  }

  const stage = listener.dataset.previewStage;
  if (!stage) return;

  event.preventDefault();
  document.dispatchEvent(
    new CustomEvent(STAGE_PAYLOAD_EVENT, { detail: { stage, payload: message.data } }),
  );
});

/**
 * The surface of the capability standing in the window: a direct child of the region,
 * never a descendant. A build narrates beside what it displaced and carries a copy of that
 * surface inside its own subscriber; only the one standing beside it is what the window is
 * showing, and only that one may name what a build displaces
 * (public/desk-window.js `capabilityInWindow` owns the rule).
 * @returns {HTMLElement | null}
 */
function activeCapabilitySurface() {
  const output = document.getElementById(WINDOW_REGION_ID);
  const surface = output?.querySelector(":scope > [data-active-capability-id]");
  return surface instanceof HTMLElement ? surface : null;
}

// Capture the exact active registry identity before POST /prompt appends its dormant
// subscriber. The server validates both hints and stores only this data-free
// descriptor on the ephemeral job.
document.addEventListener("htmx:configRequest", (event) => {
  const detail =
    /** @type {CustomEvent<{ elt?: Element, parameters?: Record<string, unknown> }>} */ (event)
      .detail;
  const trigger = detail?.elt;
  if (!(trigger instanceof HTMLFormElement) || trigger.id !== PROMPT_FORM_ID) return;
  const surface = activeCapabilitySurface();
  if (surface === null || !detail.parameters) return;
  const capabilityId = surface.dataset.activeCapabilityId;
  const incarnationId = surface.dataset.activeCapabilityIncarnation;
  if (!capabilityId || !incarnationId) return;
  detail.parameters.__aluna_restore_capability_id = capabilityId;
  detail.parameters.__aluna_restore_incarnation_id = incarnationId;
});

// Appending keeps the active View stable while intent is still unknown. Enforce one
// subscriber at admission so HTMX's queued-submit window cannot create siblings,
// and retire any explanation from the preceding request.
//
// The subscriber lives inside the window, so a window that has been put away leaves no
// subscriber to find — which is correct rather than a hole: putting the window away asks
// first and then ends the run it was narrating (public/leaving-a-run.js), so there is
// nothing left to be the second of.
document.addEventListener("htmx:beforeRequest", (event) => {
  const detail = /** @type {CustomEvent<{ elt?: Element }>} */ (event).detail;
  if (!(detail?.elt instanceof HTMLFormElement) || detail.elt.id !== PROMPT_FORM_ID) return;
  const output = document.getElementById(WINDOW_REGION_ID);
  const standing = output?.querySelector(BUILD_SUBSCRIBER_SELECTOR);
  if (standing instanceof HTMLElement) {
    // A run that is still going is exactly what this guard is for. A run that has ended
    // and is only waiting to be read is not: typing the next prompt is a way of saying
    // you have read it, so the run gets out of the way rather than swallowing the
    // submission and looking like the prompt bar did nothing.
    //
    // Dropped rather than given back. What the run displaced was never taken away, only
    // covered, so it is already standing there — and `htmx:configRequest` has just read
    // this build's restoration identity off it, which the incoming run will re-resolve at
    // its own terminal. Placing the parked collection here would start a records read for
    // a surface the arriving subscriber covers again in the same frame.
    if (runIsUsingTheWindow()) {
      event.preventDefault();
      tellThePromptBar(BUILD_IN_FLIGHT_REFUSAL, true, true);
      return;
    }
    dropHeldRun(standing);
  }
  tellThePromptBar("");
});

/**
 * What the desk does, and what the bar has to say about it. A desk action is a request made
 * from the ground rather than from inside the window: a capability's logo, and the controls
 * 5.9 hangs on one. One that would take the window while a run is using it is refused
 * before it can, and the run stays mounted — a desk action may never become a second way
 * to cancel a build (PLAN decision 20). One that goes ahead answers whatever the bar was
 * still saying.
 *
 * Opening a capability is exempt from the refusal only: it is a navigation, and what it
 * owes the run it walks away from is a warning (5.8/04). `matches` rather than `closest`,
 * so a control *hung on* a logo — 5.9's menu and rename editor — is furniture like any
 * other. The prompt bar has its own guard above, with its own sentence.
 */
document.addEventListener("htmx:beforeRequest", (event) => {
  const detail = /** @type {CustomEvent<{ elt?: unknown, target?: unknown }>} */ (event).detail;
  const asking = detail?.elt;
  if (!(asking instanceof Element) || asking.id === PROMPT_FORM_ID) return;
  if (asking.closest(`#${WINDOW_REGION_ID}`) !== null) return;
  // Where this would land is htmx's own answer, already resolved and handed over on this
  // event. Borrowed rather than reimplemented, for the reason `public/swap-target.js`
  // gives: a second reading of `hx-target` has to re-derive inheritance, `this`, the
  // extended selectors and `hx-disinherit`, and every drift is either a refusal of a
  // healthy request or silence on the one this exists to catch.
  const takingTheWindow =
    detail?.target instanceof Element && detail.target.id === WINDOW_REGION_ID;
  const openingACapability = asking.matches(CAPABILITY_LOGO_SELECTOR);
  if (!takingTheWindow && !openingACapability) return;
  if (takingTheWindow && !openingACapability && runIsUsingTheWindow()) {
    event.preventDefault();
    tellThePromptBar(DESK_ACTION_REFUSAL, true, true);
    return;
  }
  tellThePromptBar("");
});

/**
 * Whether a run is using the window, rather than only standing in it. A run that has
 * stopped and is waiting to be read is not — the same line the one-subscriber guard
 * draws, so the two guards can never disagree about what "in use" means.
 * @returns {boolean}
 */
function runIsUsingTheWindow() {
  const standing = document
    .getElementById(WINDOW_REGION_ID)
    ?.querySelector(BUILD_SUBSCRIBER_SELECTOR);
  return standing instanceof HTMLElement && standing.querySelector(BUILD_ENDING_SELECTOR) === null;
}

/**
 * A new build starts from an empty panel — and only a build that was actually
 * admitted.
 *
 * The old clear was an out-of-band swap inside the subscriber fragment, so it landed
 * only when the server returned one. Clearing on the *request* instead would let
 * every refusal — a blank prompt, a queued sibling, a 500 — wipe the panel, including
 * the lifecycle history the page seeded, which nothing restores until a reload. So
 * this waits for the subscriber to arrive and keys off its job id, which also means a
 * re-swap of the same subscriber cannot clear a build's own stages out from under it.
 */
let clearedForJob = "";
document.addEventListener("htmx:afterSwap", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const subscriber =
    target.closest(BUILD_SUBSCRIBER_SELECTOR) ?? target.querySelector(BUILD_SUBSCRIBER_SELECTOR);
  const jobId = subscriber instanceof HTMLElement ? subscriber.dataset.buildJobId : undefined;
  if (!jobId || jobId === clearedForJob) return;
  clearedForJob = jobId;
  document.dispatchEvent(new CustomEvent(STAGES_CLEARED_EVENT));
});

/**
 * The sentence out of a structured refusal, read from the marked element the router wrote
 * it in (`src/router/failure-responses.ts`). Parsed into an inert template, so nothing in
 * it runs or loads.
 * @param {string} html
 * @returns {string}
 */
function refusalSentence(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector("[data-error-code]")?.textContent?.trim() ?? "";
}

// HTMX keeps error responses out of the DOM by default. Structured form refusals are
// the exception: the router retargets them to the active create/edit/delete aria-live error
// region, while leaving the response unsuccessful so typed values and the standing
// confirmation survive.
//
// Where the refusal lands is one ownership rule and not a table of codes: it renders on
// the surface it arrived from (PLAN decision 26). A window action's refusal renders in
// the window, which is where the router already aimed it. Anything that asked from
// outside the window — the desk, the prompt bar — hears it on the prompt bar instead,
// and whatever the window was holding stays exactly as it was.
document.addEventListener("htmx:beforeSwap", (event) => {
  const detail =
    /** @type {CustomEvent<{ xhr: XMLHttpRequest, shouldSwap: boolean, requestConfig?: { elt?: unknown } }>} */ (
      event
    ).detail;
  const response = detail?.xhr?.responseText;
  // 409 is the read-gate refusal while a deletion drains: the capability is briefly
  // unreadable, not broken. It has to be listed here or htmx drops it and the click
  // looks like it did nothing.
  if (![404, 409, 422, 500].includes(detail?.xhr?.status) || typeof response !== "string") return;
  const isStructuredFormRefusal = [
    "missing_required_fields",
    // A submitted choice value the field never declared. Platform-owned, like the
    // required-field refusal beside it, and dropped by htmx unless the shell claims it.
    "invalid_choice",
    // A newly chosen option the field no longer offers. Its own code, because the value
    // is declared and the record already holding it is untouched.
    "choice_disabled",
    // A string longer than its field's declared max_length. The native attribute stops it
    // on a filled-in form, so this is the crafted-request path — and one nobody would see
    // without the claim.
    "max_length_exceeded",
    "mutation_busy",
    "read_unavailable",
    "record_not_found",
    "mutation_failed",
    // A rename the desk turned down (`src/capability-rename/presentation.ts`). It is the
    // first refusal that can only ever have come from outside the window, so it always
    // takes the branch below and always speaks on the prompt bar.
    "rename_refused",
    // An address or a press that names nothing (`NOT_FOUND_FRAGMENT`). A second tab's
    // desk still stands the tile of a capability the other tab deleted, and a press on it
    // used to open a window, get this, and take the window back down without a word.
    "not_found",
  ].some((code) => response.includes(`data-error-code="${code}"`));
  if (!isStructuredFormRefusal) return;

  // Which surface asked. `detail.elt` is the swap *target* here — htmx dispatches this
  // event on it — but the request's own configuration is on the same detail and names the
  // element that made it, so nothing has to be remembered from an earlier event.
  const asking = detail.requestConfig?.elt;
  if (asking instanceof Element && asking.closest(`#${WINDOW_REGION_ID}`) === null) {
    // A refusal whose sentence could not be read is still shown where it was aimed.
    // Moving it to a slot and finding nothing to put there answers the person with
    // silence, which is the one thing this rule exists to stop.
    const sentence = refusalSentence(response);
    if (sentence) {
      detail.shouldSwap = false;
      tellThePromptBar(sentence, true);
      return;
    }
  }

  detail.shouldSwap = true;
});

/**
 * The window's content changed hands. The desk owns what the address does about it — this
 * classic script cannot import the module that owns it, so it says what happened rather
 * than deciding (ARCH §6.1: the shell presents, it never decides).
 *
 * `navigated` is true only where a capability *took* the window: a build's successful v1
 * activation, whose canonical collection is standing somewhere for the first time. Kept
 * in sync with public/desk-window.js (WINDOW_TOOK_CAPABILITY_EVENT); a platform test pins
 * that these strings match.
 * @param {boolean} navigated
 */
function tellDeskTheWindowTookCapability(navigated) {
  document.dispatchEvent(
    new CustomEvent("aluna:window-took-capability", { detail: { navigated } }),
  );
}

/** @param {HTMLElement} subscriber */
// `activated` is the one thing the address cares about: a `commit` is a real pointer
// activation, and its capability's canonical collection is taking the window. Every
// restoration puts back what the build displaced and navigated nowhere, so it may not
// leave an entry behind — not even when it lands after the user has opened something
// else and the address has moved on without it.
function terminalPresentationContent(subscriber) {
  const restoration = subscriber.querySelector("[data-build-restoration]");
  if (restoration instanceof HTMLElement) {
    return {
      element: restoration,
      promoteElement: false,
      restorationKind: restoration.dataset.buildRestoration,
      activated: false,
    };
  }
  const commit = subscriber.querySelector(".build-stream__commit");
  if (commit instanceof HTMLElement && commit.childNodes.length > 0) {
    return { element: commit, promoteElement: false, restorationKind: undefined, activated: true };
  }
  const narration = subscriber.querySelector(".build-stream__narration");
  return narration instanceof HTMLElement && narration.childNodes.length > 0
    ? { element: narration, promoteElement: true, restorationKind: undefined, activated: false }
    : null;
}

/**
 * Everything the region is still holding that is not the content just promoted: the
 * capability surface the run displaced, and whatever is left of the run's own subscriber.
 * Each one is released and then detached, while it is still connected — which is the only
 * moment an htmx request inside it can be aborted.
 *
 * A walk of what is leaving, and deliberately not a release of the region itself. The
 * region is the anchor for work that should outlive every swap it holds
 * (`region-scope.js`), so releasing at the region would take that work away on a swap
 * that is not the region's own ending.
 *
 * @param {HTMLElement} output
 * @param {readonly ChildNode[]} promoted
 */
function releaseDisplacedContent(output, promoted) {
  for (const node of [...output.childNodes]) {
    if (promoted.includes(node)) continue;
    if (node instanceof Element) releaseRegionContent(node);
    node.remove();
  }
}

/**
 * Wire up the content the region has just been given, so its own `hx-trigger="load"`
 * fires — the ordinary way anything this script inserts is wired up, and the same seam
 * the record swap and the search chrome use.
 *
 * Load-bearing, not a belt on braces. htmx runs its own settle 20ms after a swap lands,
 * and that settle is what would fire the trigger; a run writes its ending and closes the
 * stream back to back, so the promotion has carried the View out of the subscriber long
 * before the settle looks for it and the settle then passes it by. Without this the
 * restored collection stands there with no records and a create form bound to nothing.
 *
 * A subtree that is *already* reading is left alone, and that is the load-bearing half.
 * Processing an element htmx is holding a request on de-initialises it, and htmx's abort
 * is a lookup of the request it no longer has — so the read would outlive every release
 * that could stop it, land on a region the user has since searched or swapped away from,
 * and hold its read token to the end. `htmx-request` is htmx's own mark for exactly that,
 * and a subtree carrying it has been processed already anyway.
 *
 * Last, after the release: a read started before it would be a read the release could
 * abort.
 *
 * @param {readonly ChildNode[]} promoted
 */
function processPromotedContent(promoted) {
  const htmx = /** @type {Window & { htmx?: { process(node: Element): void } }} */ (window).htmx;
  if (!htmx) return;
  for (const node of promoted) {
    if (!(node instanceof Element)) continue;
    if (node.classList.contains(HTMX_REQUEST_CLASS)) continue;
    if (node.querySelector(`.${HTMX_REQUEST_CLASS}`) !== null) continue;
    htmx.process(node);
  }
}

/**
 * Promote what the run ended with, and release only what that displaces.
 *
 * The terminal content is moved out of the subscriber *before* anything is released, so
 * the release runs over exactly the content that is leaving and never over the content
 * that is arriving.
 *
 * @param {HTMLElement} subscriber @param {HTMLElement} output
 */
function promoteTerminalPresentation(subscriber, output) {
  const terminal = terminalPresentationContent(subscriber);
  if (terminal === null) {
    releaseRegionContent(subscriber);
    subscriber.remove();
    return { restorationKind: undefined, activated: false };
  }
  /** @type {ChildNode[]} */
  const promoted = terminal.promoteElement ? [terminal.element] : [...terminal.element.childNodes];
  output.append(...promoted);
  releaseDisplacedContent(output, promoted);
  processPromotedContent(promoted);
  return { restorationKind: terminal.restorationKind, activated: terminal.activated };
}

/**
 * Promote what a run ended with, and answer for what that leaves the desk holding: a
 * window with nothing in it goes away, and a run that gave back the bare desk is at the
 * desk's own address.
 *
 * @param {HTMLElement} subscriber
 * @param {HTMLElement} output
 * @param {boolean} mayPutWindowAway
 * @returns {boolean} whether a real pointer activation took the window
 */
function completeTerminalPresentation(subscriber, output, mayPutWindowAway) {
  const { restorationKind, activated } = promoteTerminalPresentation(subscriber, output);
  // An activation renames the window after the capability that just took it; every other
  // ending puts back the name the run took over, because nothing it was called while it
  // worked is true any more.
  if (!activated) nameTheWindow(null);
  if (mayPutWindowAway) putAwayEmptyWindow(output);

  if (
    restorationKind === "neutral" &&
    (window.location.pathname !== "/" || window.location.search !== "")
  ) {
    window.history.replaceState(window.history.state, "", "/");
  }
  return activated;
}

/**
 * Take the run's story down, having been read. Always first, so nothing downstream can
 * still mistake this run for one that is waiting — the rescue below reads exactly that.
 * @param {HTMLElement} subscriber
 */
function retireBuildEnding(subscriber) {
  subscriber.querySelector(BUILD_ENDING_SELECTOR)?.remove();
}

/**
 * Let a read run go without giving anything back.
 *
 * What the run displaced was never taken away, only covered (`demo.css` hides it for as
 * long as the narration is standing), so uncovering it is the whole of what this owes.
 * Reached two ways: the next prompt, which is about to cover it again anyway, and a run
 * whose restoration never arrived at all because its terminal write ran out of its bound.
 *
 * @param {HTMLElement} subscriber
 * @param {boolean} mayPutWindowAway
 */
function dropHeldRun(subscriber, mayPutWindowAway = false) {
  const output = subscriber.closest(`#${WINDOW_REGION_ID}`);
  nameTheWindow(null);
  retireBuildEnding(subscriber);
  releaseRegionContent(subscriber);
  subscriber.remove();
  if (mayPutWindowAway && output instanceof HTMLElement) putAwayEmptyWindow(output);
  tellDeskTheWindowTookCapability(false);
}

/**
 * The end of the wait: a run that had something to tell you gives back what it displaced.
 *
 * The restoration was parked rather than placed (`holdRestoration`), so this is where it
 * finally reaches the region — moved into the run's own fragment surface first, so the
 * one promotion path in this file is the one that carries it out, and so the restored
 * collection is processed exactly once, on its way into the window.
 *
 * @param {HTMLElement} subscriber
 */
function giveBackTheWindow(subscriber) {
  const output = subscriber.closest(`#${WINDOW_REGION_ID}`);
  const held = subscriber.querySelector(`template[${HELD_RESTORATION_ATTRIBUTE}]`);
  const surface = subscriber.querySelector(".build-stream__fragment");
  if (!(output instanceof HTMLElement)) return;
  if (!(held instanceof HTMLTemplateElement) || !(surface instanceof HTMLElement)) {
    dropHeldRun(subscriber, true);
    return;
  }

  retireBuildEnding(subscriber);
  surface.replaceChildren(held.content);
  held.remove();
  completeTerminalPresentation(subscriber, output, true);
  tellDeskTheWindowTookCapability(false);
}

/**
 * A held ending that is about to be destroyed rather than read.
 *
 * The window is the only place this sentence lives now, and the window can be put away,
 * swapped for another capability, or navigated off — none of which is the person saying
 * they have read it. The line moves to the prompt bar's standing slot on the way out, so
 * a build that failed can never leave the desk looking exactly as it did before the
 * prompt was typed. It is the same element every warm answer that never became a build
 * already speaks in, not a surface of the desk's own (PLAN decisions 23 and 24).
 *
 * htmx's own cleanup is the hook, because it is the one thing every disappearance goes
 * through: the subscriber carries `hx-ext`/`sse-connect`, so htmx cleans it up whichever
 * way it leaves. A dismissal never reaches this — the ending is retired before anything
 * is released.
 *
 * @param {EventTarget | null} eventTarget
 */
function rescueHeldEnding(eventTarget) {
  if (!(eventTarget instanceof Element)) return;
  const ending = eventTarget.matches?.(BUILD_SUBSCRIBER_SELECTOR)
    ? eventTarget.querySelector(BUILD_ENDING_SELECTOR)
    : null;
  if (!(ending instanceof HTMLElement)) return;
  // Carried as the ending it already was, not turned into a refusal on the way. It had
  // its moment in the window's own live region; this is only the line surviving the
  // window, so it arrives without the cue a fresh refusal comes with.
  tellThePromptBar(ending.textContent ?? "");
}

/**
 * @param {EventTarget | null} eventTarget
 * @returns {boolean} whether a real pointer activation took the window
 */
function finishTerminalPresentation(eventTarget) {
  if (!(eventTarget instanceof Element)) return false;
  const subscriber = eventTarget.closest(BUILD_SUBSCRIBER_SELECTOR);
  const output = subscriber?.closest(`#${WINDOW_REGION_ID}`);
  if (!(subscriber instanceof HTMLElement) || !(output instanceof HTMLElement)) return false;

  if (subscriber.dataset.preserveActiveView === "true") {
    // Scoped to the subscriber, not the region: the preserved active view stays. Dispatched
    // before the detach because `abortTransportIn` can only abort a connected node's
    // request — the observer sweep behind it cannot.
    releaseRegionContent(subscriber);
    subscriber.remove();
    // The run took the window over and then turned out not to need it, so it gives back
    // the name it displaced: a prompt that built nothing may not leave the window called
    // `Thinking…` over a collection that has been standing there the whole time. And when
    // there was nothing to keep — a bare desk asking for something it already has — the
    // window is left holding nothing, and a window holding nothing does not exist.
    nameTheWindow(null);
    putAwayEmptyWindow(output);
    return false;
  }

  // A run that ended with something to tell you stops here. The story stays up, the
  // surface it displaced stays covered, and nothing is given back until the ending is
  // dismissed (PLAN decision 25). Cancel never reaches this: it has no ending, because
  // the person who pressed it already knows why the run stopped.
  if (subscriber.querySelector(BUILD_ENDING_SELECTOR) !== null) {
    nameTheWindow(null);
    return false;
  }

  return completeTerminalPresentation(subscriber, output, true);
}

// The press that ends the wait. The control is about to be detached, so focus goes to the
// prompt bar rather than being dropped on `<body>` — and the person's words are still in
// it, because a run that ends by asking them to try again may not wipe what they typed.
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const dismiss = event.target.closest(BUILD_DISMISS_SELECTOR);
  if (!(dismiss instanceof HTMLElement)) return;
  const subscriber = dismiss.closest(BUILD_SUBSCRIBER_SELECTOR);
  if (!(subscriber instanceof HTMLElement)) return;
  giveBackTheWindow(subscriber);
  document.getElementById(PROMPT_FIELD_ID)?.focus();
});

document.addEventListener("htmx:beforeCleanupElement", (event) => rescueHeldEnding(event.target));

document.addEventListener("htmx:afterSwap", () => {
  // A swap is not a navigation: whatever navigated pushed its own address before the
  // request went out, so this only ever catches the address up with a window that
  // changed hands underneath it — a cancelled deletion putting the previous capability
  // back is the one that does.
  tellDeskTheWindowTookCapability(false);
});
document.addEventListener("htmx:afterSettle", (event) => {
  const target = /** @type {CustomEvent<{ target?: unknown }>} */ (event).detail?.target;
  // Only a swap of the region itself can have emptied it; a swap into something inside
  // it — the records region reloading — never leaves the window with nothing in it.
  if (target instanceof HTMLElement && target.id === WINDOW_REGION_ID) {
    putAwayEmptyWindow(target);
  }
});
document.addEventListener("htmx:sseClose", (event) => {
  if (closeTypeOf(event) !== "message") return;
  // Only a real pointer activation navigated: its capability's canonical collection is
  // standing somewhere for the first time. A restoration puts back what the build
  // displaced and is owed no entry — least of all when it lands after the user has opened
  // something else and the address has already moved on without it.
  tellDeskTheWindowTookCapability(finishTerminalPresentation(event.target));
});
