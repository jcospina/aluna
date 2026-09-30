// @ts-check
/**
 * What the voice recorder says and draws, apart from the recorder itself (`file-recorder.js`),
 * so its rules run anywhere: which type a browser records in, what the finished file is called,
 * what a browser's refusal means and how to recover from it in that browser, and the row the
 * field shows while it records. A leaf beside `file-parts.js`, which it draws with.
 */

import { clock, esc, G, glyph, seed, square } from "./file-parts.js";

/** The hook a field's render moves the keyboard to (`FILE_FIELD_HOOKS.focus` in file-field.js). */
const FOCUS = "data-file-focus";

/**
 * @typedef {import("./file-parts.js").Seeded} Seeded
 * @typedef {"asking" | "recording" | "finishing"} RecorderState
 * @typedef {"denied" | "no-device" | "device-busy" | "device-lost" | "failed" | "empty"} Refusal
 * @typedef {"webm" | "m4a" | "ogg"} Container
 * @typedef {"chrome" | "firefox" | "safari" | "ios" | "ios-app" | "android" | "other"} Browser
 * @typedef {{ state: RecorderState, at: number, levels: number[] }} View
 */

/**
 * The types a recorder is asked for, best first. WebM is first because a finished one shows its
 * length and seeks in every browser (`lib/webm.js`), where Chrome's MP4 reads as a fraction of a
 * second long in Firefox; MP4 is for a Safari that records nothing else. A recorder asked for no
 * type answers with none in Firefox, so one is asked for whenever the browser has one.
 */
export const RECORDING_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/**
 * @param {(type: string) => boolean} supported
 * @returns {string} the first type this browser records, or "" to let it choose
 */
export function recordingType(supported) {
  return (
    RECORDING_TYPES.find((type) => {
      try {
        return supported(type);
      } catch {
        return false;
      }
    }) ?? ""
  );
}

/** @type {Record<Container, string>} */
const TYPE_OF = { webm: "audio/webm", m4a: "audio/mp4", ogg: "audio/ogg" };

/** @type {Record<string, Container>} */
const BY_TYPE = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/mp4": "m4a",
  "video/mp4": "m4a",
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
};

/**
 * The DocType an EBML header names, which is what tells a WebM from any other Matroska file.
 *
 * @param {Uint8Array} head
 */
function docTypeOf(head) {
  const at = head.findIndex((byte, n) => n >= 4 && byte === 0x42 && head[n + 1] === 0x82);
  if (at < 0) return "";
  const first = head[at + 2] ?? 0;
  const width = Math.clz32(first) - 23;
  if (width < 1 || width > 8) return "";
  let length = first & (0xff >> width);
  for (let i = 1; i < width; i++) length = length * 256 + (head[at + 2 + i] ?? 0);
  const from = at + 2 + width;
  return String.fromCharCode(...head.subarray(from, from + length));
}

/**
 * The container a recording is in, read off its first bytes, and failing that off the type the
 * recorder reported. The name and the type sent both follow it, because admission reads the
 * bytes and refuses a name that says otherwise.
 *
 * @param {Uint8Array} head its first 64 bytes, which hold a WebM's whole EBML header
 * @param {string} reported
 * @returns {Container | null}
 */
export function containerOf(head, reported) {
  const ascii = (/** @type {number} */ from, /** @type {number} */ to) =>
    String.fromCharCode(...head.subarray(from, to));
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return docTypeOf(head) === "webm" ? "webm" : null;
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(4, 8) === "ftyp") return "m4a";
  return BY_TYPE[reported.split(";")[0]?.trim().toLowerCase() ?? ""] ?? null;
}

/** @param {Container} container */
export const typeOf = (container) => TYPE_OF[container];

/** @param {number} n */
const two = (n) => String(n).padStart(2, "0");

/**
 * A name a person can read in the record: when it was recorded, to the second, so two notes
 * made a minute apart are told apart.
 *
 * @param {Date} when
 * @param {Container} container
 */
