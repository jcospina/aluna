// @ts-check
/**
 * The controls page's stand-in for the upload route, and the benches that pick the files
 * nobody has to hand. Nothing here is the control — `file-field.js` is — and nothing here
 * uploads: a pick streams against a timer at the speed the bench is set to.
 *
 * The refusals are the platform's sentences, as 7.1/02 and 7.2/01 settle them. Admission
 * reads a file's first bytes, so a file of the wrong kind is refused a moment into its stream;
 * one over the cap is refused before it starts. A list names the file it refuses, because
 * several may be travelling at once. The record's render view is here too: a video or a sound
 * a field opens plays in full under "Inside the open record".
 */

import {
  FILE_FIELD_HOOKS,
  FILE_FIELD_OPEN,
  FileRefusal,
  mountFileFields,
  pickInto,
  settleFileFields,
} from "./file-field.js";
import { mountFileLists, pickIntoList } from "./file-list.js";
import { mountPlayer } from "./file-player.js";

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

/**
 * WebM and Ogg carry either (decision 3): a declared video or audio type names the family, then
 * a field that takes only one of the two; failing both, the extension's usual family does.
 */
const EITHER = new Set(["webm", "ogg"]);

/** @type {Record<Kind, { noun: string, verb: string }>} */
const SAID = {
  image: { noun: "a photo", verb: "show" },
  video: { noun: "a video", verb: "play" },
  audio: { noun: "an audio file", verb: "play" },
  document: { noun: "a document", verb: "keep" },
};

/**
 * What a field says of a file of a family it doesn't take. A field that takes several names
 * them all, and keeps rather than shows or plays.
 *
 * @param {Kind[]} kinds
 * @param {string} subject "That", or the file's name in a list
 */
function notThisKind(kinds, subject) {
  const nouns = kinds.map((k) => SAID[k].noun);
  const last = nouns.pop() ?? "";
  const named = nouns.length > 0 ? `${nouns.join(", ")} or ${last}` : last;
  const verb = kinds.length === 1 ? SAID[kinds[0] ?? "document"].verb : "keep";
  return `${subject} isn’t ${named} I can ${verb} here. Mind picking a different one?`;
}

/** @param {string} subject */
const tooLarge = (subject) =>
  `${subject === "That" ? "That’s" : `${subject} is`} over ${CAP_MB} MB, more than I can keep in one file. Mind picking a smaller one?`;

/**
 * @param {string} extension
 * @param {string | undefined} claim
 * @param {Kind[]} kinds
 * @returns {Kind | undefined}
 */
function eitherFamily(extension, claim, kinds) {
  if (claim === "video" || claim === "audio") return claim;
  const media = kinds.filter((k) => k === "video" || k === "audio");
  return media.length === 1 ? media[0] : FAMILIES[extension];
}

/**
 * The family admission would take this file in as, or null when the field takes none it
 * could be. A blank or generic MIME type makes no claim (decision 2); a specific one of
 * another family is a contradiction.
 *
 * @param {Picked} picked
 * @param {Kind[]} kinds
 * @returns {Kind | null}
 */
function admitted(picked, kinds) {
  const extension = (picked.name.split(".").pop() ?? "").toLowerCase();
  const claim = /^(image|video|audio)\//.exec(picked.type)?.[1];
  const named = EITHER.has(extension) ? eitherFamily(extension, claim, kinds) : FAMILIES[extension];
  if (!named || !kinds.includes(named)) return null;
  return claim === undefined || claim === named ? named : null;
}

/** What a document's name says it is, for the sentence that says it isn't. @type {Record<string, string>} */
const NAMED_AS = {
  pdf: "PDF",
  doc: "Word document",
  docx: "Word document",
  md: "Markdown file",
  txt: "text file",
};

/**
 * What admission finds inside the files this page pretends to pick whose names say otherwise:
 * a spreadsheet renamed `.docx`, and a Word document locked with a password (7.2/05).
 *
 * @type {Record<string, "renamed" | "locked">}
 */
const INSIDE = { "cuentas.docx": "renamed", "acta de la junta.docx": "locked" };

/**
 * @param {Picked} picked
 * @param {string} subject
 * @returns {string | null}
 */
