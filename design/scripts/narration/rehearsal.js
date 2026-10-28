// @ts-check
/**
 * A build on a timer, for the design pages: the facts a real build sends, in its order, each step
 * taking its usual time at {@link REHEARSAL_PACE}, about twenty seconds in all. The narrator that
 * tells it is given the same pace, so its pencil is drawn as it would be at full length. In the
 * product the facts arrive over SSE, as the build really reaches each stage. `dev` names the
 * developer-panel stage filed at the same moment.
 */

import { USUAL_MS, USUAL_PART_MS, USUAL_RULES_MS } from "./narrator.js";

/** @typedef {import("./narrator.js").Fact} Fact */
/** @typedef {import("./voice.js").Part} Part */
/** @typedef {import("./voice.js").Check} Check */
/** @typedef {{ at: number, fact?: Fact, dev?: string, landed?: true, failed?: true }} Beat */
/** @typedef {"lands" | "mends" | "fizzles"} Ending */

/** @type {Part[]} */
const PARTS = ["card", "add", "open", "change", "remove", "search"];
/** @type {Check[]} */
const CHECKS = ["fit", "try", "look", "rules"];
/** The part a rehearsed repair mends. */
/** @type {Part} */
const MENDED = "search";

/** How much of a real build's time the rehearsal takes. */
export const REHEARSAL_PACE = 0.2;

/** @param {number} ms a real build's usual time */
const paced = (ms) => Math.round(ms * REHEARSAL_PACE);

/**
 * @param {{ label: string, noun: string, plural: string, fields: string[] }} subject
 * @param {Ending} [ending] whether the checks pass it, mend it first, or mend it and still fail it
 * @returns {Beat[]}
 */
export function rehearsal(subject, ending = "lands") {
  /** @type {Beat[]} */
  const beats = [];
  let at = 0;
  /**
   * @param {Fact} fact
   * @param {number} [wait] how long until the next beat
   * @param {string} [dev]
   */
  const beat = (fact, wait = 0, dev = undefined) => {
    beats.push({ at, fact, ...(dev ? { dev } : {}) });
    at += wait;
  };

  beat({ kind: "plan", stages: ["listen", "plan", "room", "rules", "make", "check", "finish"] });
  beat({ kind: "stage", stage: "plan" }, 0, "metrics");
  const opening = `I’ll make a place for your ${subject.plural}.`;
  beat({ kind: "opening", text: opening }, paced(USUAL_MS.plan), "spec");
  beat({ kind: "shape", ...subject, parts: PARTS }, 0, "candidate");
  beat({ kind: "stage", stage: "room" }, paced(USUAL_MS.room), "migration");
  beat({ kind: "stage", stage: "rules" }, 0, "behavioral-tests");
  // The house rules are written two Actions at a time; the card is no Action and has none.
  const ruled = PARTS.filter((part) => part !== "card");
  for (let i = 0; i < ruled.length; i += 2) {
    const pair = ruled.slice(i, i + 2);
    pair.forEach((part, j) => {
      beat(
        { kind: "rules", part, state: "writing" },
        j === pair.length - 1 ? paced(USUAL_RULES_MS) : 0,
      );
    });
    for (const part of pair) beat({ kind: "rules", part, state: "written" });
  }
  beat({ kind: "stage", stage: "make" }, 0, "units");
  for (const part of PARTS) {
    beat({ kind: "part", part, state: "making" }, paced(USUAL_PART_MS[part]));
    beat({ kind: "part", part, state: "made" });
  }
  beat({ kind: "stage", stage: "check" }, 0, "gate");
  for (const check of CHECKS) beat({ kind: "check", check }, paced(USUAL_MS.check) / CHECKS.length);
  if (ending !== "lands") {
    beat({ kind: "stage", stage: "mend" });
    beat({ kind: "part", part: MENDED, state: "mending" }, paced(USUAL_PART_MS[MENDED]));
    beat({ kind: "stage", stage: "check" });
    beat({ kind: "check", check: "rules" }, paced(USUAL_MS.check) / 2);
  }
  if (ending === "fizzles") {
    beats.push({ at, failed: true });
    return beats;
  }
  for (const part of PARTS) beat({ kind: "part", part, state: "checked" });
  beat({ kind: "stage", stage: "finish" }, 0, "commit");
  beat({ kind: "finish", elapsedMs: at }, paced(USUAL_MS.finish));
  beats.push({ at, landed: true });
  return beats;
}