export function recordingName(when, container) {
  const day = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}`;
  const time = `${two(when.getHours())}.${two(when.getMinutes())}.${two(when.getSeconds())}`;
  return `Voice note ${day} ${time}.${container}`;
}

/**
 * What a refused microphone means. A browser that won't ask again and a person who said no are
 * the same to the page; a microphone another app holds fails to start rather than to be found.
 *
 * @param {unknown} error
 * @returns {Refusal}
 */
export function refusalOf(error) {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-device";
  if (name === "NotReadableError" || name === "AbortError") return "device-busy";
  return "failed";
}

/**
 * @param {string} agent
 * @param {number} touchPoints an iPad asks for a Mac's page, and only its touch gives it away
 * @returns {Browser}
 */
export function browserOf(agent, touchPoints = 0) {
  const apple = /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && touchPoints > 1);
  if (apple) return /CriOS|FxiOS|EdgiOS/.test(agent) ? "ios-app" : "ios";
  if (/Android/.test(agent)) return "android";
  if (/Firefox\//.test(agent)) return "firefox";
  if (/Chrome\/|Chromium\/|Edg\//.test(agent)) return "chrome";
  if (/Safari\//.test(agent)) return "safari";
  return "other";
}

/** @type {Record<Browser, string>} */
export const UNBLOCK = {
  chrome: "Click the icon at the left of the address bar, turn Microphone on, then try again.",
  firefox:
    "Click the crossed-out microphone in the address bar and clear the block, then try again.",
  safari:
    "Open Safari’s Settings, choose Websites, then Microphone, set this site to Allow, and try again.",
  ios: "Tap the page menu in the address bar, choose Website Settings, set Microphone to Allow, then try again.",
  "ios-app":
    "Open your device’s Settings, find this browser, turn Microphone on, then come back and try again.",
  android:
    "Tap the icon at the left of the address bar, choose Permissions, allow Microphone, then try again.",
  other: "Allow the microphone for this site in your browser’s settings, then try again.",
};

/** A browser allowed the microphone can still be refused it by the computer itself. */
const PRIVACY =
  "If it’s already allowed, check that your computer’s privacy settings allow it too.";

/** What each refusal says under the field, and how to recover; a block's steps are the browser's. */
const REFUSALS = {
  denied: { say: "Your browser is blocking the microphone.", steps: "" },
  "no-device": {
    say: "I can’t find a microphone.",
    steps: "Plug one in or turn it on, then press Record again.",
  },
  "device-busy": {
    say: "Another app is using your microphone.",
    steps: `Close it or stop its recording, then press Record again. ${PRIVACY}`,
  },
  "device-lost": {
    say: "Your microphone went away before I heard anything.",
    steps: "Plug it back in, then press Record again.",
  },
  failed: {
    say: "I couldn’t start the microphone.",
    steps: "Press Record to try again, or choose a file instead.",
  },
  empty: {
    say: "I didn’t hear anything to keep.",
    steps: "Press Record to try again, or choose a file instead.",
  },
};

/**
 * The sentence a refusal leaves under the field: what went wrong, then what to do about it.
 *
 * @param {Refusal} refusal
 * @param {Browser} browser
 */
export function refusalSentence(refusal, browser) {
  const { say, steps } = REFUSALS[refusal];
  return `${say} ${refusal === "denied" ? `${UNBLOCK[browser]} ${PRIVACY}` : steps}`;
}

/** What the row says while it waits on the browser, and while the file is made. */
export const WAITING = {
  asking: "Allow the microphone when your browser asks.",
  finishing: "Finishing the recording…",
};

/* ── Levels and peaks ─────────────────────────────────────────────────────── */

/** How many moments the live wave shows. */
export const LEVEL_POINTS = 100;

/**
 * How loud a moment is, from the analyser's samples around 128: the loudest of them, as a
 * height between a hair and full, lifted a little so a voice at speaking distance still shows.
 *
 * @param {Uint8Array} samples
 */
export function levelOf(samples) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
  return Math.min(1, Math.max(0.04, (peak * 1.25) ** 0.7));
}

/**
 * Whether the next chunk could carry the recording past the field's cap: stop while two of the
 * largest chunk so far, and the index a finished WebM gains, still fit.
 *
 * @param {number} gathered
 * @param {number} largest
 * @param {number} cap
 */
export const nearsCap = (gathered, largest, cap) =>
  Number.isFinite(cap) && gathered + 2 * largest + Math.ceil(cap / 100) + 4096 >= cap;

/* ── Markup ───────────────────────────────────────────────────────────────── */

/**
 * The soundwave: one stroke per moment, as tall as the loudest the sound got in it, mirrored
 * about the middle line. Nothing is smoothed, so the wave is as jagged as the sound was.
 *
 * @param {number[]} levels each between a hair and 1
 */
export const wavePath = (levels) =>
  levels
    .map((level, x) => {
      const half = Math.round(48 * Math.min(1, Math.max(0, level)) * 10) / 10;
      return `M${x + 0.5} ${50 - half}V${50 + half}`;
    })
    .join("");

/** @param {number[]} levels */
const wave = (levels) =>
  `<svg class="recorder__wave" viewBox="0 0 ${Math.max(1, levels.length)} 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${wavePath(levels)}" stroke="currentColor" stroke-width="0.6" data-recorder-wave></path></svg>`;

/**
 * The row the field is while it records, in its well's place: the microphone, the time and the
 * live wave, and Stop and Cancel as squares beside it. While the browser is asked, and while the
 * file is made, the row says so instead. The keyboard lands on the words, never on a square, so
 * a held Enter on Record can't press Stop or Cancel.
 *
 * @param {Seeded} f
 * @param {View} v
 */
export function recorderRow(f, v) {
  const live = v.state === "recording";
  const words = /** @type {Record<string, string>} */ (WAITING)[v.state] ?? "";
  const inside = live
    ? `<span class="file__meta recorder__time" role="timer" tabindex="-1" ${FOCUS}><span class="recorder__said">Recording, </span><span data-recorder-time>${clock(v.at)}</span></span>${wave(v.levels)}`
    : `<span class="file__name" tabindex="-1" ${FOCUS}>${words}</span>`;
  const stop = live
    ? square(f, "rec-stop", "Stop recording", glyph(12, G.stop, true), 'data-recorder-do="stop"')
    : "";
  const label = live ? "Cancel the recording" : "Stop asking for the microphone";
  const cancel =
    v.state === "finishing"
      ? ""
      : square(
          f,
          "rec-cancel",
          label,
          glyph(14, G.clear),
          'data-recorder-do="cancel"',
          live ? "btn--danger" : "btn--outline",
        );
  return `<div class="file__row" data-recorder data-state="${v.state}">
  <span class="field__control file__well file__recorder"${seed(f, "well")}>
    <span class="file__glyph">${glyph(18, G.microphone)}</span>
    ${inside}
  </span>
  <span class="file__actions">${stop}${cancel}</span>
