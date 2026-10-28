// @ts-check
/**
 * The narration of one build, drawn from the facts the build sends: the drawing of the window
 * being made, a band with the stage's odd little verb and a tiny square per stage, a rule that
 * fills toward the end, and the line being said.
 *
 * The rule, the pencil and the pace of the lines lean on how long each stage usually takes. Those
 * numbers only set the speed between facts: the rule moves to a stage's mark when that stage
 * really starts, never past the next one before it does, and holds still while something is being
 * mended; a part's pencil is drawn across its usual time and finishes when the part really does,
 * and a part being mended is drawn again across the same time. A run that ends without its window
 * ends the band too: the rule runs out, and only the squares of the stages it reached stay.
 */

import { creep, firm, freeze, loosen, prod, redraw, SETTLE_MS, settle, unghost } from "./pencil.js";
import { DRAWN_BY, drawSheet, markDrawn, nameFields, shapesOf } from "./sheet.js";
import { CHECKS, clock, listed, PARTS, READY, READY_TITLE, STAGES, say } from "./voice.js";

/** @typedef {import("./voice.js").Stage} Stage */
/** @typedef {import("./voice.js").Part} Part */
/** @typedef {import("./voice.js").Check} Check */
/**
 * @typedef {{ kind: "plan", stages: Stage[] }
 *   | { kind: "stage", stage: Stage }
 *   | { kind: "rules", part: Part, state: "writing"|"written" }
 *   | { kind: "opening", text: string }
 *   | { kind: "shape", label: string, noun: string, plural: string, fields: string[],
 *       parts: Part[] }
 *   | { kind: "part", part: Part, state: "kept"|"making"|"mending"|"made"|"checked" }
 *   | { kind: "connect", links: { field: string, target: string }[] }
 *   | { kind: "check", check: Check }
 *   | { kind: "finish", elapsedMs: number }} Fact
 */

/** How long each stage usually takes, in milliseconds, measured over local builds. */
/** @type {Record<Stage, number>} */
export const USUAL_MS = {
  listen: 3500,
  plan: 10000,
  room: 800,
  rules: 22000,
  make: 0,
  connect: 3000,
  check: 9000,
  mend: 0,
  finish: 2000,
};

/** @type {Record<Part, number>} */
export const USUAL_PART_MS = {
  card: 10500,
  add: 11500,
  open: 1800,
  change: 10500,
  remove: 1600,
  search: 19000,
};

/** How long one Action's house rules usually take; two are written at a time. */
export const USUAL_RULES_MS = 7000;

/** How long the count's line takes, drawn while the room is cleared. */
const COUNT_MS = 1200;

/** How quickly the rule runs out once the run has ended. */
const RUN_OUT_MS = 300;

/** The checks ink one part, prod the drawing, ink the next: never faster or slower than this. */
const INK_GAP_MS = { least: 260, most: 1300 };
/** How often the drawing is prodded once every part is inked and the checks run on. */
const PROD_IDLE_MS = { least: 1100, most: 1600 };

/** How small a sentence too long for its box may be set before it is left to overflow. */
const SMALLEST_LINE = 0.7;

/** How many field names, and how many pieces being mended, one sentence names before counting. */
const FIELDS_SAID = 4;
const PIECES_SAID = 3;

/** @type {Part[]} */
const ALL_PARTS = ["card", "add", "open", "change", "remove", "search"];

/** The least time a line stays up, so a burst of facts never flickers through its lines. */
const DWELL_MS = 2200;

/** How far toward the next mark the rule creeps while it waits for that stage to start. */
const CREEP = 0.92;
/** After its creep the rule keeps closing on the mark, half the gap a leg, each leg this long or more. */
const APPROACH_MS = 4000;
/** How much of its length the rule may fill before the window lands; landing fills the rest. */
const BEFORE_LANDING = 0.95;

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} className
 */
