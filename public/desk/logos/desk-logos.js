// @ts-check

/**
 * The client's half of the tile an admitted build stands on the desk: press it for the story,
 * take it down when the stream ends (`renderProvisionalLogo`, `src/server/http/fragments/fragments.ts`).
 */

import { BUILD_JOB_ID_ATTRIBUTE } from "../../core/shell-dom.js";

/**
 * The attribute a provisional tile is keyed by. A reload may forget the tile: it is
 * presentation only, and registry rehydration says what stands on the desk.
 */
export const PROVISIONAL_LOGO_ATTRIBUTE = "data-provisional-logo";

/**
 * The region the in-flight narration streams into. It lives inside the window, so a build
 * opens the window at submit; pinned against `desk-window.js`'s own name for it.
 */
export const BUILD_NARRATION_REGION_ID = "spec-build-output";

/** One build's subscriber, the node every lifecycle event for that build comes from. */
const BUILD_SUBSCRIBER_SELECTOR = `[${BUILD_JOB_ID_ATTRIBUTE}]`;

/**
 * The DOM facts this module needs and no more. Structural on purpose, so a test double
 * satisfies it as well as a `Document` and the rule runs in Bun without a browser.
 *
 * @typedef {{ target?: unknown, detail?: { type?: string } }} LogoEvent
 * @typedef {{ getAttribute(name: string): string | null, remove(): void }} RemovableNode
 * @typedef {{
 *   scrollIntoView?: (options?: { block: "nearest" }) => void,
 *   focus?: () => void,
 *   hasAttribute?: (name: string) => boolean,
 *   setAttribute?: (name: string, value: string) => void,
 * }} RevealableNode
 * @typedef {{
 *   querySelectorAll(selector: string): Iterable<RemovableNode & RevealableNode>,
 *   getElementById?: (id: string) => RevealableNode | null,
 *   addEventListener?: (type: string, listener: (event: LogoEvent) => void) => void,
 * }} LogoRoot
 */

/**
 * Take one build's tile off the ground. Idempotent, and silent about a build that never stood
 * one up: an evolution, a deflection and anything refused before admission remove nothing.
 * @param {LogoRoot} root
 * @param {string | undefined | null} buildId
 * @returns {boolean} whether a tile was actually taken down
 */
export function removeProvisionalLogo(root, buildId) {
  if (!buildId) return false;
  // Matched by attribute value, not by a selector built from the id: the id is a string this
  // module did not author, and reading the attribute back needs no escaping to be safe.
  const tile = [...root.querySelectorAll(`[${PROVISIONAL_LOGO_ATTRIBUTE}]`)].find(
    (node) => node.getAttribute(PROVISIONAL_LOGO_ATTRIBUTE) === buildId,
  );
  if (tile === undefined) return false;
  tile.remove();
  return true;
}

/**
 * Bring the in-flight story back into view. A window put away mid-build ends the build
 * (`leaving-a-run.js`) and takes this tile with it, so no tile points at a story that is gone.
 * @param {LogoRoot} root
 * @param {string} buildId
 */
export function revealBuildNarration(root, buildId) {
  const subscriber = [...root.querySelectorAll(BUILD_SUBSCRIBER_SELECTOR)].find(
    (node) => node.getAttribute(BUILD_JOB_ID_ATTRIBUTE) === buildId,
  );
  const target = subscriber ?? root.getElementById?.(BUILD_NARRATION_REGION_ID) ?? null;
  if (target === null) return;
  target.scrollIntoView?.({ block: "nearest" });
  // The region is not a control, so it carries no tab stop of its own. Give it one for the
  // duration, so the press lands somewhere a screen reader follows rather than nowhere.
  if (target.hasAttribute?.("tabindex") === false) target.setAttribute?.("tabindex", "-1");
  target.focus?.();
}

/**
 * The build a lifecycle event belongs to. `closest` answers on a detached node too, which the
 * terminal presentation needs: it may have replaced the subscriber's contents already.
 * @param {unknown} eventTarget
 * @returns {string | undefined}
 */
export function buildIdFromEvent(eventTarget) {
  const node =
    /** @type {{ closest?: (selector: string) => { getAttribute(name: string): string | null } | null }} */ (
      eventTarget
    );
  if (typeof node?.closest !== "function") return undefined;
  return node.closest(BUILD_SUBSCRIBER_SELECTOR)?.getAttribute(BUILD_JOB_ID_ATTRIBUTE) ?? undefined;
}

/**
 * Wire the tile's two obligations onto a document.
 * @param {LogoRoot} root
 */
