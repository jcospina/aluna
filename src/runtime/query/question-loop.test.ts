// The loop: ten steps, no timeout, and a spent budget that says so.
//
// Every case runs against the real worker and the real database file, for the reason
// `question-turn.test.ts` gives: a loop over a fake row set proves that a `while` counts to
// ten, and this loop's claims are about what happens when a statement is actually executed
// between the counting.
//
// Two of these are pinned by absence rather than by behaviour — no timeout, and no rows past
// a spent budget — and both are written as sweeps, because "we did not add one" is a claim
// that stays true right up until somebody adds one as a convenience.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { warpClocks } from "./clock-warp.test-support.ts";
import {
  answers,
  EXPENSES_TABLE,
  NOTES_TABLE,
  providerResolving,
  type QuestionDesk,
  questionDesk,
  reads,
  SCRIPTED_ANSWER,
  type ScriptedProvider,
  scriptedProvider,
} from "./question.test-support.ts";
import { QUESTION_STEP_BUDGET, runQuestionLoop } from "./question-loop.ts";
import { QUESTION_BUDGET_SPENT_SENTENCE, questionEndingNarration } from "./question-narration.ts";
import { READ_ONLY_QUERY_TOOL } from "./question-tool.ts";
import { type QuestionStep, UNREADABLE_DECISION } from "./question-turn.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";

let platforms: ScratchPlatforms;

/** The shared desk, at this suite's own lifecycle. See `question.test-support.ts`. */
function desk(): QuestionDesk {
  return questionDesk(platforms);
}

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

