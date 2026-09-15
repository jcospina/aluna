// The whole question path, from the prompt bar to the words in the answer window (6.5/03).
//
// One prompt bar and no mode switch: what is posted here is the same route, the same field and
// the same body a build posts, and the only thing that decides which happens is the sentence
// (PLAN decision 1). What comes back is the answer window opening, one sentence per step as the
// loop takes it, and the answer in place of the last of them.
//
// The sweep here is the one 6.3/04's own header hands over: that suite proves the *sentences*
// carry no machinery, and this one proves the trip to the desk does not put any back — the
// fragment, its attributes and its HTML encoding included. Numbers are not swept, because an
// answer that counted something says the number it counted.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BUILD_JOB_ID_ATTRIBUTE } from "#shell/shell-dom.js";
import {
  deflectionNarration,
  NotDeflectableError,
  REJECT_DEFLECTION,
} from "../../../pipeline/build/admission/deflection.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { Provider } from "../../../platform/provider/index.ts";
import { listCapabilities } from "../../../registry/index.ts";
import {
  QUESTION_COULD_NOT_FINISH,
  QUESTION_OPEN_WINDOW_HEADING,
  QUESTION_TURN_PROMPT_PREFIX,
  questionLabelNarration,
} from "../../../runtime/query/index.ts";
import {
  catalogueWithRecords,
  EXPENSES_TABLE,
  NOTES_CAPABILITY,
  NOTES_TABLE,
} from "../../../runtime/query/question.test-support.ts";
import {
  createScratchDbEnv,
  DATA_QUERY_INTENT,
  eventData,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  NEW_CAPABILITY_INTENT,
  postPrompt,
  REJECT_INTENT,
  responseText,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { escapeHtml, unescapeHtml } from "../../http/html.ts";
import {
  ANSWER_WINDOW_ATTRIBUTE,
  ANSWER_WINDOW_OPENING,
  ANSWER_WINDOW_SAYING_ATTRIBUTE,
  answerWindowTitle,
} from "../../http/index.ts";
import { askInTheWindow, saidInTheAnswerWindow } from "./answer-window.test-support.ts";
import { makeQuestionProvider } from "./staged-question.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

const QUESTION = "how much did I spend on groceries?";

/** What the fake model says once the reading is done: one sentence, hers. */
const ANSWER = { answer: "I went through your expenses under groceries — you spent £12.50." };

/** The two statements it asks for: what things are called, then the total. */
const READS = [
  { sql: `SELECT DISTINCT text FROM ${EXPENSES_TABLE}`, label: "naming" },
  { sql: `SELECT sum(amount) AS spent FROM ${EXPENSES_TABLE} WHERE text = ?`, label: "totalling" },
] as const;

function askingApp(provider: Provider, recordMetrics = makeMetricsRecorder().recordMetrics) {
  return makeScratchApp({ dir, conns, artifactsRoot }, provider, recordMetrics);
}

/** The fake model for a question that runs to an answer. */
function askingProvider(overrides: Partial<Parameters<typeof makeQuestionProvider>[0]> = {}) {
  return makeQuestionProvider({
    intent: DATA_QUERY_INTENT,
    asking: QUESTION,
    reads: [...READS],
    answer: ANSWER,
    ...overrides,
  });
}

/** A provider nothing on the tested path reaches: a submit is admitted before any generation. */
function quiet(): Provider {
  return {
    generate() {
      throw new Error("a submit generates nothing");
    },
  };
}

/**
 * What must never survive the trip to the desk (PLAN decision 15). The step count is here as the
 * word rather than as a digit: the answer carries the figures its statements computed.
 */
const MACHINERY: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "a SQL verb", pattern: /\b(select|join|distinct|union|from|where)\b/i },
  { name: "an aggregate", pattern: /\b(count|sum|avg|min|max)\s*\(/i },
  { name: "a step count", pattern: /\bsteps?\b/i },
  { name: "a row", pattern: /\brows?\b/i },
  { name: "a column", pattern: /\bcolumns?\b/i },
  { name: "a table", pattern: /\btables?\b/i },
  { name: "a query", pattern: /\bquer(y|ies)\b/i },
  { name: "a database", pattern: /\bdatabase\b/i },
  { name: "an error", pattern: /\berrors?\b/i },
  { name: "a table of this desk's own", pattern: new RegExp(`${NOTES_TABLE}|${EXPENSES_TABLE}`) },
  {
    name: "an internals word",
    pattern: /\b(handler|spec|migration|compile|schema|endpoint|crud|artifacts?)\b/i,
  },
];

