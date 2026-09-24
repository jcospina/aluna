// @ts-check
//
// Authored shell glue — plain JavaScript served verbatim from /static/app.js, with `// @ts-check`
// plus JSDoc getting `tsc --noEmit` to typecheck it at zero runtime cost.
//
// Everything here is presentation-only (ARCH §6.1), and it is what is left over from the shell's
// modules rather than a subject of its own: the `shell` Alpine component, developer-preview SSE
// payloads handed to the panel, a build's terminal presentation promoted once its stream closes,
// and a run that ended with something to tell you held until the press that gives the window back.
//
// A classic script, because it has to run before Alpine starts — which is also why it can import
// nothing, and why every constant it shares with a module is restated here and pinned by a test.

/**
 * The two things the desk turns down while a run has the window: a second prompt, and a desk
 * action that would take the window. Neither is `mutation_busy`, which is refused inside it.
 */
const BUILD_IN_FLIGHT_REFUSAL =
  "I’m still making the last thing you asked for. Let me finish, then tell me the next one.";
const DESK_ACTION_REFUSAL =
  "I’m still making the last thing you asked for. Let me finish, then try that again.";

/**
 * A capability's logo, restated from `public/desk-window.js` the way this file restates every
 * constant it shares with a module; a platform test pins that the two agree.
 */
const CAPABILITY_LOGO_SELECTOR = "[data-capability-logo]";

/**
 * The prompt bar's ids and its one refusal marker, restated the way this file restates every
 * constant it shares with a module. The bar itself is `public/prompt-bar.js`.
 */
const PROMPT_FIELD_ID = "spec-build-prompt";
const PROMPT_FORM_ID = "spec-build-form";
const PROMPT_NOTICE_ID = "prompt-notice";
const PROMPT_REFUSAL_SELECTOR = "[data-prompt-refusal]";

/**
 * What the desk says on the prompt bar: the glue says what happened and the bar places it
 * (ARCH §6.1). `aboutTheRun` marks the two sentences that stop being true when the run ends.
 *
 * @param {string} sentence the empty string retires whatever is standing
 * @param {boolean} [refused] @param {boolean} [aboutTheRun]
 */
function tellThePromptBar(sentence, refused = false, aboutTheRun = false) {
  const detail = { sentence, refused, aboutTheRun };
  document.dispatchEvent(new CustomEvent("aluna:prompt-bar-message", { detail }));
}

/**
 * htmx executes swapped `<script>` tags and `js:`/`hx-on` expressions by default, and nothing
 * this desk serves needs either, so markup that reached the browser another way cannot run.
 */
const htmxConfig = /** @type {Window & { htmx?: { config?: Record<string, unknown> } }} */ (window)
  .htmx?.config;
// Set after the vendored htmx build rather than in the page, because htmx reads its config at
// swap time, and together because they are one decision: this desk executes nothing it is sent.
if (htmxConfig) Object.assign(htmxConfig, { allowScriptTags: false, allowEval: false });

/**
 * The shell's presentation state.
 * @typedef {Object} ShellState
 * @property {boolean} promptBusy - Courtesy presentation state while a build has the window.
 * @property {() => void} init - Alpine lifecycle hook; wires the stream courtesy state.
 */

