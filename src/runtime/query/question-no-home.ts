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
// name something the desk already holds, or when they name nothing at all and a window is standing
// open — decision 30's two checks, against the catalog this question is already holding. The rest
// of the claim rests on the loop: the turn refuses the decision until she has opened a collection,
// and a question that searched and matched nothing keeps its own ending.

import { z } from "zod";

import { abortableProvider, type Provider } from "../../platform/provider/index.ts";
import {
  type ActiveRegistryCatalog,
  activeSpecFields,
  type CapabilitySpec,
  choiceFieldOptions,
  isChoiceFieldType,
} from "../../registry/index.ts";
import { questionNoHomeSentence, questionSubjectInTheirWords } from "./question-narration.ts";
import { capabilityQuerySpec } from "./whole-catalog-query-scope.ts";

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
 * What names a collection: what this person called it, and what it calls one of its records. Not
 * its id, though the resolver's own check compares one: an id is engineering language and never
 * this person's (`src/registry/spec/spec.ts`), and a renamed capability's is a word nobody on the
 * desk uses any more — *notes from my landlord* would be held by a Journal whose id is `notes`.
 */
function collectionNames(spec: CapabilitySpec): readonly string[] {
  return [spec.label, spec.noun];
}

/**
 * What a collection holds: each live column's name and label, and a choice field's declared
 * values, a disabled one included for the reason `formatChoiceValues` lists it. A retired field
 * is not here — its column is gone from what a statement may read, so a subject naming one has
 * nowhere to be found after all. Nor is `prompt_context`, though the resolver weighs it: prose
 * matched mechanically would suppress gaps this desk really has, which is this file's whole job.
 */
function namesInsideCollection(spec: CapabilitySpec): readonly string[] {
  return activeSpecFields(spec.schema.fields).flatMap((field) => [
    field.name,
    field.label,
    ...(isChoiceFieldType(field.type)
      ? choiceFieldOptions(field).flatMap((option) => [option.value, option.label])
      : []),
  ]);
}

/** Whether one of these runs of words sits inside the other, by the word notion the subject was
 * narrowed with. Both ways round is the two being the same words, since neither can be longer. */
function inside(name: string, named: string): boolean {
  return questionSubjectInTheirWords(name, named) !== null;
}

/**
 * Whether these words name something this desk already holds. A collection is caught either way
 * round: *hiking* is held by one called Hiking trips, and *notes from my doctor* holds one called
 * Notes. What is inside a collection has to be the whole subject, because a column's name found
 * inside a longer subject is a coincidence — one desk of nine collections puts two hundred names
 * in reach, most of them one ordinary word, and *light bulbs* is no gap once *light* is a roast.
 */
export function questionNamesSomethingOnThisDesk(
  catalog: ActiveRegistryCatalog,
  named: string,
): boolean {
  // Through `capabilityQuerySpec`, so every name weighed here is one on this person's own desk.
  return catalog.capabilities
    .map(capabilityQuerySpec)
    .some(
      (spec) =>
        collectionNames(spec).some((name) => inside(name, named) || inside(named, name)) ||
        namesInsideCollection(spec).some((name) => inside(name, named) && inside(named, name)),
    );
}

/** Whether a window naming one of these collections is standing open. An id naming nothing the
 * catalog lists is nothing standing, the way it is nothing in a turn's own prompt — which in
 * production it cannot be: `windowTheQuestionLeansOn` (`src/pipeline/query/data-query.ts`) names
 * a collection only where the desk's own restoration and the model's claim agree. */
function windowIsStanding(catalog: ActiveRegistryCatalog, open: string | null): boolean {
  return catalog.capabilities.some((row) => row.id === open);
}

export interface QuestionNoHomeDeps {
  readonly provider: Provider;
  /** The question's cancellation, and the only thing the scope lends this step, for the reason
   * the answer is lent it: the whole catalog is held while these words are settled. */
  readonly signal: AbortSignal;
  /** That same held catalog, which is what makes the checks above cost nothing. */
  readonly catalog: ActiveRegistryCatalog;
  /** What was standing in their window while they asked (decision 28), which is the second home
   * decision 30 weighs: a question whose words name no thing of their own asked about that. */
  readonly openCapability: string | null;
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
 * The gap sentence, or `null` for the two ways this desk turns out to have a home after all —
 * either way no gap, so the question answers instead. A generation that will not read settles the
 * sentence without a subject rather than ending the question, whatever is standing: the words are
 * the platform's, and a provider that hiccuped is no evidence about anybody's desk.
 */
export async function runQuestionNoHome(
  deps: QuestionNoHomeDeps,
  question: string,
): Promise<string | null> {
  const provider = abortableProvider(deps.provider, deps.signal);
  const generated = provider.generate(buildQuestionNoHomePrompt(question), questionNoHomeSchema);
  const named = await namedSubject(generated.object, deps.signal);
  if (named === null) return questionNoHomeSentence(null);
  const narrowed = questionSubjectInTheirWords(question, named);
  // It named something and the words were not theirs to name. Asked in front of a window that is
  // *how many did I add this month*, which is about the collection standing there and they
  // plainly have that one; asked in front of nothing, the unnamed sentence is all it can be.
  if (narrowed === null) {
    return windowIsStanding(deps.catalog, deps.openCapability)
      ? null
      : questionNoHomeSentence(null);
  }
  return questionNamesSomethingOnThisDesk(deps.catalog, narrowed)
    ? null
    : questionNoHomeSentence(narrowed);
}
