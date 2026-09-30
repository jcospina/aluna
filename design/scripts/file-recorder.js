// @ts-check
/**
 * The voice recorder: what an audio field's row becomes while Record is recording, in the same
 * place and at the same height as the well (`styles/components/file-recorder.css`). Record
 * starts it, so the first press is also what makes the browser ask for the microphone; the row
 * then shows the time and a live wave, with Stop and Cancel beside it. Stop hands the field a
 * `File`, which uploads as a picked file does; a WebM is finished first (`lib/webm.js`), so the
 * record shows its length and seeks. Cancel throws the recording away. A microphone that is
 * refused leaves the field empty with the reason and the fix under it.
 *
 * Everything the browser gives it arrives through a `RecorderEnv` (`recorder-env.js`), so the
 * design page can hold each state still and the product's tests can drive every path without a
 * microphone. Every way out of recording stops every track, so the microphone light goes out.
 */

import { clock } from "./file-parts.js";
import { finishWebm } from "./lib/webm.js";
import {
  browserOf,
  containerOf,
  LEVEL_POINTS,
  levelOf,
  nearsCap,
  recorderRow,
  recordingName,
  recordingType,
  refusalOf,
  refusalSentence,
  typeOf,
  WAITING,
  wavePath,
} from "./recorder-parts.js";

/**
 * @typedef {import("./recorder-parts.js").RecorderState} RecorderState
 * @typedef {import("./recorder-parts.js").Refusal} Refusal
 * @typedef {import("./file-parts.js").Seeded} Seeded
 * @typedef {import("./recorder-env.js").RecorderEnv} RecorderEnv
 * @typedef {{ redraw: (focus?: string) => void, say: (text: string) => void,
 *   commit: (file: File, said: string, note: string) => void, refuse: (sentence: string) => void,
 *   leave: () => void, hold?: (release: () => void) => () => void, cap: number }} RecorderHooks
 */

const LOST = "Your microphone went away, so I stopped the recording there.";
const CAPPED = "I stopped the recording there, because it reached the size this field takes.";
const ON_ITS_OWN = "The recording stopped on its own, so I kept what I heard up to there.";

/**
 * How long after a change a press is taken for the one before it: a double click on Record, or a
 * held Enter, lands on Stop or Cancel where Record was.
 */
export const SETTLE_MS = 400;

/**
 * How long finishing waits for the browser's last chunk before making the file from what it has:
 * a browser that stops later than this loses its last second, which beats a field left waiting.
 */
const WATCHDOG_MS = 5000;

export class Recorder {
  /** @type {RecorderState} */
  state = "asking";
  /** @type {MediaStream | null} */
  stream = null;
  /** @type {MediaRecorder | null} */
  recorder = null;
  /** @type {AudioContext | null} */
  context = null;
  /** @type {AnalyserNode | null} */
  analyser = null;
  /** @type {Blob[]} */
  chunks = [];
  gathered = 0;
  largest = 0;
  levels = Array.from({ length: LEVEL_POINTS }, () => 0.04);
  startedAt = 0;
  recordedMs = 0;
  /** @type {Array<() => void>} */
  stops = [];
  gone = false;
  recorderStopped = false;
  making = false;
  /** Why the recording ended, when it wasn't Stop: said, and kept under the field. */
  why = "";
  changedAt = 0;
  /** @type {(() => void) | null} */
  watchdog = null;

  /**
   * @param {Seeded} f the field it records into, whose hand its lines keep
   * @param {RecorderEnv} env
   * @param {RecorderHooks} hooks
   */
  constructor(f, env, hooks) {
    this.f = f;
    this.env = env;
    this.hooks = hooks;
    this.browser = browserOf(env.agent, env.touchPoints);
    this.unhold = hooks.hold?.(() => this.dispose()) ?? null;
  }

  /** Whether the form's save waits: from the first press until the file is handed over. */
  holds() {
    return !this.gone;
  }

  /** Whether leaving now would lose audio, which is what the page asks before. */
  losesAudio() {
    return this.state === "recording" || this.state === "finishing";
  }

  markup() {
    const at = this.elapsed() / 1000;
    return recorderRow(this.f, { state: this.state, at, levels: this.levels });
  }