describe("the loop runs the model's chosen steps in sequence", () => {
  test("feeds each result back and keeps going until the model answers", async () => {
    const { result, steps, prompts } = await desk().run(
      scriptedProvider(
        reads(`SELECT DISTINCT text FROM ${EXPENSES_TABLE} ORDER BY text`),
        reads(`SELECT sum(amount) AS spent FROM ${EXPENSES_TABLE} WHERE text = ?`, ["groceries"]),
        answers(),
      ),
    );

    // Asserted on the result, not only on what `onStep` observed: an answered ending is the
    // one that carries its steps, and it is 6.4's whole raw material.
    if (result.ending !== "answered") throw new Error("the fixture answers");
    expect(result.steps).toHaveLength(2);
    expect(result.steps).toEqual(steps);
    expect(result.steps[0]?.result).toEqual({
      outcome: "rows",
      rows: [{ text: "groceries" }, { text: "rent" }],
    });
    expect(result.steps[1]?.result).toEqual({ outcome: "rows", rows: [{ spent: 12.5 }] });

    // Three generations for two reads: the third is the one that decided to stop.
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain("none yet; this is the first step");
    expect(prompts[1]).toContain('"text":"groceries"');
    expect(prompts[2]).toContain('"spent":12.5');
    expect(prompts[2]).toContain("step 2");
  });

  test("an answer on the very first turn runs no statement at all", async () => {
    const { result, steps, prompts } = await desk().run(scriptedProvider(answers()));

    expect(result).toEqual({ ending: "answered", steps: [], answer: SCRIPTED_ANSWER });
    expect(steps).toEqual([]);
    expect(prompts).toHaveLength(1);
  });

  test("the model is told how many reads it has left, and never a deadline", async () => {
    const { prompts } = await desk().run(
      scriptedProvider(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`), answers()),
    );

    expect(prompts[0]).toContain(`${QUESTION_STEP_BUDGET} of ${QUESTION_STEP_BUDGET}`);
    expect(prompts[1]).toContain(`${QUESTION_STEP_BUDGET - 1} of ${QUESTION_STEP_BUDGET}`);
    expect(prompts[0]).toContain("Take as long as you need");
  });
});

describe("the budget is ten steps", () => {
  test("is ten", () => {
    expect(QUESTION_STEP_BUDGET).toBe(10);
  });

  test("a question that never converges stops at exactly ten reads", async () => {
    // The script runs out after one entry and repeats it, which is a model that keeps
    // deciding to read and never decides it has enough.
    const { result, steps, prompts } = await desk().run(
      scriptedProvider(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)),
    );

    expect(result).toEqual({ ending: "budget_spent", stepsTaken: QUESTION_STEP_BUDGET });
    expect(steps).toHaveLength(QUESTION_STEP_BUDGET);
    // Eleven generations for ten reads: the last shows the model its tenth result and asks once
    // more, and asking for an eleventh read there is what spends the budget.
    expect(prompts).toHaveLength(QUESTION_STEP_BUDGET + 1);
    expect(prompts[QUESTION_STEP_BUDGET]).toContain(`0 of ${QUESTION_STEP_BUDGET}`);
    expect(prompts[QUESTION_STEP_BUDGET]).toContain("no reads left");
  });

  test("and the eleventh read is decided but never executed", async () => {
    // This counts what reached the worker, not what was recorded: an eleventh statement would be
    // an unbounded wait nobody sees, and would report ten while eleven ran (6.6/04's number).
    const scratch = desk();

    const { result, steps } = await scratch.run(
      scriptedProvider(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)),
    );

    expect(result).toEqual({ ending: "budget_spent", stepsTaken: QUESTION_STEP_BUDGET });
    expect(steps).toHaveLength(QUESTION_STEP_BUDGET);
    expect(scratch.executed()).toBe(QUESTION_STEP_BUDGET);
  });

  test("a question that answers instead executes exactly what it asked for", async () => {
    const scratch = desk();

    await scratch.run(
      scriptedProvider(
        reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`),
        reads(`SELECT count(*) AS total FROM ${EXPENSES_TABLE}`),
        answers(),
      ),
    );

    expect(scratch.executed()).toBe(2);
  });

  test("a question that answers off its tenth read is answered, not refused", async () => {
    // The budget counts reads, not turns. Bounding turns would spend a read the model is
    // never shown and fail a question while holding its answer.
    const script = Array.from({ length: QUESTION_STEP_BUDGET }, () =>
      reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`),
    );
    const { result, steps } = await desk().run(scriptedProvider(...script, answers()));

    if (result.ending !== "answered") throw new Error("the fixture answers on its last read");
    expect(steps).toHaveLength(QUESTION_STEP_BUDGET);
    expect(result.steps).toHaveLength(QUESTION_STEP_BUDGET);
  });
});

describe("no timeout exists on a step or on the loop", () => {
  test("a clock that jumps years between reads changes nothing", async () => {
    // A deadline has to read a clock, so every clock on the main thread is warped years forward at
    // each step and a whole budget still runs to its ordinary ending: slow is allowed.
    const clocks = warpClocks();
    const { YEAR_MS } = clocks;

    // Time passes in two places a deadline could measure — while the model thinks, and between one
    // read and the next — so a deadline across the loop and one within a turn are both caught.
    const scripted = scriptedProvider(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`));
    const ticking: ScriptedProvider = {
      prompts: scripted.prompts,
      answerPrompts: scripted.answerPrompts,
      generate(prompt, schema) {
        clocks.advance(YEAR_MS);
        return scripted.generate(prompt, schema);
      },
    };

    try {
      const { result, steps } = await desk().run(ticking, "how many notes?", () => {
        clocks.advance(YEAR_MS);
      });
      expect(result).toEqual({ ending: "budget_spent", stepsTaken: QUESTION_STEP_BUDGET });
      expect(steps).toHaveLength(QUESTION_STEP_BUDGET);
      // The clock really did move, and it moved for code reading it the ordinary ways.
      expect(clocks.warped).toContain("Date.now");
      expect(clocks.elapsed()).toBeGreaterThanOrEqual(YEAR_MS * QUESTION_STEP_BUDGET);
    } finally {
      clocks.restore();
    }
  });

  test("and nothing on the path arms a timer while a whole budget is spent", async () => {
    // The clock pin catches a deadline that measures; this catches one that schedules. It says
    // nothing about a real question, which arms ADR-0003's per-generation deadline in the spine.
    const armed: string[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const realSetInterval = globalThis.setInterval;
    const realAbortTimeout = AbortSignal.timeout;

    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      armed.push(`setTimeout(${String(args[1])})`);
      return realSetTimeout(...args);
    }) as typeof setTimeout;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      armed.push(`setInterval(${String(args[1])})`);
      return realSetInterval(...args);
    }) as typeof setInterval;
    AbortSignal.timeout = ((ms: number) => {
      armed.push(`AbortSignal.timeout(${ms})`);
      return realAbortTimeout(ms);
    }) as typeof AbortSignal.timeout;

    try {
      const { result } = await desk().run(
        scriptedProvider(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)),
      );
      expect(result.ending).toBe("budget_spent");
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.setInterval = realSetInterval;
      AbortSignal.timeout = realAbortTimeout;
    }

    expect(armed).toEqual([]);
  });

  test("and no source on the path holds a construct a deadline is built from", () => {
    // The pins prove nothing fired for these fixtures; the sweep proves there is no code to fire
    // for any other. The worker's thread is swept too: its globals are out of the spies' reach.
    const source = [
      "question-loop.ts",
      "question-answer.ts",
      "question-turn.ts",
      "question-tool.ts",
      "question-payload.ts",
      "whole-catalog-query-scope.ts",
      "whole-catalog-read-scope.ts",
      "query-worker.ts",
      "query-worker-thread.ts",
      "../../pipeline/query/data-query.ts",
    ];

    for (const file of source) {
      const text = readFileSync(join(import.meta.dir, file), "utf8");
      for (const construct of [
        "setTimeout",
        "setInterval",
        "setImmediate",
        "AbortSignal.timeout",
        "Bun.sleep",
        "Date.now",
        "new Date",
        "performance.now",
        "nanoseconds",
        "hrtime",
        "node:timers",
      ]) {
        expect({ file, construct, present: text.includes(construct) }).toEqual({
          file,
          construct,
          present: false,
        });
      }
    }
  });

  test("the sweep is looking at files that exist", () => {
    // A sweep over a mistyped path passes by reading nothing. `readFileSync` throws on a
    // missing file, so this only has to prove the list is not empty and the paths resolve.
    for (const file of ["question-loop.ts", "query-worker-thread.ts"]) {
      expect(readFileSync(join(import.meta.dir, file), "utf8").length).toBeGreaterThan(0);
    }
  });
});

