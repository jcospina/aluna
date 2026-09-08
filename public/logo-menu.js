// @ts-check

/**
 * The short menu that opens on a capability's logo, and the inline rename form it opens: three
 * ways in, one component (PLAN decision 19), with the markup shipped hidden beside the logo.
 */

import { isCapabilityNameLabel, isMarkupShapedName } from "./capability-name.js";
import { BUSY_LABEL_ATTRIBUTE, IDLE_LABEL_ATTRIBUTE } from "./shell-dom.js";

/**
 * The slot one capability occupies on the desk: the logo, its menu and its editor. The doorway is
 * on the logo rather than the window chrome, which is why no lamp goes signal red and D3 stands.
 */
const SLOT_SELECTOR = "[data-logo-slot]";
const LOGO_SELECTOR = "[data-capability-logo]";
const MENU_SELECTOR = "[data-logo-menu]";
const MENU_ITEM_SELECTOR = "[role=menuitem]";
const RENAME_FORM_SELECTOR = "[data-logo-rename]";
const RENAME_INPUT_SELECTOR = "[data-logo-rename-input]";
const RENAME_ERROR_SELECTOR = "[data-logo-rename-error]";
const RENAME_CANCEL_SELECTOR = "[data-logo-rename-cancel]";
const RENAME_ITEM_SELECTOR = "[data-logo-menu-rename]";
const LOGO_LABEL_SELECTOR = "[data-logo-label]";
const RENAME_SAVE_SELECTOR = "[data-logo-rename-save]";

/** The marker the slot wears while its label is a form. The stylesheet hides the label
 * on it, so the form stands exactly where the name was. */
const RENAMING_ATTRIBUTE = "data-renaming";

/**
 * Where an open menu stands. It ships inside its logo's slot, which keeps the two together
 * through every swap, but the logo layer sits under the window layer — so it is lifted here.
 */
const MENU_LAYER_ID = "capability-menus";

/**
 * How long a press has to be held before it is a press-and-hold — the interval every platform's
 * own long-press uses. Shorter and an ordinary tap opens the menu; longer feels broken.
 */
export const LONG_PRESS_MS = 500;

/**
 * How far a finger may wander and still be holding still. A press is never perfectly still on a
 * touch screen, and anything past this is the start of a scroll or a drag.
 */
export const LONG_PRESS_SLOP_PX = 10;

/** How close to the edge of the screen a menu may be placed before it is pulled back. */
const MENU_VIEWPORT_MARGIN_PX = 8;

/**
 * The prompt bar's form, whose top edge is the floor a floating panel stops at (design D5): a
 * panel over that sentence would cover the answer to itself. Restated and pinned by a test.
 */
const PROMPT_FORM_ID = "spec-build-form";

/**
 * The slot the bar speaks in. It stands above the rail and is as tall as the sentence it holds,
 * so the floor moves up when the desk has something to say. Restated and pinned by a test.
 */
const PROMPT_NOTICE_ID = "prompt-notice";

/* What the editor says when the name will not do. It stays in the editor: a client-side reading
   is not a refusal the desk has made. */
const BLANK_LABEL_NOTICE = "Give it a name and I’ll put it under the tile.";
const UNUSABLE_LABEL_NOTICE = "Something short, in a few words — no full sentences.";
// Angle brackets are refused on their own rule, so the sentence about length would be untrue.
const BRACKETED_LABEL_NOTICE = "Names can\u2019t use < or >. Try it without them.";

/**
 * What the editor says about this name, or the empty string when it has nothing to say.
 * @param {string} value
 */
export function labelNotice(value) {
  if (value.trim().length === 0) return BLANK_LABEL_NOTICE;
  if (isCapabilityNameLabel(value)) return "";
  return isMarkupShapedName(value) ? BRACKETED_LABEL_NOTICE : UNUSABLE_LABEL_NOTICE;
}

