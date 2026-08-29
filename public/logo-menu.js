// @ts-check

/**
 * The short menu that opens on a capability's logo, and the one inline rename form it
 * opens.
 *
 * Three ways in, one component (PLAN decision 19): right-click for a mouse,
 * press-and-hold for touch, and the menu key or Shift+F10 for the keyboard — which the
 * logo already accepts because it is a real `<button>`. The markup for both the menu and
 * the editor ships with the logo and hidden (`renderCapabilityLogo`, `src/web/fragments.ts`),
 * the way the record view ships its delete confirmation: nothing here builds HTML, so
 * nothing here has to get escaping right, and no round trip stands between a right-click
 * and the menu.
 *
 * The doorway is on the logo and not on the window chrome, which is the whole reason no
 * lamp goes signal red and D3 stands. Delete's confirmation is the window's (5.9/02);
 * this module only opens the doorway to it.
 *
 * Rename changes the name written under the tile and nothing else — not the id, not the
 * address, not the artwork, which L7 forbids redrawing. The write itself is the server's
 * (`src/capability-rename/`); what happens here is the form, its own guard on the name,
 * and putting focus back where it came from.
 */

/** The slot one capability occupies on the desk: the logo, its menu and its editor. */
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
 * Where an open menu stands while it is open.
 *
 * The menu ships inside its logo's slot, which is the only place that keeps the two
 * together through every swap addressed at that capability. But the logo layer sits under
 * the window layer — correct for logos, wrong for a menu, which is the frontmost thing on
 * the desk for as long as it is open. So the menu is lifted into this layer on the way up
 * and put back on its logo on the way down, and it is never in both places at once.
 */
const MENU_LAYER_ID = "capability-menus";

/**
 * How long a press has to be held before it is a press-and-hold. The interval every
 * platform's own long-press uses; shorter and an ordinary tap opens the menu, longer and
 * the gesture feels broken.
 */
export const LONG_PRESS_MS = 500;

/**
 * How far a finger may wander and still be holding still. A press is never perfectly
 * still on a touch screen, and anything past this is the start of a scroll or a drag —
 * both of which cancel the hold rather than opening a menu over what is moving.
 */
export const LONG_PRESS_SLOP_PX = 10;

/** How close to the edge of the screen a menu may be placed before it is pulled back. */
const MENU_VIEWPORT_MARGIN_PX = 8;

/**
 * The prompt bar's form. The floor a floating panel stops at is its top edge, not the
 * bottom of the window: the strip the bar floats in is a floor for everything on this
 * desk (design D5), and the bar is also where a refusal about the very name being typed is
 * spoken — a panel standing over that sentence would cover the answer to itself.
 *
 * Restated from `public/desk-window.js` (PROMPT_FORM_ID) rather than imported, the way
 * this shell restates every constant that crosses a module boundary here; a platform test
 * pins the two copies against each other.
 */
const PROMPT_FORM_ID = "spec-build-form";

/**
 * The slot the bar speaks in. It stands *above* the rail rather than inside it, and it is
 * as tall as the sentence it is holding — so the floor moves up when the desk has
 * something to say, which is exactly when this matters.
 *
 * Restated from `public/prompt-bar.js` (PROMPT_NOTICE_ID); a platform test pins the two.
 */
const PROMPT_NOTICE_ID = "prompt-notice";

/**
 * What the editor says about a name it will not send.
 *
 * Restated from `isCapabilityNameLabel` (`src/registry/labels.ts`) rather than shared,
 * the way this shell restates every constant it cannot import; a platform test runs both
 * readings over the same corpus and pins that they agree. The server keeps its own guard
 * for every submission that does not come from this form.
 */
const MAX_LABEL_CHARS = 48;
const MAX_LABEL_WORDS = 5;
const SENTENCE_PUNCTUATION = /[.!?]/;
const PRODUCT_VOICE_START = /^(?:got it|i.?ll|i will|i.?m|we.?ll|we will|let.?s)\b/i;

/** What the editor says when the name will not do. One sentence, and it stays in the
 * editor: a client-side reading is not a refusal the desk has made. */
