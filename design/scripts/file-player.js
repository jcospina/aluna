// @ts-check
/**
 * The full player a record's render view gives a video or a sound (decision 29): play and
 * pause, where it has got to, a line to seek along, its length, and the file's own download
 * link under it. The form's control only previews; this is where a file is watched or heard
 * through.
 *
 * The seek line is ruled, as the upload's progress line is, and a native range lies over it
 * unseen, so the keyboard, touch and a screen reader get a real slider. A file the browser
 * won't play, for want of a codec or of the file, shows its download link where the player
 * would be (decision 3). There is no
 * poster and no promise of a first frame (decision 28), so the kind's glyph stands behind the
 * picture.
 */

import {
  cantPlay,
  clock,
  esc,
  G,
  glyph,
  harvestSeeds,
  refusesToPlay,
  seed,
  sizeOf,
} from "./file-parts.js";

/**
 * @typedef {import("./file-parts.js").Held} Held
 * @typedef {"video" | "audio"} Playable
 * @typedef {{ host: HTMLElement, body: HTMLElement, live: HTMLElement, held: Held,
 *             kind: Playable, refused: string | null, seeking: boolean, paused: boolean,
 *             seeds: Map<string, number> }} Player
 */

let players = 0;

/** How far one arrow key moves the line, in seconds; Page Up and Down move a tenth. */
const STEP = 5;

/**
 * The listeners of whatever a host last played. A player that replaces another stops them,
 * so a detached element's late `pause` or `error` never writes into its successor.
 *
 * @type {WeakMap<HTMLElement, AbortController>}
 */
const WIRED = new WeakMap();

/**
 * @param {Player} p
 * @param {string} [why] the id of the sentence the link stands beside
 */
function download(p, why) {
  const name = esc(p.held.name);
  const said = why ? ` aria-describedby="${why}"` : "";
  return `<a class="btn btn--outline btn--sm" href="${esc(p.held.url)}" download="${name}" aria-label="Download ${name}"${said}${seed(p, "download")}>Download</a>`;
}

/**
 * @param {Player} p
 * @param {string} link
 */
const foot = (p, link) =>
  `<div class="file-player__foot"><span class="file__meta">${esc(p.held.name)} · ${sizeOf(p.held.size)}</span>${link}</div>`;

/** @param {Player} p */
function refusedMarkup(p) {
  const video = p.kind === "video";
  const why = `file-player-${++players}-why`;
  return `<div class="file-player__refused${video ? " file-player__refused--screen" : ""}" data-ink style="--ink-hand: ${video ? "frame" : "fine"}"${seed(p, "refused")}>
    <span class="file__glyph">${glyph(video ? 32 : 18, G[p.kind])}</span>
    <span class="file__sub" id="${why}">${esc(p.refused ?? "")}</span>
    ${download(p, why)}
  </div>${foot(p, "")}`;
}

/** @param {Player} p */
function playerMarkup(p) {
  const name = esc(p.held.name);
  const length = clock(p.held.duration ?? 0);
  const src = esc(p.held.url);
  const media =
    p.kind === "video"
      ? `<div class="file-player__screen"><span class="file__backdrop file__glyph">${glyph(32, G.video)}</span><video src="${src}" preload="metadata" playsinline data-file-media data-file-player-media></video></div>`
      : `<audio src="${src}" preload="metadata" data-file-media data-file-player-media></audio>`;
  return `${media}
  <div class="file-player__controls">
    <button class="btn btn--outline file__action" type="button" data-file-player-toggle aria-pressed="false" aria-label="Play ${name}"${seed(p, "toggle")}><span data-file-player-glyph>${glyph(12, G.play, true)}</span></button>
    <span class="file__meta" data-file-player-now>0:00</span>
    <span class="file-player__seek" style="--file-at: 0">
      <span class="file-player__rail"><span class="file-player__played"></span><span class="file-player__thumb" data-ink style="--ink-hand: close"${seed(p, "thumb")}></span></span>
      <input class="file-player__range" type="range" min="0" max="${p.held.duration ?? 0}" step="any" value="0" aria-label="Seek ${name}" aria-valuetext="0:00 of ${length}" data-file-player-seek>
    </span>
    <span class="file__meta" data-file-player-length>${length}</span>
  </div>${foot(p, download(p))}`;
}

/**
 * The file's length as the element knows it, or as the record declared it while the element
 * does not know yet, as a stream still being written doesn't.
 *
 * @param {Player} p
 * @param {HTMLMediaElement} media
 */
const lengthOf = (p, media) =>
  Number.isFinite(media.duration) ? media.duration : (p.held.duration ?? 0);

/**
 * @param {Player} p
 * @param {number} at
 * @param {number} length
 */
function showLine(p, at, length) {
  const range = p.body.querySelector("[data-file-player-seek]");
  if (range instanceof HTMLInputElement) {
    range.max = String(length);
    if (!p.seeking) range.value = String(at);
    range.setAttribute("aria-valuetext", `${clock(at)} of ${clock(length)}`);
  }
  const line = p.body.querySelector(".file-player__seek");
  if (line instanceof HTMLElement)
    line.style.setProperty("--file-at", String(length > 0 ? Math.min(1, at / length) : 0));
}

/**
 * The toggle's glyph changes only when the state does, so its drawn line is not rebuilt on
 * every tick of the clock.
 *
 * @param {Player} p
 * @param {HTMLMediaElement} media
 */
