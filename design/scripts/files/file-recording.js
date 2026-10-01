// @ts-check
/**
 * How a file field records. Record turns the field's row into the recorder (`file-recorder.js`),
 * and a recording the recorder keeps is taken as a pick, so it uploads as a chosen file does. A
 * recording exists nowhere but the page until its upload lands, so one whose upload fails or is
 * stopped stays on the field, unsent, until it goes up again or is thrown away; while it does,
 * the form's save waits and the page asks before it is left.
 *
 * `file-field.js` and `file-list.js` hand in what they draw and take with, so this imports nothing
 * of either but types.
 */

import { Recorder, SETTLE_MS } from "./file-recorder.js";

/**
 * What records: a single field, or a list, whose recording joins it as one more file.
 *
 * @typedef {import("./file-parts.js").Picked} Picked
 * @typedef {{ host: HTMLElement, seeds: Map<string, number>,
 *   env: import("./recorder-env.js").RecorderEnv,
 *   hold?: import("./file-field.js").Hold, recorder: Recorder | null,
 *   unsent?: Picked | null, unholdUnsent?: () => void, refusal: string | null,
 *   notice?: string | null, quiet?: boolean, focus?: string | null, settleUntil?: number,
 *   upload?: import("./file-parts.js").InFlight | null }} Field
 * @typedef {{ render(f: Field): void, take(f: Field, picked: Picked): boolean | void,
 *   say(f: Field, text: string): void, cap(f: Field): number }} FieldApi
 */

const RECORD = "[data-file-record]";

/**
 * Keep `picked` on the field as its unsent recording, or let the one it kept go. A form closed
 * around it lets it go too, and `redraw` puts the row back.
 *
 * @param {Field} f
 * @param {Picked | null} picked
 * @param {(f: Field) => void} [redraw]
 */
export function keepUnsent(f, picked, redraw) {
  f.unsent = picked;
  f.env.guardLeave(f, picked !== null);
  f.unholdUnsent?.();
  f.unholdUnsent = undefined;
  const { hold } = f;
  if (!picked || !hold) return;
  f.unholdUnsent = hold(f.host, "unsent recording", () => {
    keepUnsent(f, null);
    redraw?.(f);
  });
}

/**
 * A moment in which the field takes no press: after a change that puts another control where the
 * pointer is, the second click of a double click would land on it.
 *
 * @param {Field} f
 */
export const settle = (f) => {
  f.settleUntil = f.env.now() + SETTLE_MS;
};

/**
 * Why a pick has to wait, if it does: a recording still being made, or one kept unsent, which a
 * drop or a paste would otherwise throw away without a word.
 *
 * @param {Field} f
 * @param {Picked} picked
 */
export function heldBack(f, picked) {
  if (f.recorder?.losesAudio()) {
    return f.recorder.state === "finishing"
      ? "I’m still finishing the recording."
      : "Stop the recording first, then add the file.";
  }
  if (f.unsent && picked !== f.unsent) return "Upload the recording again or throw it away first.";
  return null;
}

/**
 * Record was pressed: the row records, and what it keeps is taken; a microphone it can't have
 * is refused under the field, as a file would be, without turning the empty well red.
 *
 * @param {Field} f
 * @param {FieldApi} api
 */
export function record(f, api) {
  if (f.recorder || f.upload || f.unsent) return;
  const { host, hold } = f;
  const recorder = new Recorder(f, f.env, {
    cap: api.cap(f),
    redraw: (focus) => {
      f.focus = focus;
      api.render(f);
    },
    say: (text) => api.say(f, text),
    commit: (file, said, note) => {
      f.recorder = null;
      const picked = { name: file.name, type: file.type, size: file.size, file };
      keepUnsent(f, picked, api.render);
      f.notice = note || null;
      // A list answers whether the recording set off; a single field shows it in `upload`.
      const went = api.take(f, picked);
      if (went ?? f.upload) api.say(f, said);
    },
    refuse: (sentence) => {
      f.recorder = null;
      f.refusal = sentence;
      f.quiet = true;
      f.focus = RECORD;
      settle(f);
      api.render(f);
      api.say(f, sentence);
    },
    leave: () => {
      if (f.recorder !== recorder) return;
      f.recorder = null;
      f.notice = null;
      f.focus = RECORD;
      settle(f);
      api.render(f);
    },
    hold: hold && ((release) => hold(host, "voice recording", release)),
  });
  f.recorder = recorder;
  f.refusal = null;
  f.notice = null;
  void recorder.begin();
}

/**
 * @param {Field} f
 * @param {FieldApi} api
 */
export function resend(f, api) {
  if (f.unsent) api.take(f, f.unsent);
}

/**
 * @param {Field} f
 * @param {FieldApi} api
 */
export function forget(f, api) {
  keepUnsent(f, null);
  f.refusal = null;
  f.notice = null;
  f.focus = RECORD;
  settle(f);
  api.render(f);
  api.say(f, "I threw the recording away.");
}