/**
 * As much of the document as these rules reach for. Structural on purpose, so a double satisfies
 * it as well as a `Document` and the rules run in Bun without a browser.
 *
 * @typedef {{
 *   getAttribute(name: string): string | null,
 *   setAttribute(name: string, value: string): void,
 *   removeAttribute(name: string): void,
 *   hasAttribute(name: string): boolean,
 *   matches(selector: string): boolean,
 *   closest(selector: string): MenuNode | null,
 *   readonly isConnected?: boolean,
 *   querySelector(selector: string): MenuNode | null,
 *   querySelectorAll(selector: string): Iterable<MenuNode>,
 *   append?: (node: unknown) => void,
 *   focus(): void,
 *   style?: { setProperty(name: string, value: string): void },
 *   getBoundingClientRect?: () => { left: number, top: number, right: number,
 *     bottom: number, width: number, height: number },
 *   contains?: (node: unknown) => boolean,
 *   textContent?: string,
 *   value?: string,
 *   select?: () => void,
 * }} MenuNode
 *
 * @typedef {{
 *   type?: string,
 *   target?: unknown,
 *   key?: string,
 *   shiftKey?: boolean,
 *   pointerType?: string,
 *   clientX?: number,
 *   clientY?: number,
 *   detail?: unknown,
 *   preventDefault(): void,
 *   stopPropagation(): void,
 * }} MenuEvent
 *
 * @typedef {{
 *   addEventListener(type: string, listener: (event: any) => void, options?: unknown): void,
 *   getElementById?: (id: string) => MenuNode | null,
 *   querySelectorAll?: (selector: string) => Iterable<MenuNode>,
 *   activeElement?: MenuNode | null,
 *   body?: MenuNode | null,
 * }} MenuRoot
 */

/**
 * How many presses a click reports. A pointer's click carries at least one; a keyboard
 * activation carries none, which is what tells the two apart.
 * @param {MenuEvent} event
 */
function pressesBehind(event) {
  return typeof event.detail === "number" ? event.detail : 1;
}

/** What htmx put on one of its own events, when it put anything there. */
function htmxDetail(/** @type {MenuEvent} */ event) {
  const detail = event.detail;
  return /** @type {{ elt?: unknown, target?: unknown, successful?: boolean }} */ (
    typeof detail === "object" && detail !== null ? detail : {}
  );
}

/** The node an event happened on, when it is one this module can ask questions of. */
function nodeOf(/** @type {unknown} */ target) {
  const node = /** @type {MenuNode | null} */ (target);
  return node && typeof node.closest === "function" ? node : null;
}

/** @param {MenuNode} slot @param {string} selector */
function within(slot, selector) {
  return slot.querySelector(selector);
}

/**
 * The capability one node belongs to. A press inside the open menu is answered by the slot it
 * was opened on: while open, the menu stands in the menu layer, which is nobody's slot.
 * @param {MenuNode} node
 */
function slotOf(node) {
  const enclosing = node.closest(SLOT_SELECTOR);
  if (enclosing !== null) return enclosing;
  return node.closest(MENU_SELECTOR) === null ? null : openSlot;
}

/**
 * The desk's one open menu. Module state rather than per-slot: there is one pointer and one
 * keyboard, so a second menu opening is the first one closing.
 */
/** @type {MenuNode | null} */
let openSlot = null;
/** The open menu while it is standing in the menu layer rather than on its own logo. */
/** @type {MenuNode | null} */
let liftedMenu = null;
/** The open rename editor while it stands in the menu layer rather than on its own logo. */
/** @type {MenuNode | null} */
let liftedEditor = null;
/**
 * The slot that editor was lifted out of, and the only slot it may be put back into. Sending it
 * home by whichever slot happened to be swapped puts one logo's editor inside another's.
 */
/** @type {MenuNode | null} */
let editorHome = null;
/**
 * Where the label the editor stands in for was. Kept because the editor is placed more than
 * once: a sentence under the field makes the panel taller than the clamp allowed for.
 */
/** @type {{ x: number, y: number } | null} */
let editorAnchor = null;
/** @type {MenuNode | null} */
let menuLayer = null;
/** @type {MenuRoot | null} */
let deskRoot = null;
/** @type {MenuNode | null} */
let editingSlot = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let holdTimer;
/** @type {{ x: number, y: number } | null} */
let holdOrigin = null;
/**
 * Whether the click a consumed gesture is about to produce belongs to this module: a hold ends in
 * a `pointerup` the browser follows with a click, and opening the menu must not open the tile.
 */
