// @ts-check
/**
 * The controls page's stand-in for the upload route, and the benches that pick the files
 * nobody has to hand. Nothing here is the control — `file-field.js` is — and nothing here
 * uploads: a pick streams against a timer at the speed the bench is set to.
 *
 * The refusals are the platform's sentences: 7.1/02 settles the photo's and the size's,
 * and drafts the other kinds' for 7.2 to settle. Admission reads a file's first bytes, so a
 * file of the wrong kind is refused a moment into its stream; one over the cap is refused
 * before it starts.
 */

import { FileRefusal, mountFileFields, pickInto, settleFileFields } from "./file-field.js";

/**
 * @typedef {import("./file-field.js").Picked} Picked
 * @typedef {import("./file-field.js").Held} Held
 * @typedef {import("./file-field.js").Kind} Kind
 * @typedef {import("./file-field.js").Upload} Upload
 */

const MB = 1024 * 1024;
const CAP_MB = 500;

/**
 * The family each extension names (decision 3): the extension decides, and a MIME type only
 * speaks when it contradicts it. HEIC, TIFF and SVG name no family a field accepts.
 *
 * @type {Record<string, Kind>}
 */
const FAMILIES = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  ogv: "video",
  mp3: "audio",
  m4a: "audio",
  aac: "audio",
  wav: "audio",
  oga: "audio",
  ogg: "audio",
  opus: "audio",
  flac: "audio",
  pdf: "document",
  doc: "document",
  docx: "document",
  md: "document",
  txt: "document",
};

/** WebM and Ogg carry either, so the field's own kind names the family (decision 3). */
const EITHER = new Set(["webm", "ogg"]);

/** @type {Record<Kind, string>} */
const NOT_THIS_KIND = {
  image: "That isn’t a photo I can show here. Mind picking a different one?",
  video: "That isn’t a video I can play here. Mind picking a different one?",
  audio: "That isn’t a sound I can play here. Mind picking a different one?",
  document: "That isn’t a document I can keep here. Mind picking a different one?",
};

const TOO_LARGE = `That’s over ${CAP_MB} MB, more than I can keep in one file. Mind picking a smaller one?`;

/**
 * Whether admission would take this file into a field of this kind. A blank or generic MIME
 * type makes no claim (decision 2); a specific one of another family is a contradiction.
 *
 * @param {Picked} picked
 * @param {Kind} kind
 */
function admitted(picked, kind) {
  const extension = (picked.name.split(".").pop() ?? "").toLowerCase();
  const named =
    EITHER.has(extension) && (kind === "video" || kind === "audio") ? kind : FAMILIES[extension];
  if (named !== kind) return false;
  const claim = /^(image|video|audio)\//.exec(picked.type)?.[1];
  if (claim === undefined) return true;
  return EITHER.has(extension) ? claim === "video" || claim === "audio" : claim === kind;
}

/** Past this a real pick is not read into memory, and its preview is the well's glyph. */
const READ_LIMIT = 80 * MB;

/** @type {Record<string, Picked>} */
const PRETEND = {
  photo: {
    name: "coffee-beans.jpg",
    type: "image/jpeg",
    size: 2_516_582,
    url: "./assets/media/coffee-beans.jpg",
  },
  big: { name: "night-sky-panorama.png", type: "image/png", size: 641_728_512 },
  heic: { name: "IMG_2041.heic", type: "image/heic", size: 1_887_436 },
  pdf: { name: "repotting-guide.pdf", type: "application/pdf", size: 184_320 },
  video: {
    name: "monstera-new-pot.mp4",
    type: "video/mp4",
    size: 38_797_312,
    url: "./assets/media/repotting.mp4",
    duration: 18,
  },
  sound: {
    name: "watering-notes.m4a",
    type: "audio/mp4",
    size: 4_404_019,
    url: "./assets/media/morning-chimes.m4a",
    duration: 6,
  },
};

let speed = 5000;

/**
 * The address a settled file is served at. The pretend files carry one; a real pick is read
 * into a data URL, because the app server's policy admits `data:` media and not `blob:`.
 *
 * @param {Picked} picked
 * @returns {Promise<string>}
 */
function servedAt(picked) {
  const { file } = picked;
  if (picked.url || !file || file.size > READ_LIMIT) return Promise.resolve(picked.url ?? "");
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => resolve(""));
    reader.readAsDataURL(file);
  });
}

/**
 * @param {Picked} picked
 * @returns {Promise<Held>}
 */
