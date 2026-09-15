// The gap: the one ending in this module that comes closest to a proposal without becoming one
// (PLAN decision 20; ADR-0008).
//
// Four claims decay quietly and each is pinned here. The sentence informs and offers nothing, so
// it carries no control and the resolver's confirmation flag stays shut — the surface that would
// accept an offer is Module 8's. The subject is words this person wrote, because free text of the
// model's inside a sentence the platform vouches for is what 6.4/04 spent its findings on. The
// claim is about their desk, so it is refused when it names something they already have, and a
// question that searched and matched nothing keeps its own weaker, truer ending. And the whole of
// it is earned by looking: the turn refuses a gap until a statement has opened a collection.

import { beforeEach, describe, expect, test } from "bun:test";
import { zodSchema } from "ai";

import { intentClassificationSchema } from "../../pipeline/intent/index.ts";
import { A_DATA_QUERY_CLASSIFICATION } from "../../pipeline/intent/intent.test-support.ts";
import type { GenerateResult, Provider } from "../../platform/provider/index.ts";
import { type ActiveRegistryCatalog, readActiveRegistryCatalog } from "../../registry/index.ts";
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
  SCRIPTED_SUBJECT,
  scriptedProvider,
  scriptedProviderNaming,
  toldAgainStep,
} from "./question.test-support.ts";
import {
  QUESTION_NO_HOME_FOR_THAT,
  QUESTION_NOTHING_FOUND,
  QUESTION_NOTHING_FOUND_ANYWHERE,
  questionEndingNarration,
  questionNoHomeSentence,
} from "./question-narration.ts";
import {
  buildQuestionNoHomePrompt,
  QUESTION_NO_HOME_PROMPT_PREFIX,
  QUESTION_SUBJECT_RULES,
  questionNamesSomethingOnThisDesk,
  questionNoHomeSchema,
  runQuestionNoHome,
} from "./question-no-home.ts";
import { questionSubjectInTheirWords } from "./question-their-words.ts";
import { LOOK_BEFORE_NO_HOME } from "./question-turn.ts";
import { QUESTION_NO_HOME_RULES } from "./question-turn-prompt.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";

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
  test("names the gap in this person's own words and says they can ask for one", () => {
    expect(
      questionNoHomeSentence(
        questionSubjectInTheirWords(A_QUESTION_WITH_NO_HOME, SCRIPTED_SUBJECT),
      ),
    ).toBe("You don't have anywhere for hiking trips yet — you can ask me to make one.");
  });

  test("states rather than asks, so there is nothing to answer yes to", () => {
    for (const sentence of [QUESTION_NO_HOME_FOR_THAT, questionNoHomeSentence(SCRIPTED_SUBJECT)]) {
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence).not.toContain("?");
    }
  });

  test("is the platform's frame, and the subject is the whole of what it takes from outside", () => {
    // What keeps a capability, a table and a column out of it: every word but the subject is
    // written in this repository, and the subject is words this person typed.
    expect(questionNoHomeSentence("a subject")).toBe(
      QUESTION_NO_HOME_FOR_THAT.replace("for that", "for a subject"),
    );
  });

  test("names nothing at all when there were no words of theirs to put in it", () => {
    expect(questionNoHomeSentence(null)).toBe(QUESTION_NO_HOME_FOR_THAT);
  });

  test("carries no markup, whatever the person typed around their own words", () => {
    // Two ways markup can stand between the words she was handed. One carries words of its own,
    // which breaks the run, and the sentence names nothing rather than reaching across it. One
    // carries none, which does not break it — and still no character but theirs crosses.
    const broken = 'do I track hiking "><script>alert(1)</script> trips?';
    const between = 'do I track hiking "><" trips?';
    expect(questionNoHomeSentence(questionSubjectInTheirWords(broken, SCRIPTED_SUBJECT))).toBe(
      QUESTION_NO_HOME_FOR_THAT,
    );
    expect(questionNoHomeSentence(questionSubjectInTheirWords(between, SCRIPTED_SUBJECT))).toBe(
      "You don't have anywhere for hiking trips yet — you can ask me to make one.",
    );
  });
});

