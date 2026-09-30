// @ts-check
/**
 * The controls page's recorder, held in each of its states. Nothing here is the recorder —
 * `file-recorder.js` is — and nothing here listens: every field under `[data-recorder-bench]`
 * records from a stand-in microphone whose level is a made-up voice and whose recording is
 * `assets/media/voice-note.webm`, recorded by Chrome from a tone shaped like speech. Each field
 * is walked to the state it names by the clicks a person makes, and stays live from there.
 *
 * The one field the bench leaves alone records from your own microphone.
 */

import { mountFileFields, pickInto } from "../files/file-field.js";
import { esc } from "../files/file-parts.js";
import { UNBLOCK } from "../files/recorder-parts.js";
import { timedTransfer } from "./file-bench.js";

/**
 * @typedef {import("../files/recorder-env.js").RecorderEnv} RecorderEnv
 * @typedef {{ refuse?: string, waits?: boolean, steps: string[], lose?: "early" | "late",
 *   silent?: boolean, stuck?: boolean, selfStop?: boolean, drop?: boolean,
 *   failUpload?: boolean }} Walk
 */

const RECORDING = "./assets/media/voice-note.webm";

/** @type {Record<string, Walk>} */
const WALKS = {
  asking: { steps: ["record"], waits: true },
  recording: { steps: ["record"] },
  narrow: { steps: ["record"] },
  finishing: { steps: ["record", "stop"], stuck: true },
  stopped: { steps: ["record", "stop"] },
  capped: { steps: ["record"] },
  "lost-late": { steps: ["record"], lose: "late" },
  "on-its-own": { steps: ["record"], selfStop: true },
  dropped: { steps: ["record"], drop: true },
  unsent: { steps: ["record", "stop"], failUpload: true },
  "over-held": { steps: ["record"] },
  "cancel-held": { steps: ["record", "cancel"] },
  denied: { steps: ["record"], refuse: "NotAllowedError" },
  "denied-held": { steps: ["record"], refuse: "NotAllowedError" },
  "no-device": { steps: ["record"], refuse: "NotFoundError" },
  "device-busy": { steps: ["record"], refuse: "NotReadableError" },
  "lost-early": { steps: ["record"], lose: "early" },
  failed: { steps: ["record"], refuse: "TypeError" },
  empty: { steps: ["record", "stop"], silent: true },
};

/** A moment of recording before a step, so the time and the wave have moved. */
const DWELL_MS = 1600;

/** @type {Record<string, string>} */
const BROWSERS = {
  chrome: "Chrome and Edge",
  firefox: "Firefox",
  safari: "Safari on a Mac",
  ios: "Safari on an iPhone or iPad",
  "ios-app": "Chrome or Firefox on an iPhone or iPad",
  android: "A browser on Android",
  other: "Any other browser",
};

class Track extends EventTarget {
  stop() {}
}

/** @param {Track} track */
const streamOf = (track) =>
  /** @type {MediaStream} */ (
    /** @type {unknown} */ ({ getTracks: () => [track], getAudioTracks: () => [track] })
  );

/**
 * A recorder that "records" the page's sample in four chunks, as a browser gives one a second, and
 * the rest at Stop. A silent one records nothing, a stuck one never says it stopped, and one that
 * stops itself does so a moment in, as a browser does when its track ends.
 */
class Recording extends EventTarget {
  /** @param {string} type */
  static isTypeSupported = (type) => type.startsWith("audio/webm");
  static silent = false;
  static stuck = false;
  static selfStop = false;
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  /** @type {Promise<Blob[]>} */
  pieces = Promise.resolve([]);
  /** @type {ReturnType<typeof setInterval> | undefined} */
  timer = undefined;

  get kind() {
    return /** @type {typeof Recording} */ (this.constructor);
  }

  start() {
    this.state = "recording";
    this.pieces = this.kind.silent ? Promise.resolve([]) : slices();
    this.timer = setInterval(() => void this.emit(1), 300);
    if (this.kind.selfStop) setTimeout(() => void this.stop(), DWELL_MS);
  }

  /** @param {number} count */
  async emit(count) {
    const pieces = await this.pieces;
    for (const data of pieces.splice(0, count)) {
      this.dispatchEvent(Object.assign(new Event("dataavailable"), { data }));
    }
  }

  async stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    clearInterval(this.timer);
    await this.emit(Number.POSITIVE_INFINITY);
    if (!this.kind.stuck) this.dispatchEvent(new Event("stop"));
  }
}

/** The page's sample in four pieces. */
async function slices() {
  const whole = await (await fetch(RECORDING)).blob();
  const step = Math.ceil(whole.size / 4);
  return [0, 1, 2, 3].map((n) => whole.slice(n * step, (n + 1) * step));
}

/**
 * How loud someone talking is at `t` seconds: syllables of a fifth of a second, each its own
 * loudness, rising and falling inside it, and now and then a pause.
 *
 * @param {number} t
 */
