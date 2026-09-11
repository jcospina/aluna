// One fake provider that can carry a whole question through the real routes (6.5/03).
//
// Every stage is told apart by the prompt it builds rather than by call order, the way
// `question.test-support.ts` does it for the loop's own suites. That is what lets a build run
// through the same app without either of them consuming the other's answers — which is the only
// way to prove a build narrates in the window while a question speaks in the answer window.
//
// Not a test file (no `*.test.ts`), so bun never runs it.

import type { ZodType } from "zod";
import {
  INTENT_RESOLVER_PROMPT_PREFIX,
  type IntentClassification,
} from "../../../pipeline/intent/index.ts";
import type { DeepPartial, GenerateResult, Provider } from "../../../platform/provider/index.ts";
import {
  QUESTION_ANSWER_PROMPT_PREFIX,
  QUESTION_NO_HOME_PROMPT_PREFIX,
  QUESTION_TURN_PROMPT_PREFIX,
  READ_ONLY_QUERY_TOOL,
} from "../../../runtime/query/index.ts";

/** One statement a fake model asks for, in the shape a turn's decision carries it. */
export interface StagedQuestionRead {
  readonly sql: string;
  readonly label: string;
  readonly parameters?: readonly string[];
}

export interface StagedQuestionInput {
  readonly intent?: IntentClassification;
  /** The sentence `intent` classifies. Every other sentence goes to the fallback's own queue. */
  readonly asking?: string;
  /** The statements it asks for, in order. It answers once they are done. */
  readonly reads: readonly StagedQuestionRead[];
  /** The one sentence it says once the reading is done. */
  readonly answer: { readonly answer: string };
  /** What answers everything that is not a question: a build's own stages, usually. */
  readonly fallback?: Provider;
  /** Thrown from the answer generation, so a caller can reach the question's third ending. */
  readonly faultTheAnswer?: Error;
  /**
   * The subject it names instead of answering, which is 6.4/05's gap ending. The turn refuses the
   * decision until a statement has opened a collection, so `reads` still carries one.
   */
  readonly gap?: string;
  /** Start the run of statements over instead of answering, so a question spends its ten reads. */
  readonly neverStops?: boolean;
}

/** One staged answer, in the three shapes `Provider.generate` hands back. */
function stagedGeneration<T>(answer: unknown, schema: ZodType<T>): GenerateResult<T> {
  const object = (async () => schema.parse(answer))();
  object.catch(() => {});
  return {
    partialStream: (async function* () {
      yield answer as DeepPartial<T>;
    })(),
    object,
    usage: Promise.resolve({
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    }),
  };
}

/**
 * One fake provider that can carry a whole question: the classification, each turn's decision,
 * and the answer.
 */
export function makeQuestionProvider(input: StagedQuestionInput): {
  provider: Provider;
  questionsAsked: () => number;
} {
  // Checked here rather than left to the recursion below, where an empty `reads` would spend the
  // suite's stack instead of failing: a fixture mistake must read as one.
  if (input.neverStops && input.reads.length === 0) {
    throw new Error("a model that never stops reading needs a statement to ask for again");
  }
  let asked = 0;
  let taken = 0;

  /** The next statement it wants, or the decision to stop reading. */
  function decide(): unknown {
    const read = input.reads[taken];
    // Reset where the reading ends rather than where the answer is written: a question the
    // platform answers itself (nothing matched, nothing worked) never reaches that generation.
    if (!read) {
      taken = 0;
      // A model that never converges asks for the same statements again, which spends the budget.
      if (input.neverStops) return decide();
      return { next: input.gap === undefined ? "answer" : "no_home", read: null };
    }
    taken += 1;
    return { next: "read", read: { tool: READ_ONLY_QUERY_TOOL, parameters: [], ...read } };
  }

  /** Every question opens its own run of statements, so the same one asked twice reads twice. */
  function turn(): unknown {
    if (taken === 0) asked += 1;
    return decide();
  }

  function answer(): unknown {
    if (input.faultTheAnswer) throw input.faultTheAnswer;
    return input.answer;
  }

  /** The classification, when this is the sentence it was staged for. */
  function classification(prompt: string): unknown {
    if (!input.intent) return undefined;
    return input.asking === undefined || prompt.includes(input.asking) ? input.intent : undefined;
  }

  /** What this prompt is asking for, or nothing when it belongs to the fallback. */
  function staged(prompt: string): unknown {
    if (prompt.startsWith(QUESTION_TURN_PROMPT_PREFIX)) return turn();
    if (prompt.startsWith(QUESTION_ANSWER_PROMPT_PREFIX)) return answer();
    if (prompt.startsWith(QUESTION_NO_HOME_PROMPT_PREFIX) && input.gap !== undefined) {
      return { subject: input.gap };
    }
    if (prompt.startsWith(INTENT_RESOLVER_PROMPT_PREFIX)) return classification(prompt);
    return undefined;
  }

  const provider: Provider = {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      const staging = staged(prompt);
      if (staging !== undefined) return stagedGeneration(staging, schema);
      if (!input.fallback) throw new Error(`No staged answer for: ${prompt.slice(0, 60)}`);
      return input.fallback.generate(prompt, schema);
    },
  };
  return { provider, questionsAsked: () => asked };
}