const BLANK_LABEL_NOTICE = "Give it a name and I’ll put it under the tile.";
const UNUSABLE_LABEL_NOTICE = "Something short, in a few words — no full sentences.";

/**
 * Whether a typed name is one the registry will take. The same reading the server does,
 * which is what makes the two answers identical.
 * @param {string} value
 */
export function isUsableCapabilityName(value) {
  const label = value.trim();
  if (label.length === 0 || label.length > MAX_LABEL_CHARS) return false;
  if (SENTENCE_PUNCTUATION.test(label)) return false;
  if (PRODUCT_VOICE_START.test(label)) return false;
  return label.split(/\s+/).length <= MAX_LABEL_WORDS;
}

/**
 * What the editor says about this name, or the empty string when it has nothing to say.
 * @param {string} value
 */
export function labelNotice(value) {
  if (value.trim().length === 0) return BLANK_LABEL_NOTICE;
  return isUsableCapabilityName(value) ? "" : UNUSABLE_LABEL_NOTICE;
}

/**
 * As much of the document as these rules reach for. Structural on purpose, the way the
 * desk's other modules take theirs: a real `Document` satisfies it and so does a double,
 * which is what lets the rules run in Bun without a browser.
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
 * The capability one node belongs to. A press inside the open menu is answered by the
 * slot the menu was opened on rather than by walking up from it: while it is open the
 * menu stands in the menu layer, which is nobody's slot.
 * @param {MenuNode} node
 */
function slotOf(node) {
  const enclosing = node.closest(SLOT_SELECTOR);
  if (enclosing !== null) return enclosing;
  return node.closest(MENU_SELECTOR) === null ? null : openSlot;
}

/**
 * The desk's one open menu, and the gesture that opened it.
 *
 * Module state rather than per-slot state: there is one pointer and one keyboard, so
 * there is one menu, and a second one opening is the first one closing.
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
 * The slot that editor was lifted out of, and the only slot it may ever be put back into.
 *
 * Held rather than passed in. A lifted editor belongs to one capability, and a swap
 * landing on the desk while it is up is not always that capability's — sending it home by
 * whichever slot happened to be swapped is how one logo's editor ends up inside another
 * logo's, which is to say gone.
 */
/** @type {MenuNode | null} */
let editorHome = null;
/**
 * Where the label the editor is standing in for was. Kept, because the editor is placed
 * more than once: a sentence appearing under the field makes the panel taller, and a
 * panel clamped to the screen when it was shorter now hangs past the bottom of it.
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
 * Whether the click a consumed gesture is about to produce belongs to this module.
 *
 * A press-and-hold ends in a `pointerup`, and the browser follows it with a click on the
 * button that was held — which is the logo's ordinary open. Opening the menu must never
 * also open the capability, so exactly one click is taken. It is cleared by the next
 * `pointerdown` as well: a platform that suppressed the click itself would otherwise
 * leave this armed against the person's next, entirely unrelated, tap.
 */
let consumeNextClick = false;
/** The capability whose rename is in flight, so the logo that comes back can be given
 * the focus the swap took. */
let renamingCapabilityId = "";

/**
 * Put down everything this module is holding.
 *
 * Called when it is started against a document, which in the browser happens once. It is
 * the rules being run against a *second* document that this is for: state left over from
 * the first — a consumed click still armed, a slot still marked open — would answer the
 * second one's first question with the first one's leftovers.
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
 * Open one logo's menu, and close whatever was open. Idempotent: a platform that fires
 * its own `contextmenu` for a long press reaches this beside the hold's own timer, and
 * the second arrival must not re-enter the menu or move focus a second time.
 * @param {MenuNode} slot
 * @param {{ x: number, y: number } | null} [at] where the pointer was, when there was one
 */