let consumeNextClick = false;
/** The capability whose rename is in flight, so the logo that comes back can be given
 * the focus the swap took. */
let renamingCapabilityId = "";

/**
 * Put down everything this module is holding. For the rules being run against a second document:
 * a consumed click still armed would answer its first question with the first one's leftovers.
 */
export function resetLogoMenu() {
  openSlot = null;
  liftedMenu = null;
  editingSlot = null;
  liftedEditor = null;
  editorHome = null;
  editorAnchor = null;
  menuLayer = null;
  deskRoot = null;
  renamingCapabilityId = "";
  consumeNextClick = false;
  cancelHold();
}

/** @param {MenuNode} slot */
function menuOf(slot) {
  return within(slot, MENU_SELECTOR);
}

/** @param {MenuNode} slot */
function logoOf(slot) {
  return within(slot, LOGO_SELECTOR);
}

/**
 * Open one logo's menu, and close whatever was open. Idempotent: a platform firing its own
 * `contextmenu` for a long press reaches this beside the hold's timer.
 * @param {MenuNode} slot
 * @param {{ x: number, y: number } | null} [at] where the pointer was, when there was one
 */
export function openLogoMenu(slot, at = null) {
  if (openSlot === slot) return;
  closeLogoMenu({ restoreFocus: false });
  closeRenameEditor({ restoreFocus: false });
  const menu = menuOf(slot);
  if (menu === null) return;
  // Shown first and moved second: a drawn element measured while hidden has no box, so
  // relocating before unhiding asks the ink system to redraw nothing.
  menu.removeAttribute("hidden");
  logoOf(slot)?.setAttribute("aria-expanded", "true");
  if (menuLayer !== null) menuLayer.append?.(menu);
  liftedMenu = menuLayer === null ? null : menu;
  openSlot = slot;
  placeFloating(menu, at ?? cornerOf(logoOf(slot)));
  firstMenuItem(menu)?.focus();
}

/**
 * Put a floating piece of the desk where it was asked for, clamped to the viewport so a logo in
 * the corner opens above and left of the cursor. Silent where there is nothing to measure.
 *
 * @param {MenuNode | null | undefined} node @param {{ x: number, y: number } | null} at
 */
function placeFloating(node, at) {
  if (node === null || node === undefined || at === null) return;
  if (node.style === undefined || node.getBoundingClientRect === undefined) return;
  const box = node.getBoundingClientRect();
  const view = typeof window === "undefined" ? null : window;
  const room = {
    w: view?.innerWidth ?? Number.POSITIVE_INFINITY,
    h: promptBarTop() ?? view?.innerHeight ?? Number.POSITIVE_INFINITY,
  };
  const left = Math.max(
    MENU_VIEWPORT_MARGIN_PX,
    Math.min(at.x, room.w - box.width - MENU_VIEWPORT_MARGIN_PX),
  );
  const top = Math.max(
    MENU_VIEWPORT_MARGIN_PX,
    Math.min(at.y, room.h - box.height - MENU_VIEWPORT_MARGIN_PX),
  );
  node.style.setProperty("left", `${Math.round(left)}px`);
  node.style.setProperty("top", `${Math.round(top)}px`);
}

/** Where the desk's floor is, when there is a prompt bar standing on it. */
function promptBarTop() {
  const rail = deskRoot?.getElementById?.(PROMPT_FORM_ID)?.getBoundingClientRect?.();
  if (rail === undefined) return null;
  const said = deskRoot?.getElementById?.(PROMPT_NOTICE_ID)?.getBoundingClientRect?.();
  // An empty slot has no box and no claim on the desk. One holding a sentence does.
  return said === undefined || said.height === 0 ? rail.top : Math.min(rail.top, said.top);
}

/**
 * Where a menu opened without a pointer starts: the logo's own bottom-left corner, the keyboard
 * having no cursor to open from.
 * @param {MenuNode | null} logo
 */
function cornerOf(logo) {
  const box = logo?.getBoundingClientRect?.();
  return box === undefined ? null : { x: box.left, y: box.bottom };
}

