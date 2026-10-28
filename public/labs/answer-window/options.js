// @ts-check
/** The ten ways the lab plays a question. Each builds its own body on `open`, then takes each step and the ending. */

import {
  answerScale,
  completeRule,
  creep,
  drawRuns,
  el,
  find,
  OPENING,
  say,
  stepDone,
  stepSentence,
  wordList,
} from "./kit.js";

/**
 * @typedef {import("./scenarios.js").Scenario} Scenario
 * @typedef {object} Option
 * @property {string} id
 * @property {string} name
 * @property {string} gist
 * @property {string} does
 * @property {string} borrows
 * @property {string} watch
 * @property {string} needs
 * @property {(body: HTMLElement, s: Scenario) => void} open
 * @property {(body: HTMLElement, s: Scenario, i: number) => void} step
 * @property {(body: HTMLElement, s: Scenario) => void} end
 */

/** @param {HTMLElement} body @param {string} kind */
function voiceLine(body, kind) {
  const line = el("p", `lab-line ${kind}`);
  body.append(line);
  say(line, [OPENING]);
  return line;
}

/** @param {HTMLElement} body @param {Scenario} s @param {number} i */
function sayStep(body, s, i) {
  say(find(body, ".lab-line"), [stepSentence(s, i)]);
}

/** @param {HTMLElement} body @param {Scenario} s */
function sayAnswer(body, s) {
  const line = find(body, ".lab-line");
  line.classList.add("is-concluded");
  say(line, drawRuns(s.ending.runs), `is-answer ${answerScale(s)}`);
}

/** @param {HTMLElement} rule */
function startCreep(rule) {
  rule.style.setProperty("--lab-fill", "0%");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (rule.dataset.fill === undefined) creep(rule);
    }),
  );
}

/** @param {HTMLElement} list @param {string} text @param {string} [extra] */
function addNote(list, text, extra = "") {
  for (const item of list.children) item.setAttribute("data-state", "done");
  const item = el("li", `lab-note ${extra}`.trim(), [el("span", "lab-note__mark"), text]);
  item.setAttribute("data-state", "now");
  list.append(item);
}

/** @param {HTMLElement} list */
function settleNotes(list) {
  for (const item of list.children) item.setAttribute("data-state", "done");
}