export function openLogoMenu(slot, at = null) {
  if (openSlot === slot) return;
  closeLogoMenu({ restoreFocus: false });
  closeRenameEditor({ restoreFocus: false });
  const menu = menuOf(slot);
  if (menu === null) return;
  // Shown first and moved second. A drawn element measured while it is hidden has no box,
  // so relocating before unhiding asks the ink system to redraw nothing.
  menu.removeAttribute("hidden");
  logoOf(slot)?.setAttribute("aria-expanded", "true");
  if (menuLayer !== null) menuLayer.append?.(menu);
  liftedMenu = menuLayer === null ? null : menu;
  openSlot = slot;
  placeFloating(menu, at ?? cornerOf(logoOf(slot)));
  firstMenuItem(menu)?.focus();
}

/**
 * Put a floating piece of the desk where it was asked for: the menu at the tip of the
 * pointer, running down and to the right of it the way a context menu does everywhere
 * else, and the rename editor at the label it is standing in for.
 *
 * Clamped to the viewport, so a logo in the bottom-right corner of the desk opens its menu
 * *above and to the left* of the cursor rather than half off the screen. Measured after
 * the menu is shown, because a hidden box has no size to clamp against.
 *
 * Silent where there is nothing to measure. The rules above run against a document double
 * in Bun, and placement is the one thing a double cannot answer.
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
 * Where a menu opened without a pointer starts: the logo's own bottom-left corner, which
 * is where the person's attention already is. The keyboard has no cursor to open from.
 * @param {MenuNode | null} logo
 */
function cornerOf(logo) {
  const box = logo?.getBoundingClientRect?.();
  return box === undefined ? null : { x: box.left, y: box.bottom };
}

/**
 * Put the menu away. Focus goes back to the logo it opened on, which is where it was
 * before and the only place that is still there afterwards.
 * @param {{ restoreFocus?: boolean }} [options]
 */
export function closeLogoMenu(options = {}) {
  const slot = openSlot;
  if (slot === null) return;
  openSlot = null;
  const menu = liftedMenu ?? menuOf(slot);
  // Asked before the menu is hidden, because after it the answer is always no. Focus goes
  // back to the logo when the menu still had it — a row that is about to be hidden is not
  // somewhere the keyboard may be left, and neither is nowhere. It does not go back when
  // something else has already taken it: a press that lands on another control moves focus
  // before this runs, and taking it away again would be this menu closing over the
  // person's next action.
  const held = options.restoreFocus ?? holdsTheFocus(menu, MENU_SELECTOR);
  menu?.setAttribute("hidden", "");
  logoOf(slot)?.setAttribute("aria-expanded", "false");
  // Home again, so the slot is once more the whole of what this capability occupies and a
  // swap addressed at it takes the menu with it.
  if (menu !== null && menu !== undefined) slot.append?.(menu);
  liftedMenu = null;
  if (held) logoOf(slot)?.focus();
}

/**
 * Whether the keyboard is inside this node, or nowhere in particular. Both are cases where
 * putting focus back on the logo is giving it somewhere to be rather than taking it.
 * @param {MenuNode | null | undefined} node @param {string} selector
 */
function holdsTheFocus(node, selector) {
  const active = deskRoot?.activeElement;
  // A root that cannot answer is answered generously: the panel had the focus when it
  // opened, so giving it back is the safe reading.
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
 * Move along the menu, wrapping at both ends. A menu of two items is a menu you can
 * still walk, and wrapping is what every platform's own does.
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
 * Turn one logo's label into the rename form.
 *
 * The form is a sibling of the button rather than a child of it, because a `<button>` may
 * not contain interactive content — so the label is hidden and the form takes the space
 * it was using. Nothing about the capability's place on the desk moves, no modal opens,
 * and the window keeps whatever it was holding.
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
  // The tile is still on the desk but is not a way into the capability while its own
  // name is being typed, and it is not a tab stop standing between the field and Save.
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
 * Put the editor away and give the label back. Every exit comes through here — Cancel,
 * Escape, and a name that has just been written — so there is one place that knows how
 * to leave the logo the way it was found.
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
 * Hide the editor and put it back on the logo it was opened from, wherever it currently
 * stands. It goes home even when home has just been swapped out from under it: appending
 * it to the slot that left takes it out of the menu layer, which is the one place it may
 * not be left behind.
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

/** Whether this keystroke is a request for the menu. Two spellings, because two
 * platforms: the dedicated menu key, and Shift+F10 where there is none.
 * @param {MenuEvent} event */
function asksForTheMenu(event) {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey === true);
}

