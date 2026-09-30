// @ts-check
/**
 * What the voice recorder (`file-recorder.js`) is given of the browser: its media, its clock and
 * timers, the page's question before leaving, and whether a field is still on the page. A page
 * that records for real takes `browserRecorderEnv()`; the design page and the tests hand the
 * recorder a stand-in of the same shape.
 */

/**
 * @typedef {{
 *   mediaDevices?: Pick<MediaDevices, "getUserMedia">,
 *   MediaRecorder?: { new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder,
 *     isTypeSupported: (type: string) => boolean },
 *   AudioContext?: { new (): AudioContext },
 *   agent: string,
 *   touchPoints: number,
 *   now: () => number,
 *   date: () => Date,
 *   repeat: (run: () => void, ms: number) => () => void,
 *   guardLeave: (holder: object, on: boolean) => void,
 *   watchShown: (el: Element, hidden: () => void) => () => void,
 * }} RecorderEnv
 */

/** @param {Event} event */
function onLeave(event) {
  event.preventDefault();
  Reflect.set(event, "returnValue", "");
}

/** Every recorder holding audio on this page: the page asks before leaving while one does. */
const LEAVE_HOLDERS = new Set();

/**
 * @param {object} holder
 * @param {boolean} on
 */
function guardLeave(holder, on) {
  const had = LEAVE_HOLDERS.size > 0;
  if (on) LEAVE_HOLDERS.add(holder);
  else LEAVE_HOLDERS.delete(holder);
  if (!had && LEAVE_HOLDERS.size > 0) addEventListener("beforeunload", onLeave);
  if (had && LEAVE_HOLDERS.size === 0) removeEventListener("beforeunload", onLeave);
}

/**
 * Whether `el` is off the page's layout: hidden itself or inside something hidden. A browser
 * without `checkVisibility` is asked whether it lays out any box at all.
 *
 * @param {Element} el
 */
const outOfSight = (el) =>
  typeof el.checkVisibility === "function"
    ? !el.checkVisibility()
    : el.getClientRects().length === 0;

/**
 * Watch `el` for being hidden: a box that stops intersecting or shrinks to nothing is asked
 * whether it is still laid out, so scrolling it away is not hiding it.
 *
 * @param {Element} el
 * @param {() => void} hidden
 */
function watchShown(el, hidden) {
  const check = () => {
    if (outOfSight(el)) hidden();
  };
  /** @type {Array<IntersectionObserver | ResizeObserver>} */
  const watches = [];
  if (typeof IntersectionObserver === "function") watches.push(new IntersectionObserver(check));
  if (typeof ResizeObserver === "function") watches.push(new ResizeObserver(check));
  for (const watch of watches) watch.observe(el);
  return () => {
    for (const watch of watches) watch.disconnect();
  };
}

/**
 * The browser's own media, timers and page, for a page that records for real.
 *
 * @returns {RecorderEnv}
 */
export function browserRecorderEnv() {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    mediaDevices: nav?.mediaDevices,
    MediaRecorder: typeof MediaRecorder === "function" ? MediaRecorder : undefined,
    AudioContext: typeof AudioContext === "function" ? AudioContext : undefined,
    agent: nav?.userAgent ?? "",
    touchPoints: nav?.maxTouchPoints ?? 0,
    now: () => performance.now(),
    date: () => new Date(),
    repeat: (run, ms) => {
      const timer = setInterval(run, ms);
      return () => clearInterval(timer);
    },
    guardLeave,
    watchShown,
  };
}

/**
 * Whether this browser can record here: a page outside a secure context has no `mediaDevices`.
 *
 * @param {RecorderEnv} env
 */
export const canRecord = (env) =>
  typeof env.mediaDevices?.getUserMedia === "function" && typeof env.MediaRecorder === "function";
