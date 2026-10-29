// The gap: the one question ending that comes closest to a proposal without becoming one
// (ADR-0008).
//
// Four claims decay quietly and each is pinned here. The sentence informs and offers nothing, so it
// carries no control and the resolver's confirmation flag stays shut — the surface that would
// accept an offer is the implicit loop's, and a sentence of hers that asks something gives way to
// the platform's. Hers is written from the question alone, so it has no row to report and no
// collection to name. The claim is about their desk, so it is refused when the subject names
// something they already have, and a question that searched and matched nothing keeps its own
// weaker, truer ending. And the whole of it is earned by looking: the turn refuses a gap until a
// statement has opened a collection.

import { beforeEach, describe, expect, test } from "bun:test";
import { zodSchema } from "ai";

import { intentClassificationSchema } from "../../../pipeline/intent/index.ts";
import { A_DATA_QUERY_CLASSIFICATION } from "../../../pipeline/intent/intent.test-support.ts";
import type { GenerateResult, Provider } from "../../../platform/provider/index.ts";
import { type ActiveRegistryCatalog, readActiveRegistryCatalog } from "../../../registry/index.ts";
import {
  QUESTION_NO_HOME_UNNAMED,
  QUESTION_NOTHING_FOUND,
  QUESTION_NOTHING_FOUND_ANYWHERE,
  questionEndingNarration,
} from "../loop/question-narration.ts";
import {
  A_QUESTION_WITH_NO_HOME,
  answers,
  EXPENSES_CAPABILITY,
  NO_USAGE,
  NOTES_CAPABILITY,
  NOTES_TABLE,
  nextPrompt,
  noHome,
  type QuestionDesk,
  questionDesk,
  reads,
  registeredSpecs,
  SCRIPTED_ANSWER,
  SCRIPTED_GAP_SENTENCE,
  SCRIPTED_SUBJECT,
  scriptedProvider,
  scriptedProviderNaming,
  toldAgainStep,
} from "../question.test-support.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "../scope/read-scope.test-support.ts";
import { LOOK_BEFORE_NO_HOME } from "../turn/question-turn.ts";
import { QUESTION_NO_HOME_RULES } from "../turn/question-turn-prompt.ts";
import {
  buildQuestionNoHomePrompt,
  QUESTION_NO_HOME_PROMPT_PREFIX,
  QUESTION_SUBJECT_RULES,
  questionNamesSomethingOnThisDesk,
  questionNoHomeSchema,
  runQuestionNoHome,
} from "./question-no-home.ts";
import { questionSubjectIsTheirs } from "./question-their-words.ts";

let platforms: ScratchPlatforms;

function desk(): QuestionDesk {
  return questionDesk(platforms);
}

/** A desk and the catalog it stands on, which is the one the loop hands the gap's own call. */
function catalogued(): ActiveRegistryCatalog {
  return readActiveRegistryCatalog(desk().database.readonly);
}

/** One read that opens a collection and matches rows, which is what the turn asks for before it
 * will hear a gap at all. */
function looksAtNotes() {
  return reads(`SELECT text FROM ${NOTES_TABLE}`, [], "naming");
}

/** What the gap says for one generation, asked in front of nothing on this desk. */
async function gapSaid(named: unknown): Promise<string | null> {
  return await runQuestionNoHome(
    {
      provider: namingProvider(named),
      signal: new AbortController().signal,
      catalog: catalogued(),
    },
    { question: A_QUESTION_WITH_NO_HOME, openCapability: null },
  );
}

/** A provider whose naming call comes back as whatever this test chose, unvalidated. */
function namingProvider(named: unknown): Provider {
  return {
    generate<T>(): GenerateResult<T> {
      return {
        partialStream: (async function* () {
          yield named as never;
        })(),
        object: Promise.resolve(named as T),
        usage: Promise.resolve(NO_USAGE),
      };
    },
  };
}

/** A provider whose naming call rejects its handle, which is what the real spine does with a
 * generation its schema refuses, and what a cancelled one does. */
function namingProviderFaulting(error: Error): Provider {
  return {
    generate<T>(): GenerateResult<T> {
      const object = Promise.reject(error) as Promise<T>;
      object.catch(() => {});
      return { partialStream: (async function* () {})(), object, usage: Promise.resolve(NO_USAGE) };
    },
  };
}

beforeEach(() => {
  platforms = createScratchPlatforms();
});