/**
 * Wire every way in onto a document.
 *
 * `gestureRoot` is where the one consumed click is taken, and it is `window` in a browser
 * rather than the document. Capture runs outermost-first, so a listener there is the only
 * one guaranteed to see a click before the desk's own document-level opener does
 * (`answerPress`, `public/desk-window.js`) — which is what makes the suppression
 * independent of the order these modules happen to load in.
 *
 * @param {MenuRoot} root
 * @param {MenuRoot} [gestureRoot]
 */
export function startLogoMenu(root, gestureRoot = root) {
  resetLogoMenu();
  deskRoot = root;
  menuLayer = root.getElementById?.(MENU_LAYER_ID) ?? null;
  gestureRoot.addEventListener("click", onGestureClick, true);
  // Outside the document, in the capture phase, for the reason the click above is: two
  // other rules answer Escape on the document itself and neither reads what has focus —
  // a standing record confirmation (`public/record-mutations.js`) and the question a
  // navigation asks before it ends a run (`public/leaving-a-run.js`). An Escape that
  // closes this menu must not also dismiss one of those behind it, and `stopPropagation`
  // does not stop a listener on the *same* node, so answering it here — before the
  // document sees it at all — is the only placement that holds whatever order these
  // modules happen to load in.
  gestureRoot.addEventListener("keydown", onKeyDown, true);
  wirePointerHold(root);
  root.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("click", onActivation);
  root.addEventListener("submit", onRenameSubmit, true);
  wireRenameRequest(root);
}

/**
 * The one click a consumed gesture is allowed to eat, and the press that dismisses a
 * menu. Everything else on the desk goes past untouched.
 * @param {MenuEvent} event
 */
function onGestureClick(event) {
  // `detail` counts the presses behind a click, and a keyboard activation reports none.
  // A platform that suppressed the post-hold click itself would otherwise leave this
  // armed against the very next Enter on the menu it just opened, so the first press of
  // Rename would do nothing at all.
  if (consumeNextClick && pressesBehind(event) > 0) {
    consumeNextClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const node = nodeOf(event.target);
  if (node === null) return;
  // A press that goes somewhere answers the editor on its way: a logo, or an item on
  // another logo's menu. An editor left standing through one of those is a form about a
  // capability the person has walked away from. A press on the ground or in the prompt bar
  // is not going anywhere, and takes nobody's half-typed name with it.
  const navigating =
    node.closest(LOGO_SELECTOR) !== null || node.closest(MENU_ITEM_SELECTOR) !== null;
  if (navigating && editingSlot !== null && node.closest(RENAME_FORM_SELECTOR) === null) {
    closeRenameEditor();
  }
  if (openSlot === null) return;
  if (node.closest(MENU_SELECTOR) !== null) return;
  // A press that dismisses the menu does only that. Landing on the logo the menu belongs
  // to would otherwise both put the menu away and open the capability, which is one press
  // doing two things the person asked for once.
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
    // A right-click anywhere else is a dismissal like any other. It produces no `click`,
    // so the rule that closes the menu on a press away never hears about this one.
    if (node?.closest(MENU_SELECTOR) === null) closeLogoMenu();
    return;
  }
  event.preventDefault();
  // The same logo again is the menu asked for again, at wherever the pointer is now — and
  // moved rather than closed and reopened. A platform that turns a long press into one of
  // these itself fires it alongside this module's own timer, and a menu that tore itself
  // down and rebuilt on the second arrival flickered on every touch open.
  if (slot === openSlot) placeFloating(liftedMenu ?? menuOf(slot), pointOf(event));
  else openLogoMenu(slot, pointOf(event));
}