function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export class Narrator {
  /**
   * @param {HTMLElement} host where the narration is drawn; it is prepended there
   * @param {{ pace?: number }} [options] `pace` scales every usual time, for a rehearsal that
   *   tells a whole build in a fraction of one
   */
  constructor(host, { pace = 1 } = {}) {
    this.root = el("div", "narration");
    this.sheet = drawSheet();
    this.rule = el("div", "narration__rule");
    this.title = el("span", "caps narration__stage");
    this.dots = el("span", "narration__dots");
    this.dots.setAttribute("aria-hidden", "true");
    this.line = el("div", "narration__line");
    const row = el("div", "narration__row");
    row.append(this.title, this.dots);
    const band = el("div", "narration__band");
    band.append(this.rule, row, this.line);
    this.root.append(this.sheet, band);
    host.prepend(this.root);
    // A box that changes size after a sentence was fitted to it, a window resized or shown again,
    // fits the sentence again.
    this.resizing =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => this.#refit());
    this.resizing?.observe(this.line);
    this.usual = scaled(USUAL_MS, pace);
    this.usualPart = scaled(USUAL_PART_MS, pace);
    this.usualRules = USUAL_RULES_MS * pace;
    this.countMs = COUNT_MS * pace;
    this.ruleReach = BEFORE_LANDING;
    /** The stage whose name and square the band shows now. */
    /** @type {Stage | undefined} */
    this.shownStage = undefined;
    /** The last stage of the plan that the run entered. */
    /** @type {Stage} */
    this.reached = "listen";
    /** Whether the run has said its last words, after which nothing it sends is drawn. */
    this.ended = false;

    /** @type {Stage[]} */
    this.stages = [];
    /** @type {Stage} */
    this.stage = "listen";
    /** @type {Part[]} */
    this.parts = ALL_PARTS;
    /** @type {Map<Part, string>} */
    this.partState = new Map();
    /** @type {Record<string, string>} */
    this.values = {};
    this.finishedAt = 0;
    this.elapsedMs = 0;
    this.shownAt = 0;
    /** The stage whose name and square wait for its first line, so the band never disagrees. */
    /** @type {Stage | undefined} */
    this.announcing = undefined;
    /** @type {ReturnType<typeof setTimeout>[]} */
    this.timers = [];
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.fillTimer = undefined;
    /** @type {(() => void)[]} what stops each part's crawl */
    this.drawStops = [];
    /** @type {ReturnType<typeof setTimeout>[]} */
    this.checkTimers = [];
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.prodTimer = undefined;
  }

  /** @param {Fact} fact */
  take(fact) {
    if (this.ended) return;
    if (!this.root.isConnected) return this.stop();
    switch (fact.kind) {
      case "plan":
        return this.#plan(fact.stages);
      case "stage":
        return this.#enter(fact.stage);
      case "opening":
        return this.#speak(
          [fact.text, ...STAGES.plan.lines.map((line) => say(line, this.values))],
          this.usual.plan,
          true,
        );
      case "shape":
        return this.#shape(fact);
      case "rules":
        return firm(this.sheet, DRAWN_BY[fact.part], fact.state, this.usualRules);
      case "part":
        return this.#part(fact.part, fact.state);
      case "connect":
        return this.#speak(
          fact.links.map((link) => say(STAGES.connect.lines[0] ?? "", { ...this.values, ...link })),
          this.usual.connect,
          true,
        );
      case "check":
        if (fact.check === "fit") markDrawn(this.sheet, ["frame"], "inked");
        return this.#speak(CHECKS[fact.check], this.usual.check / 4);
      case "finish":
        this.elapsedMs = fact.elapsedMs;
        this.finishedAt = performance.now();
    }
  }

  /** The build is in: every part inked, the rule full, and how long it took. */
  ready() {
    if (this.ended) return;
    this.#clear();
    const drawn = [...this.parts.flatMap((part) => DRAWN_BY[part]), "frame", "count"];
    settle(this.sheet, drawn);
    for (const part of this.parts) markDrawn(this.sheet, DRAWN_BY[part], "inked");
    markDrawn(this.sheet, ["frame", "count", "labels"], "inked");
    this.ruleReach = 1;
    this.#fill(1, 1, RUN_OUT_MS);
    this.root.classList.add("is-done");
    const waited = this.elapsedMs + (this.finishedAt ? performance.now() - this.finishedAt : 0);
    this.announcing = undefined;
    this.#roll(say(READY, { time: clock(waited) }));
    this.title.textContent = READY_TITLE;
    for (const dot of this.dots.children) dot.setAttribute("data-state", "done");
  }

  /**
   * The run's own last words arrived after the drawing — an ending, or a line it sent as text —
   * and take the line's place, and the band ends with it. The drawing stops where it stood, and a
   * run that failed lets go of every piece it had not inked.
   *
   * @param {boolean} failed whether the run ended without its window
   */
  conclude(failed) {
    this.ended = true;
    this.#clear();
    freeze(this.sheet);
    this.resizing?.disconnect();
    this.root.classList.add("is-concluded");
    const nodes = Array.from(this.root.parentNode?.childNodes ?? []);
    const said = nodes.slice(nodes.indexOf(this.root) + 1);
    if (said.length > 0) this.line.replaceChildren(...said);
    this.root.classList.toggle("is-failed", failed);
    this.#endBand(failed);
    if (failed) loosen(this.sheet);
  }

  /**
   * The stage's word goes, since the ending speaks for the run, the rule runs out, and the squares
   * of stages never reached go with it. The square it stopped at stays lit when it failed there.
   *
   * @param {boolean} failed
   */
  #endBand(failed) {
    this.title.textContent = "";
    this.ruleReach = 1;
    this.#setRule(1, RUN_OUT_MS);
    const reached = this.#reachedAt();
    [...this.dots.children].forEach((dot, i) => {
      const stopped = i === reached && failed;
      dot.setAttribute("data-state", i > reached ? "gone" : stopped ? "now" : "done");
    });
  }

  /** The square of the last stage the run entered, or the first if that one was taken back. */
  #reachedAt() {
    return Math.max(0, this.stages.indexOf(this.reached));
  }

  /** The run went away without a last word: the drawing and the line stay where they stood. */
  stop() {
    this.#clear();
    this.#hold();
    freeze(this.sheet);
    this.resizing?.disconnect();
  }

  /** @param {Stage[]} stages */
  #plan(stages) {
    this.stages = stages;
    this.dots.replaceChildren(...stages.map(() => el("i", "narration__dot")));
    // A plan sent again, a promised stage taken back, keeps the square of the stage on show.
    if (this.shownStage) this.#paintDots(this.shownStage);
  }

  /** @param {Stage} stage */
  #enter(stage) {
    const wasMending = this.stage === "mend";
    this.stage = stage;
    this.announcing = stage;
    this.sheet.setAttribute("data-stage", stage);
    if (this.stages.includes(stage)) this.reached = stage;
    if (wasMending) this.#settleMended();
    this.#drawFor(stage);
    // A check's lines still waiting would be said under the mending verb, so they go.
    if (stage === "mend") {
      this.#clearLines();
      return this.#hold();
    }
    if (stage !== "make") this.#fillStage(stage);
    if (stage !== "connect") this.#speak(STAGES[stage].lines, this.usual[stage]);
  }

  /** @param {Stage} stage */
  #drawFor(stage) {
    this.#stopChecking();
    this.#finishSketching(["frame", "count"]);
    // The frame's ghost is made in this same moment, and a fade started now would cut short the
    // one it arrives with; it stays under the frame until the frame is finished instead.
    if (stage === "plan") this.#creep(["frame"], this.usual.plan, "sketching", false);
    if (stage === "room") {
      markDrawn(this.sheet, ["labels"], "sketched");
      this.#creep(["count"], this.countMs);
    }
    if (stage === "check") this.#checkInTurn();
    if (stage === "finish") markDrawn(this.sheet, ["frame", "count", "labels"], "inked");
  }

  /**
   * Draw the named parts across `ms`, stroke by stroke, their ghosts fading as they go.
   *
   * @param {readonly string[]} parts
   * @param {number} ms
   * @param {string} [state] the drawing state they are drawn in
   * @param {boolean} [fades] whether their ghosts fade as they are drawn
   */
  #creep(parts, ms, state = "sketching", fades = true) {
    this.drawStops.push(creep(this.sheet, parts, ms, fades));
    markDrawn(this.sheet, parts, state);
  }

  /**
   * The named parts finish in the state their step ends in, their ghosts going with them.
   *
   * @param {readonly string[]} parts
   * @param {string} state
   */
  #finish(parts, state) {
    settle(this.sheet, parts);
    markDrawn(this.sheet, parts, state);
    unghost(this.sheet, parts, SETTLE_MS);
  }

  /** @param {readonly string[]} parts the ones still being drawn are finished as sketched */
  #finishSketching(parts) {
    const drawing = parts.filter((part) =>
      shapesOf(this.sheet, [part]).some((node) => node.getAttribute("data-state") === "sketching"),
    );
    this.#finish(drawing, "sketched");
  }

  /** The checks go over the drawing in ink one part after another, prodding it as they go. */
  #checkInTurn() {
    const parts = this.#making();
    const share = (this.usual.check * 0.85) / Math.max(1, parts.length * 2);
    const gap = Math.min(INK_GAP_MS.most, Math.max(INK_GAP_MS.least, share));
    parts.forEach((part, i) => {
      this.checkTimers.push(setTimeout(() => this.#ink(part), 2 * i * gap));
    });
    this.#prodAfter(gap, gap, parts.length);
  }

  /** @param {Part} part */
  #ink(part) {
    if (this.partState.get(part) === "made") markDrawn(this.sheet, DRAWN_BY[part], "inking");
  }

  /**
   * @param {number} wait
   * @param {number} gap the time between one part's ink and the next
   * @param {number} left how many prods still fall between two inks
   */
  #prodAfter(wait, gap, left) {
    this.prodTimer = setTimeout(() => {
      if (!this.root.isConnected) return this.stop();
      prod(this.sheet);
      const idle = PROD_IDLE_MS.least + Math.random() * (PROD_IDLE_MS.most - PROD_IDLE_MS.least);
      this.#prodAfter(left > 1 ? 2 * gap : idle, gap, left - 1);
    }, wait);
  }

  #stopChecking() {
    for (const timer of this.checkTimers) clearTimeout(timer);
    this.checkTimers = [];
    clearTimeout(this.prodTimer);
  }

  /** @param {Extract<Fact, { kind: "shape" }>} shape */
  #shape(shape) {
    this.parts = shape.parts;
    this.values = {
      thing: shape.noun,
      things: shape.plural,
      label: shape.label,
      fields: listed(shape.fields, FIELDS_SAID),
    };
    nameFields(this.sheet, shape.fields);
    const absent = ALL_PARTS.filter((part) => !shape.parts.includes(part));
    unghost(
      this.sheet,
      absent.flatMap((part) => DRAWN_BY[part]),
      SETTLE_MS,
    );
  }

  /**
   * @param {Part} part
   * @param {"kept"|"making"|"mending"|"made"|"checked"} state
   */
  #part(part, state) {
    this.partState.set(part, state);
    const repaired = state === "mending" && this.stage === "mend";
    const redrawn = state === "making" || (state === "mending" && this.stage === "make");
    if (redrawn) this.#creep(DRAWN_BY[part], this.usualPart[part], DRAWING[state]);
    else if (repaired) this.#redraw(DRAWN_BY[part], this.usualPart[part]);
    else this.#finish(DRAWN_BY[part], DRAWING[state]);
    if (state === "making") {
      this.#fillPart(part);
      this.#speak(PARTS[part].lines, this.usualPart[part]);
    }
    if (repaired) this.#sayMending();
  }

  /** Every piece the repair is mending is named, and its lines last as long as the longest. */
  #sayMending() {
    const mending = [...this.partState].flatMap(([each, now]) => (now === "mending" ? [each] : []));
    const piece = listed(
      mending.map((each) => PARTS[each].name),
      PIECES_SAID,
    );
    this.#speak(
      STAGES.mend.lines.map((line) => say(line, { piece })),
      Math.max(...mending.map((each) => this.usualPart[each])),
      true,
    );
  }

  /**
   * @param {readonly string[]} parts
   * @param {number} ms
   */
  #redraw(parts, ms) {
    this.drawStops.push(redraw(this.sheet, parts, ms));
    markDrawn(this.sheet, parts, "mending");
  }

  /** Parts that were being mended are made again, and show as sketched until they are checked. */
  #settleMended() {
    for (const [part, state] of this.partState) {
      if (state !== "mending") continue;
      this.partState.set(part, "made");
      this.#finish(DRAWN_BY[part], "sketched");
    }
  }

  /** @param {Stage} stage */
  #paintDots(stage) {
    // A mend has no square of its own: it shows the square of the stage it is mending in.
    const now = this.stages.includes(stage) ? this.stages.indexOf(stage) : this.#reachedAt();
    [...this.dots.children].forEach((dot, i) => {
      dot.setAttribute("data-state", i < now ? "done" : i === now ? "now" : "");
    });
  }

  /* ── The rule ─────────────────────────────────────────────────────────── */

  /** @param {Stage} stage */
  #weight(stage) {
    if (stage !== "make") return this.usual[stage];
    return this.#making().reduce((sum, part) => sum + this.usualPart[part], 0);
  }

  /** The parts this build makes, as against the ones it keeps. */
  #making() {
    return this.parts.filter((part) => this.partState.get(part) !== "kept");
  }

  #total() {
    return this.stages.reduce((sum, stage) => sum + this.#weight(stage), 0) || 1;
  }

  /** @param {Stage} stage */
  #markOf(stage) {
    const i = this.stages.indexOf(stage);
    return this.stages.slice(0, Math.max(0, i)).reduce((sum, each) => sum + this.#weight(each), 0);
  }

  /** @param {Stage} stage */
  #fillStage(stage) {
    if (!this.stages.includes(stage)) return;
    const from = this.#markOf(stage);
    const usual = this.#weight(stage);
    this.#fill(from / this.#total(), (from + usual) / this.#total(), usual);
  }

  /** @param {Part} part */
  #fillPart(part) {
    if (this.stages.length === 0) return;
    const before = this.#making()
      .slice(0, this.#making().indexOf(part))
      .reduce((sum, each) => sum + this.usualPart[each], 0);
    const from = this.#markOf("make") + before;
    const usual = this.usualPart[part];
    this.#fill(from / this.#total(), (from + usual) / this.#total(), usual);
  }

  /**
   * Move to `from` now, then creep toward `to` over `ms`, stopping short of it. Never backwards.
   *
   * @param {number} from
   * @param {number} to
   * @param {number} ms
   */
  #fill(from, to, ms) {
    clearTimeout(this.fillTimer);
    const start = Math.max(from, this.#shown());
    this.#setRule(start, 300);
    const mark = Math.max(start, to);
    const toward = start + (mark - start) * CREEP;
    this.fillTimer = setTimeout(() => {
      this.#setRule(toward, ms);
      this.#approach(toward, mark, ms);
    }, 320);
  }

  /**
   * Keep closing on `mark` once the creep toward it is done, half the gap a leg, so a stage that
   * runs long still moves the rule, and never past the mark before that stage really ends.
   *
   * @param {number} at
   * @param {number} mark
   * @param {number} wait until the leg before this one is done
   */
  #approach(at, mark, wait) {
    if (mark - at < 0.001 || !this.root.isConnected) return;
    const leg = Math.max(wait, APPROACH_MS);
    this.fillTimer = setTimeout(() => {
      const next = at + (mark - at) / 2;
      this.#setRule(next, leg);
      this.#approach(next, mark, leg);
    }, wait);
  }

  /** Stop the rule where it stands. */
  #hold() {
    clearTimeout(this.fillTimer);
    this.#setRule(this.#shown(), 0);
  }

  /** How far the rule is drawn right now, mid-transition included. */
  #shown() {
    const drawn = Number.parseFloat(getComputedStyle(this.rule).backgroundSize) / 100 || 0;
    return drawn / this.ruleReach;
  }

  /**
   * @param {number} share
   * @param {number} ms
   */
  #setRule(share, ms) {
    this.rule.style.setProperty("--narration-eta", `${Math.round(ms)}ms`);
    const drawn = Math.min(1, share) * this.ruleReach;
    this.rule.style.setProperty("--narration-fill", `${(drawn * 100).toFixed(2)}%`);
  }

  /* ── The line ─────────────────────────────────────────────────────────── */

  /**
   * Say these lines one after another across `ms`, each for at least {@link DWELL_MS}. Anything
   * still waiting to be said from before is dropped: it described work that is over.
   *
   * @param {readonly string[]} lines
   * @param {number} ms
   * @param {boolean} [filled] whether the holes are already filled
   */
  #speak(lines, ms, filled = false) {
    this.#clearLines();
    const gap = Math.max(DWELL_MS, ms / Math.max(1, lines.length));
    const due = Math.max(0, DWELL_MS - (performance.now() - this.shownAt));
    lines.forEach((line, i) => {
      const text = filled ? line : say(line, this.values);
      this.timers.push(setTimeout(() => this.#roll(text), due + i * gap));
    });
  }

  /** @param {string} text */
  #roll(text) {
    if (!this.root.isConnected) return this.stop();
    for (const old of this.line.querySelectorAll(".narration__said")) {
      if (old.classList.contains("is-leaving")) continue;
      old.classList.add("is-leaving");
      old.setAttribute("aria-hidden", "true");
      setTimeout(() => old.remove(), 400);
    }
    const said = el("span", "narration__said");
    said.textContent = text;
    this.line.append(said);
    this.#fit(said);
    this.#keepInView();
    this.shownAt = performance.now();
    this.#announce();
  }

  /** The stage's name and its square change with its first line, never before it. */
  #announce() {
    if (!this.announcing) return;
    this.title.textContent = STAGES[this.announcing].title;
    this.root.classList.toggle("is-mending", this.announcing === "mend");
    this.#paintDots(this.announcing);
    this.shownStage = this.announcing;
    this.announcing = undefined;
  }

  /**
   * A sentence too long for the line's box is set a little smaller, so the box never grows.
   *
   * @param {HTMLElement} said
   */
  #fit(said) {
    said.style.fontSize = "";
    const { paddingTop, paddingBottom } = getComputedStyle(this.line);
    const padding = (Number.parseFloat(paddingTop) || 0) + (Number.parseFloat(paddingBottom) || 0);
    const room = this.line.clientHeight - padding;
    let size = Number.parseFloat(getComputedStyle(said).fontSize);
    const least = size * SMALLEST_LINE;
    while (said.offsetHeight > room + 1 && size > least) {
      size *= 0.94;
      said.style.fontSize = `${size.toFixed(2)}px`;
    }
  }

  /**
   * A window too short for the whole band scrolls the region under it; that scroller shows the
   * line being said rather than the control below it. Anywhere with room nothing moves.
   */
  #keepInView() {
    for (let box = this.root.parentElement; box; box = box.parentElement) {
      const { overflowY } = getComputedStyle(box);
      if (overflowY !== "auto" && overflowY !== "scroll") continue;
      const over = this.line.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
      if (over > 0) box.scrollTop += over;
      return;
    }
  }

  /** The sentence being said, fitted again to the box it is in now. */
  #refit() {
    const said = [...this.line.querySelectorAll(".narration__said")].filter(
      (node) => !node.classList.contains("is-leaving"),
    );
    const last = said.at(-1);
    if (last instanceof HTMLElement) this.#fit(last);
  }

  #clearLines() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  #clear() {
    this.#clearLines();
    clearTimeout(this.fillTimer);
    this.#stopChecking();
    for (const stop of this.drawStops) stop();
    this.drawStops = [];
  }
}

/** How a part's lines are drawn in each state of its making. */
/** @type {Record<"kept"|"making"|"mending"|"made"|"checked", string>} */
const DRAWING = {
  kept: "inked",
  making: "sketching",
  mending: "mending",
  made: "sketched",
  checked: "inked",
};

/**
 * @template {string} K
 * @param {Record<K, number>} table
 * @param {number} pace
 * @returns {Record<K, number>}
 */
function scaled(table, pace) {
  return /** @type {Record<K, number>} */ (
    Object.fromEntries(Object.entries(table).map(([key, ms]) => [key, Number(ms) * pace]))
  );
}