describe("the sentence", () => {
  test("is hers once the platform has settled that there is a gap", async () => {
    expect(await gapSaid({ subject: SCRIPTED_SUBJECT, sentence: SCRIPTED_GAP_SENTENCE })).toBe(
      SCRIPTED_GAP_SENTENCE,
    );
  });

  test("is the platform's when hers asks something, in any script: there is nothing to say yes to", async () => {
    for (const sentence of ["Shall I start keeping track of them?", "始めましょうか？"]) {
      const said = await gapSaid({ subject: SCRIPTED_SUBJECT, sentence });
      expect({ sentence, said }).toEqual({ sentence, said: QUESTION_NO_HOME_UNNAMED });
    }
  });

  test("and when hers says nothing, or runs on far past one thing she says", async () => {
    for (const sentence of ["  ", "…", "\u200b", SCRIPTED_GAP_SENTENCE.repeat(40)]) {
      const said = await gapSaid({ subject: SCRIPTED_SUBJECT, sentence });
      expect({ sentence, said }).toEqual({ sentence, said: QUESTION_NO_HOME_UNNAMED });
    }
  });

  test("and hers is shaped as an answer is, so a character that draws nothing is gone", async () => {
    const reordering = `${SCRIPTED_GAP_SENTENCE}\u202e`;
    expect(await gapSaid({ subject: SCRIPTED_SUBJECT, sentence: reordering })).toBe(
      SCRIPTED_GAP_SENTENCE,
    );
  });
});

describe("whether the subject is this person's own words", () => {
  test("it is, through case, punctuation, quotation marks, marks on a letter and either form", () => {
    const theirs: readonly (readonly [string, string])[] = [
      ["what about my Hiking Trips?", SCRIPTED_SUBJECT],
      ["anything on hiking-trips lately?", SCRIPTED_SUBJECT],
      ['about hiking "><" trips?', SCRIPTED_SUBJECT],
      ["how many 'hiking trips' did I take?", SCRIPTED_SUBJECT],
      ["do I track cafe\u0301 visits?", "caf\u00e9 visits"],
      ["मेरे पानी की बोतल कहाँ है?", "पानी की बोतल"],
      ["ما هي فواتيري؟", "فواتيري"],
      [A_QUESTION_WITH_NO_HOME, "many hiking trips did I take"],
    ];
    for (const [question, subject] of theirs) {
      const is = questionSubjectIsTheirs(question, subject);
      expect({ question, subject, is }).toEqual({ question, subject, is: true });
    }
  });

  test("it is not when built from words they used apart, ones they never wrote, or the question", () => {
    // Thai runs its words together, so a whole clause reads as one word and no subject inside it
    // can be told apart from it. A run as long as the question hands back the question itself.
    const not: readonly (readonly [string, string])[] = [
      ["how many trips did I take hiking?", SCRIPTED_SUBJECT],
      [A_QUESTION_WITH_NO_HOME, "hiking boots"],
      ["how many hikings?", "hiking"],
      [A_QUESTION_WITH_NO_HOME, "how many hiking trips did I take last year"],
      ["มีไก่กี่ตัว", "ไก่"],
      [A_QUESTION_WITH_NO_HOME, ""],
      [A_QUESTION_WITH_NO_HOME, "…"],
    ];
    for (const [question, subject] of not) {
      const is = questionSubjectIsTheirs(question, subject);
      expect({ question, subject, is }).toEqual({ question, subject, is: false });
    }
  });
});