/**
 * Put the menu away. Focus goes back to the logo it opened on, which is where it was before and
 * the only place still there afterwards.
 * @param {{ restoreFocus?: boolean }} [options]
 */
export function closeLogoMenu(options = {}) {
  const slot = openSlot;
  if (slot === null) return;
  openSlot = null;
  const menu = liftedMenu ?? menuOf(slot);
  // Asked before the menu is hidden, because after it the answer is always no. It does not go
  // back when something else has taken it: that would be this menu closing over the next action.
  const held = options.restoreFocus ?? holdsTheFocus(menu, MENU_SELECTOR);
  menu?.setAttribute("hidden", "");
  logoOf(slot)?.setAttribute("aria-expanded", "false");
  // Home again, so the slot is once more the whole of what this capability occupies and a swap
  // addressed at it takes the menu with it.
  if (menu !== null && menu !== undefined) slot.append?.(menu);
  liftedMenu = null;
  if (held) logoOf(slot)?.focus();
}

/**
 * Whether the keyboard is inside this node, or nowhere in particular. Both are cases where
 * putting focus back on the logo gives it somewhere to be rather than taking it away.
 * @param {MenuNode | null | undefined} node @param {string} selector
 */
function holdsTheFocus(node, selector) {
  const active = deskRoot?.activeElement;
  // A root that cannot answer is answered generously: the panel had the focus when it opened,
  // so giving it back is the safe reading.
  if (active === undefined) return true;
  if (active === null || active === deskRoot?.body) return true;
  return node !== null && node !== undefined && active.closest?.(selector) === node;
}

/** @param {MenuNode} menu */
function menuItems(menu) {
  return [...menu.querySelectorAll(MENU_ITEM_SELECTOR)];
}

/** @param {MenuNode} menu */
function firstMenuItem(menu) {
  return menuItems(menu)[0] ?? null;
}

/**
 * Move along the menu, wrapping at both ends, which is what every platform's own does.
 * @param {MenuNode} menu @param {MenuNode | null} from @param {number} step
 */
function moveMenuFocus(menu, from, step) {
  const items = menuItems(menu);
  if (items.length === 0) return;
  const at = from === null ? -1 : items.indexOf(from);
  const next = at === -1 ? 0 : (at + step + items.length) % items.length;
  items[next]?.focus();
}

/**
 * Turn one logo's label into the rename form. A sibling of the button rather than a child,
 * because a `<button>` may not contain interactive content, so no modal opens and nothing moves.
 * @param {MenuNode} slot
 */
export function openRenameEditor(slot) {
  const form = within(slot, RENAME_FORM_SELECTOR);
  const input = within(slot, RENAME_INPUT_SELECTOR);
  if (form === null || input === null) return;
  closeLogoMenu({ restoreFocus: false });
  const label = within(slot, LOGO_LABEL_SELECTOR);
  // Measured before the label is hidden, because where the label is is the whole answer.
  const at = label?.getBoundingClientRect?.();
  editingSlot = slot;
  slot.setAttribute(RENAMING_ATTRIBUTE, "");
  // The tile is not a way into the capability while its own name is being typed, and not a tab
  // stop standing between the field and Save.
  logoOf(slot)?.setAttribute("inert", "");
  form.removeAttribute("hidden");
  if (menuLayer !== null) menuLayer.append?.(form);
  liftedEditor = menuLayer === null ? null : form;
  editorHome = slot;
  clearRenameNotice(slot);
  input.value = label?.textContent?.trim() ?? input.value;
  editorAnchor = at === undefined ? null : { x: at.left, y: at.top };
  placeFloating(form, editorAnchor);
  input.focus();
  input.select?.();
}

/**
 * Put the editor away and give the label back. Every exit comes through here — Cancel, Escape,
 * and a name just written — so one place knows how to leave the logo the way it was found.
 * @param {{ restoreFocus?: boolean }} [options]
 */
