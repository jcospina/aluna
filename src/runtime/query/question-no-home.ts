// The gap: the call that names what this desk has nowhere for (PLAN decision 20; ADR-0008). The
// sentence is `question-narration.ts`'s, beside every other ending's.
//
// No button, and nothing here may grow one. An offer with a yes is a proposal, and the proposal
// surface is Module 8's — `src/pipeline/intent/schema.ts` admits only `requires_confirmation:
// z.literal(false)`. This ending is the first place M8 should wire that surface when it has one.
// Until then the action stays one ordinary sentence away, in the box already under the cursor.
//
// One call, carrying the question and nothing else: no rows, no collections, no steps. What comes
// back is narrowed to a run of words this person wrote, and then refused outright when those words
// name a collection they already have — the one part of this claim the platform can check against
// the catalog it is already holding, and *you don't have anywhere for expenses* is what it stops.
// The rest of the claim rests on the loop: the turn refuses the decision until she has opened a
// collection, a question that searched and matched nothing keeps its own ending, and 6.6/02 goes
// on to make the looking the loop's first step.

import { z } from "zod";

import { abortableProvider, type Provider } from "../../platform/provider/index.ts";
import { type ActiveRegistryCatalog, canonicalCapabilityLabel } from "../../registry/index.ts";
import { questionNoHomeSentence, questionSubjectInTheirWords } from "./question-narration.ts";

/**
 * The opening line of this call's prompt, and how a fake provider tells it from a turn's and an
 * answer's. "naming" against their "answering" and "saying", so no prefix is a prefix of another.
 */
export const QUESTION_NO_HOME_PROMPT_PREFIX = "You are Aluna, naming what there is nowhere for";

/**
 * What the model is told before it names. The worked example is a subject no fixture and no demo
 * uses, so a run that copied the example is told apart from one that read the question.
 */
export const QUESTION_SUBJECT_RULES = Object.freeze([
  "- Give the words from their question that name the thing they asked about.",
  "- Copy those words. Never translate them, tidy them, or supply a word they did not write.",
  '- In "how many parking tickets did I get last spring?" the thing is parking tickets.',
  "- Leave out how many, when, and anything you would have counted or added up.",
]);

// `.min(1)` emits `minLength`, which OpenAI's strict `json_schema` mode rejects (`question-tool.ts`).
const subjectText = z.string().refine((text) => text.trim().length > 0, "must name something");

/** The shape this call is generated against. One field, so there is nowhere in it for a sentence
 * of the model's: the sentence is the platform's and this fills its one slot. */
export const questionNoHomeSchema = z.strictObject({ subject: subjectText });

export function buildQuestionNoHomePrompt(question: string): string {
  return [
    `${QUESTION_NO_HOME_PROMPT_PREFIX}. There is nowhere on this desk for it.`,
    "",
    "Rules:",
    ...QUESTION_SUBJECT_RULES,
    "",
    "The question:",
    question,
  ].join("\n");
}

/**
 * Whether these words name a collection this desk already holds, by the name the person gave it
 * or by what one of its records is called. Either way round, because *notes from my doctor* holds
 * a collection's name and *hiking* is held by one. Names it catches, never meanings: this is the
 * cheap half of decision 30's check, and 6.6/02 owns the half that reads the data.
 */
export function questionNamesACollection(catalog: ActiveRegistryCatalog, named: string): boolean {
  return catalog.capabilities.some((row) =>
    [canonicalCapabilityLabel(row), row.noun].some(
      (name) =>
        questionSubjectInTheirWords(name, named) !== null ||
        questionSubjectInTheirWords(named, name) !== null,
    ),
  );
}

export interface QuestionNoHomeDeps {
  readonly provider: Provider;
  /** The question's cancellation, and the only thing the scope lends this step, for the reason
   * the answer is lent it: the whole catalog is held while these words are settled. */
  readonly signal: AbortSignal;
  /** That same held catalog, which is what makes the check above cost nothing. */
  readonly catalog: ActiveRegistryCatalog;
}

/** What the generation named, or `null` for one that came back unreadable — which a cancellation
 * is not: that ends the question, the way it ends every other generation on this path. */
async function namedSubject(object: Promise<unknown>, signal: AbortSignal): Promise<string | null> {
  try {
    const named = questionNoHomeSchema.safeParse(await object);
    return named.success ? named.data.subject : null;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

/**
 * The gap sentence, or `null` when what came back names a collection they already have — which is
 * no gap, so the question answers instead. A generation that will not read settles the sentence
 * without a subject rather than ending the question: the words are the platform's either way.
 */
export async function runQuestionNoHome(
  deps: QuestionNoHomeDeps,
  question: string,
): Promise<string | null> {
  const provider = abortableProvider(deps.provider, deps.signal);
  const generated = provider.generate(buildQuestionNoHomePrompt(question), questionNoHomeSchema);
  const named = await namedSubject(generated.object, deps.signal);
  const narrowed = named === null ? null : questionSubjectInTheirWords(question, named);
  if (narrowed !== null && questionNamesACollection(deps.catalog, narrowed)) return null;
  return questionNoHomeSentence(narrowed);
}
