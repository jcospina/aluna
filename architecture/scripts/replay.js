// @ts-check
/**
 * Plays one run's cues into the design system's narrator. Moving on to the next cue plays it
 * over what is already drawn; any other move starts a fresh narrator, hands it every fact before
 * the cue at once, so the drawing settles where that stage begins, and plays the cue from there.
 */

import { Narrator } from "../../design/scripts/narration/narrator.js";
import { PACE } from "./build.js";

/** @typedef {import("./build.js").Cue} Cue */
/** @typedef {import("./build.js").Beat} Beat */

export class Replay {
  /** @param {(landed: Narrator) => void} onLanded what happens once a run's window has landed */
  constructor(onLanded) {
    this.onLanded = onLanded;
    /** @type {Narrator | null} */
    this.narrator = null;
    /** @type {Cue[] | null} */
    this.run = null;
    this.at = -1;
    /** @type {{ beat: Beat, timer: ReturnType<typeof setTimeout> }[]} */
    this.pending = [];
  }

  /**
   * @param {HTMLElement} host where the narration is drawn
   * @param {Cue[]} run
   * @param {number} cue
   */
  show(host, run, cue) {
    if (this.run === run && this.at === cue && this.narrator?.root.parentElement === host) return;
    const follows = this.run === run && this.at === cue - 1 && this.narrator?.root.isConnected;
    if (follows) this.#flush();
    else this.#restart(host, run, cue);
    this.at = cue;
    for (const beat of run[cue] ?? []) {
      const entry = { beat, timer: setTimeout(() => this.#play(entry), beat.at) };
      this.pending.push(entry);
    }
  }

  stop() {
    this.#cancel();
    this.narrator?.stop();
    this.narrator?.root.remove();
    this.narrator = null;
    this.run = null;
    this.at = -1;
  }

  /**
   * @param {HTMLElement} host
   * @param {Cue[]} run
   * @param {number} cue
   */
  #restart(host, run, cue) {
    this.stop();
    host.replaceChildren();
    const narrator = new Narrator(host, { pace: PACE });
    this.narrator = narrator;
    this.run = run;
    for (const beat of run.slice(0, cue).flat()) this.#apply(beat);
  }

  /** The cue still playing finishes at once, so the next one starts where it ends. */
  #flush() {
    const left = this.pending;
    this.#cancel();
    for (const { beat } of left) this.#apply(beat);
  }

  #cancel() {
    for (const { timer } of this.pending) clearTimeout(timer);
    this.pending = [];
  }

  /** @param {{ beat: Beat }} entry */
  #play(entry) {
    this.pending = this.pending.filter((each) => each !== entry);
    this.#apply(entry.beat);
  }

  /** @param {Beat} beat */
  #apply(beat) {
    const { narrator } = this;
    if (!narrator) return;
    if (beat.fact) narrator.take(beat.fact);
    if (!beat.ready) return;
    narrator.ready();
    this.onLanded(narrator);
  }
}