  /**
   * After each draw: Stop and Cancel.
   *
   * @param {HTMLElement} body
   * @param {AbortSignal} signal
   */
  wire(body, signal) {
    body.addEventListener(
      "click",
      (event) => {
        const hit = event.target instanceof Element && event.target.closest("[data-recorder-do]");
        const act = hit instanceof HTMLElement ? hit.dataset.recorderDo : undefined;
        if (this.env.now() - this.changedAt < SETTLE_MS) return;
        if (act === "stop") this.end("");
        if (act === "cancel") this.cancel();
      },
      { signal },
    );
    const wave = body.querySelector(".recorder__wave");
    const width = wave?.getBoundingClientRect().width ?? 0;
    if (width > 0) this.fit(wave, Math.max(24, Math.round(width / 3)));
  }

  /**
   * As many moments as the wave has room for at the pitch it was drawn at, so it looks the same
   * in a wide field and a narrow one.
   *
   * @param {Element | null} wave
   * @param {number} points
   */
  fit(wave, points) {
    if (points === this.levels.length) return;
    const quiet = Array.from({ length: Math.max(0, points - this.levels.length) }, () => 0.04);
    this.levels = [...quiet, ...this.levels].slice(-points);
    wave?.setAttribute("viewBox", `0 0 ${points} 100`);
    wave?.querySelector("[data-recorder-wave]")?.setAttribute("d", wavePath(this.levels));
  }

  /**
   * @param {RecorderState} state
   * @param {string} said
   * @param {string} [focus] what takes the keyboard, when not the row's first control
   */
  go(state, said, focus) {
    if (this.gone) return;
    this.state = state;
    this.changedAt = this.env.now();
    this.env.guardLeave(this, this.losesAudio());
    this.hooks.redraw(focus);
    if (said) this.hooks.say(said);
  }

  elapsed() {
    return this.recordedMs + (this.state === "recording" ? this.env.now() - this.startedAt : 0);
  }

  /** @param {Refusal} refusal */
  refuse(refusal) {
    if (this.gone) return;
    this.teardown();
    this.hooks.refuse(refusalSentence(refusal, this.browser));
  }

  /* ── Starting ───────────────────────────────────────────────────────────── */

  /** Record was pressed: ask for the microphone, and record the moment the browser says yes. */
  async begin() {
    const devices = this.env.mediaDevices;
    if (!devices) return this.refuse("failed");
    this.stops.push(this.env.watchShown(this.f.host, () => this.hidden()));
    this.go("asking", WAITING.asking);
    try {
      this.listen(await devices.getUserMedia({ audio: true }));
    } catch (error) {
      this.refuse(refusalOf(error));
    }
  }

  /** @param {MediaStream} stream */
  listen(stream) {
    if (this.gone) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    stream.getAudioTracks()[0]?.addEventListener("ended", () => this.lost(LOST));
    this.meter(stream);
    this.start(stream);
  }

  /** @param {MediaStream} stream */
  meter(stream) {
    if (!this.env.AudioContext) return;
    try {
      this.context = new this.env.AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.context.createMediaStreamSource(stream).connect(this.analyser);
      void this.context.resume?.().catch(() => {});
    } catch {
      this.analyser = null;
    }
  }

  /** @param {MediaStream} stream */
  start(stream) {
    const Recording = this.env.MediaRecorder;
    if (!Recording) return this.refuse("failed");
    const mimeType = recordingType((type) => Recording.isTypeSupported(type));
    /** @type {MediaRecorder} */
    let recorder;
    try {
      recorder = new Recording(stream, mimeType ? { mimeType } : {});
      recorder.start(1000);
    } catch {
      return this.refuse("failed");
    }
    this.recorder = recorder;
    const current = () => this.recorder === recorder;
    recorder.addEventListener("dataavailable", (event) => current() && this.gather(event.data));
    recorder.addEventListener("stop", () => current() && this.recorderStops());
    recorder.addEventListener("error", () => current() && this.lost(ON_ITS_OWN));
    this.startedAt = this.env.now();
    this.stops.push(this.env.repeat(() => this.sample(), 50));
    this.go("recording", "Recording.");
  }

  sample() {
    if (this.state !== "recording") return;
    const samples = new Uint8Array(this.analyser?.fftSize ?? 0);
    this.analyser?.getByteTimeDomainData(samples);
    const level = this.analyser ? levelOf(samples) : 0.04;
    this.levels = [...this.levels.slice(1), level];
    this.paint();
  }

