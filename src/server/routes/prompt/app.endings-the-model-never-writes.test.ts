// The three endings the model never writes, read where a person reads them (6.5/05).
//
// A question can end on words no generation produced: a search that matched nothing, a desk that
// holds nowhere for what was asked, and a budget of reads spent. All three stop before the answer
// generation, which is what separates them from the other two endings — an answer, and a question
// that could not be finished. `question-narration.ts`'s suites own the sentences and
// `question-loop.ts`'s own the endings; what is proved here is the trip through the real prompt
// path: each ending reaches the answer window as the whole of what she says, in place of an
// answer that was never asked for (PLAN decisions 3, 15, 17, 20).
//
// These ran through 6.3/01's developer-gated exercise until 6.5/05 took it down.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { Provider } from "../../../platform/provider/index.ts";
import {
  QUESTION_BUDGET_SPENT_SENTENCE,
  QUESTION_NOTHING_FOUND,
  QUESTION_STEP_BUDGET,
  questionNoHomeSentence,
} from "../../../runtime/query/index.ts";
import {
  catalogueWithRecords,
  EXPENSES_CAPABILITY,
  NOTES_CAPABILITY,
  NOTES_TABLE,
  SCRIPTED_SUBJECT,
} from "../../../runtime/query/question.test-support.ts";
import {
  createScratchDbEnv,
  DATA_QUERY_INTENT,
  makeMetricsRecorder,
  makeScratchApp,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { escapeHtml } from "../../http/html.ts";
import { ANSWER_WINDOW_ATTRIBUTE, renderAnswerWindowSaying } from "../../http/index.ts";
import { askInTheWindow, saidInTheAnswerWindow } from "./answer-window.test-support.ts";
import { makeQuestionProvider } from "./staged-question.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

/** What the fake model would say if it were ever asked for an answer. On all three of these
 * endings it is not, so this sentence reaching the desk is the failure each test looks for. */
const NEVER_ASKED_FOR = "I counted them up for you and there were eleven.";

/** A statement that opens a collection and matches rows in it. The gap ending is refused until
 * one has (`question-no-home.ts`), and a search that matched nothing takes the ending instead. */
const OPENS_NOTES = { sql: `SELECT text FROM ${NOTES_TABLE}`, label: "naming" } as const;

/** One statement that matches nothing, so the platform ends the question rather than the model. */
const MATCHES_NOTHING = {
  sql: `SELECT count(*) AS total FROM ${NOTES_TABLE} WHERE text = ?`,
  label: "counting",
  parameters: ["nothing is filed under this"],
} as const;

function askingApp(provider: Provider) {
  return makeScratchApp(
    { dir, conns, artifactsRoot },
    provider,
    makeMetricsRecorder().recordMetrics,
  );
}

function askingProvider(overrides: Partial<Parameters<typeof makeQuestionProvider>[0]> = {}) {
  return makeQuestionProvider({
    intent: DATA_QUERY_INTENT,
    reads: [OPENS_NOTES],
    answer: { answer: NEVER_ASKED_FOR },
    ...overrides,
  }).provider;
}

beforeEach(() => {
  ({ dir, conns, artifactsRoot } = createScratchDbEnv("aluna-unanswered-endings-"));
  // Two collections with rows in them, so a question that matched nothing did so by searching.
  catalogueWithRecords(conns.readwrite);
});

afterEach(() => {
  teardownScratchDbEnv({ dir, conns, artifactsRoot });
});

describe("a search that matched nothing", () => {
  test("ends on the platform's sentence, naming what she read and nothing after it", async () => {
    const { fragments } = await askInTheWindow(
      askingApp(askingProvider({ reads: [MATCHES_NOTHING] })),
      "how many notes about nothing?",
    );

    // Her claim is about her own search, so the collection she opened is in it and the one she
    // never touched is not. The whole last frame is pinned, so nothing may follow the sentence.
    const ending = saidInTheAnswerWindow(fragments).at(-1) ?? "";
    expect(ending).toEndWith(QUESTION_NOTHING_FOUND);
    expect(ending).toContain(NOTES_CAPABILITY.label);
    expect(ending).not.toContain(EXPENSES_CAPABILITY.label);
    expect(fragments).toEndWith(renderAnswerWindowSaying(ending));
    expect(fragments).not.toContain(escapeHtml(NEVER_ASKED_FOR));
  });
});

describe("a question this desk holds nowhere for", () => {
  const ASKED = `how many ${SCRIPTED_SUBJECT} did I take last year?`;

  test("ends with the gap named in this person's own words, and nothing beside it", async () => {
    const { events, fragments } = await askInTheWindow(
      askingApp(askingProvider({ gap: SCRIPTED_SUBJECT })),
      ASKED,
    );

    // The whole frame rather than its text: an offer with a yes in it would be something this
    // ending shipped beside the sentence, and searching for the sentence would walk past it.
    expect(fragments).toEndWith(renderAnswerWindowSaying(questionNoHomeSentence(SCRIPTED_SUBJECT)));
    expect(fragments).not.toContain(escapeHtml(NEVER_ASKED_FOR));
    expect(events.at(-1)).toMatchObject({ event: "done", data: "ok" });
  });

  test("and nothing on the way to it is a control to press", async () => {
    // Decision 20: the gap is named and there is nothing to accept. Swept over every fragment
    // this question streamed, because a control it grew would be one wherever it landed.
    const { fragments } = await askInTheWindow(
      askingApp(askingProvider({ gap: SCRIPTED_SUBJECT })),
      ASKED,
    );

    // The window opened and the gap was reached, so the sweep below is over the stream it means.
    expect(fragments).toContain(ANSWER_WINDOW_ATTRIBUTE);
    expect(saidInTheAnswerWindow(fragments).at(-1)).toBe(questionNoHomeSentence(SCRIPTED_SUBJECT));
    for (const control of ["<form", "<button", "<input", "<select", "<a ", "href", "onclick"]) {
      expect({ control, present: fragments.includes(control) }).toEqual({
        control,
        present: false,
      });
    }
  });
});

describe("a question that never converges", () => {
  test("stops at ten reads and says so, rather than answering half of one", async () => {
    const { fragments } = await askInTheWindow(
      askingApp(askingProvider({ neverStops: true })),
      "how many notes did I write last month?",
    );

    // The opening, one sentence per read, and the platform's own sentence in place of an answer.
    const said = saidInTheAnswerWindow(fragments);
    expect(said).toHaveLength(QUESTION_STEP_BUDGET + 2);
    expect(said.at(-1)).toBe(QUESTION_BUDGET_SPENT_SENTENCE);
    expect(fragments).not.toContain(escapeHtml(NEVER_ASKED_FOR));
  });
});