// Register on `alpine:init`, dispatched at the start of Alpine.start(). This file is loaded
// before alpine.min.js precisely so the listener is in place when Alpine starts.
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
    // Courtesy prompt-bar state only, and not a lock: the build queue admits every job it is
    // handed, and the one-subscriber guard below is what holds a second build off.
    promptBusy: false,

    init() {
      /** @param {boolean} clear @param {boolean} [take] whether the keyboard is owed back */
      const wakePrompt = (clear, take = true) => {
        this.promptBusy = false;
        requestAnimationFrame(() => {
          const promptField = document.getElementById(PROMPT_FIELD_ID);
          if (clear && promptField instanceof HTMLInputElement) promptField.value = "";
          // A wake the run owns takes the keyboard back, because disabling the field is what
          // put it on `<body>`. A question's wake asks first: the desk stayed usable while she
          // read, so the person may be typing somewhere else by now.
          if (take || document.activeElement === document.body) promptField?.focus();
        });
      };

      document.addEventListener("htmx:sseOpen", () => {
        // The transport reconnects on its own after a drop, and that is not a new run: a question
        // that has already said what it is keeps the bar it gave back.
        this.promptBusy = document.querySelector(QUESTION_RUN_SELECTOR) === null;
      });
      /* A question does not lock the bar (PLAN decision 27). The lock goes on at the open, where
       * nothing yet knows what the sentence was; the moment the run says it turned out to be a
       * question it comes off, and the words that asked it go with it. Waiting for an answer is
       * not waiting for a commit: asking something else has to be possible immediately. */
      document.addEventListener(OPEN_THE_ANSWER_WINDOW_EVENT, () => wakePrompt(true, false));
      document.addEventListener("htmx:sseClose", (event) => {
        // Only a stream the server finished: `nodeReplaced` and `nodeMissing` are the desk
        // taking a run down, and the navigation that did it already placed focus.
        if (closeTypeOf(event) !== "message") return;
        // A run that stopped with something to tell you keeps the words that produced the
        // ending, and puts the keyboard on the control the window is waiting on.
        const ending = heldRunEnding();
        if (ending === null) {
          // A sentence about the run that just ended retires with it. Words typed while the
          // person was told to wait were never submitted, so they stay.
          //
          // Only a bar this run actually locked: a question woke it when it opened its window,
          // and the next question may be half typed by the time the answer lands. Waking again
          // would take those words away and pull focus off whatever the person is doing.
          if (this.promptBusy) wakePrompt(!theWordsInTheFieldStay());
          return;
        }
        this.promptBusy = false;
        requestAnimationFrame(() => {
          const control = document.querySelector(BUILD_DISMISS_SELECTOR);
          // Visibly: the build ending moves focus to its own button, and a button rings on
          // keyboard focus alone.
          if (control instanceof HTMLElement) control.focus({ focusVisible: true });
        });
      });
      // `htmx:sseError` fires on every transient drop while the transport retries, so waking on
      // it unlocked the prompt mid-build. Wake only once the connection itself is dead.
      document.addEventListener("htmx:sseError", (event) => {
        const source = /** @type {{detail?: {source?: {readyState?: number}}}} */ (event).detail
          ?.source;
        if (source?.readyState === EventSource.CLOSED && this.promptBusy) wakePrompt(false);
      });
    },
  };
}

// Kept in sync with public/region-scope.js (RELEASE_REGION_EVENT) and pinned by a test. Asks a
// region's scope to release its content's work before the content is replaced.
const RELEASE_REGION_EVENT = "aluna:release-region";

/** @param {Element} region */
function releaseRegionContent(region) {
  region.dispatchEvent(new CustomEvent(RELEASE_REGION_EVENT, { bubbles: true }));
}

/**
 * The window's content region, and the way this script asks for the window itself to be put
 * away. Kept in sync with public/desk-window.js and pinned by a platform test.
 */
const WINDOW_REGION_ID = "spec-build-output";
const PUT_WINDOW_AWAY_EVENT = "aluna:put-window-away";

/**
 * The two ways this script reaches the developer panel's window, kept in sync with
 * public/desk-dev-panel.js and pinned by the same test: one stage's payload, and a new build.
 */
const STAGE_PAYLOAD_EVENT = "aluna:stage-payload";
const STAGES_CLEARED_EVENT = "aluna:stages-cleared";

/** One build's subscriber — the node the run's id is written on. */
const BUILD_SUBSCRIBER_SELECTOR = "[data-build-job-id]";
/** What a run that turned out to be a question is marked with (`public/leaving-a-run.js`). */
const QUESTION_RUN_SELECTOR = "[data-question-run]";

/**
 * A run that ended with something to say, and the control that ends the wait (`renderBuildEnding`,
 * pinned by a test). The window holds until the ending is dismissed, and only then gives back.
 */
const BUILD_ENDING_SELECTOR = "[data-build-ending]";
const BUILD_DISMISS_SELECTOR = "[data-build-dismiss]";