/**
 * Where a pointer event happened, or nothing when it did not happen at a point. A menu
 * key pressed on Windows arrives as a `contextmenu` with no coordinates of its own, and
 * that one belongs at the logo rather than at the top-left corner of the screen.
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
 * Escape is the way out of a form that has taken the label's place. It answers the editor
 * and nothing further up: a live run and the window it is in are not what this is about.
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
  // Scrolling does not bubble, so it is heard on the way down. A list moving under a
  // finger is the clearest statement there is that the press was not a hold — and a panel
  // placed against the viewport has to answer for the ground moving under it too.
  root.addEventListener("scroll", onTheGroundMoving, true);
  if (typeof window !== "undefined") window.addEventListener("resize", onTheGroundMoving);
}

/** @param {MenuEvent} event */
function onPointerDown(event) {
  consumeNextClick = false;
  cancelHold();
  // A mouse has its own way in and does not hold anything down to get it. Only the
  // gestures that have no button of their own are timed.
  if (event.pointerType === "mouse") return;
  const slot = nodeOf(event.target)?.closest(SLOT_SELECTOR) ?? null;
  if (slot === null || slot === editingSlot) return;
  holdOrigin = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
  holdTimer = setTimeout(() => {
    holdTimer = undefined;
    // Taken before the menu opens, because the release that ends this hold is still to
    // come and the click behind it belongs to a gesture that has now been spent.
    consumeNextClick = true;
    openLogoMenu(slot, holdOrigin);
  }, LONG_PRESS_MS);
}

/**
 * The desk moved under whatever is floating over it.
 *
 * The menu goes away, which is what every menu does when the thing it opened on walks off
 * — it is a choice about one logo, and a menu pointing at a logo that has scrolled away
 * is pointing at nothing. The editor is followed instead: it is holding typed text, and
 * taking that away because the page moved would be the worst of both.
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
  // Any other item is a doorway into the window — Delete's confirmation is the window's
  // (5.9/02). Focus goes back to the logo, because the row it is standing on is about to
  // be hidden and the window's own answer arrives later and only if it arrives at all: a
  // refusal swaps nothing, and the keyboard would be left on the body with nothing to
  // carry on from.
  if (node.closest(MENU_ITEM_SELECTOR) !== null) closeLogoMenu({ restoreFocus: true });
}

/**
 * The editor's own guard on the name, before anything reaches the wire. A name this
 * reading refuses is not a refusal the desk has made, so it is said in the editor and the
 * prompt bar stays quiet. `stopPropagation` in the capture phase is what keeps it off the
 * wire: htmx listens on the form itself, and an event stopped at the document never
 * reaches it — the same way a blank prompt is refused (`public/prompt-bar.js`).
 * @param {MenuEvent} event
 */
function onRenameSubmit(event) {
  const form = nodeOf(event.target)?.closest(RENAME_FORM_SELECTOR) ?? null;
  if (form === null) return;
  // The slot the editor belongs to, not the one it sits in: an open editor stands in the
  // menu layer, which is nobody's slot.
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
  // While the write waits for its place in the coordinator's queue. The action is not
  // lost and must not look it; htmx's own `hx-disabled-elt` takes Save out of reach for
  // the same interval.
  root.addEventListener("htmx:beforeRequest", (/** @type {MenuEvent} */ event) => {
    const form = renameFormOf(event);
    if (form === null) return;
    form.setAttribute("aria-busy", "true");
    sayOnSave(form, form.querySelector(RENAME_SAVE_SELECTOR)?.getAttribute("data-busy-label"));
  });
  root.addEventListener("htmx:afterRequest", (/** @type {MenuEvent} */ event) => {
    const form = renameFormOf(event);
    if (form === null) return;
    form.removeAttribute("aria-busy");
    sayOnSave(form, SAVE_LABEL);
    // A refusal swaps nothing, so no swap arrives to put this marker down. Leaving it
    // standing would hand the focus to a logo on the next unrelated swap of that slot.
    if (htmxDetail(event).successful === true) return;
    renamingCapabilityId = "";
    // The bar has answered by now, and the sentence it is holding raises the desk's floor.
    // Placed again so the editor never stands over the answer it is about.
    placeFloating(form, editorAnchor);
  });
  // The name was written and the slot came back re-rendered, which takes the focus with
  // it. A rename is a small thing to have done and must not cost the keyboard its place.
  //
  // Three events rather than one, because a slot changes hands three ways. `afterSwap` is
  // the rename's own answer and the tile's. `oobAfterSwap` is an evolution's replacement,
  // which arrives out of band inside a response addressed at the window. And `afterSettle`
  // is the backstop for the one that announces nothing at all: a deletion's out-of-band
  // `delete:` removes the slot without htmx swapping anything, so no swap event is ever
  // dispatched for it.
  for (const landing of ["htmx:afterSwap", "htmx:oobAfterSwap"]) {
    root.addEventListener(landing, onSlotSwapped);
  }
  root.addEventListener("htmx:afterSettle", reconcile);
}

