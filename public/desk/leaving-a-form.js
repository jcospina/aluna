// @ts-check

/**
 * The exits that take a form out of the window without passing through the desk window's own
 * navigations: the form's own close, opening another record, Delete on a logo's menu, and a
 * prompt. Each asks first when the form has unsaved changes (Module 7 PLAN decision 32), and a yes
 * makes the same press again. Listened for on the window in the capture phase, so the question
 * comes before every listener of the page's: htmx's, Alpine's, the desk's own and the prompt bar's.
 */

import {
  PROMPT_FIELD_ID,
  PROMPT_FORM_ID,
  RECORD_FORM_SELECTOR,
  WINDOW_CONTENT_ID,
} from "../core/shell-dom.js";
import { hasUnsavedChanges } from "../records/unsaved-changes.js";
import { WINDOW_DOORWAY_SELECTOR } from "./desk-doorway.js";
import {
  askBeforeLeaving,
  buildJobIdIn,
  leavingIsBeingAsked,
  runHasDrawn,
  runRefusesThePrompt,
} from "./leaving-a-run.js";
import { closeLogoMenu } from "./logos/logo-menu.js";
import { hasSomethingToBuild } from "./prompt-bar.js";

/** A form's own way out: a record's Back and Cancel, and the create panel's Cancel. */
const FORM_CLOSE_SELECTOR = "[data-record-back], [data-record-cancel], [data-create-cancel]";

/**
 * The create panel's Back only hides the panel, its form still filled under **New**. A person
 * reads it as leaving, so with changes it asks, and a yes puts the form down the way Cancel does.
 */
const CREATE_BACK_SELECTOR = ".capability-collection__create [data-record-form-back]";
const CREATE_CANCEL_SELECTOR = "[data-create-cancel]";

/** A record in the collection that opens in the window when pressed; a card for one that cannot be
 * changed opens nothing. */
const RECORD_ITEM_SELECTOR = ".capability-item[data-record-view-template]";

/** The form a close takes, which is all a close takes: the window stays. */
const FORM_SURFACE_SELECTOR = "[data-record-view], .capability-collection__create";

/**
 * As much of an element as the rules read, so a plain object satisfies it in Bun.
 *
 * @typedef {{
 *   closest(selector: string): Pressable | null,
 *   click?: () => void,
 *   contains?: (other: never) => boolean,
 *   querySelector?: (selector: string) => unknown,
 * }} Pressable
 * @typedef {{ getElementById(id: string): Pressable | null }} Desk
 * @typedef {{
 *   el: Pressable,
 *   scope: Pressable,
 *   again: () => void,
 *   first?: () => void,
 *   keep?: boolean,
 *   desk?: boolean,
 *   pressed?: unknown,
 * }} Exit
 */

/**
 * The window's content region and the window around it, or null when no window stands.
 *
 * @param {Desk} desk
 */
function standingWindow(desk) {
  const region = desk.getElementById(WINDOW_CONTENT_ID);
  const el = region?.closest(".window") ?? null;
  return region === null || el === null ? null : { region, el };
}

/**
 * What a press would take out of the window, and how to make it again, or null when it is not one
 * of these exits. A form's own close takes only that form; the others take the whole window.
 *
 * @param {Pressable} pressed
 * @param {Desk} desk
 * @returns {Exit | null}
 */
export function exitPressed(pressed, desk) {
  const standing = standingWindow(desk);
  if (standing === null) return null;
  const { region, el } = standing;
  const inside = (/** @type {Pressable | null} */ node) =>
    node !== null && region.contains?.(/** @type {never} */ (node)) === true ? node : null;
  const close = inside(pressed.closest(FORM_CLOSE_SELECTOR));
  if (close !== null) {
    const scope = close.closest(FORM_SURFACE_SELECTOR) ?? el;
    return { el, scope, again: () => close.click?.(), pressed: close };
  }
  const back = inside(pressed.closest(CREATE_BACK_SELECTOR));
  const panel = back?.closest(FORM_SURFACE_SELECTOR) ?? null;
  if (back !== null && panel !== null) {
    const cancel = () =>
      /** @type {Pressable | null} */ (panel.querySelector?.(CREATE_CANCEL_SELECTOR));
    return { el, scope: panel, again: () => cancel()?.click?.(), pressed: back };
  }
  const item = inside(pressed.closest(RECORD_ITEM_SELECTOR));
  if (item !== null) return { el, scope: el, again: () => item.click?.(), pressed: item };
  const doorway = pressed.closest(WINDOW_DOORWAY_SELECTOR);
  if (doorway === null) return null;
  /* The menu goes the way any choice in it sends it, focus back on its logo, before the question
   * stands: left open beside it, it offered a second Delete over the first. */
  const first = () => closeLogoMenu({ restoreFocus: true });
  return { el, scope: el, again: () => doorway.click?.(), first, desk: true };
}