/**
 * Where a held run keeps the restoration it was streamed. A `<template>` because its own
 * `hx-trigger="load"` would otherwise fetch into a subscriber nobody can see, and again later.
 */
const HELD_RESTORATION_ATTRIBUTE = "data-held-restoration";

/**
 * What the window is called while a run has it (`renderBuildWindowTitle`, pinned by a test). A
 * `null` name puts back what the run took over, nothing it was called during the work being true.
 */
const BUILD_WINDOW_TITLE_ATTRIBUTE = "data-build-window-title";
const NAME_THE_WINDOW_EVENT = "aluna:name-the-window";

/**
 * A sentence that turned out to be a question (`renderAnswerWindowOpening`, pinned by a test):
 * the attribute names the answer window, the text is what Aluna says while she has not looked.
 */
const ANSWER_WINDOW_ATTRIBUTE = "data-answer-window";
const OPEN_THE_ANSWER_WINDOW_EVENT = "aluna:open-the-answer-window";

/**
 * One more thing said in the answer window that already stands (`renderAnswerWindowSaying`,
 * pinned by a test): each step as Aluna takes it, then the answer in place of the last of them.
 */
const ANSWER_WINDOW_SAYING_ATTRIBUTE = "data-answer-saying";
const SAY_IN_THE_ANSWER_WINDOW_EVENT = "aluna:say-in-the-answer-window";

/**
 * A sentence Aluna will not build from (`renderRefusedPrompt`, pinned by a test). It opens
 * no window: the desk offers it to the answer window standing here, and says it on the prompt bar
 * when there is none (PLAN decision 31).
 */
const REFUSED_PROMPT_ATTRIBUTE = "data-refused-prompt";
const REFUSE_IN_THE_ANSWER_WINDOW_EVENT = "aluna:refuse-in-the-answer-window";

/**
 * Whether the run now ending refused what was typed. The words stay in the field either way,
 * because a refusal asks the person to tell her one thing they would like to keep track of, and
 * a field emptied under that sentence takes back the very thing it asks for.
 */
let theRunRefusedWhatWasTyped = false;

/**
 * Retire anything the prompt bar was still saying about the run that just ended, and answer
 * whether the words that produced it stay in the field. The event is kept in sync with
 * public/prompt-bar.js and pinned by a platform test.
 *
 * A refusal leaves them too, wherever it landed: the try-again its sentence asks for is then one
 * edit away rather than a retype.
 * @returns {boolean}
 */
function theWordsInTheFieldStay() {
  const asked = new CustomEvent("aluna:retire-run-sentence", { cancelable: true });
  // False from `dispatchEvent` is the bar saying it had one to retire, which the DOM answers with.
  return !document.dispatchEvent(asked) || theRunRefusedWhatWasTyped;
}

/** @param {string | null} title */
function nameTheWindow(title) {
  document.dispatchEvent(new CustomEvent(NAME_THE_WINDOW_EVENT, { detail: { title } }));
}

/**
 * Why a stream closed: `message` for one the server finished, `nodeReplaced` or `nodeMissing`
 * for one whose subscriber left the document (htmx's SSE extension).
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
 * The class htmx puts on an element while its request is in flight, restated the way
 * `region-scope.js` restates it; a platform test pins that the two agree.
 */
const HTMX_REQUEST_CLASS = "htmx-request";

/**
 * Whether the window is left holding nothing. Whitespace between swapped nodes is not content,
 * and nothing else in there is invisible: the ink system does not draw this region.
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
 * A window that holds nothing does not exist. Asked at settle rather than when content lands,
 * because a swap can empty the region and then refill it.
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
  // An open record needs no question of its own: it replaced the collection, so the search
  // state this asks for is not on the surface and the answer is already no.
  return searchIsIdle && searchIsEmpty && createIsClosed;
}

/**
 * The region is not drawn — the window's own frame is the only line around it — so there are no
 * ink layers in here to look past.
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
 * @param {string | undefined} kind
 * @param {{ id?: string, incarnation?: string, version?: string } | null} current
 * @param {{ id?: string, incarnation?: string, version?: string } | null} restored
 * @param {boolean} canonical whether the View standing is the capability's own
 * @param {boolean} neutral whether the output holds nothing but a dormant subscriber
 */