export function closeRenameEditor(options = {}) {
  const slot = editingSlot;
  if (slot === null) return;
  editingSlot = null;
  const held = options.restoreFocus ?? holdsTheFocus(liftedEditor, RENAME_FORM_SELECTOR);
  slot.removeAttribute(RENAMING_ATTRIBUTE);
  clearRenameNotice(slot);
  returnEditor();
  const logo = logoOf(slot);
  logo?.removeAttribute("inert");
  if (held) logo?.focus();
}

/**
 * Hide the editor and put it back on the logo it was opened from. It goes home even when home
 * has just been swapped away: the menu layer is the one place it may not be left behind.
 */
function returnEditor() {
  const home = editorHome;
  const form = liftedEditor ?? (home === null ? null : within(home, RENAME_FORM_SELECTOR));
  liftedEditor = null;
  editorHome = null;
  editorAnchor = null;
  if (form === null || form === undefined) return;
  form.setAttribute("hidden", "");
  if (home !== null) home.append?.(form);
}

/** @param {MenuNode} slot @param {string} notice */
function sayInEditor(slot, notice) {
  const editor = editorOf(slot);
  const said = editor?.querySelector(RENAME_ERROR_SELECTOR);
  if (said === null || said === undefined) return;
  said.textContent = notice;
  // The panel is a different height now, so it is placed again from the same anchor.
  if (editor !== null && editor !== undefined) placeFloating(editor, editorAnchor);
}

/** This slot's rename editor, wherever it is standing. @param {MenuNode} slot */
function editorOf(slot) {
  return liftedEditor ?? within(slot, RENAME_FORM_SELECTOR);
}

/** @param {MenuNode} slot */
function clearRenameNotice(slot) {
  sayInEditor(slot, "");
}

/** Whether this keystroke is a request for the menu. Two spellings for two platforms: the
 * dedicated menu key, and Shift+F10 where there is none.
 * @param {MenuEvent} event */
function asksForTheMenu(event) {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey === true);
}

/**
 * Wire every way in onto a document. `gestureRoot` is `window` in a browser: capture runs
 * outermost-first, so only a listener there is guaranteed to see a click before `answerPress`.
 *
 * @param {MenuRoot} root
 * @param {MenuRoot} [gestureRoot]
 */
export function startLogoMenu(root, gestureRoot = root) {
  resetLogoMenu();
  deskRoot = root;
  menuLayer = root.getElementById?.(MENU_LAYER_ID) ?? null;
  gestureRoot.addEventListener("click", onGestureClick, true);
  // Outside the document and captured, for the reason the click above is: two other rules answer
  // Escape on the document and neither reads focus, and `stopPropagation` spares the same node.
  gestureRoot.addEventListener("keydown", onKeyDown, true);
  wirePointerHold(root);
  root.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("click", onActivation);
  root.addEventListener("submit", onRenameSubmit, true);
  wireRenameRequest(root);
}

/**
 * The one click a consumed gesture is allowed to eat, and the press that dismisses a menu.
 * Everything else on the desk goes past untouched.
 * @param {MenuEvent} event
 */