/**
 * Ask before an exit. A press from the desk that a run holds the window against is refused on the
 * prompt bar instead (`public/app.js`). A run that has drawn hides the form, so nothing in it can be
 * pressed; one still working out its sentence has not, and a form's own exit would take it.
 *
 * @param {Exit | null} exit
 * @returns {boolean} whether the press is being held
 */
export function holdExit(exit) {
  if (exit === null) return false;
  const el = /** @type {never} */ (exit.el);
  if (exit.desk ? runRefusesThePrompt(el) : runHasDrawn(el)) return false;
  const running = !exit.desk && buildJobIdIn(el) !== null;
  const costs = running || hasUnsavedChanges(/** @type {never} */ (exit.scope));
  if (!leavingIsBeingAsked() && !costs) return false;
  exit.first?.();
  return askBeforeLeaving(el, exit.again, exit.scope, { keep: exit.keep, pressed: exit.pressed });
}

/** Whether the prompt being sent is the one a yes sends, which is not asked about again. */
let sendingAgain = false;

/**
 * The prompt about to be sent, as an exit: a sentence can turn out to be a build, which takes
 * the window, and once it is sent there is no asking. A yes is consent and gives nothing up, since
 * the sentence may turn out to be a question that leaves the form standing; a build that takes the
 * window lets its uploads go as any leave does. A blank sentence, or one the prompt bar refuses
 * while a run holds the window, is not asked about.
 *
 * @param {{ id?: string, querySelector?: (selector: string) => unknown, requestSubmit?: (by?: never) => void }} form
 * @param {unknown} submitter
 * @param {Desk} desk
 * @returns {Exit | null}
 */
export function promptExit(form, submitter, desk) {
  if (sendingAgain || form.id !== PROMPT_FORM_ID) return null;
  const field = /** @type {{ value?: string } | null} */ (
    form.querySelector?.(`#${PROMPT_FIELD_ID}`)
  );
  if (!hasSomethingToBuild(field?.value ?? "")) return null;
  const el = standingWindow(desk)?.el ?? null;
  if (el === null || runRefusesThePrompt(/** @type {never} */ (el))) return null;
  const again = () => {
    sendingAgain = true;
    try {
      form.requestSubmit?.(/** @type {never} */ (submitter));
    } finally {
      sendingAgain = false;
    }
  };
  return { el, scope: el, again, keep: true, desk: true };
}

/**
 * Whether a record form's save must wait for the question's answer. The form under the question is
 * inert, but a save sent anyway would carry what the person is being asked whether to give up.
 *
 * @param {{ matches?: (selector: string) => boolean }} form
 */
export function saveHeldByTheQuestion(form) {
  return leavingIsBeingAsked() && form.matches?.(RECORD_FORM_SELECTOR) === true;
}

/** @param {Event} event */
function stop(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/**
 * Stand the exits behind the question, on the page's window, before every listener of the page's.
 *
 * @param {Pick<Window, "addEventListener">} view
 * @param {Desk} desk
 */
export function startLeavingAForm(view, desk) {
  view.addEventListener(
    "click",
    (event) => {
      const pressed = event.target;
      if (!(pressed instanceof Element)) return;
      if (holdExit(exitPressed(/** @type {never} */ (pressed), desk))) stop(event);
    },
    true,
  );
  view.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (saveHeldByTheQuestion(form)) {
        stop(event);
        return;
      }
      const exit = promptExit(form, /** @type {SubmitEvent} */ (event).submitter, desk);
      if (holdExit(exit)) stop(event);
    },
    true,
  );
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  startLeavingAForm(window, /** @type {never} */ (document));
}
