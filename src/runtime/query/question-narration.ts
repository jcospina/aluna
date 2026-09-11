// Everything Aluna says while she is reading, and every ending but the answer's (PLAN
// decisions 14, 15, 17 and 20; ADR-0001).
//
// The model picks the kind of step from a closed set; the words are the platform's, and this
// file is the only place they exist — nothing copies them, the suite included. So she cannot
// report a number she has not computed. What the model does still choose is which kind of step
// it says it is taking: nothing cross-checks a label against the statement, so a mislabelled
// read says a true sentence about the wrong thing.
//
// Never machinery (decision 15): no SQL, table, column, error string, step count or
// percentage. A failed step says what a working one says, because the label is what she set
// out to do; a statement too large to carry keeps no call, so it falls back like any other
// step with no label to read.
//
// The gap is the one sentence with a word of the model's inside it, and the word is narrowed
// here to a run this person wrote. `question-no-home.ts` runs the call that offers one.

import type { QuestionEnding, QuestionLoopResult } from "./question-loop.ts";
import {
  QUESTION_STEP_FALLBACK_LABEL,
  type QuestionStepLabel,
  type QuestionToolCall,
} from "./question-tool.ts";
import type { QuestionStep } from "./question-turn.ts";

/**
 * One sentence per kind of step: each stands alone, carries no number, and claims nothing about
 * the data until the rows are back (decision 17). `default` makes a seventh kind a type error.
 */
export function questionLabelNarration(label: QuestionStepLabel): string {
  switch (label) {
    case "naming":
      return "I'm seeing how you named things.";
    case "counting":
      return "I'm counting how many you have.";
    case "totalling":
      return "I'm adding everything up.";
    case "listing":
      return "I'm looking for the ones you asked about.";
    case "dates":
      return "I'm checking when things happened.";
    case "other":
      return "I'm having a look at what you've saved.";
    default: {
      const unreachable: never = label;
      throw new Error(`no sentence is written for ${String(unreachable)}`);
    }
  }
}

/**
 * What Aluna says about one step, read off the label and nothing else — not the statement, not
 * the bound values, which is what stops a person's own saved data becoming her words.
 */
export function questionStepNarration(call: QuestionToolCall | null): string {
  return questionLabelNarration(call?.label ?? QUESTION_STEP_FALLBACK_LABEL);
}

/**
 * The sentence when she ran out of reads. It claims only that she stopped: a question whose every
 * decision was unreadable spends ten reads and runs no statement.
 */
export const QUESTION_BUDGET_SPENT_SENTENCE =
  "I couldn't work this one out. Want to try asking a different way?";

/** How she finishes a sentence about a search that matched nothing (decision 17). *Matching that*
 * because a collection she read is named just before it, and *nothing* alone would read as a
 * claim that the collection is empty — which is the claim about this person she may not make. */
export const QUESTION_NOTHING_FOUND = "I couldn't find anything matching that.";

/** What she says when nothing matched and no statement of hers ever opened a collection. */
export const QUESTION_NOTHING_FOUND_ANYWHERE = "I couldn't find anything to answer that with.";

/**
 * The third ending: the question stopped before it could finish. A faulted generation, a read
 * gate closing under a deletion, a context window overrun and an answer that came back unreadable
 * all arrive here (6.3/02, 6.4/02). She claims only that she did not finish — a deletion closing
 * a gate is the platform working, not a fault — and asks for the question again rather than for
 * different words, because nothing about the words was wrong.
 */
export const QUESTION_COULD_NOT_FINISH =
  "I couldn't finish looking at that one. Mind asking me again?";

/**
 * What she says when no statement of hers came back at all — every one failed or was refused.
 * She did not search, so she may not report a search: this claims only that she got nowhere.
 */
export const QUESTION_NOTHING_WORKED =
  "I couldn't get anywhere with that one. Want to try asking a different way?";