describe("the subject, narrowed to what this person wrote", () => {
  test("comes back as their characters rather than the model's rendering of them", () => {
    expect(questionSubjectInTheirWords("what about my Hiking Trips?", SCRIPTED_SUBJECT)).toBe(
      "Hiking Trips",
    );
  });

  test("reads through the punctuation between their words, and carries none of it out", () => {
    // Whatever stands between two of their words is whatever they typed there, and this is a
    // sentence the platform vouches for: their words cross, their punctuation does not.
    expect(questionSubjectInTheirWords("anything on hiking-trips lately?", SCRIPTED_SUBJECT)).toBe(
      "hiking trips",
    );
    expect(questionSubjectInTheirWords('about hiking "><" trips?', SCRIPTED_SUBJECT)).toBe(
      "hiking trips",
    );
  });

  test("keeps the marks on a word, so an accent and a script that needs them survive", () => {
    // A paste from macOS arrives decomposed, and a mark that ended a word would take the rest of
    // the word off with it — handing this person something else inside a sentence of ours.
    const cases: readonly (readonly [string, string, string])[] = [
      ["do I track café visits?", "café visits", "café visits"],
      ["मेरे पानी की बोतल कहाँ है?", "पानी की बोतल", "पानी की बोतल"],
      ["ما هي فواتيري؟", "فواتيري", "فواتيري"],
    ];
    for (const [question, subject, named] of cases) {
      expect(questionSubjectInTheirWords(question, subject)).toBe(named);
    }
  });

  test("reads past the quotation marks they put round the thing they asked about", () => {
    // A quote closed the word rather than sat inside it, so *tickets’* and *tickets* are one
    // word — and what comes back is still the run they typed, without the quotes round it.
    expect(
      questionSubjectInTheirWords("how many 'hiking trips' did I take?", SCRIPTED_SUBJECT),
    ).toBe("hiking trips");
  });

  test("and matches a subject composed either way against a question composed the other", () => {
    // A paste from macOS arrives decomposed and a model answers composed. The two are the same
    // word, and what comes back is the one they typed rather than the one we normalized.
    const decomposed = "do I track cafe\u0301 visits?";
    expect(questionSubjectInTheirWords(decomposed, "caf\u00e9 visits")).toBe("cafe\u0301 visits");
  });

  test("and names nothing at all in a script that puts no spaces between words", () => {
    // Thai runs its words together, so a whole clause reads as one word and no subject inside it
    // can be told apart from it. She says the sentence without naming the thing, which is true.
    expect(questionSubjectInTheirWords("มีไก่กี่ตัว", "ไก่")).toBeNull();
    expect(questionNoHomeSentence(null)).toBe(QUESTION_NO_HOME_FOR_THAT);
  });

  test("refuses a phrase built from words they used apart", () => {
    expect(questionSubjectInTheirWords("how many trips did I take hiking?", SCRIPTED_SUBJECT)).toBe(
      null,
    );
  });

  test("refuses a word they did not write, and a longer word holding one they did", () => {
    expect(questionSubjectInTheirWords(A_QUESTION_WITH_NO_HOME, "hiking boots")).toBeNull();
    expect(questionSubjectInTheirWords("how many hikings?", "hiking")).toBeNull();
  });

  test("refuses a run long enough to be the question rather than the thing it asks about", () => {
    // Their own words, and still not a subject: *anywhere for how many hiking trips did I take
    // last year* names nothing, so the sentence is better off naming nothing outright.
    expect(
      questionSubjectInTheirWords(
        A_QUESTION_WITH_NO_HOME,
        "how many hiking trips did I take last year",
      ),
    ).toBe(null);
    expect(
      questionSubjectInTheirWords(A_QUESTION_WITH_NO_HOME, "many hiking trips did I take"),
    ).toBe("many hiking trips did I take");
  });

  test("refuses a subject that is no words at all", () => {
    for (const subject of ["", "   ", "…"]) {
      expect({
        subject,
        named: questionSubjectInTheirWords(A_QUESTION_WITH_NO_HOME, subject),
      }).toEqual({
        subject,
        named: null,
      });
    }
  });
});