/** Nothing that would make a disposable answer keepable, and nothing that would render it as a
 * grid or a figure rather than as a sentence (PLAN decision 3). Matched against a lowercased
 * fragment, because a `CSV` button is the same button as a `csv` one. */
const KEEPABLE = [
  "<table",
  "<tr",
  "<th",
  "<td",
  "<canvas",
  "chart",
  "csv",
  "download",
  "export",
  "save this",
];

beforeEach(() => {
  ({ dir, conns, artifactsRoot } = createScratchDbEnv("aluna-question-window-"));
});

/** Two collections with rows in them, so a question runs to a real answer. Per test rather than
 * per file: the build below needs a desk that does not already hold what it is about to make. */
function withCollections() {
  catalogueWithRecords(conns.readwrite);
}

afterEach(() => {
  teardownScratchDbEnv({ dir, conns, artifactsRoot });
});

describe("a question is narrated and answered in the answer window", () => {
  test("the window opens, every step is said in it, and the answer replaces the last of them", async () => {
    withCollections();
    const { provider } = askingProvider();
    const { events, fragments } = await askInTheWindow(askingApp(provider), QUESTION);

    // The window opens before the first read, so a person who has just pressed the key gets the
    // frame and her first sentence now rather than after a generation.
    expect(saidInTheAnswerWindow(fragments)).toEqual([
      ANSWER_WINDOW_OPENING,
      questionLabelNarration("naming"),
      questionLabelNarration("totalling"),
      ANSWER.answer,
    ]);
    // It is one window throughout: opened once, then said into. Opening is what names and raises
    // it, and a question that ran for a while must not keep doing either — a second question is
    // the one thing that may (PLAN decision 25).
    expect(fragments.match(new RegExp(ANSWER_WINDOW_ATTRIBUTE, "g"))).toHaveLength(1);
    expect(fragments).toContain(`${ANSWER_WINDOW_ATTRIBUTE}="${escapeHtml(QUESTION)}"`);
    expect(events.at(-1)).toMatchObject({ event: "done", data: "ok" });
  });

  test("no mode switch, no second control: the sentence is the only thing that decides", async () => {
    // The same route and the same field carry a build. What separates them is the classification
    // of the sentence, and there is nowhere on the way in to say which you meant (decision 1).
    const question = await postPrompt(askingApp(quiet()), QUESTION);
    const build = await postPrompt(askingApp(quiet()), "track my books");
    expect(question.status).toBe(build.status);
    for (const body of [await responseText(question), await responseText(build)]) {
      expect(body).toContain(BUILD_JOB_ID_ATTRIBUTE);
    }
  });

  test("nothing machinery-shaped survives the trip to the desk", async () => {
    withCollections();
    const { provider } = askingProvider();
    const { fragments } = await askInTheWindow(askingApp(provider), QUESTION);

    // Over the rendered fragment rather than over the sentence: an attribute, an entity and a
    // tag are all places a table name could ride to the desk on.
    for (const { name, pattern } of MACHINERY) {
      expect({ leaked: name, present: pattern.test(fragments) }).toEqual({
        leaked: name,
        present: false,
      });
    }
    // And nothing on this path makes a disposable answer keepable.
    const lowered = fragments.toLowerCase();
    for (const keepable of KEEPABLE) {
      expect({ keepable, present: lowered.includes(keepable) }).toEqual({
        keepable,
        present: false,
      });
    }
  });

  test("markup in an answer is text, and cannot open a second window", async () => {
    // The answer is model-written, so the fragment is this path's injection surface. Unescaped,
    // a `</div><div data-answer-window="…">` inside a finding would be read by the glue as a
    // *new question* and would re-title and re-raise the window (`openTheAnswerWindowFrom`).
    withCollections();
    const hostile = `</div><div ${ANSWER_WINDOW_ATTRIBUTE}="owned"><span onclick="x">12.50</span>`;
    const { provider } = askingProvider({
      answer: { answer: `I looked through your expenses, and you spent ${hostile}` },
    });
    const { fragments } = await askInTheWindow(askingApp(provider), QUESTION);

    // One window opened, and it was opened by the question rather than by the answer.
    expect(fragments.match(new RegExp(`${ANSWER_WINDOW_ATTRIBUTE}="`, "g"))).toHaveLength(1);
    expect(fragments).toContain(`${ANSWER_WINDOW_ATTRIBUTE}="${escapeHtml(QUESTION)}"`);
    expect(fragments).not.toContain(hostile);
    expect(fragments).not.toContain("<span");
    // And the words themselves still arrive whole, as text.
    expect(saidInTheAnswerWindow(fragments).at(-1)).toContain(hostile);
  });

  test("markup in the question is text too, and cannot break out of the title", async () => {
    // The other half of the same surface, and the one nothing proved: the question is the
    // *person's* words, and they are interpolated into an attribute rather than into a body
    // (`renderAnswerWindowOpening`). A benign question makes the escape an identity function, so
    // every other test here passes with it deleted. This one closes the quote and adds a handler.
    withCollections();
    const hostile = `" onmouseover="alert(1)" x="`;
    const { provider } = askingProvider({ asking: hostile });
    const { fragments } = await askInTheWindow(askingApp(provider), hostile);

    expect(fragments).toContain(`${ANSWER_WINDOW_ATTRIBUTE}="${escapeHtml(hostile)}"`);
    // The raw quotes are what would close the attribute; escaped, the handler is inert text.
    expect(fragments).not.toContain(hostile);
    // Still one window, named by the question: an attribute that broke out would open a second.
    expect(fragments.match(new RegExp(`${ANSWER_WINDOW_ATTRIBUTE}="`, "g"))).toHaveLength(1);
  });

  test("a long question is shortened for the title, and shortened after it is escaped", async () => {
    // The bound and the escape meet here: a title cut to its limit must not be cut through an
    // entity, which would leave `&am` in an attribute and the rest of it loose in the markup.
    withCollections();
    const hostile = `${"a&b ".repeat(60)}<end>`;
    const { provider } = askingProvider({ asking: hostile });
    const { fragments } = await askInTheWindow(askingApp(provider), hostile);

    expect(fragments).toContain(
      `${ANSWER_WINDOW_ATTRIBUTE}="${escapeHtml(answerWindowTitle(hostile))}"`,
    );
    expect(fragments).not.toContain("<end>");
    expect(unescapeHtml(saidInTheAnswerWindow(fragments)[0] ?? "")).toBe(ANSWER_WINDOW_OPENING);
  });

  test("a question asked twice runs twice and reuses nothing", async () => {
    withCollections();
    const { provider, questionsAsked } = askingProvider();
    const app = askingApp(provider);
    const first = await askInTheWindow(app, QUESTION);
    const second = await askInTheWindow(app, QUESTION);

    expect(questionsAsked()).toBe(2);
    expect(first.jobId).not.toBe(second.jobId);
    expect(saidInTheAnswerWindow(first.fragments).length).toBeGreaterThan(1);
    expect(saidInTheAnswerWindow(second.fragments)).toEqual(saidInTheAnswerWindow(first.fragments));
    // Asking adds nothing to the desk: the two capabilities that were there are the two that are
    // there, at the versions they were at.
    expect(listCapabilities(conns.readonly).map((row) => [row.id, row.version])).toEqual([
      ["expenses", 1],
      ["notes", 1],
    ]);
  });

  test("a question that could not be finished says so, and says nothing else", async () => {
    withCollections();
    const { provider } = askingProvider({
      faultTheAnswer: new Error(`no such column: ${EXPENSES_TABLE}.total`),
    });
    const { events, fragments } = await askInTheWindow(askingApp(provider), QUESTION);

    // The third ending. The reason is the platform's to log, and what reaches the desk is one
    // authored sentence — never the thrown string, which here carries a column of theirs.
    expect(saidInTheAnswerWindow(fragments).at(-1)).toBe(QUESTION_COULD_NOT_FINISH);
    expect(fragments).not.toContain("no such column");
    expect(events.at(-1)).toMatchObject({ event: "done", data: "ok" });
  });
});