function shouldPreserveRestoration(kind, current, restored, canonical, neutral) {
  if (kind === "neutral") return current === null && neutral;
  if (kind !== "capability" || current === null || restored === null || !canonical) return false;
  return (
    current.id !== undefined &&
    current.incarnation !== undefined &&
    current.version !== undefined &&
    current.id === restored.id &&
    current.incarnation === restored.incarnation &&
    current.version === restored.version
  );
}

/**
 * Which capability a node says is standing in it, or nothing when the node is not one.
 * @param {Element | null} el
 */
function activeCapabilityIdentity(el) {
  if (!(el instanceof HTMLElement)) return null;
  const { activeCapabilityId: id, activeCapabilityIncarnation: incarnation } = el.dataset;
  return { id, incarnation, version: el.dataset.activeCapabilityVersion };
}

/**
 * The element a fragment frame is marked with, or nothing when this frame is not that one.
 * @param {HTMLElement} listener
 * @param {string} raw
 * @param {string} attribute
 * @returns {HTMLElement | null}
 */
function markedFragment(listener, raw, attribute) {
  if (!listener.classList.contains("build-stream__fragment")) return null;
  const template = document.createElement("template");
  template.innerHTML = raw;
  const marked = template.content.querySelector(`[${attribute}]`);
  return marked instanceof HTMLElement ? marked : null;
}

/**
 * A deterministic duplicate is a true no-op: keep the exact active View node in place, surface
 * only its explanation, and let stream close remove the dormant subscriber.
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
  const currentIdentity = activeCapabilityIdentity(current);
  const restoredIdentity = activeCapabilityIdentity(restored);
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
    const marked = explanation.querySelector(PROMPT_REFUSAL_SELECTOR) !== null;
    tellThePromptBar(explanation.textContent ?? "", marked);
  }
  subscriber.dataset.preserveActiveView = "true";
  return true;
}

/**
 * The run saying what it turned out to be. It lands nowhere: the desk owns the window, so this
 * is told rather than placed (ARCH §6.1).
 *
 * @param {HTMLElement} listener
 * @param {string} raw
 * @returns {boolean}
 */
function nameTheWindowFrom(listener, raw) {
  const named = markedFragment(listener, raw, BUILD_WINDOW_TITLE_ATTRIBUTE);
  if (!named) return false;
  const title = named.getAttribute(BUILD_WINDOW_TITLE_ATTRIBUTE);
  if (title) nameTheWindow(title);
  // The desk has stopped working out what the sentence was, so what it said about that is done.
  tellThePromptBar("");
  return true;
}

/**
 * The run saying it was a question. It lands nowhere either: the desk owns its windows, and this
 * one opens beside whatever is standing rather than taking the window over (PLAN decision 23).
 *
 * @param {HTMLElement} listener
 * @param {string} raw
 * @returns {boolean}
 */
function openTheAnswerWindowFrom(listener, raw) {
  const asked = markedFragment(listener, raw, ANSWER_WINDOW_ATTRIBUTE);
  if (!asked) return false;
  // The window the submit borrowed was never this run's to keep, and the mark is what makes the
  // give-back exact: at close the subscriber goes and the region is otherwise untouched, so a
  // record the user had open is still open. The name goes back now rather than at close, because
  // a question runs for a while — unless the frame holds nothing but this run, which is one the
  // prompt stood up and which goes away at close rather than being renamed on its way out.
  const subscriber = listener.closest(BUILD_SUBSCRIBER_SELECTOR);
  const output = subscriber?.closest(`#${WINDOW_REGION_ID}`);
  if (subscriber instanceof HTMLElement && output instanceof HTMLElement) {
    // What the desk finds a running question by (`public/leaving-a-run.js`), and the one thing
    // the two triggers of decision 10 need standing in the window to have anything to end.
    subscriber.dataset.questionRun = "true";
    subscriber.dataset.preserveActiveView = "true";
    if (!outputHasOnlyDormantSubscriber(output, subscriber)) nameTheWindow(null);
  }
  tellThePromptBar("");
  const question = asked.getAttribute(ANSWER_WINDOW_ATTRIBUTE) ?? "";
  const detail = { question, saying: asked.textContent ?? "" };
  document.dispatchEvent(new CustomEvent(OPEN_THE_ANSWER_WINDOW_EVENT, { detail }));
  return true;
}

