// @ts-check

/**
 * The question a form with unsaved changes asks before a navigation takes it (Module 7 PLAN
 * decision 32, widened in 7.3/03): the window's leaving question, drawn in
 * `design/styles/components/window.css` and asked over a running build's window too. A run ships
 * its copy hidden in its own surface; a form has no such surface, so this one is built in the
 * window's body when it is asked, and nothing is fetched or swapped to show it. Saying to leave
 * puts every file control under the form back to what it saved, which stops what is travelling,
 * and hands the keys it held to the pending-only route; typed changes go with the form.
 */

import { settleFileFields } from "../../design/scripts/files/file-field.js";
import { heldUploads } from "../controls/held-uploads.js";
import { hasUnsavedChanges, letGoOfChanges } from "../records/unsaved-changes.js";
import { raiseWindow } from "./window/desk-stack.js";

/** What the question says, and its two answers: the one focus lands on keeps the form. */
export const LEAVING_UNSAVED_QUESTION = "You have unsaved changes, are you sure you want to leave?";
export const LEAVING_UNSAVED_BACK_OUT = "Keep editing";
export const LEAVING_UNSAVED_GO_AHEAD = "Leave without saving";

/** The marks the question and its two answers are found by. */
const MARK = {
  question: "data-unsaved-leaving",
  back: "data-unsaved-leaving-back",
  go: "data-unsaved-leaving-go",
};
export const UNSAVED_LEAVING_SELECTOR = `[${MARK.question}]`;
export const UNSAVED_LEAVING_BACK_SELECTOR = `[${MARK.back}]`;
export const UNSAVED_LEAVING_GO_SELECTOR = `[${MARK.go}]`;

const QUESTION_ID = "window-leaving-unsaved";
const WINDOW_BODY_SELECTOR = ":scope > .window__body";

/**
 * The window, the document and the bookkeeping, as much of each as the question reaches for, so a
 * plain object stands in for any of them in Bun.
 *
 * @typedef {{ focus?: () => void, isConnected?: boolean }} Focusable
 * @typedef {{ append(node: unknown): void, children: Iterable<{ inert: boolean }> }} WindowBody
 * @typedef {{ querySelector(selector: string): unknown }} QuestionWindow
 * @typedef {import("../records/unsaved-changes.js").RecordForm} Scope
 * @typedef {{
 *   unsaved?: (scope: Scope) => boolean,
 *   letGo?: (scope: Scope) => void,
 *   revert?: (scope: Scope) => void,
 *   draw?: () => Veil,
 *   focused?: () => unknown,
 *   raise?: (el: QuestionWindow) => void,
 *   keep?: boolean,
 *   pressed?: unknown,
 *   alsoEnd?: () => boolean,
 * }} UnsavedQuestionHow
 * @typedef {{ node: { isConnected?: boolean }, remove(): void, back: Focusable | null }} Veil
 * @typedef {{
 *   run: null,
 *   show: (asking: boolean) => void,
 *   stands: () => boolean,
 *   backOut: () => Focusable | null,
 *   end: () => boolean,
 * }} UnsavedQuestion
 */

/**
 * The question's markup: the run's own, word for word in structure, so one stylesheet draws both.
 *
 * @returns {Veil}
 */
function drawVeil() {
  const make = (/** @type {string} */ tag, /** @type {string} */ className) => {
    const node = document.createElement(tag);
    if (className !== "") node.className = className;
    return node;
  };
  const veil = make("div", "window__leaving");
  veil.setAttribute(MARK.question, "");
  const panel = make("div", "window__leaving-panel");
  const question = make("p", "");
  question.id = QUESTION_ID;
  question.textContent = LEAVING_UNSAVED_QUESTION;
  const actions = make("div", "window__leaving-actions");
  const answer = (/** @type {string} */ label, /** @type {string} */ kind, mark = "") => {
    const button = make("button", `btn ${kind}`);
    Object.assign(button, { type: "button", textContent: label });
    button.setAttribute(mark, "");
    button.setAttribute("aria-describedby", QUESTION_ID);
    return button;
  };
  const back = answer(LEAVING_UNSAVED_BACK_OUT, "btn--warm", MARK.back);
  const go = answer(LEAVING_UNSAVED_GO_AHEAD, "btn--outline", MARK.go);
  actions.append(back, go);
  panel.append(question, actions);
  veil.append(panel);
  return { remove: () => veil.remove(), back, node: veil };
}

/**
 * The question to ask over `el` before a navigation takes `scope`, or null when nothing would be
 * lost. Asked, it comes to the front and what it covers is inert, so nothing under it is saved. A
 * yes that `keep`s is consent and gives nothing up; `alsoEnd` is a run a yes ends first, and one
 * that cannot be ended gives nothing up either. Focus goes back to what was `pressed`, or to what
 * had it, since a browser need not focus a pressed button.
 *
 * @param {QuestionWindow} el the window
 * @param {Scope} scope what the navigation takes: the window, or the one form closing
 * @param {UnsavedQuestionHow} [how]
 * @returns {UnsavedQuestion | null}
 */
export function unsavedQuestionIn(el, scope, how = {}) {
  const {
    unsaved = hasUnsavedChanges,
    letGo = (/** @type {Scope} */ s) => {
      heldUploads.letGo(/** @type {never} */ (s));
      letGoOfChanges(s);
    },
    revert = (/** @type {Scope} */ s) => settleFileFields(/** @type {Element} */ (s), "revert"),
    draw = drawVeil,
    focused = () => globalThis.document?.activeElement ?? null,
    raise = raiseWindow,
    keep = false,
    alsoEnd = () => true,
  } = how;
  const body = /** @type {WindowBody | null} */ (el.querySelector(WINDOW_BODY_SELECTOR));
  if (body === null || !unsaved(scope)) return null;
  /** @type {Veil | null} */
  let veil = null;
  /** @type {Focusable | null} */
  let pressed = null;
  /** @type {{ inert: boolean }[]} */
  let covered = [];
  /* Focus goes back to what was pressed, so the press made again lands exactly as the first. */
  const takeDown = () => {
    veil?.remove();
    veil = null;
    for (const node of covered) node.inert = false;
    covered = [];
    if (pressed?.isConnected) pressed.focus?.();
  };
  return {
    run: null,
    show(asking) {
      if (!asking) {
        takeDown();
        return;
      }
      pressed = /** @type {Focusable | null} */ (how.pressed ?? focused());
      raise(el);
      covered = [...body.children].filter((node) => !node.inert);
      for (const node of covered) node.inert = true;
      veil = draw();
      body.append(veil.node);
      veil.back?.focus?.();
    },
    stands: () => veil?.node.isConnected !== false,
    backOut: () => veil?.back ?? null,
    end() {
      if (!alsoEnd()) return false;
      if (!keep) {
        revert(scope);
        letGo(scope);
      }
      takeDown();
      return true;
    },
  };
}