describe("the two things Aluna says are said in different windows", () => {
  test("build narration goes to the window, and a question's words never do", async () => {
    // An empty desk, so the build actually finishes: a build colliding with what is already
    // registered fails, and a failed build's one narration line proves nothing about where
    // narration goes. Then the question asks about the collection the build just made.
    const { provider, questionsAsked } = askingProvider({
      reads: [{ sql: `SELECT count(*) AS total FROM ${NOTES_TABLE}`, label: "counting" }],
      fallback: makePromptBuildProvider(NEW_CAPABILITY_INTENT).provider,
    });
    const app = askingApp(provider);

    const built = await askInTheWindow(app, "track my books");
    const asked = await askInTheWindow(app, QUESTION);

    // A build that actually finished: it narrated, and it committed a capability to the window.
    expect(eventData(built.events, "narration").length).toBeGreaterThan(0);
    expect(eventData(built.events, "commit").length).toBeGreaterThan(0);
    expect(listCapabilities(conns.readonly).map((row) => row.id)).toContain("notes");
    expect(built.fragments).not.toContain(ANSWER_WINDOW_ATTRIBUTE);
    expect(built.fragments).not.toContain(ANSWER_WINDOW_SAYING_ATTRIBUTE);
    // A question narrates nothing on that channel: everything it says is in the answer window.
    expect(eventData(asked.events, "narration")).toBe("");
    expect(questionsAsked()).toBe(1);
    const spoken = saidInTheAnswerWindow(asked.fragments);
    expect(spoken.length).toBeGreaterThan(1);
    for (const said of spoken) {
      expect(built.fragments).not.toContain(said);
    }
  });
});