function onGestureClick(event) {
  // `detail` counts the presses behind a click and a keyboard activation reports none, so a
  // platform that suppressed the post-hold click cannot eat the next Enter on Rename.
  if (consumeNextClick && pressesBehind(event) > 0) {
    consumeNextClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const node = nodeOf(event.target);
  if (node === null) return;
  // A press that goes somewhere — a logo, another logo's menu item — answers the editor on its
  // way. One on the ground or in the prompt bar takes nobody's half-typed name with it.
  const navigating =
    node.closest(LOGO_SELECTOR) !== null || node.closest(MENU_ITEM_SELECTOR) !== null;
  if (navigating && editingSlot !== null && node.closest(RENAME_FORM_SELECTOR) === null) {
    closeRenameEditor();
  }
  if (openSlot === null) return;
  if (node.closest(MENU_SELECTOR) !== null) return;
  // A press that dismisses the menu does only that: landing on its own logo would otherwise put
  // the menu away and open the capability, one press doing two things asked for once.
  const dismissedOnItsOwnLogo = node.closest(SLOT_SELECTOR) === openSlot;
  closeLogoMenu();
  if (!dismissedOnItsOwnLogo) return;
  event.preventDefault();
  event.stopPropagation();
}

/** Right-click, and the long press every platform turns into one of these itself.
 * @param {MenuEvent} event */
function onContextMenu(event) {
  const node = nodeOf(event.target);
  const slot = node?.closest(SLOT_SELECTOR) ?? null;
  if (slot === null || slot === editingSlot) {
    // A right-click anywhere else is a dismissal like any other. It produces no `click`, so the
    // rule that closes the menu on a press away never hears about this one.
    if (node?.closest(MENU_SELECTOR) === null) closeLogoMenu();
    return;
  }
  event.preventDefault();
  // The same logo again is the menu asked for again, moved rather than closed and reopened: a
  // menu that tore itself down on the second arrival flickered on every touch open.
  if (slot === openSlot) placeFloating(liftedMenu ?? menuOf(slot), pointOf(event));
  else openLogoMenu(slot, pointOf(event));
}

/**
 * Where a pointer event happened, or nothing when it did not happen at a point: a Windows menu
 * key arrives as a `contextmenu` with no coordinates, and belongs at the logo.
 * @param {MenuEvent} event
 */
function pointOf(event) {
  const x = event.clientX ?? 0;
  const y = event.clientY ?? 0;
  return x === 0 && y === 0 ? null : { x, y };
}

/** @param {MenuEvent} event */
function onKeyDown(event) {
  const node = nodeOf(event.target);
  if (node === null) return;
  const menu = node.closest(MENU_SELECTOR);
  if (menu !== null) {
    onMenuKey(event, menu, node);
    return;
  }
  if (node.closest(RENAME_FORM_SELECTOR) !== null) {
    onEditorKey(event);
    return;
  }
  const logo = node.closest(LOGO_SELECTOR);
  if (logo === null || !asksForTheMenu(event)) return;
  event.preventDefault();
  const slot = logo.closest(SLOT_SELECTOR);
  if (slot !== null) openLogoMenu(slot);
}

/**
 * Escape is the way out of a form that has taken the label's place. It answers the editor and
 * nothing further up: a live run and its window are not what this is about.
 * @param {MenuEvent} event
 */
function onEditorKey(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeRenameEditor();
}

/** @param {MenuRoot} root */
function wirePointerHold(root) {
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  for (const ending of ["pointerup", "pointercancel", "pointerleave"]) {
    root.addEventListener(ending, cancelHold);
  }
  // Scrolling does not bubble, so it is heard on the way down: a list moving under a finger says
  // the press was not a hold, and a panel placed against the viewport must answer for it too.
  root.addEventListener("scroll", onTheGroundMoving, true);
  if (typeof window !== "undefined") window.addEventListener("resize", onTheGroundMoving);
}

/** @param {MenuEvent} event */
function onPointerDown(event) {
  consumeNextClick = false;
  cancelHold();
  // A mouse has its own way in and holds nothing down to get it, so only the gestures with no
  // button of their own are timed.
  if (event.pointerType === "mouse") return;
  const slot = nodeOf(event.target)?.closest(SLOT_SELECTOR) ?? null;
  if (slot === null || slot === editingSlot) return;
  holdOrigin = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
  holdTimer = setTimeout(() => {
    holdTimer = undefined;
    // Taken before the menu opens, because the release that ends this hold is still to come and
    // the click behind it belongs to a gesture now spent.
    consumeNextClick = true;
    openLogoMenu(slot, holdOrigin);
  }, LONG_PRESS_MS);
}

/**
 * The desk moved under whatever is floating over it. The menu goes away, pointing at nothing;
 * the editor is followed instead, because it is holding typed text.
 */
function onTheGroundMoving() {
  cancelHold();
  closeLogoMenu();
  followTheLabel();
}

/** Put the open editor back over the label it is standing in for, wherever that now is. */
function followTheLabel() {
  const slot = editingSlot;
  if (slot === null) return;
  const at = within(slot, LOGO_LABEL_SELECTOR)?.getBoundingClientRect?.();
  if (at !== undefined) editorAnchor = { x: at.left, y: at.top };
  placeFloating(liftedEditor ?? within(slot, RENAME_FORM_SELECTOR), editorAnchor);
}

/** @param {MenuEvent} event */
function onPointerMove(event) {
  if (holdOrigin === null) return;
  const dx = (event.clientX ?? 0) - holdOrigin.x;
  const dy = (event.clientY ?? 0) - holdOrigin.y;
  if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) cancelHold();
}