describe("a subject naming something they already have", () => {
  test("is caught by the name this person gave it, and either way round", () => {
    // *note paper* is caught by what one Notes record is called, which is more than those words
    // strictly name. The check errs that way on purpose: a suppressed gap costs her the stronger
    // sentence, and a gap she should not have claimed is something untrue about their desk.
    const catalog = catalogued();
    const held = [
      EXPENSES_CAPABILITY.label,
      "expenses",
      "notes from my doctor",
      "the notes from my doctor",
      "note paper",
    ];
    for (const named of held) {
      expect({ named, held: questionNamesSomethingOnThisDesk(catalog, named) }).toEqual({
        named,
        held: true,
      });
    }
  });

  test("but a collection's own noun in the middle of a subject is a coincidence too", () => {
    // The same asymmetry the column check makes, made for a one-word noun: English hangs a
    // subject on its first word or its last, so *a grocery note list* is about a list and this
    // desk holds nowhere for one. Suppressing it would answer about Notes instead.
    const catalog = catalogued();
    for (const named of ["grocery note list", "a grocery note list"]) {
      expect({ named, held: questionNamesSomethingOnThisDesk(catalog, named) }).toEqual({
        named,
        held: false,
      });
    }
  });

  test("and by a column of one, which is where a value lives", () => {
    const catalog = catalogued();
    for (const named of ["amount", "Amount", "what", "the amount"]) {
      expect({ named, held: questionNamesSomethingOnThisDesk(catalog, named) }).toEqual({
        named,
        held: true,
      });
    }
  });

  test("but a column's name found inside a subject is a coincidence, not a home", () => {
    // The asymmetry is the whole guard. A collection's name inside a subject is what the subject
    // is about, and a column's is not: *what I spent the summer on* is not held by Expenses
    // having a column called What, and a desk of nine collections puts two hundred such words in
    // reach. Suppressing this gap would answer a question about one thing out of another.
    const catalog = catalogued();
    for (const named of ["what I spent the summer on", "the amount of sleep I get"]) {
      expect({ named, held: questionNamesSomethingOnThisDesk(catalog, named) }).toEqual({
        named,
        held: false,
      });
    }
  });

  test("while a real gap is not", () => {
    const catalog = catalogued();
    for (const named of [SCRIPTED_SUBJECT, "guitar practice", "parking tickets"]) {
      expect({ named, held: questionNamesSomethingOnThisDesk(catalog, named) }).toEqual({
        named,
        held: false,
      });
    }
  });
});

describe("the call that names it", () => {
  test("opens on a prefix of its own, and carries the question and the rules", () => {
    const prompt = buildQuestionNoHomePrompt(A_QUESTION_WITH_NO_HOME);
    expect(prompt.startsWith(QUESTION_NO_HOME_PROMPT_PREFIX)).toBe(true);
    expect(prompt).toContain(A_QUESTION_WITH_NO_HOME);
    for (const rule of QUESTION_SUBJECT_RULES) expect(prompt).toContain(rule);
  });

  test("is generated against a shape a strict provider will accept", () => {
    // The rules `question-tool.ts` describes: every property required, no extra ones, and none
    // of the keywords OpenAI's strict `json_schema` mode refuses.
    const schema = zodSchema(questionNoHomeSchema).jsonSchema as Record<string, unknown>;
    expect(schema.required).toEqual(Object.keys(questionNoHomeSchema.shape));
    expect(schema.additionalProperties).toBe(false);
    const emitted = JSON.stringify(schema);
    for (const keyword of ["oneOf", "minLength", "maxLength", "pattern", "format", "default"]) {
      expect({ keyword, present: emitted.includes(keyword) }).toEqual({ keyword, present: false });
    }
  });

  test("says the platform's sentence when the generation named nothing readable", async () => {
    // Both shapes a bad generation arrives in: one that resolves to the wrong thing, and one
    // whose handle the real spine rejects. Neither ends the question — the sentence is ours.
    const catalog = catalogued();
    const providers = [
      namingProvider({ nothing: true }),
      namingProvider(null),
      namingProviderFaulting(new Error("the generation did not match its schema")),
    ];
    for (const provider of providers) {
      const said = await runQuestionNoHome(
        { provider, signal: new AbortController().signal, catalog },
        { question: A_QUESTION_WITH_NO_HOME, openCapability: null },
      );
      expect(said).toBe(QUESTION_NO_HOME_UNNAMED);
    }
  });

  test("in front of a window, gives way to it whenever it named nothing of theirs", async () => {
    // A question naming nothing of its own is about the collection standing there, however the
    // nothing came about: a generation that would not read, words that were not theirs, or none.
    const catalog = catalogued();
    const standing = { question: A_QUESTION_WITH_NO_HOME, openCapability: NOTES_CAPABILITY.id };
    const signal = new AbortController().signal;
    const providers = [
      namingProvider({ nothing: true }),
      namingProviderFaulting(new Error("the generation did not match its schema")),
      namingProvider({ subject: "outdoor activities", sentence: SCRIPTED_GAP_SENTENCE }),
      namingProvider({ subject: "", sentence: SCRIPTED_GAP_SENTENCE }),
    ];
    for (const provider of providers) {
      expect(await runQuestionNoHome({ signal, catalog, provider }, standing)).toBeNull();
    }
  });

  test("while their own words in front of a window still name the gap", async () => {
    const provider = namingProvider({ subject: SCRIPTED_SUBJECT, sentence: SCRIPTED_GAP_SENTENCE });
    const said = await runQuestionNoHome(
      { provider, signal: new AbortController().signal, catalog: catalogued() },
      { question: A_QUESTION_WITH_NO_HOME, openCapability: NOTES_CAPABILITY.id },
    );
    expect(said).toBe(SCRIPTED_GAP_SENTENCE);
  });

  test("a cancellation still ends the question rather than settling a sentence", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const run = runQuestionNoHome(
      {
        provider: namingProviderFaulting(new Error("cancelled")),
        signal: cancelled.signal,
        catalog: catalogued(),
      },
      { question: A_QUESTION_WITH_NO_HOME, openCapability: null },
    );
    await expect(run).rejects.toThrow();
  });

  test("in front of nothing, a blank subject has the platform's sentence: hers names a thing", async () => {
    expect(await gapSaid({ subject: "", sentence: SCRIPTED_GAP_SENTENCE })).toBe(
      QUESTION_NO_HOME_UNNAMED,
    );
  });

  test("and words that were not theirs are weighed against the desk all the same", async () => {
    // Her sentence names the thing in her own words either way, so what the model named is the
    // subject left to check: an expense is something this desk already keeps.
    expect(await gapSaid({ sentence: SCRIPTED_GAP_SENTENCE, subject: "expense" })).toBeNull();
    expect(await gapSaid({ sentence: SCRIPTED_GAP_SENTENCE, subject: "outings" })).toBe(
      SCRIPTED_GAP_SENTENCE,
    );
  });

  test("hands back nothing when the words name a collection they already have", async () => {
    const said = await runQuestionNoHome(
      {
        provider: namingProvider({ sentence: SCRIPTED_GAP_SENTENCE, subject: "expenses" }),
        signal: new AbortController().signal,
        catalog: catalogued(),
      },
      { question: "do I have anywhere for expenses?", openCapability: null },
    );
    expect(said).toBeNull();
  });

  test("and a sentence of hers that asks something does not turn that into a gap", async () => {
    const asking = { subject: "expenses", sentence: "Shall I start keeping track of them?" };
    const said = await runQuestionNoHome(
      {
        provider: namingProvider(asking),
        signal: new AbortController().signal,
        catalog: catalogued(),
      },
      { question: "do I have anywhere for expenses?", openCapability: null },
    );
    expect(said).toBeNull();
  });
});