/** @param {string} text */
function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** @type {Option[]} */
export const OPTIONS = [
  {
    id: "rising",
    name: "Rising line",
    gist: "The Blueprint’s voice line, carried over whole.",
    does: "One sentence at a time, at the build narration’s size and weight. Each step’s sentence rises into place as the last one lifts away, and the answer lands on the same line, so it reads as the last thing she says. A long answer steps down a size.",
    borrows:
      "The build narration’s .narration__line. NN/g backs a single explanatory line for waits of 2–10 seconds, and Claude’s docs describe agent progress as a status line updated at each step.",
    watch:
      "A step under a second flickers past unread. Nothing of how she looked is left once she answers.",
    needs: "Nothing. It keeps today’s contract: one utterance, replaced in place.",
    open: (body) => voiceLine(body, "lab-voice"),
    step: sayStep,
    end: sayAnswer,
  },
  {
    id: "rule",
    name: "Line over a creeping rule",
    gist: "The same line, with the Blueprint’s 2px rule creeping under it.",
    does: "The rule fills toward an end it never reaches, slowing each time she takes another step, and closes only when she answers. Then it fades. It says she is still working without claiming how far along she is.",
    borrows:
      "The build narration’s .narration__rule creep. NN/g warns that a bar racing ahead and then stalling frustrates people; this one only ever slows, and it never stands for a percentage.",
    watch:
      "Anyone looking at a filling rule assumes it measures something. A long question leaves it hovering near the end.",
    needs: "Nothing new from the server.",
    open: (body) => {
      voiceLine(body, "lab-voice");
      const rule = el("div", "lab-rule");
      body.append(rule);
      startCreep(rule);
    },
    step: (body, s, i) => {
      creep(find(body, ".lab-rule"));
      sayStep(body, s, i);
    },
    end: (body, s) => {
      const rule = find(body, ".lab-rule");
      completeRule(rule);
      rule.classList.add("is-spent");
      sayAnswer(body, s);
    },
  },
  {
    id: "pencil",
    name: "Pencil, then ink",
    gist: "Looking is written in pencil; the answer is inked.",
    does: "Each step’s sentence is set small in pencil grey under the last, and the older ones fade out. The answer arrives at the voice size in pencil and darkens to ink, the way a Blueprint part is inked once it passes its check.",
    borrows:
      "Blueprint’s pencil-to-ink states (--ink-3 to --ink). Kizilcec (CHI 2016) found a moderate amount of process kept trust best; two or three faint lines is about that.",
    watch:
      "Pencil grey at a small size has to clear contrast on --surface. A stack of steps is a log, which the window was written to avoid.",
    needs: "The window to keep the last two sayings instead of replacing each one.",
    open: (body) => {
      const stack = el("ol", "lab-pencil");
      body.append(stack);
      addNote(stack, OPENING);
    },
    step: (body, s, i) => {
      const stack = find(body, ".lab-pencil");
      const items = [...stack.children];
      for (const [age, item] of items.reverse().entries()) {
        if (age >= 1) item.classList.add("is-gone");
        if (age >= 2) setTimeout(() => item.remove(), 400);
      }
      addNote(stack, stepSentence(s, i));
    },
    end: (body, s) => {
      const stack = find(body, ".lab-pencil");
      stack.classList.add("is-lifting");
      setTimeout(() => stack.remove(), 420);
      body.append(el("p", `lab-inked ${answerScale(s)}`, drawRuns(s.ending.runs)));
    },
  },
  {
    id: "ghost",
    name: "Ghost lines",
    gist: "Faint dashed lines hold the answer’s place until she fills them.",
    does: "A small status line says each step. Under it, three dashed ghost lines in the Blueprint’s ghost stroke mark where the answer will go. When she answers, the words fade in over the ghosts as they fade out.",
    borrows:
      "NN/g’s skeleton screens for 2–10 second waits, drawn in Blueprint’s ghost stroke (--ink-3, dashed 3 3, opacity .28) instead of grey bars.",
    watch:
      "Three lines promise an answer about three lines long, and a one-line answer under them looks small. NN/g scopes skeletons to page loads.",
    needs: "Nothing.",
    open: (body) => {
      const status = el("p", "lab-line lab-status");
      const ghosts = el("div", "lab-ghosts", [
        el("span", "lab-ghost"),
        el("span", "lab-ghost"),
        el("span", "lab-ghost"),
      ]);
      body.append(el("div", "lab-ghost-area", [el("div", "lab-ghost-wait", [status, ghosts])]));
      say(status, [OPENING]);
    },
    step: sayStep,
    end: (body, s) => {
      const area = find(body, ".lab-ghost-area");
      area.classList.add("is-landed");
      area.append(el("p", `lab-landing ${answerScale(s)}`, drawRuns(s.ending.runs)));
    },
  },
  {
    id: "band",
    name: "Band with squares",
    gist: "The Blueprint band as it stands: a caps word, a square per step, a rule.",
    does: "“Looking” sits in caps over the line, with one small square added for each step she takes (the current one in sun) and the creeping rule under the sentence. When she answers, the band and rule fade where they stand, and the answer fades in on the very spot the last sentence fades out of: nothing moves.",
    borrows:
      "The build narration’s .narration__band, __stage and __dot. Perplexity reports people were more willing to wait when intermediate progress showed.",
    watch:
      "The squares count steps, which the window’s rules ban as machinery, so this needs your ruling. A build knows its stages up front; a question does not know how many steps it will take, so the squares can only grow.",
    needs: "Your ruling on the squares, and “Looking” as a new word.",
    open: (body) => {
      const rule = el("div", "lab-rule");
      const dots = el("span", "lab-dots");
      const row = el("div", "lab-band__row", [
        el("span", "caps lab-band__stage", ["Looking"]),
        dots,
      ]);
      body.append(el("div", "lab-band", [row]));
      voiceLine(body, "lab-voice");
      body.append(rule);
      startCreep(rule);
    },
    step: (body, s, i) => {
      const dots = find(body, ".lab-dots");
      for (const dot of dots.children) dot.setAttribute("data-state", "done");
      const dot = el("span", "lab-dot");
      dot.setAttribute("data-state", "now");
      dots.append(dot);
      creep(find(body, ".lab-rule"));
      sayStep(body, s, i);
    },
    end: (body, s) => {
      const band = find(body, ".lab-band");
      for (const dot of find(band, ".lab-dots").children) dot.setAttribute("data-state", "done");
      const rule = find(body, ".lab-rule");
      completeRule(rule);
      rule.classList.add("is-spent");
      band.classList.add("is-spent");
      sayAnswer(body, s);
    },
  },
  {
    id: "trail",
    name: "Answer first, quiet trail",
    gist: "The answer leads; how she looked follows in one muted sentence.",
    does: "Steps play on a quiet line. When she answers, the answer takes the voice size and a hairline drops in below it with one small sentence saying how she looked.",
    borrows:
      "Answer-first (NN/g’s inverted pyramid) and provenance on the page (Tableau Pulse, Hex, Microsoft HAX guideline 11). The trail repeats platform-owned step sentences, so it describes what ran rather than what a model says it did.",
    watch:
      "The owner withdrew a restatement of where she looked in September; this says how rather than where, but it sits close. Bansal (CHI 2021) found explanations raise acceptance whether or not the answer is right.",
    needs:
      "Past-tense versions of the six step sentences (new words), and the step kinds sent to the window, which today receives only the sentence.",
    open: (body) => voiceLine(body, "lab-quiet"),
    step: sayStep,
    end: (body, s) => {
      sayAnswer(body, s);
      if (s.steps.length === 0 || !["answer", "nothing"].includes(s.ending.kind)) return;
      const told = wordList(s.steps.map((_, i) => lowerFirst(stepDone(s, i))));
      body.append(
        el("p", "lab-trail", [el("span", "caps lab-trail__label", ["How I looked"]), ` ${told}.`]),
      );
    },
  },
  {
    id: "figure",
    name: "Big figure",
    gist: "A count or a total is set large; her sentence sits under it.",
    does: "Steps play on a quiet line. When the answer is a single figure, it lands in Fraunces at title size, with her sentence beneath it carrying the links. Any other answer lands on the voice line.",
    borrows:
      "The “big number” for a lone figure (Knaflic’s simple text), as Tableau Pulse and most dashboards set one.",
    watch:
      "The figure has to come from a step’s result, never be read out of her prose, or it reports a number no step computed. A bare number loses its unit and its month, so the sentence stays.",
    needs:
      "The platform to send the figure as its own field when a counting or totalling step produced it.",
    open: (body) => voiceLine(body, "lab-quiet"),
    step: sayStep,
    end: (body, s) => {
      const figure = s.ending.kind === "answer" ? s.ending.figure : undefined;
      if (figure === undefined) {
        sayAnswer(body, s);
        return;
      }
      const line = find(body, ".lab-line");
      line.classList.add("is-concluded");
      say(line, [
        el("span", "lab-figure__value", [figure]),
        el("span", "lab-figure__sentence", drawRuns(s.ending.runs)),
      ]);
    },
  },
  {
    id: "margin",
    name: "Margin notes",
    gist: "The steps go in a narrow margin; the answer gets the measure.",
    does: "Each step is written as a small note in a margin down the left, with a square that turns from sun to ink as the step finishes. The main column stays empty until she answers there. In a narrow window the margin keeps only the latest note, above the answer.",
    borrows:
      "Tufte’s sidenotes, and Gemini Deep Research’s plan beside its report. The notes stay readable after the answer without a press.",
    watch:
      "It keeps a log in the window. In the default 634px window the margin costs about a quarter of the measure.",
    needs: "The window to keep every saying instead of replacing each one.",
    open: (body) => {
      const margin = el("ol", "lab-margin");
      body.append(el("div", "lab-margin-grid", [margin, el("div", "lab-main")]));
      addNote(margin, OPENING);
    },
    step: (body, s, i) => addNote(find(body, ".lab-margin"), stepSentence(s, i)),
    end: (body, s) => {
      const margin = find(body, ".lab-margin");
      settleNotes(margin);
      margin.classList.add("is-settled");
      find(body, ".lab-main").append(
        el("p", `lab-landing ${answerScale(s)}`, drawRuns(s.ending.runs)),
      );
    },
  },
  {
    id: "ledger",
    name: "Ledger that folds",
    gist: "Steps list as they happen, then fold under a “How I looked” switch.",
    does: "Each step joins a short list as she takes it. When she answers, the list fades and the answer takes the voice size, with a small “How I looked” switch under it that unfolds the list again.",
    borrows:
      "Hex Threads, Claude’s thinking section and the AI SDK’s Reasoning component, which all fold the trace once the answer lands and keep it one press away.",
    watch:
      "Folded provenance is rarely opened. The switch sits under the answer, so unfolding never moves a link out from under the pointer.",
    needs: "The window to keep every saying, and “How I looked” as a new phrase.",
    open: (body) => {
      const ledger = el("ol", "lab-ledger");
      body.append(ledger);
      addNote(ledger, OPENING, "is-opening");
    },
    step: (body, s, i) => addNote(find(body, ".lab-ledger"), stepSentence(s, i)),
    end: (body, s) => {
      const ledger = find(body, ".lab-ledger");
      settleNotes(ledger);
      ledger.querySelector(".is-opening")?.remove();
      const answer = el("p", `lab-landing ${answerScale(s)}`, drawRuns(s.ending.runs));
      const toggle = el("button", "lab-fold__toggle", ["How I looked"]);
      toggle.setAttribute("type", "button");
      toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", () => {
        const open = ledger.classList.toggle("is-unfolded");
        toggle.setAttribute("aria-expanded", String(open));
      });
      ledger.classList.add("is-folded");
      if (s.steps.length === 0) {
        body.replaceChildren(answer);
        return;
      }
      body.replaceChildren(answer, toggle, ledger);
    },
  },
  {
    id: "paced",
    name: "Spoken pace",
    gist: "The answer is said at a reading pace, a word at a time.",
    does: "Steps play on the voice line. The answer arrives whole, but each word fades in a few dozen milliseconds after the last, links included, so it reads as being said. A screen reader gets the whole answer at once.",
    borrows:
      "The streamed replies of ChatGPT and Claude, applied to an answer that arrives complete. Words fade rather than slide, within NN/g’s 100–500ms per motion.",
    watch:
      "No study shows a paced reveal helps when the answer is already complete, and it costs a second or two on a long one. It can read as a gimmick.",
    needs: "Nothing.",
    open: (body) => voiceLine(body, "lab-voice"),
    step: sayStep,
    end: (body, s) => {
      const line = find(body, ".lab-line");
      line.classList.add("is-concluded");
      let order = 0;
      const words = drawRuns(s.ending.runs).flatMap((run) => {
        if (typeof run !== "string") {
          const word = el("span", "lab-word", [run]);
          word.style.setProperty("--lab-order", String(order++));
          return [word];
        }
        return run.split(/(\s+)/).map((part) => {
          if (/^\s*$/.test(part)) return part;
          const word = el("span", "lab-word", [part]);
          word.style.setProperty("--lab-order", String(order++));
          return word;
        });
      });
      say(line, words, `is-answer is-paced ${answerScale(s)}`);
    },
  },
];