export function startDeskLogos(root) {
  root.addEventListener?.(
    "click",
    /** @param {LogoEvent} event */ (event) => {
      const node =
        /** @type {{ closest?: (selector: string) => { getAttribute(name: string): string | null } | null }} */ (
          event.target
        );
      if (typeof node?.closest !== "function") return;
      const buildId = node
        .closest(`[${PROVISIONAL_LOGO_ATTRIBUTE}]`)
        ?.getAttribute(PROVISIONAL_LOGO_ATTRIBUTE);
      if (buildId) revealBuildNarration(root, buildId);
    },
  );

  // `htmx:sseClose` covers every real ending: `message` when the server finishes the stream,
  // `nodeReplaced`/`nodeMissing` when the subscriber leaves — commonly another logo pressed.
  root.addEventListener?.(
    // `htmx:sseError` is absent: the extension reconnects after it and a native EventSource
    // fires `error` on every drop, so a blip would orphan a tile that only activation restores.
    "htmx:sseClose",
    /** @param {LogoEvent} event */ (event) => {
      removeProvisionalLogo(root, buildIdFromEvent(event.target));
    },
  );
}

/** The layer the logos stand on; pinned against the server's own name for it. */
export const DESK_LOGO_LAYER_ID = "capability-logos";

/** One line of a wheel that counts in lines, as Firefox's does for a mouse. */
const WHEEL_LINE_PX = 16;

/**
 * @typedef {{ target?: unknown, deltaX: number, deltaY: number, deltaMode: number,
 *   ctrlKey?: boolean, preventDefault(): void }} LayerWheel
 * @typedef {{ target?: unknown, offsetX: number, offsetY: number, preventDefault(): void }} LayerPress
 * @typedef {{ scrollIntoView?: (options: ScrollIntoViewOptions) => void,
 *   matches?: (selector: string) => boolean }} Revealable
 * @typedef {{
 *   scrollLeft: number, scrollWidth: number, clientWidth: number,
 *   scrollHeight: number, clientHeight: number, blur?: () => void,
 *   addEventListener(type: string, listener: (event: any) => void, options?: object): void,
 * }} LogoLayer
 * @typedef {new (callback: (records: { addedNodes: Iterable<unknown> }[]) => void) => {
 *   observe(target: unknown, options: { childList: boolean }): void }} ObserverClass
 */

/** @param {unknown} node */
function reveal(node) {
  /** @type {Revealable} */ (node)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/** The last element among what a swap added: whitespace comes in beside it as text. */
function lastRevealable(/** @type {Iterable<unknown>} */ nodes) {
  return [...nodes]
    .filter((node) => typeof (/** @type {Revealable} */ (node)?.scrollIntoView) === "function")
    .at(-1);
}

/**
 * The layer scrolls when the desk holds more logos than room (desk.css), so what the person is
 * working with is kept inside it: a logo the keyboard reaches, and a tile a build or evolution has
 * just stood on the ground. A plain wheel turns it sideways, the only way it runs on a desktop.
 * @param {LogoLayer | null} layer
 * @param {ObserverClass | undefined} Observer
 */
export function startLogoLayerScroll(layer, Observer) {
  if (layer === null) return;
  layer.addEventListener("focusin", (/** @type {LogoEvent} */ event) => {
    // A press on the ground or the bar is not a claim on the keyboard: the shell reads focus on
    // `body` as nobody's. And only the keyboard is revealed to, since a reveal under a pointer
    // moves the logo out from under the click it is in the middle of.
    if (event.target === layer) layer.blur?.();
    else if (/** @type {Revealable} */ (event.target)?.matches?.(":focus-visible")) {
      reveal(event.target);
    }
  });
  // A press on the bar itself is not a press on the desk: it leaves the keyboard where it was.
  layer.addEventListener("mousedown", (/** @type {LayerPress} */ event) => {
    const onBar = event.offsetX >= layer.clientWidth || event.offsetY >= layer.clientHeight;
    if (event.target === layer && onBar) event.preventDefault();
  });
  if (Observer !== undefined) {
    new Observer((records) =>
      reveal(lastRevealable(records.flatMap((r) => [...r.addedNodes]))),
    ).observe(layer, { childList: true });
  }
  layer.addEventListener(
    "wheel",
    (/** @type {LayerWheel} */ event) => {
      const sideways =
        layer.scrollWidth > layer.clientWidth && layer.scrollHeight <= layer.clientHeight;
      if (!sideways || event.ctrlKey || event.deltaX !== 0 || event.deltaY === 0) return;
      event.preventDefault();
      const unit = [1, WHEEL_LINE_PX, layer.clientWidth][event.deltaMode] ?? 1;
      layer.scrollLeft += event.deltaY * unit;
    },
    { passive: false },
  );
}

if (typeof document !== "undefined") {
  startDeskLogos(document);
  startLogoLayerScroll(
    /** @type {LogoLayer | null} */ (document.getElementById(DESK_LOGO_LAYER_ID)),
    globalThis.MutationObserver,
  );
}