</div>`;
}

/**
 * A recording whose upload failed or was stopped, kept so it isn't lost: it goes up again, or is
 * thrown away, and nothing else leaves the row until one of the two.
 *
 * @param {Seeded} f
 * @param {string} name
 */
export const unsentRow = (f, name) => `<div class="file__row">
  <span class="field__control file__well"${seed(f, "well")}>
    <span class="file__glyph">${glyph(18, G.microphone)}</span>
    <span class="file__name" tabindex="-1" ${FOCUS}>${esc(name)}</span>
    <span class="file__meta">Not uploaded</span>
  </span>
  <span class="file__actions">
    ${square(f, "resend", `Upload ${esc(name)} again`, glyph(14, G.up), "data-file-resend")}
    ${square(f, "forget", `Throw away ${esc(name)}`, glyph(14, G.clear), "data-file-forget", "btn--danger")}
  </span>
</div>`;

/** @param {Seeded} f */
export const recordButton = (f) =>
  `<button class="btn btn--primary file__record" type="button" data-file-record aria-describedby="${f.host.id}-guidance"${seed(f, "record")}>${glyph(16, G.microphone)}<span>Record</span></button>`;

/**
 * @param {Seeded} f
 * @param {string} name
 */
export const recordAgainSquare = (f, name) =>
  square(
    f,
    "record",
    `Record in place of ${esc(name)}`,
    glyph(14, G.microphone),
    "data-file-record",
    "btn--primary",
  );
