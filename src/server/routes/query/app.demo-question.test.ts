// The scaffolding, exercised through the real app.
//
// This is the only place in the module where the whole path runs from an HTTP request:
// classify, open the whole-catalog scope, offer one tool, and run the loop's statements in
// the worker until the model answers or its ten reads are spent.
// It is scaffolding and its removal has an owner — 6.5/05 — which is exactly why the
// assertions here name what they are proving, so they can be re-homed rather than deleted.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ZodType } from "zod";

import { INTENT_RESOLVER_PROMPT_PREFIX } from "../../../pipeline/intent/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import type { DeepPartial, GenerateResult, Provider } from "../../../platform/provider/index.ts";
import {
  QUESTION_ANSWER_PROMPT_PREFIX,
  QUESTION_BUDGET_SPENT_SENTENCE,
  QUESTION_NOTHING_FOUND,
  QUESTION_RESULT_PAYLOAD_BUDGET_BYTES,
  QUESTION_STEP_BUDGET,
  QUESTION_STEP_LABELS,
  QUESTION_STEP_RESULT_CAP_BYTES,
  QUESTION_STEP_RESULT_TOO_LARGE,
  QUESTION_TURN_PROMPT_PREFIX,
  questionAnswerSchema,
  questionAnswerSentence,
  questionLabelNarration,
  READ_ONLY_QUERY_TOOL,
} from "../../../runtime/query/index.ts";
import {
  addNotes,
  catalogueWithRecords,
  EXPENSES_CAPABILITY,
  NOTES_CAPABILITY,
  NOTES_TABLE,
} from "../../../runtime/query/question.test-support.ts";
import { createApp } from "../../app.ts";
import { escapeHtml } from "../../http/html.ts";
import {
  ANSWER_HEADING,
  BUDGET_SPENT_HEADING,
  DEMO_QUESTION_PATH,
  NOTHING_FOUND_HEADING,
  NOTHING_MATCHED,
  STEP_COLLECTIONS_HEADING,
  STEP_MATCH,
  STEP_NARRATION_HEADING,
  VOCABULARY_HEADING,
} from "./demo-question.ts";

const DATA_QUERY_INTENT = {
  type: "data_query",
  confidence: 0.94,
  target_capability: null,
  resolution: "none",
  proposed_identity: null,
  proposed_action: "Look at what is saved.",
  user_facing_label: "Let me look at what you've saved.",
  requires_confirmation: false,
};

const NEW_CAPABILITY_INTENT = {
  ...DATA_QUERY_INTENT,
  type: "new_capability",
  resolution: "new",
  user_facing_label: "I'll make you a place for that.",
};

/**
 * What the fake provider says once the reading is done, in 6.4/03's two halves. Both carry the
 * characters an escape has to catch: this is model-authored text rendered into the page, so it is
 * the page's XSS surface, and the restatement is as much of it as the finding.
 */
const DEMO_ANSWER_WRITTEN = questionAnswerSchema.parse({
  looked_at: "Looking through your groceries & tea",
  found: 'you spent £12.50 <span onclick="x">last week</span>.',
});

/** The one sentence they make, assembled the one way the platform assembles it. */
const DEMO_ANSWER = questionAnswerSentence(DEMO_ANSWER_WRITTEN);

/**
 * One provider answering three different prompts, told apart by the prompt each stage builds
 * rather than by call order. `reads` is how many statements it runs; `Infinity` never converges.
 */
function stagedProvider(
  intent: unknown,
  sql: string,
  reads: number,
  parameters: readonly string[],
): Provider {
  let taken = 0;
  return {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      const decide = () => {
        if (taken >= reads) return { next: "answer", read: null };
        taken += 1;
        return {
          next: "read",
          read: { tool: READ_ONLY_QUERY_TOOL, sql, label: "counting", parameters },
        };
      };
      const answer = prompt.startsWith(INTENT_RESOLVER_PROMPT_PREFIX)
        ? intent
        : prompt.startsWith(QUESTION_TURN_PROMPT_PREFIX)
          ? decide()
          : prompt.startsWith(QUESTION_ANSWER_PROMPT_PREFIX)
            ? DEMO_ANSWER_WRITTEN
            : undefined;
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
    },
  };
}