function show(p, media) {
  const length = lengthOf(p, media);
  showLine(p, media.currentTime, length);
  const now = p.body.querySelector("[data-file-player-now]");
  if (now) now.textContent = clock(media.currentTime);
  const total = p.body.querySelector("[data-file-player-length]");
  if (total) total.textContent = clock(length);
  if (p.paused === media.paused) return;
  p.paused = media.paused;
  p.body
    .querySelector("[data-file-player-toggle]")
    ?.setAttribute("aria-pressed", String(!p.paused));
  const mark = p.body.querySelector("[data-file-player-glyph]");
  if (mark) mark.innerHTML = glyph(12, p.paused ? G.play : G.pause, true);
}

/**
 * The line moves by five seconds a key and a tenth a page, from where the file is rather than
 * from where the range last rested. With no length to move along, the key is left alone.
 *
 * @param {number} at
 * @param {number} length
 * @param {string} key
 */
function stepped(at, length, key) {
  if (!(length > 0)) return null;
  /** @type {Record<string, number>} */
  const moves = {
    ArrowLeft: -STEP,
    ArrowDown: -STEP,
    ArrowRight: STEP,
    ArrowUp: STEP,
    PageDown: -length / 10,
    PageUp: length / 10,
    Home: -length,
    End: length,
  };
  const move = moves[key];
  return move === undefined ? null : Math.max(0, Math.min(length, at + move));
}

/**
 * While a pointer holds the line, the clock doesn't pull the range back under it; any way the
 * hold ends lets go, whether or not the value moved.
 *
 * @param {Player} p
 * @param {HTMLMediaElement} media
 * @param {HTMLInputElement} range
 * @param {AbortSignal} signal
 */
function wireSeek(p, media, range, signal) {
  const hold = (/** @type {boolean} */ on) => () => {
    p.seeking = on;
  };
  range.addEventListener("pointerdown", hold(true), { signal });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture", "change", "blur"])
    range.addEventListener(type, hold(false), { signal });
  range.addEventListener(
    "input",
    () => {
      media.currentTime = Number(range.value);
      show(p, media);
    },
    { signal },
  );
  range.addEventListener(
    "keydown",
    (event) => {
      const to = stepped(media.currentTime, lengthOf(p, media), event.key);
      if (to === null) return;
      event.preventDefault();
      media.currentTime = to;
      show(p, media);
    },
    { signal },
  );
}

/**
 * A play the browser gives up because something paused or removed the player is not a
 * failure, and a file the browser won't play says so through the element's own error.
 *
 * @param {Player} p
 * @param {HTMLMediaElement} media
 * @param {AbortSignal} signal
 */
function wireMedia(p, media, signal) {
  const events = ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "ended"];
  for (const type of events) media.addEventListener(type, () => show(p, media), { signal });
  const refuse = (/** @type {string} */ sentence) => {
    p.refused = sentence;
    render(p);
    p.live.textContent = sentence;
  };
  media.addEventListener("error", () => refuse(cantPlay(p.kind)), { signal });
  media.addEventListener(
    "loadedmetadata",
    () => {
      if (refusesToPlay(media)) refuse(cantPlay(p.kind));
    },
    { signal },
  );
  p.body.querySelector("[data-file-player-toggle]")?.addEventListener(
    "click",
    () => {
      if (!media.paused) return media.pause();
      media.play().catch((error) => {
        const quiet = error instanceof DOMException && error.name === "AbortError";
        if (!quiet && !media.error) p.live.textContent = cantPlay(p.kind);
      });
    },
    { signal },
  );
}

/**
 * A player that turns to its download link keeps the keyboard where it was: on the link.
 *
 * @param {Player} p
 */
function render(p) {
  WIRED.get(p.host)?.abort();
  const wired = new AbortController();
  WIRED.set(p.host, wired);
  const active = p.body.contains(document.activeElement);
  harvestSeeds(p);
  p.body.innerHTML = p.refused ? refusedMarkup(p) : playerMarkup(p);
  p.host.classList.toggle("is-refused", p.refused !== null);
  const next = p.body.querySelector(p.refused ? "a" : "[data-file-player-toggle]");
  if (active && next instanceof HTMLElement) next.focus({ focusVisible: true });
  const media = p.body.querySelector("[data-file-player-media]");
  const range = p.body.querySelector("[data-file-player-seek]");
  if (!(media instanceof HTMLMediaElement) || !(range instanceof HTMLInputElement)) return;
  wireMedia(p, media, wired.signal);
  wireSeek(p, media, range, wired.signal);
}

/**
 * The player's body is redrawn whole; what it says to a screen reader lives beside the body,
 * so a sentence survives the redraw that caused it.
 *
 * @param {HTMLElement} host
 */
function partsOf(host) {
  let body = host.querySelector(":scope > [data-file-player-body]");
  let live = host.querySelector(":scope > .file__live");
  if (!(body instanceof HTMLElement) || !(live instanceof HTMLElement)) {
    host.innerHTML =
      '<div class="file-player__body" data-file-player-body></div><span class="file__live" role="status" aria-live="polite"></span>';
    body = host.querySelector("[data-file-player-body]");
    live = host.querySelector(".file__live");
  }
  return { body: /** @type {HTMLElement} */ (body), live: /** @type {HTMLElement} */ (live) };
}

/**
 * Draw the full player for `held` into `host`, replacing whatever it held.
 *
 * @param {HTMLElement} host
 * @param {Held} held
 * @param {Playable} kind
 */
export function mountPlayer(host, held, kind) {
  host.classList.add("file-player");
  host.dataset.kind = kind;
  const { body, live } = partsOf(host);
  live.textContent = "";
  render({
    host,
    body,
    live,
    held,
    kind,
    refused: null,
    seeking: false,
    paused: true,
    seeds: new Map(),
  });
}