describe("the deflection that used to answer a question", () => {
  test("its line is gone, and the refusal's is untouched", async () => {
    expect(() => deflectionNarration(DATA_QUERY_INTENT)).toThrow(NotDeflectableError);
    // The refusal's line is the one 6.6/03 will use, and nothing here touched it.
    expect(deflectionNarration(REJECT_INTENT)).toBe(REJECT_DEFLECTION);
    expect(deflectionNarration(NEW_CAPABILITY_INTENT)).toBe(
      NEW_CAPABILITY_INTENT.user_facing_label,
    );
  });
});

// PLAN decision 28, end to end: the shell puts the standing capability in the body, the resolver
// classifies against it, and what it classified reaches the prompt the loop reads from.
describe("a question asked in front of an open capability", () => {
  const VAGUE = "how many did I add this month?";

  function turnPrompts(asked: () => readonly string[]): readonly string[] {
    return asked().filter((prompt) => prompt.startsWith(QUESTION_TURN_PROMPT_PREFIX));
  }

  test("carries that window from the body to every turn of the loop", async () => {
    catalogueWithRecords(conns.readwrite);
    const { provider, prompts } = askingProvider({ asking: VAGUE });

    await askInTheWindow(askingApp(provider), VAGUE, {
      capabilityId: NOTES_CAPABILITY.id,
      incarnationId: NOTES_CAPABILITY.incarnationId,
    });

    const [classification] = prompts();
    expect(classification).toContain(`Active capability:\nid: ${NOTES_CAPABILITY.id}`);
    const turns = turnPrompts(prompts);
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(turn).toContain(`${QUESTION_OPEN_WINDOW_HEADING} ${NOTES_CAPABILITY.label}`);
    }
  });

  test("and the same sentence asked with nothing standing carries none", async () => {
    catalogueWithRecords(conns.readwrite);
    // The resolver leaves the field null when there is no window for the loose words to point at.
    const { provider, prompts } = askingProvider({
      asking: VAGUE,
      intent: { ...DATA_QUERY_INTENT, target_capability: null },
    });

    await askInTheWindow(askingApp(provider), VAGUE);

    expect(prompts()[0]).toContain("Active capability:\nnone");
    const turns = turnPrompts(prompts);
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) expect(turn).not.toContain(QUESTION_OPEN_WINDOW_HEADING);
  });
});