async function settled(picked) {
  const url = await servedAt(picked);
  return {
    name: picked.name,
    size: picked.size,
    url,
    ...(picked.duration ? { duration: picked.duration } : {}),
  };
}

/**
 * How far one tick carries a stream: a share of the file scaled to the bench's speed, uneven
 * so it reads as a network, and now and then nothing at all.
 *
 * @param {number} size
 * @param {number} dt
 */
function stride(size, dt) {
  if (Math.random() < 0.08) return 0;
  return ((size * dt) / speed) * (0.35 + Math.random() * 1.3);
}

/**
 * @typedef {{ picked: Picked, kind: Kind, size: number, refused: boolean, started: number, loaded: number,
 *             timer: number, onProgress: (loaded: number) => void,
 *             resolve: (held: Promise<Held>) => void, reject: (refusal: FileRefusal) => void }} Stream
 */

/** @param {Stream} s */
function tick(s) {
  const dt = 90 + Math.random() * 90;
  const gain = s.refused ? s.size * 0.02 : stride(s.size, dt);
  s.loaded = Math.min(s.refused ? s.size * 0.06 : s.size, s.loaded + gain);
  s.onProgress(s.loaded);
  if (s.refused && performance.now() - s.started > 520) {
    s.reject(new FileRefusal("not-this-kind", NOT_THIS_KIND[s.kind]));
    return;
  }
  if (s.loaded >= s.size) s.resolve(settled(s.picked));
  else s.timer = window.setTimeout(() => tick(s), dt);
}

/**
 * @param {Picked} picked
 * @param {Kind} kind
 * @param {(loaded: number) => void} onProgress
 * @returns {Upload}
 */
export function timedTransfer(picked, kind, onProgress) {
  if (picked.size > CAP_MB * MB) {
    return { done: Promise.reject(new FileRefusal("too-large", TOO_LARGE)), abort() {} };
  }
  /** @type {Stream | undefined} */
  let stream;
  /** @type {Promise<Held>} */
  const done = new Promise((resolve, reject) => {
    stream = {
      picked,
      size: Math.max(1, picked.size),
      refused: !admitted(picked, kind),
      kind,
      started: performance.now(),
      loaded: 0,
      timer: 0,
      onProgress,
      resolve,
      reject,
    };
    const s = stream;
    s.timer = window.setTimeout(() => tick(s), 120);
  });
  return { done, abort: () => clearTimeout(stream?.timer) };
}

/**
 * @param {Element} button
 * @param {string} selector
 */
function press(button, selector) {
  const group = button.closest(".segmented");
  for (const b of group?.querySelectorAll(selector) ?? []) {
    b.setAttribute("aria-pressed", String(b === button));
  }
}

/**
 * The field a pretend pick goes into: the one its button names.
 *
 * @param {HTMLElement} button
 */
function targetOf(button) {
  const host = button.dataset.target ? document.getElementById(button.dataset.target) : null;
  return host instanceof HTMLElement ? host : null;
}

/** @param {HTMLElement} button */
function pretend(button) {
  const picked = PRETEND[button.dataset.filePretend ?? ""];
  const host = targetOf(button);
  if (picked && host) pickInto(host, { ...picked });
}

/** @param {HTMLElement} button */
function pace(button) {
  speed = Number(button.dataset.fileSpeed);
  press(button, "[data-file-speed]");
}

/** @type {Array<[string, (button: HTMLElement) => void]>} */
const BENCH = [
  ["[data-file-pretend]", pretend],
  ["[data-file-speed]", pace],
  ["[data-held-save]", (button) => settleIn(button, "keep")],
  ["[data-file-cancel]", (button) => settleIn(button, "revert")],
];

/**
 * @param {HTMLElement} button
 * @param {"keep" | "revert"} how
 */
function settleIn(button, how) {
  const scope = button.closest(".form");
  if (scope) settleFileFields(scope, how);
}

/** @param {MouseEvent} event */
function onBench(event) {
  const target = event.target instanceof Element ? event.target : null;
  for (const [selector, run] of BENCH) {
    const button = target?.closest(selector);
    if (button instanceof HTMLElement) run(button);
  }
}

/**
 * Mount the page's file fields on the timed transfer, and wire the benches beside them.
 *
 * @param {HTMLElement} root
 */
export function mountFileBench(root) {
  mountFileFields(root, timedTransfer);
  root.addEventListener("click", onBench);
}