/**
 * Aluna saying one more thing in the window she is already speaking in.
 *
 * @param {HTMLElement} listener
 * @param {string} raw
 * @returns {boolean}
 */
function sayInTheAnswerWindowFrom(listener, raw) {
  const said = markedFragment(listener, raw, ANSWER_WINDOW_SAYING_ATTRIBUTE);
  if (!said) return false;
  const detail = { saying: said.textContent ?? "" };
  document.dispatchEvent(new CustomEvent(SAY_IN_THE_ANSWER_WINDOW_EVENT, { detail }));
  return true;
}

/**
 * Aluna declining a sentence, and the desk choosing where that lands. A refusal opens no window,
 * so an answer standing here takes it — under the words that were refused, in place of an answer
 * to a question nobody asked — and a desk holding none hears it on the prompt bar instead.
 *
 * @param {HTMLElement} listener
 * @param {string} raw
 * @returns {boolean}
 */
function placeTheRefusalFrom(listener, raw) {
  const refused = markedFragment(listener, raw, REFUSED_PROMPT_ATTRIBUTE);
  if (!refused) return false;
  const saying = refused.textContent ?? "";
  const detail = { refused: refused.getAttribute(REFUSED_PROMPT_ATTRIBUTE) ?? "", saying };
  theRunRefusedWhatWasTyped = true;
  // A window that took it answers the offer; one left unanswered means there was no window. Either
  // way the bar is told, because the deflection stopped sending a notice for a refusal and nothing
  // else retires the resolver's sentence from under a window that has since said the real thing.
  // The empty sentence retires rather than speaks, so the refusal mark rides only the spoken one.
  const offer = new CustomEvent(REFUSE_IN_THE_ANSWER_WINDOW_EVENT, { detail, cancelable: true });
  tellThePromptBar(document.dispatchEvent(offer) ? saying : "", true);
  return true;
}

/**
 * Park a held run's restoration instead of letting htmx place it. The ending arrives first, so
 * the subscriber already says whether this run waits; the fragment itself is the ordinary one.
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
// Hidden `sse-swap` listener nodes cancel htmx's HTML swap and hand the payload to the panel.
document.addEventListener("htmx:sseBeforeMessage", (event) => {
  const listener = event.target;
  if (!(listener instanceof HTMLElement)) return;

  const message = /** @type {CustomEvent<MessageEvent<string>>} */ (event).detail;
  if (
    nameTheWindowFrom(listener, message.data) ||
    openTheAnswerWindowFrom(listener, message.data) ||
    sayInTheAnswerWindowFrom(listener, message.data) ||
    placeTheRefusalFrom(listener, message.data) ||
    preserveActiveView(listener, message.data) ||
    holdRestoration(listener, message.data)
  ) {
    event.preventDefault();
    return;
  }

  const stage = listener.dataset.previewStage;
  if (!stage) return;

  event.preventDefault();
  // Handed over rather than written in place: the panel may not be standing when a stage arrives,
  // and it keeps them (`public/desk-dev-panel.js`).
  const detail = { stage, payload: message.data };
  document.dispatchEvent(new CustomEvent(STAGE_PAYLOAD_EVENT, { detail }));
});

/**
 * The surface of the capability standing in the window: a direct child of the region, never a
 * descendant, since a build carries a copy of that surface inside its own subscriber.
 * @returns {HTMLElement | null}
 */
function activeCapabilitySurface() {
  const output = document.getElementById(WINDOW_REGION_ID);
  const surface = output?.querySelector(":scope > [data-active-capability-id]");
  return surface instanceof HTMLElement ? surface : null;
}

// Capture the exact active registry identity before POST /prompt appends its dormant subscriber.
// The server validates both hints and stores only this data-free descriptor on the job.
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