/** Every one of these, in the order first seen. */
function inOrder(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** A list as a sentence says one: *Expenses*, *Expenses and Notes*, *Expenses, Notes and Trips*. */
function wordList(words: readonly string[]): string {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * What she says when a question searched and matched nothing (decision 17). She names what she
 * read and then says she could not find it — a claim about her search, written here rather than
 * generated so there is no sentence for a model to put *you spent nothing on groceries* into.
 * What she narrowed to is left out: those are bound values of the model's, and its free text
 * inside a sentence the platform vouches for is the thing this ending exists to prevent.
 */
export function questionNothingFoundSentence(steps: readonly QuestionStep[]): string {
  const read = steps.filter((step) => step.result.outcome === "rows");
  const collections = inOrder(read.flatMap((step) => step.collections));
  if (collections.length === 0) return QUESTION_NOTHING_FOUND_ANYWHERE;
  return `Looking at your ${wordList(collections)}, ${QUESTION_NOTHING_FOUND}`;
}

/** The gap sentence around whatever it names (decision 20). No control comes with it and none
 * may: an offer with a yes is a proposal, and Module 8 owns that surface. */
function noHomeSentence(subject: string): string {
  return `You don't have anywhere for ${subject} yet — you can ask me to make one.`;
}

/**
 * What she says when the words she was handed were not this person's own, and what a naming call
 * that came back unreadable falls back to. Naming nothing is the honest end of the same sentence.
 */
export const QUESTION_NO_HOME_FOR_THAT = noHomeSentence("that");

/** The gap, naming the subject when the narrowing below gave one back and nothing when it did not. */
export function questionNoHomeSentence(named: string | null): string {
  return named === null ? QUESTION_NO_HOME_FOR_THAT : noHomeSentence(named);
}

/** A word as a person writes one. Its marks stay on it, so *café* is one word in either normal
 * form rather than four, and the apostrophes inside *don't* keep that whole too. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu;

/** How many of their words a subject may be. Decision 20's own runs to two, and past a handful
 * the model has handed back the question rather than the thing it is about. */
const MOST_SUBJECT_WORDS = 6;

interface WordWritten {
  readonly written: string;
  readonly word: string;
}

function wordsOf(text: string): readonly WordWritten[] {
  return [...text.matchAll(WORD)].map((match) => ({
    written: match[0],
    word: match[0].toLowerCase(),
  }));
}

/**
 * The subject as this person wrote it, or `null` when they did not write it. One unbroken run of
 * their own words, so a phrase assembled out of words they used apart is not one of theirs. Their
 * words, though, and not the stretch of question between them: what stands between two of their
 * words is whatever they typed there, and this sentence carries their characters and ours alone.
 */
export function questionSubjectInTheirWords(question: string, subject: string): string | null {
  const asked = wordsOf(question);
  const named = wordsOf(subject);
  if (named.length === 0 || named.length > MOST_SUBJECT_WORDS) return null;
  for (let from = 0; from + named.length <= asked.length; from += 1) {
    const run = asked.slice(from, from + named.length);
    if (named.every((word, index) => run[index]?.word === word.word)) {
      return run.map((written) => written.written).join(" ");
    }
  }
  return null;
}

/**
 * The one sentence a finished question ends on, whichever ending it reached. A spent budget has
 * no answer to carry — deliberately, so nothing downstream can render half a computation as a
 * finding — so the platform's own sentence stands in its place (6.5/03).
 */
export function questionResultSentence(result: QuestionLoopResult): string {
  return result.ending === "budget_spent" ? QUESTION_BUDGET_SPENT_SENTENCE : result.answer;
}

/**
 * What the platform says about an ending. `answered` is `null` on purpose: the words for what
 * she *found* are the answer's, in `question-answer.ts`, written from the steps.
 */
export function questionEndingNarration(ending: QuestionEnding): string | null {
  switch (ending) {
    case "answered":
      return null;
    // Null for the reason `answered` is, and not because there are no words: the ones for these
    // three ride on the result, out of the three sentence writers above.
    case "nothing_found":
    case "nothing_worked":
    case "no_home":
      return null;
    case "budget_spent":
      return QUESTION_BUDGET_SPENT_SENTENCE;
    default: {
      const unreachable: never = ending;
      throw new Error(`no sentence is written for ${String(unreachable)}`);
    }
  }
}
