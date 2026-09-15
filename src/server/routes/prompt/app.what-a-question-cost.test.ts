// The two numbers a question leaves behind (6.6/04, PLAN decision 33, ADR-0008).
//
// `intent-resolution-store.test.ts` owns what the row may hold; this owns what gets put in it,
// over the real prompt path, because the count and the clock are both assembled out of things
// only the whole trip has — the loop's own result, the narration seam a cancelled question is
// counted through, and the moment the run started.
//
// What the numbers are for is decision 8: ten steps was a guess, and these rows are the only
// thing that will ever say whether it was generous or tight. So the arms below are the three
// shapes of question Module 9 has to be able to tell apart — one that answered quickly, one that
// spent the whole budget, and one the person gave up on.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { IntentResolutionMetrics } from "../../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { Provider } from "../../../platform/provider/index.ts";
import { QUESTION_STEP_BUDGET, QUESTION_TURN_PROMPT_PREFIX } from "../../../runtime/query/index.ts";
import { catalogueWithRecords, NOTES_TABLE } from "../../../runtime/query/question.test-support.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  DATA_QUERY_INTENT,
  eventData,
  makeMetricsRecorder,
  makeScratchApp,
  postPrompt,
  readSse,
  responseText,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { askInTheWindow } from "./answer-window.test-support.ts";
import { makeQuestionProvider } from "./staged-question.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

const READ = { sql: `SELECT count(*) AS total FROM ${NOTES_TABLE}`, label: "counting" } as const;
const ANSWER = { answer: "You wrote three notes in July." };

/** Long enough that a clock reading over the whole question cannot round down to nothing, and
 * spent before the first turn — so a sum of step times would still be zero. */
const THINKING_MS = 60;

beforeEach(() => {
  ({ dir, conns, artifactsRoot } = createScratchDbEnv("aluna-question-cost-"));
  catalogueWithRecords(conns.readwrite);
});

afterEach(() => {
  teardownScratchDbEnv({ dir, conns, artifactsRoot });
});

/** The recorder and the app together, because every arm reads the rows the app wrote. */
function asking(provider: Provider) {
  const recorder = makeMetricsRecorder();
  return {
    app: makeScratchApp({ dir, conns, artifactsRoot }, provider, recorder.recordMetrics),
    /**
     * The write is fired and never awaited, which is what best-effort means — so every read of it
     * waits, and a silence here would be a race rather than a fact.
     */
    async settled(): Promise<IntentResolutionMetrics> {
      for (let tries = 0; tries < 400 && recorder.resolutionRows.length === 0; tries += 1) {
        await new Promise((wake) => setTimeout(wake, 5));
      }
      const [row] = recorder.resolutionRows;
      if (!row) throw new Error("the question left no resolver row");
      return row;
    },
    rows: recorder.resolutionRows,
  };
}

function questionProvider(overrides: Partial<Parameters<typeof makeQuestionProvider>[0]> = {}) {
  return makeQuestionProvider({
    intent: DATA_QUERY_INTENT,
    reads: [READ],
    answer: ANSWER,
    ...overrides,
  }).provider;
}

describe("what one question cost, over the path a person asks on", () => {
  test("an answered question says how many steps it took and how long it took them", async () => {
    const asked = asking(questionProvider());
    await askInTheWindow(asked.app, "how many notes did I write in July?");

    expect((await asked.settled()).question).toEqual({
      stepsTaken: 1,
      elapsedMs: expect.any(Number),
    });
  });

  test("and a question that spends the budget says it spent the budget", async () => {
    // The ending that carries a count instead of the rows, so its number comes off the other
    // half of the union. Read against the budget itself: the measurement exists to judge it.
    const asked = asking(questionProvider({ neverStops: true }));
    await askInTheWindow(asked.app, "how many notes did I write last month?");

    expect((await asked.settled()).question?.stepsTaken).toBe(QUESTION_STEP_BUDGET);
  });

  test("so the quick question and the long one are told apart by their rows alone", async () => {
    // The property Module 9 buys with all of this: two questions, nothing in either row about
    // what was asked, and the counts still separate them.
    const quick = asking(questionProvider());
    await askInTheWindow(quick.app, "how many notes did I write in July?");
    const long = asking(questionProvider({ neverStops: true }));
    await askInTheWindow(long.app, "how many notes did I write last month?");

    const [quickCost, longCost] = [
      (await quick.settled()).question,
      (await long.settled()).question,
    ];
    expect(longCost?.stepsTaken).toBeGreaterThan(quickCost?.stepsTaken ?? 0);
    // Both rows carry a clock reading, but which is larger is not pinned here: neither provider
    // is made slower than the other, so a scheduler hiccup would decide it.
    expect(quickCost?.elapsedMs).toEqual(expect.any(Number));
    expect(longCost?.elapsedMs).toEqual(expect.any(Number));
  });
});