// Appending keeps the active View stable while intent is unknown, and one subscriber is enforced
// at admission: a window put away leaves none to find, having already ended the run it narrated.
document.addEventListener("htmx:beforeRequest", (event) => {
  const detail = /** @type {CustomEvent<{ elt?: Element }>} */ (event).detail;
  if (!(detail?.elt instanceof HTMLFormElement) || detail.elt.id !== PROMPT_FORM_ID) return;
  const output = document.getElementById(WINDOW_REGION_ID);
  const standing = output?.querySelector(BUILD_SUBSCRIBER_SELECTOR);
  if (standing instanceof HTMLElement) {
    // A run still going is what this guard is for; one waiting to be read is not. Dropped rather
    // than given back: what it displaced was covered, so placing it starts a read nothing wants.
    if (runIsUsingTheWindow()) {
      event.preventDefault();
      tellThePromptBar(BUILD_IN_FLIGHT_REFUSAL, true, true);
      return;
    }
    // Never a question: `dropHeldRun` takes the node out without htmx's cleanup, which would
    // leave the stream open and the reading going. The answer window has already ended it
    // (`public/desk-answer-window.js`), and if it could not, leaving it is the lesser harm.
    if (!standing.matches(QUESTION_RUN_SELECTOR)) dropHeldRun(standing);
  }
  // The last run's leftovers, retired where a run starts rather than at its stream open: a
  // transport reconnect opens a stream for the same run, and must not take its words away.
  theRunRefusedWhatWasTyped = false;
  tellThePromptBar("");
});

/**
 * A desk action is a request made from the ground rather than from inside the window. One that
 * would take the window from a run is refused, never becoming a second cancel (PLAN decision 20).
 */