function speaking(t) {
  const syllable = Math.floor(t * 5);
  const chance = (/** @type {number} */ n) => {
    const x = Math.sin(syllable * 12.9898 + n * 78.233) * 43_758.5453;
    return x - Math.floor(x);
  };
  if (chance(1) < 0.2) return 0.01;
  const within = t * 5 - syllable;
  return (0.2 + 0.8 * chance(2)) * Math.sin(Math.PI * within) ** 0.6;
}

/** A stand-in microphone's context, whose analyser hears `speaking`. */
class Context {
  createAnalyser() {
    return {
      fftSize: 1024,
      /** @param {Uint8Array} samples */
      getByteTimeDomainData(samples) {
        const loud = speaking(performance.now() / 1000);
        samples.forEach((_, i) => {
          samples[i] = 128 + Math.round(127 * loud * Math.sin(i / 3));
        });
      },
    };
  }

  createMediaStreamSource() {
    return { connect() {} };
  }

  async close() {}
}

/**
 * @param {Walk} walk
 * @param {Track} track
 * @returns {RecorderEnv}
 */
function benchEnv(walk, track) {
  const getUserMedia = () => {
    if (walk.waits) return new Promise(() => {});
    if (walk.refuse) return Promise.reject(new DOMException("", walk.refuse));
    return Promise.resolve(streamOf(track));
  };
  return /** @type {RecorderEnv} */ (
    /** @type {unknown} */ ({
      mediaDevices: { getUserMedia },
      MediaRecorder: class extends Recording {
        /** @override */
        static silent = Boolean(walk.silent);
        /** @override */
        static stuck = Boolean(walk.stuck);
        /** @override */
        static selfStop = Boolean(walk.selfStop);
      },
      AudioContext: Context,
      agent: navigator.userAgent,
      touchPoints: navigator.maxTouchPoints,
      now: () => performance.now(),
      date: () => new Date(),
      repeat: (/** @type {() => void} */ run, /** @type {number} */ ms) => {
        // A stuck walk holds "Finishing" still, so its recorder's watchdog never runs.
        if (walk.stuck && ms >= 1000) return () => {};
        const timer = setInterval(run, ms);
        return () => clearInterval(timer);
      },
      guardLeave() {},
      watchShown: () => () => {},
    })
  );
}

/**
 * Wait until `ready` holds, a frame at a time, for as long as a sample takes to fetch and decode.
 *
 * @param {() => boolean} ready
 */
async function until(ready) {
  for (let tries = 0; tries < 120 && !ready(); tries++) {
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

const dwell = () => new Promise((settle) => setTimeout(settle, DWELL_MS));

/**
 * Press the button a step names, once it is there, and wait until it has done its work.
 *
 * @param {HTMLElement} host
 * @param {string} step
 */
async function press(host, step) {
  const selector = step === "record" ? "[data-file-record]" : `[data-recorder-do="${step}"]`;
  await until(() => host.querySelector(selector) !== null);
  if (step !== "record") await dwell();
  const button = host.querySelector(selector);
  if (button instanceof HTMLElement) button.click();
  await until(() => host.querySelector(selector) === null);
}

/**
 * @param {HTMLElement} host
 * @param {Walk} walk
 * @param {Track} track
 */
async function walkTo(host, walk, track) {
  for (const step of walk.steps) await press(host, step);
  if (walk.lose === "late" || walk.drop) await dwell();
  if (walk.lose) track.dispatchEvent(new Event("ended"));
  if (walk.drop) pickInto(host, { name: "Birdsong.mp3", type: "audio/mpeg", size: 48_000 });
}

/** An upload that fails a moment in, as one does when the connection drops. */
const failing = () => ({
  done: new Promise((_, refuse) => setTimeout(() => refuse(new Error("offline")), 1200)),
  abort() {},
});

/**
 * Mount the page's benched recorders, each on its own stand-in, before the rest of the page's
 * fields mount on the browser's own media.
 *
 * @param {ParentNode} root
 */
export function mountRecorderBench(root) {
  for (const table of root.querySelectorAll("[data-recorder-unblock]")) {
    table.innerHTML = Object.entries(UNBLOCK)
      .map(
        ([browser, steps]) =>
          `<tr><td>${esc(BROWSERS[browser] ?? browser)}</td><td>${esc(steps)}</td></tr>`,
      )
      .join("");
  }
  for (const host of root.querySelectorAll("[data-recorder-bench]")) {
    if (!(host instanceof HTMLElement) || !host.parentElement) continue;
    const walk = WALKS[host.dataset.recorderBench ?? ""];
    if (!walk) continue;
    const track = new Track();
    const transfer = walk.failUpload ? failing : timedTransfer;
    mountFileFields(host.parentElement, transfer, { recorder: benchEnv(walk, track) });
    void walkTo(host, walk, track);
  }
}