describe("the ending", () => {
  test("is her sentence, and no answer is written for it", async () => {
    const run = await desk().run(
      scriptedProviderNaming(SCRIPTED_SUBJECT, looksAtNotes(), noHome()),
      A_QUESTION_WITH_NO_HOME,
    );

    expect(run.result).toEqual({
      ending: "no_home",
      steps: [expect.objectContaining({ collections: [NOTES_CAPABILITY.label] })],
      answer: SCRIPTED_GAP_SENTENCE,
    });
    expect(run.answerPrompts).toHaveLength(0);
  });

  test("is named out of the question alone — no rows, no collections, no steps", async () => {
    // The one call that speaks here carries less than the answer's does on purpose: what comes
    // back from it is said to them, and it has no row to report and no collection to name.
    const run = await desk().run(
      scriptedProviderNaming(SCRIPTED_SUBJECT, looksAtNotes(), noHome()),
      A_QUESTION_WITH_NO_HOME,
    );

    const prompt = run.subjectPrompts[0] ?? "";
    expect(prompt).toContain(A_QUESTION_WITH_NO_HOME);
    for (const leak of [NOTES_CAPABILITY.label, EXPENSES_CAPABILITY.label, NOTES_TABLE, "rows"]) {
      expect({ leak, present: prompt.includes(leak) }).toEqual({ leak, present: false });
    }
  });

  test("is refused when the words name a collection this desk already holds", async () => {
    // The claim is about their desk, and this is the half of it the platform can check against
    // the catalog it holds: she has an Expenses, so she may not say there is nowhere for one.
    const run = await desk().run(
      scriptedProviderNaming("expenses", looksAtNotes(), noHome()),
      "do I have anywhere for expenses?",
    );

    expect(run.result).toMatchObject({ ending: "answered", answer: SCRIPTED_ANSWER });
  });

  test("has no sentence of its own to fetch: the words ride on the result", () => {
    expect(questionEndingNarration("no_home")).toBeNull();
  });

  test("is the decision the turn's prompt offers the model", () => {
    const prompt = nextPrompt(
      A_QUESTION_WITH_NO_HOME,
      registeredSpecs(desk().database.readonly),
      [],
    );
    for (const rule of QUESTION_NO_HOME_RULES) expect(prompt).toContain(rule);
  });
});