/** What a menu item does when it is pressed. @param {MenuEvent} event */
function onActivation(event) {
  const node = nodeOf(event.target);
  if (node === null) return;
  if (node.closest(RENAME_CANCEL_SELECTOR) !== null) {
    event.preventDefault();
    closeRenameEditor();
    return;
  }
  if (node.closest(RENAME_ITEM_SELECTOR) !== null) {
    const slot = slotOf(node);
    if (slot !== null) openRenameEditor(slot);
    return;
  }
  // Any other item is a doorway into the window; Delete's confirmation is the window's (5.9/02).
  // Focus goes back to the logo, since a refusal swaps nothing and leaves the keyboard nowhere.
  if (node.closest(MENU_ITEM_SELECTOR) !== null) closeLogoMenu({ restoreFocus: true });
}

/**
 * The editor's own guard on the name. A name this reading refuses is not a refusal the desk has
 * made, so `stopPropagation` in the capture phase keeps it off the wire and the bar stays quiet.
 * @param {MenuEvent} event
 */
function onRenameSubmit(event) {
  const form = nodeOf(event.target)?.closest(RENAME_FORM_SELECTOR) ?? null;
  if (form === null) return;
  // The slot the editor belongs to, not the one it sits in: an open editor stands in the menu
  // layer, which is nobody's slot.
  const slot = form.closest(SLOT_SELECTOR) ?? editingSlot;
  if (slot === null) return;
  const input = form.querySelector(RENAME_INPUT_SELECTOR);
  const notice = labelNotice(input?.value ?? "");
  if (notice === "") {
    clearRenameNotice(slot);
    renamingCapabilityId = slot.getAttribute("data-capability-id") ?? "";
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  sayInEditor(slot, notice);
  input?.focus();
}

/** @param {MenuRoot} root */
function wireRenameRequest(root) {
  // While the write waits for its place in the coordinator's queue: the action is not lost and
  // must not look it. htmx's `hx-disabled-elt` takes Save out of reach for the same interval.
  root.addEventListener("htmx:beforeRequest", (/** @type {MenuEvent} */ event) => {
    const form = renameFormOf(event);
    if (form === null) return;
    form.setAttribute("aria-busy", "true");
    rememberIdleSaveLabel(form);
    sayOnSave(form, saveButtonOf(form)?.getAttribute(BUSY_LABEL_ATTRIBUTE));
  });
  root.addEventListener("htmx:afterRequest", (/** @type {MenuEvent} */ event) => {
    const form = renameFormOf(event);
    if (form === null) return;
    form.removeAttribute("aria-busy");
    sayOnSave(form, idleSaveLabel(form));
    // A refusal swaps nothing, so no swap arrives to put this marker down: leaving it standing
    // would hand the focus to a logo on the next unrelated swap of that slot.
    if (htmxDetail(event).successful === true) return;
    renamingCapabilityId = "";
    // The bar has answered by now, and the sentence it holds raises the desk's floor. Placed
    // again, so the editor never stands over the answer it is about.
    placeFloating(form, editorAnchor);
  });
  // Two of the three ways a slot changes hands: the rename's own answer, and an evolution's
  // out-of-band replacement. A rename must not cost the keyboard its place.
  for (const landing of ["htmx:afterSwap", "htmx:oobAfterSwap"]) {
    root.addEventListener(landing, onSlotSwapped);
  }
  // The backstop for the third, which announces nothing: a deletion's out-of-band `delete:`
  // removes the slot without htmx swapping, so no swap event is ever dispatched for it.
  root.addEventListener("htmx:afterSettle", reconcile);
}

/**
 * Put back anything this module is holding whose logo has left the document. A panel left in the
 * menu layer floats over a desk with no logo under it, and nothing else ever takes it down.
 */
function reconcile() {
  if (editorHome !== null && editorHome.isConnected === false) {
    editingSlot = null;
    returnEditor();
  }
  if (openSlot !== null && openSlot.isConnected === false) closeLogoMenu({ restoreFocus: false });
}

/**
 * One capability's place on the desk has been re-rendered. Matched by capability, not by node:
 * an `outerHTML` swap replaces the element, so the two are never the same object.
 *
 * @param {MenuEvent} event
 */
function onSlotSwapped(event) {
  // Whatever is no longer standing goes home first: an out-of-band replacement is dispatched on
  // the new element, so the slot that left is not always the one this event can reach.
  reconcile();
  const swapped = nodeOf(event.target ?? htmxDetail(event).target);
  const was = swapped?.closest(SLOT_SELECTOR) ?? null;
  const id = was === null ? "" : (was.getAttribute("data-capability-id") ?? "");
  if (was === null || id === "") return;

  // Whatever was lifted out of that slot goes back into the copy that just left, which is what
  // takes it out of the menu layer and off a desk with no logo it belongs to.
  if (editorHome?.getAttribute("data-capability-id") === id) {
    editingSlot = null;
    returnEditor();
  }
  if (openSlot?.getAttribute("data-capability-id") === id) closeLogoMenu({ restoreFocus: false });

  // And the name just written gets its focus back — the slot that came back, not the one that
  // went away, since focus on a node nothing holds goes to the body.
  if (renamingCapabilityId !== id) return;
  renamingCapabilityId = "";
  logoOf(slotFor(id) ?? was)?.focus();
}

/**
 * One capability's slot as the document currently holds it. Found by reading ids back rather than
 * building a selector from one: the id is a string this module did not author.
 * @param {string} capabilityId
 */
function slotFor(capabilityId) {
  for (const slot of deskRoot?.querySelectorAll?.(SLOT_SELECTOR) ?? []) {
    if (slot.getAttribute("data-capability-id") === capabilityId) return slot;
  }
  return null;
}

/**
 * What Save is called right now. The button also goes out of reach for the interval, but a
 * control that only goes grey has not said what it is doing.
 * @param {MenuNode} form @param {string | null | undefined} said
 */
function sayOnSave(form, said) {
  const save = saveButtonOf(form);
  if (save !== null && typeof said === "string") save.textContent = said;
}

/**
 * What Save is called the rest of the time, kept on the control the first time the busy sentence
 * replaces it rather than restated here — the same reading `public/record-mutations.js` does.
 * @param {MenuNode} form
 */
function idleSaveLabel(form) {
  return saveButtonOf(form)?.getAttribute(IDLE_LABEL_ATTRIBUTE) ?? undefined;
}

/** @param {MenuNode} form */
function rememberIdleSaveLabel(form) {
  const save = saveButtonOf(form);
  if (save === null || save.hasAttribute(IDLE_LABEL_ATTRIBUTE)) return;
  save.setAttribute(IDLE_LABEL_ATTRIBUTE, save.textContent ?? "");
}

/** The rename form's Save control. @param {MenuNode} form */
function saveButtonOf(form) {
  return form.querySelector(RENAME_SAVE_SELECTOR);
}

/** The rename form an htmx event was made by, if it was made by one. @param {MenuEvent} event */
function renameFormOf(event) {
  return nodeOf(htmxDetail(event).elt)?.closest(RENAME_FORM_SELECTOR) ?? null;
}

/** @param {MenuEvent} event @param {MenuNode} menu @param {MenuNode} item */
function onMenuKey(event, menu, item) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    moveMenuFocus(menu, item.closest(MENU_ITEM_SELECTOR), event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    event.stopPropagation();
    const items = menuItems(menu);
    (event.key === "Home" ? items[0] : items[items.length - 1])?.focus();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeLogoMenu();
    return;
  }
  // Tab leaves the menu rather than cycling inside it. Focus goes back to the logo first, so the
  // browser's own move continues from where the menu was opened.
  if (event.key === "Tab") closeLogoMenu();
}

function cancelHold() {
  clearTimeout(holdTimer);
  holdTimer = undefined;
  holdOrigin = null;
}

if (typeof document !== "undefined") {
  startLogoMenu(
    /** @type {never} */ (document),
    /** @type {never} */ (typeof window === "undefined" ? document : window),
  );
}
