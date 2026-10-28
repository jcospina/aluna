// @ts-check
/**
 * The two runs the deck walks through, as the facts a real build sends: the first build of the
 * Finance tracker and the evolution that adds its Type field. Each run is cut into cues, one per
 * stage the deck stops on, and each beat waits as long as that step usually takes at {@link PACE}.
 */

import {
  USUAL_MS,
  USUAL_PART_MS,
  USUAL_RULES_MS,
} from "../../design/scripts/narration/narrator.js";

/** @typedef {import("../../design/scripts/narration/narrator.js").Fact} Fact */
/** @typedef {import("../../design/scripts/narration/voice.js").Part} Part */
/** @typedef {import("../../design/scripts/narration/voice.js").Stage} Stage */
/** @typedef {{ at: number, fact?: Fact, ready?: true }} Beat */
/** @typedef {Beat[]} Cue */

/** How much of a real build's time a stage takes on its slide. */
export const PACE = 0.25;

export const LABEL = "Finance tracker";

/** @type {Stage[]} */
const STAGES = ["listen", "plan", "room", "rules", "make", "check", "finish"];
/** @type {Part[]} */
const PARTS = ["card", "add", "open", "change", "remove", "search"];

/** @param {number} ms a real build's usual time */
const paced = (ms) => Math.round(ms * PACE);

function timeline() {
  /** @type {Beat[]} */
  const beats = [];
  let at = 0;
  return {
    beats,
    /** @param {Fact} fact @param {number} [wait] how long until the next beat */
    beat(fact, wait = 0) {
      beats.push({ at, fact });
      at += wait;
    },
    ready() {
      beats.push({ at, ready: true });
    },
  };
}

/** @param {string} text the Resolver's own words for the request */
function scheming(text) {
  const t = timeline();
  t.beat({ kind: "plan", stages: STAGES });
  t.beat({ kind: "stage", stage: "plan" });
  t.beat({ kind: "opening", text }, paced(USUAL_MS.plan));
  return t.beats;
}

/** @param {string[]} fields */
const shape = (fields) =>
  /** @type {Fact} */ ({
    kind: "shape",
    label: LABEL,
    noun: "transaction",
    plural: "transactions",
    fields,
    parts: PARTS,
  });

/**
 * The house rules, two Actions at a time; the card is no Action and has none.
 *
 * @param {ReturnType<typeof timeline>} t
 * @param {Part[]} parts
 */
function writeRules(t, parts) {
  for (let i = 0; i < parts.length; i += 2) {
    const pair = parts.slice(i, i + 2);
    pair.forEach((part, j) => {
      t.beat(
        { kind: "rules", part, state: "writing" },
        j === pair.length - 1 ? paced(USUAL_RULES_MS) : 0,
      );
    });
    for (const part of pair) t.beat({ kind: "rules", part, state: "written" });
  }
}

/**
 * @param {ReturnType<typeof timeline>} t
 * @param {Part[]} parts
 */
function makeParts(t, parts) {
  t.beat({ kind: "stage", stage: "make" });
  for (const part of parts) {
    t.beat({ kind: "part", part, state: "making" }, paced(USUAL_PART_MS[part]));
    t.beat({ kind: "part", part, state: "made" });
  }
}

/** @param {ReturnType<typeof timeline>} t */
function prod(t) {
  t.beat({ kind: "stage", stage: "check" });
  for (const check of /** @type {const} */ (["fit", "try", "look", "rules"])) {
    t.beat({ kind: "check", check }, paced(USUAL_MS.check) / 4);
  }
}

/** @param {number} elapsedMs */
function polishing(elapsedMs) {
  const t = timeline();
  for (const part of PARTS) t.beat({ kind: "part", part, state: "checked" });
  t.beat({ kind: "stage", stage: "finish" });
  t.beat({ kind: "finish", elapsedMs });
  return t.beats;
}

/**
 * The window lands. The finish is said again first, so the time it reports is the build's and not
 * however long the slide before it stayed up.
 *
 * @param {number} elapsedMs
 */
function landing(elapsedMs) {
  const t = timeline();
  t.beat({ kind: "finish", elapsedMs });
  t.ready();
  return t.beats;
}

const FIRST_FIELDS = ["Date", "Description", "Amount", "Category"];
const FIRST_MS = 118_000;
const EVOLUTION_MS = 74_000;

/** @returns {Cue[]} */
function firstBuild() {
  const room = timeline();
  room.beat(shape(FIRST_FIELDS));
  room.beat({ kind: "stage", stage: "room" }, paced(USUAL_MS.room));

  const rules = timeline();
  rules.beat({ kind: "stage", stage: "rules" });
  writeRules(rules, ["add", "open", "change", "remove", "search"]);

  const make = timeline();
  makeParts(make, PARTS);

  const check = timeline();
  prod(check);

  const mend = timeline();
  mend.beat({ kind: "stage", stage: "mend" });
  mend.beat({ kind: "part", part: "search", state: "mending" }, paced(USUAL_PART_MS.search));
  // The repaired Handler goes back through the checks, which say nothing new until it clears.
  mend.beat({ kind: "stage", stage: "check" });

  return [
    scheming("I’ll make a place to track your finances."),
    room.beats,
    rules.beats,
    make.beats,
    check.beats,
    mend.beats,
    polishing(FIRST_MS),
    landing(FIRST_MS),
  ];
}

/**
 * The evolution keeps the parts its change leaves alone, drawn finished from the start, and their
 * house rules carried over as written.
 *
 * @returns {Cue[]}
 */
function evolution() {
  /** @type {Part[]} */
  const kept = ["open", "remove"];
  const made = PARTS.filter((part) => !kept.includes(part));

  const assembly = timeline();
  assembly.beat(shape([...FIRST_FIELDS, "Type"]));
  assembly.beat({ kind: "stage", stage: "room" });
  for (const part of kept) assembly.beat({ kind: "part", part, state: "kept" });
  assembly.beat({ kind: "stage", stage: "rules" });
  for (const part of kept) assembly.beat({ kind: "rules", part, state: "written" });
  writeRules(
    assembly,
    made.filter((part) => part !== "card"),
  );
  makeParts(assembly, made);
  prod(assembly);

  return [
    scheming("I’ll let you mark each transaction as income or an expense."),
    assembly.beats,
    polishing(EVOLUTION_MS),
    landing(EVOLUTION_MS),
  ];
}

/** @type {Record<"first" | "evolution", Cue[]>} */
export const RUNS = { first: firstBuild(), evolution: evolution() };