let env: ScratchDbEnv;
let databases: PlatformDatabase;
const previousNodeEnv = process.env.NODE_ENV;

function app(
  intent: unknown,
  sql: string,
  reads = 1,
  parameters: readonly string[] = ["groceries"],
) {
  const provider = stagedProvider(intent, sql, reads, parameters);
  return createApp({
    getProvider: () => provider,
    buildDatabases: databases,
    artifactsRoot: env.artifactsRoot,
    capabilityRouter: { databases },
  });
}

function ask(question: string): RequestInit {
  return { method: "POST", body: new URLSearchParams({ question }) };
}

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-demo-question-");
  databases = env.conns;
  catalogueWithRecords(databases.readwrite);
});

afterEach(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  teardownScratchDbEnv(env);
});

describe("what the platform read off a result, and how the question ended", () => {
  test("says what the platform read off each result, and how it ended", async () => {
    // The block the sign-off gate reads: decision 17's verdict beside the rows it was made
    // from, and an ending whose heading says which of the two sentences this one is.
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE} WHERE text = ?`,
      1,
      ["nothing is filed under this"],
    ).request(DEMO_QUESTION_PATH, ask("how many notes about nothing?"));
    const html = await response.text();

    expect(html).toContain(`<h2>${escapeHtml(STEP_MATCH)}</h2><pre>${escapeHtml(NOTHING_MATCHED)}`);
    expect(html).not.toContain(ANSWER_HEADING);
    expect(html).not.toContain(escapeHtml(DEMO_ANSWER));
    const ending = html.slice(html.indexOf(`<h2>${escapeHtml(NOTHING_FOUND_HEADING)}</h2>`));
    expect(ending).toBe(
      `<h2>${escapeHtml(NOTHING_FOUND_HEADING)}</h2><pre>${escapeHtml(
        `Looking at your ${NOTES_CAPABILITY.label}, ${QUESTION_NOTHING_FOUND}`,
      )}</pre></section></body></html>`,
    );
  });
});

describe("the one-question exercise", () => {
  test("runs a classified data_query end to end and shows what came back", async () => {
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE} WHERE text = ?`,
    ).request(DEMO_QUESTION_PATH, ask("how many grocery notes do I have?"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("data_query");
    // Exactly one tool was offered, and the page says how many.
    expect(html).toContain("Tools offered (1)");
    expect(html).toContain(READ_ONLY_QUERY_TOOL);
    // The statement, its bound value, and the rows the worker produced.
    expect(html).toContain("WHERE text = ?");
    expect(html).toContain("groceries");
    expect(html).toContain("&quot;total&quot;: 2");
    expect(html).toContain(`Step 1 of at most ${QUESTION_STEP_BUDGET}`);
    // And then the answer, written from that result and rendered as the last thing on the page:
    // one sentence, saying what she looked at before what she found (6.4/03).
    expect(html).toContain(ANSWER_HEADING);
    expect(html).toContain(escapeHtml(DEMO_ANSWER));
    expect(html.indexOf(escapeHtml(DEMO_ANSWER))).toBeGreaterThan(html.indexOf("Rows (1)"));
    expect(html.indexOf(escapeHtml(DEMO_ANSWER_WRITTEN.looked_at))).toBeLessThan(
      html.indexOf(escapeHtml(DEMO_ANSWER_WRITTEN.found)),
    );
    // Escaped, not rendered: the answer is the one string on this page the model wrote.
    expect(html).not.toContain("<span onclick=");
  });

  test("shows a failed statement rather than ending the exercise", async () => {
    const response = await app(DATA_QUERY_INTENT, `SELECT nowhere FROM ${NOTES_TABLE}`).request(
      DEMO_QUESTION_PATH,
      ask("what did I spend?"),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Statement failed");
    expect(html).toContain("no such column");
  });

  test("a mutating statement comes back as a refusal from SQLite, not a 500", async () => {
    const response = await app(DATA_QUERY_INTENT, `DELETE FROM ${NOTES_TABLE}`).request(
      DEMO_QUESTION_PATH,
      ask("delete everything"),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("readonly database");
    expect(
      (
        databases.readonly.query(`SELECT count(*) AS total FROM ${NOTES_TABLE}`).get() as {
          total: number;
        }
      ).total,
    ).toBe(3);
  });

  test("an over-size read is refused on the page, and the payload is shown against the cap", async () => {
    // The living demo for 6.3/03: a capability holding long-text records, asked for the rows
    // themselves. The step is refused whole and the page shows what it would have cost.
    addNotes(databases.readwrite, 8, "x".repeat(3000), "long");

    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT text FROM ${NOTES_TABLE} WHERE text != ?`,
    ).request(DEMO_QUESTION_PATH, ask("read me every note I have written"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Statement failed");
    expect(html).toContain(escapeHtml(QUESTION_STEP_RESULT_TOO_LARGE));
    // Refused whole: not one of the rows is on the page either.
    expect(html).not.toContain("x".repeat(200));

    // And the page shows what the step costs rather than a zero that hides it. Asserted as a
    // read number, not as the literal constant, which any surrounding digits would satisfy.
    expect(html).toContain(`0 of ${QUESTION_STEP_RESULT_CAP_BYTES} bytes of rows`);
    const carried = /(\d+) bytes into every later prompt/.exec(html);
    expect(Number(carried?.[1])).toBeGreaterThan(0);
    const spent = new RegExp(`(\\d+) of ${QUESTION_RESULT_PAYLOAD_BUDGET_BYTES} spent`).exec(html);
    expect(Number(spent?.[1])).toBe(Number(carried?.[1]));
  });

  test("takes no turn for a prompt classified as anything else", async () => {
    const response = await app(NEW_CAPABILITY_INTENT, "SELECT 1").request(
      DEMO_QUESTION_PATH,
      ask("keep track of my plants"),
    );
    const html = await response.text();

    expect(html).toContain("new_capability");
    expect(html).not.toContain("Step 1 of at most");
  });

  test("a question that never converges stops at ten and says so", async () => {
    // The living demo: drive a fixture that never stops reading and confirm the page ends with
    // Aluna's own sentence rather than with whatever the last statement returned.
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE}`,
      Number.POSITIVE_INFINITY,
    ).request(DEMO_QUESTION_PATH, ask("how many notes did I write last month?"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(`Step ${QUESTION_STEP_BUDGET} of at most ${QUESTION_STEP_BUDGET}`);
    expect(html).not.toContain(`Step ${QUESTION_STEP_BUDGET + 1} of at most`);
    // A spent budget has no answer to render, and this is the block that would show one.
    expect(html).not.toContain(ANSWER_HEADING);
    expect(html).not.toContain(DEMO_ANSWER);

    // The ending is Aluna's sentence and nothing else. Asserting mere presence would stay green
    // with a total from the ten steps beside it, so this pins the whole block (decision 3).
    const ending = html.slice(html.indexOf(`<h2>${escapeHtml(BUDGET_SPENT_HEADING)}</h2>`));
    expect(ending).toBe(
      `<h2>${escapeHtml(BUDGET_SPENT_HEADING)}</h2><pre class="failure">${escapeHtml(
        QUESTION_BUDGET_SPENT_SENTENCE,
      )}</pre></section></body></html>`,
    );
  });

  test("a provider that cannot be built is read on the page, not a 500", async () => {
    // The likeliest developer failure there is: no API key. `createProvider` resolves its config
    // eagerly and throws, and this page's premise is that a failure is something you read on it.
    const app = createApp({
      getProvider: () => {
        throw new Error("Missing OMNI_API_KEY");
      },
      buildDatabases: databases,
      artifactsRoot: env.artifactsRoot,
      capabilityRouter: { databases },
    });

    const response = await app.request(DEMO_QUESTION_PATH, ask("how many notes?"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Missing OMNI_API_KEY");
  });

  test("renders the form on its own", async () => {
    const response = await app(DATA_QUERY_INTENT, "SELECT 1").request(DEMO_QUESTION_PATH);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<form");
  });
});

describe("what the page says a statement went through", () => {
  test("renders the answer as a sentence and never as a grid", async () => {
    // Decision 3: there is nothing on this path to render a table, a chart, a heading over a
    // figure, or a way of taking the numbers away, so the page cannot grow one by accident.
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE} WHERE text = ?`,
    ).request(DEMO_QUESTION_PATH, ask("how many grocery notes do I have?"));
    const html = await response.text();

    for (const surface of ["<table", "<tr", "<th", "<td", "chart", "csv", "download"]) {
      expect({ surface, present: html.includes(surface) }).toEqual({ surface, present: false });
    }
  });

  test("shows which collections a statement opened, so the answer can be checked against them", async () => {
    // The block a human reads beside the answer at 6.4/03's sign-off: the restatement claims a
    // collection, and this says which one actually opened, by the name the person gave it.
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE} WHERE text = ?`,
    ).request(DEMO_QUESTION_PATH, ask("how many grocery notes do I have?"));
    const html = await response.text();

    expect(html).toContain(STEP_COLLECTIONS_HEADING);
    expect(html).toContain(`<pre>${NOTES_CAPABILITY.label}</pre>`);
    // The desk holds two, and only the one the statement opened is named.
    expect(html).not.toContain(`<pre>${EXPENSES_CAPABILITY.label}</pre>`);
  });
});

describe("what the page does with a hostile request", () => {
  test("escapes the question it reflects back into the form", async () => {
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE}`,
    ).request(DEMO_QUESTION_PATH, ask('</textarea><img src=x onerror="alert(1)">'));
    const html = await response.text();

    // The question is user input reflected into markup; without the escape the textarea closes
    // early and the tag is live. No test posted markup before this one, so the suite stayed green.
    expect(html).not.toContain("</textarea><img");
    expect(html).toContain("&lt;/textarea&gt;&lt;img");
  });

  test("renders a malformed body instead of 500ing", async () => {
    const response = await app(DATA_QUERY_INTENT, "SELECT 1").request(DEMO_QUESTION_PATH, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=zz" },
      body: "garbage",
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("That was not a form");
  });

  test("refuses a cross-site post, which would spend provider tokens", async () => {
    const response = await app(DATA_QUERY_INTENT, "SELECT 1").request(DEMO_QUESTION_PATH, {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
      body: new URLSearchParams({ question: "how many notes?" }),
    });

    expect(response.status).toBe(403);
  });

  test("still accepts the page's own post", async () => {
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE}`,
    ).request(DEMO_QUESTION_PATH, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
      body: new URLSearchParams({ question: "how many notes?" }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Step 1 of at most");
  });
});

describe("the developer gate", () => {
  test("answers nothing in production, on either method", async () => {
    process.env.NODE_ENV = "production";
    const built = app(DATA_QUERY_INTENT, `SELECT count(*) AS total FROM ${NOTES_TABLE}`);

    expect((await built.request(DEMO_QUESTION_PATH)).status).toBe(404);
    expect((await built.request(DEMO_QUESTION_PATH, ask("how many notes?"))).status).toBe(404);
    // The product surface is untouched by the gate.
    expect((await built.request("/")).status).toBe(200);
  });

  test("answers outside production", async () => {
    process.env.NODE_ENV = "development";
    expect((await app(DATA_QUERY_INTENT, "SELECT 1").request(DEMO_QUESTION_PATH)).status).toBe(200);
  });
});

describe("the words beside the machinery", () => {
  test("a step shows what Aluna says for the kind of step the model labelled it", async () => {
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE} WHERE text = ?`,
    ).request(DEMO_QUESTION_PATH, ask("how many grocery notes do I have?"));
    const html = await response.text();

    // The statement is on the page, and the sentence is the one keyed to the label. Asserted as
    // the rendered pairing: every sentence appears in the vocabulary block, so containment passes.
    expect(html).toContain("WHERE text = ?");
    expect(html).toContain(
      `<h2>${escapeHtml(STEP_NARRATION_HEADING)}</h2><pre>${escapeHtml(
        questionLabelNarration("counting"),
      )}</pre>`,
    );
  });

  test("every sentence there is can be read before a question is asked", async () => {
    // 6.3/04's sign-off gate: a human opens this page and reads the whole vocabulary,
    // including the fallback and the sentence a spent budget ends on.
    const response = await app(DATA_QUERY_INTENT, `SELECT 1`).request(DEMO_QUESTION_PATH);
    const html = await response.text();

    expect(html).toContain(escapeHtml(VOCABULARY_HEADING));
    for (const label of QUESTION_STEP_LABELS) {
      expect(html).toContain(escapeHtml(questionLabelNarration(label)));
    }
    expect(html).toContain(escapeHtml(QUESTION_BUDGET_SPENT_SENTENCE));
  });
});