describe("the clock runs over the whole question rather than over its steps", () => {
  test("a question that took no step at all still says what the person waited", async () => {
    // A model that stops before its first statement: the loop hands back no steps, so a sum of
    // step times is zero by construction. The wait happened in the classification above the
    // loop, and the row carries it — which is the difference between the two ways to measure.
    const staged = questionProvider({ reads: [] });
    const slow: Provider = {
      generate(prompt, schema) {
        if (prompt.startsWith(QUESTION_TURN_PROMPT_PREFIX)) return staged.generate(prompt, schema);
        const generated = staged.generate(prompt, schema);
        const object = (async () => {
          await Bun.sleep(THINKING_MS);
          return await generated.object;
        })();
        object.catch(() => undefined);
        return { ...generated, object };
      },
    };
    const asked = asking(slow);
    await askInTheWindow(asked.app, "how many notes did I write in July?");
    const cost = (await asked.settled()).question;

    expect(cost?.stepsTaken).toBe(0);
    expect(cost?.elapsedMs).toBeGreaterThanOrEqual(THINKING_MS);
  });
});

describe("a question the person gave up on", () => {
  test("leaves a row saying what it cost before they stopped it", async () => {
    // Neither shape of the loop's result is reached here, so the count is the one the narration
    // seam kept: one step had landed and been said before the press, and the row says one.
    const staged = questionProvider({ reads: [READ, READ] });
    const arrived = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    let turns = 0;
    const parking: Provider = {
      generate(prompt, schema) {
        const generated = staged.generate(prompt, schema);
        if (!prompt.startsWith(QUESTION_TURN_PROMPT_PREFIX)) return generated;
        turns += 1;
        // The first turn goes through, so a step lands and is counted; the second parks, which
        // is the only moment a cancel has something to stop.
        if (turns < 2) return generated;
        const object = (async () => {
          arrived.resolve();
          await held.promise;
          return await generated.object;
        })();
        object.catch(() => undefined);
        return { ...generated, object };
      },
    };
    const asked = asking(parking);
    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(asked.app, "which of my notes mention the garden?")),
    );
    const streaming = readSse(await asked.app.request(`/build/${jobId}/stream`));
    await arrived.promise;
    expect((await asked.app.request(`/build/${jobId}/cancel`, { method: "POST" })).status).toBe(
      202,
    );
    held.resolve();
    collectSseEvents(await streaming);

    const row = await asked.settled();
    expect(row.outcome).toBe("cancelled");
    expect(row.question).toEqual({ stepsTaken: 1, elapsedMs: expect.any(Number) });
  });
});

describe("the write stays best-effort", () => {
  test("a writer that throws costs the row and not the answer", async () => {
    const refusing = Object.assign(makeMetricsRecorder().recordMetrics, {
      resolve: () => {
        throw new Error("the metrics table is gone");
      },
    });
    const app = makeScratchApp({ dir, conns, artifactsRoot }, questionProvider(), refusing);
    const { events, fragments } = await askInTheWindow(app, "how many notes did I write in July?");

    expect(fragments).toContain(ANSWER.answer);
    expect(eventData(events, "done")).toBe("ok");
  });
});