document.addEventListener("htmx:beforeRequest", (event) => {
  const detail = /** @type {CustomEvent<{ elt?: unknown, target?: unknown }>} */ (event).detail;
  const asking = detail?.elt;
  if (!(asking instanceof Element) || asking.id === PROMPT_FORM_ID) return;
  if (asking.closest(`#${WINDOW_REGION_ID}`) !== null) return;
  // Where this would land is htmx's own answer, already resolved on this event. Borrowed rather
  // than reimplemented, for the reason `public/swap-target.js` gives.
  const takingTheWindow =
    detail?.target instanceof Element && detail.target.id === WINDOW_REGION_ID;
  // Opening a capability is exempt from the refusal: it is a navigation, and owes the run a
  // warning instead. `matches` rather than `closest`, so a control hung on a logo is furniture.
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
 * Whether a run is using the window, rather than only standing in it. A run waiting to be read is
 * not, and neither is a question, which gave the window back as it opened its answer window —
 * refusing a press over one would hold the desk for a run that is not in it, and would put the
 * deletion that cancels a question (decision 10) out of reach. `leaving-a-run.js` draws it so too.
 * @returns {boolean}
 */
function runIsUsingTheWindow() {
  const standing = document
    .getElementById(WINDOW_REGION_ID)
    ?.querySelector(`${BUILD_SUBSCRIBER_SELECTOR}:not(${QUESTION_RUN_SELECTOR})`);
  return standing instanceof HTMLElement && standing.querySelector(BUILD_ENDING_SELECTOR) === null;
}

/**
 * A new build starts from an empty panel, and only one actually admitted: clearing on the request
 * would let a refusal wipe the lifecycle history the page seeded, which nothing restores.
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
 * The sentence out of a structured refusal, read from the marked element the router wrote it in
 * (`src/runtime/router/wire/failure-responses.ts`) and parsed into an inert template, so nothing
 * runs.
 * @param {string} html
 * @returns {string}
 */
function refusalSentence(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector("[data-error-code]")?.textContent?.trim() ?? "";
}

// HTMX keeps error responses out of the DOM by default; the router retargets structured form
// refusals to the live error region, leaving the response unsuccessful so typed values survive.
document.addEventListener("htmx:beforeSwap", (event) => {
  const detail =
    /** @type {CustomEvent<{ xhr: XMLHttpRequest, shouldSwap: boolean, requestConfig?: { elt?: unknown } }>} */ (
      event
    ).detail;
  const response = detail?.xhr?.responseText;
  // 409 is the read-gate refusal while a deletion drains: briefly unreadable, not broken. It has
  // to be listed here or htmx drops it and the click looks like it did nothing.
  if (![404, 409, 422, 500].includes(detail?.xhr?.status) || typeof response !== "string") return;
  const isStructuredFormRefusal = [
    "missing_required_fields",
    // A submitted choice value the field never declared. Platform-owned, like the required-field
    // refusal beside it, and dropped by htmx unless the shell claims it.
    "invalid_choice",
    // A newly chosen option the field no longer offers. Its own code, because the value is
    // declared and the record already holding it is untouched.
    "choice_disabled",
    // A string longer than its field's declared max_length. The native attribute stops it on a
    // filled-in form, so this is the crafted-request path.
    "max_length_exceeded",
    // A file the save could not claim: gone to a sweep, or another field's or another save's.
    "invalid_file_reference",
    "mutation_busy",
    "read_unavailable",
    "record_not_found",
    "mutation_failed",
    // A rename the desk turned down (`src/lifecycle/rename/presentation.ts`), the first refusal
    // that can only have come from outside the window, so it always speaks on the prompt bar.
    "rename_refused",
    // An address or a press that names nothing (`NOT_FOUND_FRAGMENT`). A second tab still stands
    // the tile of a deleted capability, and a press on it took the window down without a word.
    "not_found",
  ].some((code) => response.includes(`data-error-code="${code}"`));
  if (!isStructuredFormRefusal) return;

  // Which surface asked. `detail.elt` is the swap target here, but the request's own
  // configuration is on the same detail and names the element that made it.
  const asking = detail.requestConfig?.elt;
  // Where a refusal lands is one ownership rule and not a table of codes: it renders on the
  // surface it arrived from (PLAN decision 26), so one asked from outside speaks on the bar.
  if (asking instanceof Element && asking.closest(`#${WINDOW_REGION_ID}`) === null) {
    // A refusal whose sentence could not be read is still shown where it was aimed: moving it to
    // a slot and finding nothing to put there answers the person with silence.
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
 * The window's content changed hands, said rather than decided (ARCH §6.1). `navigated` is true
 * only where a capability took the window: a build's successful v1 activation.
 * @param {boolean} navigated
 */
function tellDeskTheWindowTookCapability(navigated) {
  const event = new CustomEvent("aluna:window-took-capability", { detail: { navigated } });
  document.dispatchEvent(event);
}

/** @param {HTMLElement} subscriber */
// `activated` is the one thing the address cares about: a `commit` is a real pointer activation.
// A restoration navigated nowhere, so it may not leave an entry behind.
function terminalPresentationContent(subscriber) {
  const restoration = subscriber.querySelector("[data-build-restoration]");
  if (restoration instanceof HTMLElement) {
    const restorationKind = restoration.dataset.buildRestoration;
    return { element: restoration, promoteElement: false, restorationKind, activated: false };
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
 * Everything the region still holds that is not the content just promoted, released while still
 * connected. A walk of what is leaving, not a release of the region, whose anchored work stays.
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
 * Wire up the content the region has just been given, so its own `hx-trigger="load"` fires: htmx's
 * settle runs 20ms after a swap, by which time a promotion has carried the View out of reach.
 *
 * @param {readonly ChildNode[]} promoted
 */
function processPromotedContent(promoted) {
  // Last, after the release: a read started before it would be a read the release could abort.
  const htmx = /** @type {Window & { htmx?: { process(node: Element): void } }} */ (window).htmx;
  if (!htmx) return;
  // A subtree already reading is left alone: processing an element htmx holds a request on
  // de-initialises it, and the abort then looks up a request it no longer has, so the read leaks.
  for (const node of promoted) {
    if (!(node instanceof Element)) continue;
    if (node.classList.contains(HTMX_REQUEST_CLASS)) continue;
    if (node.querySelector(`.${HTMX_REQUEST_CLASS}`) !== null) continue;
    htmx.process(node);
  }
}

/**
 * Promote what the run ended with, and release only what that displaces. The terminal content
 * moves out of the subscriber first, so the release never runs over what is arriving.
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
 * Promote what a run ended with, and answer for what that leaves the desk holding: a window with
 * nothing in it goes away, and a run that gave back the bare desk is at the desk's own address.
 *
 * @param {HTMLElement} subscriber
 * @param {HTMLElement} output
 * @param {boolean} mayPutWindowAway
 * @returns {boolean} whether a real pointer activation took the window
 */
function completeTerminalPresentation(subscriber, output, mayPutWindowAway) {
  const { restorationKind, activated } = promoteTerminalPresentation(subscriber, output);
  // An activation renames the window after the capability that took it; every other ending puts
  // back the name the run took over, nothing it was called while working being true.
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
 * Take the run's story down, having been read. Always first, so nothing downstream mistakes this
 * run for one that is waiting — the rescue below reads exactly that.
 * @param {HTMLElement} subscriber
 */
function retireBuildEnding(subscriber) {
  subscriber.querySelector(BUILD_ENDING_SELECTOR)?.remove();
}

/**
 * Let a read run go without giving anything back. What it displaced was covered rather than
 * taken away (`demo.css`), so uncovering it is the whole of what this owes.
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
 * The end of the wait: a parked restoration (`holdRestoration`) finally reaches the region, moved
 * into the run's own fragment surface first so the one promotion path carries it out once.
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
 * A held ending about to be destroyed rather than read. The window is the only place the sentence
 * lives, so it moves to the prompt bar on the way out (PLAN decisions 23 and 24).
 *
 * @param {EventTarget | null} eventTarget
 */
function rescueHeldEnding(eventTarget) {
  // htmx's own cleanup is the hook, because every disappearance goes through it. A dismissal
  // never reaches this: the ending is retired before anything is released.
  if (!(eventTarget instanceof Element)) return;
  const ending = eventTarget.matches?.(BUILD_SUBSCRIBER_SELECTOR)
    ? eventTarget.querySelector(BUILD_ENDING_SELECTOR)
    : null;
  if (!(ending instanceof HTMLElement)) return;
  // Carried as the ending it already was, not turned into a refusal: it had its moment in the
  // window's live region, so it arrives without the cue a fresh refusal comes with.
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
    // Scoped to the subscriber, not the region, so the preserved active view stays. Dispatched
    // before the detach, because `abortTransportIn` can only abort a connected node's request.
    releaseRegionContent(subscriber);
    subscriber.remove();
    // The run took the window and then did not need it, so it gives back the name: a prompt that
    // built nothing may not leave the window called `Thinking…` over a standing collection.
    nameTheWindow(null);
    putAwayEmptyWindow(output);
    return false;
  }

  // A run that ended with something to tell you stops here, giving nothing back until the ending
  // is dismissed (PLAN decision 25). Cancel never reaches this, having no ending.
  if (subscriber.querySelector(BUILD_ENDING_SELECTOR) !== null) {
    nameTheWindow(null);
    return false;
  }

  return completeTerminalPresentation(subscriber, output, true);
}

// The press that ends the wait. The control is about to be detached, so focus goes to the prompt
// bar, with the person's words still in it: a run asking them to try again may not wipe them.
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
  // A swap is not a navigation: whatever navigated pushed its own address before the request
  // went out, so this only catches up a window that changed hands underneath it.
  tellDeskTheWindowTookCapability(false);
});
document.addEventListener("htmx:afterSettle", (event) => {
  const target = /** @type {CustomEvent<{ target?: unknown }>} */ (event).detail?.target;
  // Only a swap of the region itself can have emptied it; a swap into something inside it — the
  // records region reloading — never leaves the window with nothing in it.
  if (target instanceof HTMLElement && target.id === WINDOW_REGION_ID) {
    putAwayEmptyWindow(target);
  }
});
document.addEventListener("htmx:sseClose", (event) => {
  if (closeTypeOf(event) !== "message") return;
  // Only a real pointer activation navigated: its capability's canonical collection is standing
  // somewhere for the first time. A restoration puts back what was displaced and is owed no entry.
  tellDeskTheWindowTookCapability(finishTerminalPresentation(event.target));
});