/**
 * Put back anything this module is holding whose logo has left the document.
 *
 * The menu and the editor are lifted into the menu layer while they are open, and the slot
 * they belong to can be taken out from under them by work they had nothing to do with — an
 * evolution replacing it, a deletion removing it. A panel left in that layer is a form
 * floating over a desk with no logo under it, and nothing else ever takes it down.
 */
function reconcile() {
  if (editorHome !== null && editorHome.isConnected === false) {
    editingSlot = null;
    returnEditor();
  }
  if (openSlot !== null && openSlot.isConnected === false) closeLogoMenu({ restoreFocus: false });
}

/**
 * One capability's place on the desk has been re-rendered. Two things follow, and they are
 * matched by capability rather than by node: an `outerHTML` swap replaces the element, so
 * the node this event names and the node this module was holding are never the same object.
 *
 * @param {MenuEvent} event
 */
function onSlotSwapped(event) {
  // Whatever is no longer standing goes home first, whichever slot this event named: an
  // out-of-band replacement is dispatched on the new element inside a response addressed
  // at the window, so the slot that left is not always the one this event can reach.
  reconcile();
  const swapped = nodeOf(event.target ?? htmxDetail(event).target);
  const was = swapped?.closest(SLOT_SELECTOR) ?? null;
  const id = was === null ? "" : (was.getAttribute("data-capability-id") ?? "");
  if (was === null || id === "") return;

  // Whatever was lifted out of that slot goes back into the copy of it that just left,
  // which is what takes it out of the menu layer. Without this a rename editor standing
  // open when its own tile's artwork lands is left floating over a desk that no longer has
  // a logo it belongs to.
  if (editorHome?.getAttribute("data-capability-id") === id) {
    editingSlot = null;
    returnEditor();
  }
  if (openSlot?.getAttribute("data-capability-id") === id) closeLogoMenu({ restoreFocus: false });

  // And the name that was just written gets its focus back. The slot that came back, not
  // the one that went away: focus on a node nothing holds goes to the body, which is the
  // keyboard losing its place over a rename that worked.
  if (renamingCapabilityId !== id) return;
  renamingCapabilityId = "";
  logoOf(slotFor(id) ?? was)?.focus();
}

/**
 * One capability's slot as the document currently holds it. Found by reading ids back
 * rather than by building a selector out of one: a capability id is a string this module
 * did not author, and a selector assembled from one has to be escaped correctly to be
 * safe. Reading the attribute back needs no escaping at all.
 * @param {string} capabilityId
 */
function slotFor(capabilityId) {
  for (const slot of deskRoot?.querySelectorAll?.(SLOT_SELECTOR) ?? []) {
    if (slot.getAttribute("data-capability-id") === capabilityId) return slot;
  }
  return null;
}

/**
 * What Save is called right now. The button also goes out of reach for the same interval
 * (htmx's own `hx-disabled-elt`), but a control that only goes grey has not said what it
 * is doing — and this write waits behind whatever is already queued.
 * @param {MenuNode} form @param {string | null | undefined} said
 */
function sayOnSave(form, said) {
  const save = form.querySelector(RENAME_SAVE_SELECTOR);
  if (save !== null && typeof said === "string") save.textContent = said;
}

/** What it is called the rest of the time. Restated from the markup it is rendered in. */
const SAVE_LABEL = "Save";

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
  // Tab leaves the menu rather than cycling inside it. Focus goes back to the logo first
  // so the browser's own move continues from where the menu was opened.
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