describe("a spent budget says so and never answers half", () => {
  test("hands back how many reads it took and none of what they returned", async () => {
    const { result } = await desk().run(
      scriptedProvider(reads(`SELECT sum(amount) AS spent FROM ${EXPENSES_TABLE}`)),
    );

    // Structural rather than a rule to remember: this ending does not carry the rows, so nothing
    // downstream can compose a total out of a question that never finished.
    expect("steps" in result).toBe(false);
    // 12.5 is what every one of those ten reads returned; none of it is in the ending.
    expect(JSON.stringify(result)).not.toContain("12.5");
    expect(result).toEqual({ ending: "budget_spent", stepsTaken: QUESTION_STEP_BUDGET });
  });

  test("ends with the platform's own sentence", () => {
    expect(questionEndingNarration("budget_spent")).toBe(QUESTION_BUDGET_SPENT_SENTENCE);
  });

  test("and the platform says nothing of its own about an answered question", () => {
    // `question-answer.ts` writes what she found, out of the steps. A placeholder here would be
    // the platform answering a question it did not read.
    expect(questionEndingNarration("answered")).toBeNull();
  });

  test("the sentence carries no step count, SQL, table name, column or error string", async () => {
    // Driven through a real loop so the sweep is against what the steps actually produced,
    // not against a list somebody remembered to keep up to date.
    const { steps } = await desk().run(
      scriptedProvider(reads(`SELECT nowhere FROM ${NOTES_TABLE} WHERE text = ?`, ["groceries"])),
    );
    const sentence = QUESTION_BUDGET_SPENT_SENTENCE;

    expect(sentence).not.toMatch(/\d/);
    for (const machinery of [
      NOTES_TABLE,
      EXPENSES_TABLE,
      "SELECT",
      "select",
      "sql",
      "SQL",
      "column",
      "table",
      "query",
      "step",
      "read",
      "error",
    ]) {
      expect({ machinery, present: sentence.includes(machinery) }).toEqual({
        machinery,
        present: false,
      });
    }
    for (const step of steps) {
      expect(step.result.outcome).toBe("failed");
      if (step.result.outcome !== "failed") throw new Error("unreachable");
      expect(sentence).not.toContain(step.result.message);
      expect(sentence).not.toContain(step.call?.sql ?? "");
    }
  });
});