describe("a subject naming something they already have", () => {
  test("is caught by the name this person gave it, and either way round", () => {
    // *note paper* is caught by what one Notes record is called, which is more than those words
    // strictly name. The check errs that way on purpose: a suppressed gap costs her the stronger
    // sentence, and a gap she should not have claimed is something untrue about their desk.
    const catalog = catalogued();
    const held = [EXPENSES_CAPABILITY.label, "expenses", "notes from my doctor", "note paper"];
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
    for (const named of ["grocery note list", "the expense report format"]) {
      expect({ named, held: questionNamesSomethingOnThisDesk(catalog, named) }).toEqual({
        named,
        held: false,
      });
    }
  });

  test("and by a column of one, which is where a value lives (decision 30)", () => {
    const catalog = catalogued();
    for (const named of ["amount", "Amount", "what"]) {
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
    expect(schema.required).toEqual(["subject"]);
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
      namingProvider({ subject: "  " }),
      namingProvider({ nothing: true }),
      namingProvider(null),
      namingProvider({ subject: "outdoor activities" }),
      namingProviderFaulting(new Error("the generation did not match its schema")),
    ];
    for (const provider of providers) {
      const said = await runQuestionNoHome(
        { provider, signal: new AbortController().signal, catalog },
        { question: A_QUESTION_WITH_NO_HOME, openCapability: null },
      );
      expect(said).toBe(QUESTION_NO_HOME_FOR_THAT);
    }
  });

  test("and says it whatever is standing, because a hiccup is no evidence about a desk", async () => {
    // The two ways there is nothing to name are not the same way (decision 30). A generation that
    // came back unreadable says nothing about where the subject lives, so the unnamed sentence
    // stands even with a window open; words that were merely not theirs give way to that window.
    const catalog = catalogued();
    const standing = { question: A_QUESTION_WITH_NO_HOME, openCapability: NOTES_CAPABILITY.id };
    const signal = new AbortController().signal;

    expect(
      await runQuestionNoHome(
        { signal, catalog, provider: namingProvider({ nothing: true }) },
        standing,
      ),
    ).toBe(QUESTION_NO_HOME_FOR_THAT);
    expect(
      await runQuestionNoHome(
        { signal, catalog, provider: namingProvider({ subject: "outdoor activities" }) },
        standing,
      ),
    ).toBeNull();
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

  test("hands back nothing when the words name a collection they already have", async () => {
    const said = await runQuestionNoHome(
      {
        provider: namingProvider({ subject: "expenses" }),
        signal: new AbortController().signal,
        catalog: catalogued(),
      },
      { question: "do I have anywhere for expenses?", openCapability: null },
    );
    expect(said).toBeNull();
  });
});

describe("the ending", () => {
  test("names the gap, and no answer of the model's is written for it", async () => {
    const run = await desk().run(
      scriptedProviderNaming(SCRIPTED_SUBJECT, looksAtNotes(), noHome()),
      A_QUESTION_WITH_NO_HOME,
    );

    expect(run.result).toEqual({
      ending: "no_home",
      steps: [expect.objectContaining({ collections: [NOTES_CAPABILITY.label] })],
      answer: questionNoHomeSentence(SCRIPTED_SUBJECT),
    });
    expect(run.answerPrompts).toHaveLength(0);
  });

  test("is named out of the question alone — no rows, no collections, no steps", async () => {
    // The one call that speaks here carries less than the answer's does on purpose: what comes
    // back from it lands inside a sentence the platform vouches for.
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
    // one, so the gap gives way to it (decision 17), and no naming call is even made.
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
      answer: questionNoHomeSentence(SCRIPTED_SUBJECT),
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
    // Decision 20's whole restraint, checked where it is actually enforced. The moment this
    // flag opens, the gap answer is where Module 8 should wire its proposal surface.
    expect(intentClassificationSchema.safeParse(A_DATA_QUERY_CLASSIFICATION).success).toBe(true);
    expect(
      intentClassificationSchema.safeParse({
        ...A_DATA_QUERY_CLASSIFICATION,
        requires_confirmation: true,
      }).success,
    ).toBe(false);
  });
});
