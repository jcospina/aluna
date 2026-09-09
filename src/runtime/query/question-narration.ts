// Everything Aluna says while she is reading (PLAN decisions 14, 15 and 17; ADR-0001).
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

import type { QuestionEnding } from "./question-loop.ts";
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

/**
 * What the platform says about an ending. `answered` is `null` on purpose: the words for what
 * she *found* are the answer's, in `question-answer.ts`, written from the steps.
 */
export function questionEndingNarration(ending: QuestionEnding): string | null {
  switch (ending) {
    case "answered":
      return null;
    // Null for the reason `answered` is, and not because there are no words: the ones for these
    // two ride on the result, out of `questionNothingFoundSentence` and the constant above it.
    case "nothing_found":
    case "nothing_worked":
      return null;
    case "budget_spent":
      return QUESTION_BUDGET_SPENT_SENTENCE;
    default: {
      const unreachable: never = ending;
      throw new Error(`no sentence is written for ${String(unreachable)}`);
    }
  }
}