describe("a search that matched nothing keeps its own ending", () => {
  test("because that claim is about her search, and this one is about the desk", async () => {
    // She has somewhere for it and simply found nothing there. The weaker sentence is the true
    // one, so the gap gives way to it, and no naming call is even made.
    const run = await desk().run(
      scriptedProviderNaming(
        "groceries",
        reads(`SELECT text FROM ${NOTES_TABLE} WHERE text = ?`, ["nothing is filed under this"]),
        noHome(),
      ),
      "how many groceries notes do I have?",
    );

    expect(run.result).toMatchObject({
      ending: "nothing_found",
      answer: `Looking at your ${NOTES_CAPABILITY.label}, ${QUESTION_NOTHING_FOUND}`,
    });
    expect(run.subjectPrompts).toHaveLength(0);
  });
});

describe("she cannot say it without having looked", () => {
  test("a gap claimed before any read is refused, and the model is told to look", async () => {
    const run = await desk().run(
      scriptedProvider(noHome(), looksAtNotes(), answers()),
      A_QUESTION_WITH_NO_HOME,
    );

    expect(run.steps[0]).toEqual(toldAgainStep(LOOK_BEFORE_NO_HOME));
    expect(run.result).toMatchObject({ ending: "answered", answer: SCRIPTED_ANSWER });
    expect(run.subjectPrompts).toHaveLength(0);
  });

  test("a statement that returned a row of its own is not looking", async () => {
    const run = await desk().run(
      scriptedProvider(reads("SELECT 1 AS anything"), noHome(), answers()),
      A_QUESTION_WITH_NO_HOME,
    );

    expect(run.steps[1]).toEqual(toldAgainStep(LOOK_BEFORE_NO_HOME));
    expect(run.result).toMatchObject({
      ending: "nothing_found",
      answer: QUESTION_NOTHING_FOUND_ANYWHERE,
    });
  });

  test("a model that will not look is told once, and then answers out of what it has", async () => {
    // Never ten turns of the same refusal: that spends the whole budget, ends on the sentence
    // for a question she could not work out, and narrates ten looks she never took.
    const run = await desk().run(scriptedProvider(noHome()), A_QUESTION_WITH_NO_HOME);

    expect(run.steps).toEqual([toldAgainStep(LOOK_BEFORE_NO_HOME)]);
    expect(run.result).toMatchObject({ ending: "nothing_worked" });
    expect(run.prompts).toHaveLength(2);
  });

  test("and once she has opened a collection, the refusal is behind her", async () => {
    const run = await desk().run(
      scriptedProviderNaming(SCRIPTED_SUBJECT, noHome(), looksAtNotes(), noHome()),
      A_QUESTION_WITH_NO_HOME,
    );

    expect(run.steps[0]).toEqual(toldAgainStep(LOOK_BEFORE_NO_HOME));
    expect(run.result).toMatchObject({
      ending: "no_home",
      answer: SCRIPTED_GAP_SENTENCE,
    });
  });

  test("an ordinary answer is untouched by the gate", async () => {
    const run = await desk().run(
      scriptedProvider(looksAtNotes(), answers()),
      A_QUESTION_WITH_NO_HOME,
    );
    expect(run.result).toMatchObject({ ending: "answered", answer: SCRIPTED_ANSWER });
  });
});

describe("no button, and no confirmation to wire one to", () => {
  test("the resolver still admits only an unconfirmed classification", () => {
    // The gap's whole restraint, checked where it is actually enforced. The moment this
    // flag opens, the gap answer is where the implicit loop should wire its proposal surface.
    expect(intentClassificationSchema.safeParse(A_DATA_QUERY_CLASSIFICATION).success).toBe(true);
    expect(
      intentClassificationSchema.safeParse({
        ...A_DATA_QUERY_CLASSIFICATION,
        requires_confirmation: true,
      }).success,
    ).toBe(false);
  });
});