describe("an empty result and a failed statement are ordinary turns", () => {
  test("a step that matched nothing does not end the loop", async () => {
    const { result, steps } = await desk().run(
      scriptedProvider(
        reads(`SELECT text FROM ${NOTES_TABLE} WHERE text = ?`, ["nothing is called this"]),
        reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`),
        answers(),
      ),
    );

    expect(result.ending).toBe("answered");
    expect(steps).toHaveLength(2);
    expect(steps[0]?.result).toEqual({ outcome: "rows", rows: [] });
    expect(steps[1]?.result).toEqual({ outcome: "rows", rows: [{ total: 3 }] });
  });

  test("a failed statement does not end the loop, and the model reads why", async () => {
    const { result, steps, prompts } = await desk().run(
      scriptedProvider(
        reads(`SELECT nowhere FROM ${NOTES_TABLE}`),
        reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`),
        answers(),
      ),
    );

    expect(result.ending).toBe("answered");
    expect(steps).toHaveLength(2);
    expect(steps[0]?.result.outcome).toBe("failed");
    expect(prompts[1]).toContain("failed: no such column");
  });

  test("a mutation refused at the SQLite seam is a turn too", async () => {
    const { result, steps } = await desk().run(
      scriptedProvider(reads(`UPDATE ${NOTES_TABLE} SET text = ?`, ["rewritten"]), answers()),
    );

    expect(result.ending).toBe("answered");
    expect(steps[0]?.result.outcome).toBe("failed");
  });

  test("ten failures in a row spend the budget rather than ending early", async () => {
    const { result, steps } = await desk().run(
      scriptedProvider(reads(`SELECT nowhere FROM ${NOTES_TABLE}`)),
    );

    expect(result).toEqual({ ending: "budget_spent", stepsTaken: QUESTION_STEP_BUDGET });
    expect(steps.every((step) => step.result.outcome === "failed")).toBe(true);
  });
});

describe("the scope and its tokens go back on every ending", () => {
  test("on an answer", async () => {
    const scratch = desk();

    expect(scratch.readerCounts()).toEqual([0, 0]);
    await scratch.run(
      scriptedProvider(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`), answers()),
    );
    expect(scratch.readerCounts()).toEqual([0, 0]);
  });

  test("on a spent budget", async () => {
    const scratch = desk();

    const { result } = await scratch.run(
      scriptedProvider(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)),
    );

    expect(result.ending).toBe("budget_spent");
    expect(scratch.readerCounts()).toEqual([0, 0]);
  });

  test("and on a question cancelled mid-loop, which rejects rather than becoming a step", async () => {
    const scratch = desk();
    let steps = 0;

    const cancelled = scratch.inScope(async (scope) => {
      return await runQuestionLoop(
        {
          provider: scriptedProvider(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)),
          scope,
          database: scratch.database.readonly,
        },
        {
          question: "how many notes?",
          onStep: () => {
            steps += 1;
            // The gate closing under a running question is 6.2/03's kill: it arrives as a read
            // that rejects, and must leave the loop rather than become a step to reason about.
            scope.cancel();
          },
        },
      );
    });

    await expect(cancelled).rejects.toThrow();
    expect(steps).toBe(1);
    expect(scratch.readerCounts()).toEqual([0, 0]);
  });
});

describe("a decision that will not parse is a turn, not an ending", () => {
  test("comes back to the model as words, and the loop carries on", async () => {
    // The likeliest real shape: an answer still carrying the read it said it did not need. Before
    // this it threw a raw validation error out of the question, discarding every unspent read.
    const rogue = providerResolving(
      // An answer still carrying the read it just said it did not need: the schema's own
      // refinement rejects it, and it is one of the likeliest shapes a real model sends.
      {
        next: "answer",
        read: { tool: READ_ONLY_QUERY_TOOL, sql: "SELECT 1", label: "counting", parameters: [] },
      },
      reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`),
      answers(),
    );

    const scratch = desk();
    const steps: QuestionStep[] = [];
    const result = await scratch.inScope((scope) =>
      runQuestionLoop(
        { provider: rogue, scope, database: scratch.database.readonly },
        { question: "how many notes?", onStep: (step) => steps.push(step) },
      ),
    );

    expect(result.ending).toBe("answered");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      call: null,
      result: { outcome: "failed", message: UNREADABLE_DECISION },
    });
    expect(steps[1]?.result).toEqual({ outcome: "rows", rows: [{ total: 3 }] });
    expect(scratch.readerCounts()).toEqual([0, 0]);
  });

  test("the words it comes back as carry no machinery either", () => {
    expect(UNREADABLE_DECISION).not.toMatch(/\d/);
    expect(UNREADABLE_DECISION).not.toContain("Zod");
    expect(UNREADABLE_DECISION).not.toContain("schema");
  });
});

describe("what a watcher gets and what it cannot break", () => {
  test("a throwing onStep still gives the scope back", async () => {
    const scratch = desk();

    const thrown = scratch.inScope((scope) =>
      runQuestionLoop(
        {
          provider: scriptedProvider(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)),
          scope,
          database: scratch.database.readonly,
        },
        {
          question: "how many notes?",
          onStep: () => {
            throw new Error("the watcher blew up");
          },
        },
      ),
    );

    await expect(thrown).rejects.toThrow(/watcher blew up/);
    expect(scratch.readerCounts()).toEqual([0, 0]);
  });
});