  /** The wave and the time, in place, so a tick doesn't rebuild the drawn squares. */
  paint() {
    const row = this.f.host.querySelector("[data-recorder]");
    if (!row) return;
    const time = row.querySelector("[data-recorder-time]");
    if (time) time.textContent = clock(this.elapsed() / 1000);
    row.querySelector("[data-recorder-wave]")?.setAttribute("d", wavePath(this.levels));
  }

  /* ── Ending ─────────────────────────────────────────────────────────────── */

  /** @param {Blob} chunk */
  gather(chunk) {
    if (this.gone || chunk.size === 0) return;
    this.chunks.push(chunk);
    this.gathered += chunk.size;
    this.largest = Math.max(this.largest, chunk.size);
    if (this.state === "recording" && nearsCap(this.gathered, this.largest, this.hooks.cap)) {
      this.end(CAPPED);
    }
  }

  /** @param {string} why what to say and keep under the field, when it wasn't Stop */
  end(why) {
    if (this.gone || this.state !== "recording") return;
    this.recordedMs = this.elapsed();
    this.why = why;
    this.release();
    this.go("finishing", why);
    const late = this.env.repeat(() => {
      late();
      void this.finish();
    }, WATCHDOG_MS);
    this.watchdog = late;
    if (this.recorderStopped) void this.finish();
  }

  /**
   * The recorder's own stop, which comes after its last chunk: asked for, or because every track
   * it recorded ended, which a browser does on its own.
   */
  recorderStops() {
    this.recorderStopped = true;
    if (this.state === "finishing") return void this.finish();
    if (this.state === "recording") this.lost(ON_ITS_OWN);
  }

  /**
   * The microphone went away, or the recorder stopped on its own: keep what it heard, or say so
   * if it heard nothing.
   *
   * @param {string} why
   */
  lost(why) {
    if (this.gone || this.state !== "recording") return;
    if (this.gathered === 0 && this.elapsed() < 1000) return this.refuse("device-lost");
    this.end(why);
  }

  /** The field was hidden, as a create form is when it's put away: keep what was heard. */
  hidden() {
    if (this.state === "recording") return this.end("");
    if (this.state === "asking") this.dispose();
  }

  /** Every chunk is in, so the file can be made; one that can't be made is said, not waited on. */
  async finish() {
    if (this.gone || this.state !== "finishing" || this.making) return;
    this.making = true;
    try {
      await this.make();
    } catch {
      this.refuse("failed");
    }
  }

  async make() {
    const reported = this.recorder?.mimeType ?? "";
    /** @type {Uint8Array} */
    let bytes = new Uint8Array(await new Blob(this.chunks, { type: reported }).arrayBuffer());
    if (this.gone) return;
    if (bytes.length === 0) return this.refuse("empty");
    const container = containerOf(bytes.subarray(0, 64), reported);
    if (!container) return this.refuse("failed");
    let seconds = this.recordedMs / 1000;
    if (container === "webm") {
      const finished = finishWebm(bytes);
      bytes = finished.bytes;
      seconds = finished.seconds ?? seconds;
    }
    const name = recordingName(this.env.date(), container);
    const file = new File([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)], name, {
      type: typeOf(container),
    });
    const stopped = this.why ? "" : `Stopped at ${clock(seconds)}. `;
    this.teardown();
    this.hooks.commit(file, `${stopped}I’m uploading it.`, this.why);
  }

  cancel() {
    if (this.gone) return;
    const asking = this.state === "asking";
    this.teardown();
    this.hooks.say(asking ? "I stopped asking for the microphone." : "I threw the recording away.");
    this.hooks.leave();
  }

  /** Stop listening: every track, the level, the recorder and the watches on them. */
  release() {
    for (const stop of this.stops.splice(0)) stop();
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    this.analyser = null;
  }

  teardown() {
    this.gone = true;
    this.watchdog?.();
    this.watchdog = null;
    this.release();
    this.env.guardLeave(this, false);
    this.unhold?.();
    this.unhold = null;
  }

  /** What the region release and a form's cancel call: everything off, and nothing said. */
  dispose() {
    if (this.gone) return;
    this.teardown();
    this.hooks.leave();
  }
}
