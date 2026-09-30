// @ts-check

/**
 * The record's render view (`design/controls.html`, Files, "Inside the open record"; C18). A held
 * video's or sound's Open takes the window to its full player, `design/scripts/files/file-player.js`,
 * under a way back that names the record. The record is not left: its form is only hidden, so its
 * edits and its uploads are as they were when Back brings it back, and Back lands on the Open
 * pressed.
 */

import { FILE_FIELD_OPEN } from "../../design/scripts/files/file-field.js";
import { esc } from "../../design/scripts/files/file-parts.js";
import { mountPlayer } from "../../design/scripts/files/file-player.js";
import { registerRegionRelease } from "../core/region-scope.js";
import { RECORD_TITLE_ATTRIBUTE } from "../core/shell-dom.js";

/**
 * @typedef {import("../../design/scripts/files/file-parts.js").Held} Held
 * @typedef {{ held: Held, kind: string, field: HTMLElement, entry?: string }} FileOpen
 */

const SURFACE = `[${RECORD_TITLE_ATTRIBUTE}]`;
const VIEW = "data-file-render-view";
/** Set on the surface while its view is open; `public/css/record-view.css` puts the rest away. */
const VIEWING = "data-file-viewing";
const PLAYABLE = new Set(["video", "audio"]);

const BACK_ARROW =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M14 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

/**
 * Where the Open a way back returns the keyboard to sits in its field: the field's own, or a list
 * row's, named by the entry it was opened from.
 *
 * @param {string | undefined} entry
 */
export function openerSelector(entry) {
  if (!entry) return "[data-file-open]";
  return `[data-file-entry="${entry.replace(/["\\]/g, "\\$&")}"] [data-file-list-open]`;
}

/**
 * @typedef {{ pause(): void, removeAttribute(name: string): void, load(): void }} Player
 * @typedef {{ querySelectorAll(selectors: string): Iterable<unknown> }} Scope
 */

/** @param {Scope} scope @returns {Player[]} */
const playersIn = (scope) =>
  /** @type {Player[]} */ (
    [...scope.querySelectorAll("video, audio")].filter(
      (media) => typeof (/** @type {Player} */ (media).pause) === "function",
    )
  );

/**
 * A player taken off the page stops fetching as well as playing, so the file's descriptor on the
 * server is given back too.
 *
 * @param {Scope} view
 */
export function unload(view) {
  for (const media of playersIn(view)) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
}

/**
 * The form's own preview is put out of sight with the form, and out of sight is not silent: it
 * stops when the file opens in full.
 *
 * @param {Scope} surface
 */
export function pausePreviews(surface) {
  for (const media of playersIn(surface)) media.pause();
}

/**
 * @param {string} title
 * @param {Held} held
 */
export function viewMarkup(title, held) {
  const back = esc(title);
  return `<div class="detail__bar"><button class="detail__back" type="button" data-file-view-back aria-label="Back to ${back}"><span class="detail__arrow">${BACK_ARROW}</span><span>${back}</span></button><b class="detail__title">${esc(held.name)}</b></div><div data-file-view></div>`;
}

/**
 * Take the surface `open.field` sits in to the file's player, or do nothing for a file with no
 * player or a field outside a record.
 *
 * @param {FileOpen} open
 * @returns {HTMLElement | null} the view drawn
 */
export function openRenderView(open) {
  const surface = open.field.closest(SURFACE);
  if (!(surface instanceof HTMLElement) || !PLAYABLE.has(open.kind) || !open.held.url) return null;
  if (surface.hasAttribute(VIEWING)) return null;
  pausePreviews(surface);
  surface.setAttribute(VIEWING, "");
  const view = document.createElement("div");
  view.className = "detail";
  view.setAttribute(VIEW, "");
  view.innerHTML = viewMarkup(surface.getAttribute(RECORD_TITLE_ATTRIBUTE) ?? "", open.held);
  surface.append(view);
  const player = view.querySelector("[data-file-view]");
  if (player instanceof HTMLElement) {
    mountPlayer(player, open.held, /** @type {"video" | "audio"} */ (open.kind));
  }
  const release = registerRegionRelease(view, "file render view", () => unload(view));
  view.querySelector("[data-file-view-back]")?.addEventListener("click", () => {
    release();
    unload(view);
    view.remove();
    surface.removeAttribute(VIEWING);
    const opener = open.field.querySelector(openerSelector(open.entry));
    if (opener instanceof HTMLElement) opener.focus({ focusVisible: true });
  });
  const back = view.querySelector("[data-file-view-back]");
  if (back instanceof HTMLElement) back.focus({ focusVisible: true });
  return view;
}

/** @param {Document} root */
export function startRenderViews(root) {
  root.addEventListener(FILE_FIELD_OPEN, (event) => {
    if (event instanceof CustomEvent) openRenderView(event.detail);
  });
}

if (typeof document !== "undefined") startRenderViews(document);