function foundInside(picked, subject) {
  const found = INSIDE[picked.name];
  const extension = (picked.name.split(".").pop() ?? "").toLowerCase();
  if (found === "locked")
    return `${subject === "That" ? "That Word document" : subject} has a password on it, so I can’t keep it. Mind saving a copy without one?`;
  if (found === "renamed")
    return `${subject} isn’t the ${NAMED_AS[extension] ?? "file"} its name says it is. Mind picking a different one?`;
  return null;
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
  pdf: {
    name: "repotting-guide.pdf",
    type: "application/pdf",
    size: 184_320,
    url: "./assets/media/repotting-guide.pdf",
  },
  docx: {
    name: "Presupuesto año.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 48_128,
    url: "./assets/media/presupuesto.docx",
  },
  notes: {
    name: "potting-mix.txt",
    type: "text/plain",
    size: 64,
    url: "./assets/media/potting-mix.txt",
  },
  renamed: {
    name: "cuentas.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 21_504,
  },
  locked: {
    name: "acta de la junta.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 30_720,
  },
  "video-refused": {
    name: "greenhouse-walk.mov",
    type: "video/quicktime",
    size: 41_943_040,
    url: "./assets/media/greenhouse-walk.mov",
  },
  "sound-refused": {
    name: "creek-at-dusk.m4a",
    type: "audio/mp4",
    size: 3_145_728,
    url: "./assets/media/creek-at-dusk.m4a",
  },
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
 * @param {Kind} kind
 * @returns {Promise<Held>}
 */
async function settled(picked, kind) {
  const url = await servedAt(picked);
  return {
    name: picked.name,
    size: picked.size,
    url,
    kind,
    ...(picked.type ? { type: picked.type } : {}),
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
 * @typedef {{ picked: Picked, family: Kind | null, refusal: string | null, size: number,
 *             started: number, loaded: number, timer: number,
 *             onProgress: (loaded: number) => void, resolve: (held: Promise<Held>) => void,
 *             reject: (refusal: FileRefusal) => void }} Stream
 */

/** @param {Stream} s */
function tick(s) {
  const dt = 90 + Math.random() * 90;
  const gain = s.refusal ? s.size * 0.02 : stride(s.size, dt);
  s.loaded = Math.min(s.refusal ? s.size * 0.06 : s.size, s.loaded + gain);
  s.onProgress(s.loaded);
  if (s.refusal && performance.now() - s.started > 520) {
    s.reject(new FileRefusal(s.family ? "not-what-it-says" : "not-this-kind", s.refusal));
    return;
  }
  if (s.family && s.loaded >= s.size) s.resolve(settled(s.picked, s.family));
  else s.timer = window.setTimeout(() => tick(s), dt);
}

/**
 * The families a field takes are the ones its host names; a list names several and says which
 * file it refuses.
 *
 * @param {Picked} picked
 * @param {Kind} kind
 * @param {(loaded: number) => void} onProgress
 * @param {HTMLElement} host
 * @returns {Upload}
 */
export function timedTransfer(picked, kind, onProgress, host) {
  const named = host
    .getAttribute(FILE_FIELD_HOOKS.kind)
    ?.split(/\s+/)
    .filter((k) => k in SAID);
  const kinds = /** @type {Kind[]} */ (named?.length ? named : [kind]);
  const subject = host.hasAttribute(FILE_FIELD_HOOKS.list) ? picked.name : "That";
  if (picked.size > CAP_MB * MB) {
    return { done: Promise.reject(new FileRefusal("too-large", tooLarge(subject))), abort() {} };
  }
  /** @type {Stream | undefined} */
  let stream;
  /** @type {Promise<Held>} */
  const done = new Promise((resolve, reject) => {
    const family = admitted(picked, kinds);
    stream = {
      picked,
      size: Math.max(1, picked.size),
      family,
      refusal: family ? foundInside(picked, subject) : notThisKind(kinds, subject),
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
  const picks = (button.dataset.filePretend ?? "")
    .split(/\s+/)
    .flatMap((key) => (PRETEND[key] ? [{ ...PRETEND[key] }] : []));
  const host = targetOf(button);
  const [first] = picks;
  if (!host || !first) return;
  if (host.hasAttribute(FILE_FIELD_HOOKS.list)) pickIntoList(host, picks);
  else pickInto(host, first);
}

/**
 * What the render view's own bench plays: the page's two files, and two no browser can play,
 * whose download link stands where the player would be.
 *
 * @type {Record<string, [Held, "video" | "audio"]>}
 */
const SHOWN = {
  video: [
    {
      name: "monstera-new-pot.mp4",
      size: 38_797_312,
      url: "./assets/media/repotting.mp4",
      duration: 18,
    },
    "video",
  ],
  audio: [
    {
      name: "watering-notes.m4a",
      size: 4_404_019,
      url: "./assets/media/morning-chimes.m4a",
      duration: 6,
    },
    "audio",
  ],
  "video-refused": [
    { name: "greenhouse-walk.mov", size: 41_943_040, url: "./assets/media/greenhouse-walk.mov" },
    "video",
  ],
  "audio-refused": [
    { name: "creek-at-dusk.m4a", size: 3_145_728, url: "./assets/media/creek-at-dusk.m4a" },
    "audio",
  ],
};

/** The field the render view was opened from, which Back returns to. @type {HTMLElement | null} */
let opener = null;

/** The row of a list the view was opened from, which Back lands on. @type {string | undefined} */
let openedEntry;

/** @type {Map<string, Promise<string>>} */
const INLINED = new Map();

/** @type {Record<string, string>} */
const MEDIA_TYPES = { mp4: "video/mp4", mov: "video/quicktime", m4a: "audio/mp4" };

/**
 * A copy in memory is played by its declared type alone, and this page's server calls some
 * of its media `application/octet-stream`.
 *
 * @param {Blob} blob
 * @param {string} url
 */
function typed(blob, url) {
  const type = MEDIA_TYPES[(url.split(".").pop() ?? "").toLowerCase()];
  return type && blob.type !== type ? new Blob([blob], { type }) : blob;
}

/**
 * This page's server answers no Range request, and a player cannot seek a file it can only
 * read from the start, so the render view plays the page's files from memory, as a real pick
 * already is. The product's file route answers ranges (7.2/02).
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
function inlined(url) {
  if (!url || url.startsWith("data:")) return Promise.resolve(url);
  const known = INLINED.get(url);
  if (known) return known;
  const read = fetch(url)
    .then((response) => response.blob())
    .then(
      (blob) =>
        /** @type {Promise<string>} */ (
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => resolve(String(reader.result)));
            reader.addEventListener("error", () => resolve(url));
            reader.readAsDataURL(typed(blob, url));
          })
        ),
    )
    .catch(() => url);
  INLINED.set(url, read);
  return read;
}

let shown = 0;

/**
 * @param {Held} held
 * @param {string} kind
 * @param {HTMLElement | null} from
 */
async function showInView(held, kind, from) {
  const view = document.querySelector("[data-file-view]");
  if (!(view instanceof HTMLElement) || (kind !== "video" && kind !== "audio")) return;
  const turn = ++shown;
  const url = await inlined(held.url);
  if (turn !== shown) return;
  mountPlayer(view, { ...held, url }, kind);
  const title = document.querySelector("[data-file-view-title]");
  if (title) title.textContent = held.name;
  opener = from;
}

/** @param {HTMLElement} button */
function show(button) {
  const shown = SHOWN[button.dataset.fileViewShow ?? ""];
  openedEntry = undefined;
  if (shown) showInView(shown[0], shown[1], null);
  for (const b of document.querySelectorAll("[data-file-view-show]"))
    b.setAttribute("aria-pressed", String(b === button));
}

/**
 * On this page Back returns to the field the file was opened from; in a window it returns to
 * the record's form.
 */
function back() {
  const target = opener ?? document.getElementById("files");
  target?.scrollIntoView({ block: "center" });
  const row = openedEntry ? `[data-file-entry="${openedEntry}"] ` : "";
  const again = opener?.querySelector(`${row}[data-file-open], ${row}[data-file-list-open]`);
  if (again instanceof HTMLElement) again.focus({ preventScroll: true });
}

/** @param {Event} event */
function opened(event) {
  if (!(event instanceof CustomEvent)) return;
  const { held, kind, field, entry } = event.detail;
  openedEntry = entry;
  showInView(held, kind, field);
  for (const b of document.querySelectorAll("[data-file-view-show]"))
    b.setAttribute("aria-pressed", "false");
  const stage = document.querySelector("[data-file-view-stage]");
  stage?.scrollIntoView({ block: "center" });
  const toBack = stage?.querySelector("[data-file-view-back]");
  if (toBack instanceof HTMLElement) toBack.focus({ preventScroll: true });
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
  ["[data-file-view-show]", show],
  ["[data-file-view-back]", back],
  [`[${FILE_FIELD_HOOKS.save}]`, (button) => settleIn(button, "keep")],
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
  mountFileLists(root, timedTransfer);
  root.addEventListener("click", onBench);
  root.addEventListener(FILE_FIELD_OPEN, opened);
  const [held, kind] = SHOWN.video ?? [];
  if (held && kind) showInView(held, kind, null);
}
