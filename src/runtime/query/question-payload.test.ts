// The size cap: an over-size step is refused, not truncated, and the loop recovers by
// narrowing.
//
// Every behavioural case here runs against the real worker and the real database file. A cap
// asserted over a synthetic row array proves arithmetic; what this issue claims is that a
// statement which really does read too much comes back to the model with none of it, that
// the next prompt really does not contain the rows, and that a question which keeps asking
// for too much is bounded rather than merely counted. The two unit cases at the top are the
// boundary itself, where a real read cannot land on the byte.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { QueryWorkerRow } from "./query-worker.ts";
import {
  addNotes,
  answers,
  NOTES_CAPABILITY,
  NOTES_TABLE,
  nextPrompt,
  type QuestionDesk,
  questionDesk,
  reads,
  registeredSpecs,
  scriptedProvider,
} from "./question.test-support.ts";
import { QUESTION_STEP_BUDGET } from "./question-loop.ts";
import { QUESTION_BUDGET_SPENT_SENTENCE, questionEndingNarration } from "./question-narration.ts";
import {
  QUESTION_PAYLOAD_BUDGET_SPENT,
  QUESTION_RESULT_PAYLOAD_BUDGET_BYTES,
  QUESTION_STATEMENT_TOO_LARGE,
  QUESTION_STEP_RESULT_CAP_BYTES,
  QUESTION_STEP_RESULT_TOO_LARGE,
  questionPayloadBytes,
  questionPayloadRefusal,
  questionRenderedBytes,
  questionStatementRefusal,
  renderQuestionRows,
} from "./question-payload.ts";
import type { QuestionStep } from "./question-step.ts";
import { questionPayloadSpent, questionStepBytes } from "./question-turn-prompt.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";

let platforms: ScratchPlatforms;

/** A marker no other row on the desk carries, so a prompt can be searched for these rows. */
const MARKER = "payload-marker";
/** Long enough that six of them are over the step cap and one of them is nowhere near it. */
const LONG_TEXT = `${MARKER}${"x".repeat(3000)}`;
/** Short enough that hundreds of them are still under it. */
const SHORT_TEXT = "short";
const SHORT_NOTES = 650;
const LONG_NOTES = 6;

const LONG_ROWS_SQL = `SELECT text FROM ${NOTES_TABLE} WHERE length(text) > 1000`;
const EVERY_ID_SQL = `SELECT id FROM ${NOTES_TABLE}`;

/**
 * A desk holding hundreds of short notes and a handful of long ones, which is what makes
 * "many rows" and "a large payload" two different questions on the same table.
 */
function bulkyDesk(): QuestionDesk {
  return questionDesk(platforms, (database) => {
    addNotes(database, SHORT_NOTES, SHORT_TEXT, "short");
    addNotes(database, LONG_NOTES, LONG_TEXT, "long");
  });
}

/** Rows whose rendered payload is exactly `bytes` long. */
function rowsOfExactly(bytes: number): readonly QueryWorkerRow[] {
  const overhead = questionPayloadBytes([{ t: "" }]);
  return [{ t: "x".repeat(bytes - overhead) }];
}

/** A step's own weight, the way the turn weighs one. */
function weigh(rows: readonly QueryWorkerRow[], spent = 0): string | null {
  const step: QuestionStep = {
    call: null,
    collections: [],
    plan: { empty: "no rows" },
    result: { outcome: "rows", rows },
  };
  return questionPayloadRefusal(questionPayloadBytes(rows), questionStepBytes(step), spent);
}

/** A bound value long enough that a handful of statements carrying it fill a question. */
const BULKY_PARAMETER = "y".repeat(8 * 1024);

/** Every sentence the cap can send back to the model. */
const REFUSALS = [
  QUESTION_STEP_RESULT_TOO_LARGE,
  QUESTION_PAYLOAD_BUDGET_SPENT,
  QUESTION_STATEMENT_TOO_LARGE,
];

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

describe("the two numbers", () => {
  test("bound one step and bound a whole question, and the second is not the first times ten", () => {
    expect(QUESTION_STEP_RESULT_CAP_BYTES).toBe(16 * 1024);
    expect(QUESTION_RESULT_PAYLOAD_BUDGET_BYTES).toBe(64 * 1024);

    // More than one at-cap read fits, so the step cap is not secretly the whole budget.
    expect(QUESTION_RESULT_PAYLOAD_BUDGET_BYTES).toBeGreaterThan(QUESTION_STEP_RESULT_CAP_BYTES);
    // And ten at-cap reads do not: a per-step cap alone would let a question accumulate ten
    // times what it is allowed, and the budget is what stops it.
    expect(QUESTION_RESULT_PAYLOAD_BUDGET_BYTES).toBeLessThan(
      QUESTION_STEP_RESULT_CAP_BYTES * QUESTION_STEP_BUDGET,
    );
  });

  test("are checked at the byte, in both directions", () => {
    expect(questionPayloadRefusal(QUESTION_STEP_RESULT_CAP_BYTES, 0, 0)).toBeNull();
    expect(questionPayloadRefusal(QUESTION_STEP_RESULT_CAP_BYTES + 1, 0, 0)).toBe(
      QUESTION_STEP_RESULT_TOO_LARGE,
    );

    const room = QUESTION_RESULT_PAYLOAD_BUDGET_BYTES - 1000;
    expect(questionPayloadRefusal(0, 1000, room)).toBeNull();
    expect(questionPayloadRefusal(0, 1000, room + 1)).toBe(QUESTION_PAYLOAD_BUDGET_SPENT);
  });

  test("a result exactly at the cap is admitted, and one byte over is refused", () => {
    expect(weigh(rowsOfExactly(QUESTION_STEP_RESULT_CAP_BYTES))).toBeNull();
    expect(weigh(rowsOfExactly(QUESTION_STEP_RESULT_CAP_BYTES + 1))).toBe(
      QUESTION_STEP_RESULT_TOO_LARGE,
    );
  });

  test("and a step that breaks both is told the one it can act on", () => {
    // Swapping the two checks would tell a model that read too much in one go that earlier
    // reads had spent the room, sending it down the wrong recovery.
    expect(
      questionPayloadRefusal(
        QUESTION_STEP_RESULT_CAP_BYTES + 1,
        QUESTION_RESULT_PAYLOAD_BUDGET_BYTES,
        QUESTION_RESULT_PAYLOAD_BUDGET_BYTES,
      ),
    ).toBe(QUESTION_STEP_RESULT_TOO_LARGE);
  });

  test("a result too large for the runtime to render at all is refused, not thrown", () => {
    // `JSON.stringify` throws `RangeError: Out of memory` on a big enough result, and that
    // throw would end the question on precisely the read the cap exists for.
    expect(
      questionRenderedBytes(() => {
        throw new RangeError("Out of memory");
      }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(questionPayloadRefusal(Number.POSITIVE_INFINITY, 0, 0)).toBe(
      QUESTION_STEP_RESULT_TOO_LARGE,
    );
  });

  test("count UTF-8 bytes rather than characters, which is what the payload actually costs", () => {
    // Six thousand CJK characters are well under the cap counted as characters and half as
    // much again over it counted as bytes. Tokens follow the bytes.
    const rows = [{ text: "書".repeat(6000) }];

    expect(renderQuestionRows(rows).length).toBeLessThan(QUESTION_STEP_RESULT_CAP_BYTES);
    expect(questionPayloadBytes(rows)).toBeGreaterThan(QUESTION_STEP_RESULT_CAP_BYTES);
    expect(weigh(rows)).toBe(QUESTION_STEP_RESULT_TOO_LARGE);
  });

  test("measure the very text the prompt renders", () => {
    // What is counted is what is sent, not a second serialization that agrees: a measure dropping
    // the column names would halve the cost and double the ceiling.
    const desk = bulkyDesk();
    const rows = [{ text: SHORT_TEXT }, { text: `${SHORT_TEXT}er` }];
    const step: QuestionStep = {
      call: null,
      collections: [],
      plan: { empty: "no rows" },
      result: { outcome: "rows", rows },
    };

    expect(nextPrompt("anything", registeredSpecs(desk.database.readonly), [step])).toContain(
      renderQuestionRows(rows),
    );
    expect(questionPayloadBytes(rows)).toBe(Buffer.byteLength(renderQuestionRows(rows), "utf8"));
  });
});

describe("the cap is payload size, not rows", () => {
  test("hundreds of small rows come back whole", async () => {
    const { result, steps, prompts } = await bulkyDesk().run(
      scriptedProvider(reads(EVERY_ID_SQL), reads(EVERY_ID_SQL), answers()),
    );

    expect(result.ending).toBe("answered");
    const first = steps[0]?.result;
    if (first?.outcome !== "rows") throw new Error("the read was refused");
    expect(first.rows.length).toBeGreaterThan(600);
    expect(questionPayloadBytes(first.rows)).toBeLessThanOrEqual(QUESTION_STEP_RESULT_CAP_BYTES);
    // And the model gets all of them. An admitted result that quietly lost its tail would be
    // the same lie as a truncated refusal, arriving through the door marked "passes".
    expect(prompts[1]).toContain(renderQuestionRows(first.rows));
    expect(prompts[1]).toContain(`short-${String(SHORT_NOTES - 1).padStart(5, "0")}`);
  });

  test("while a handful of long ones is refused", async () => {
    const desk = bulkyDesk();

    // What the same statement really returns, so the refusal below is a refusal of rows that
    // exist rather than a query that quietly matched nothing.
    const rows = await desk.inScope((scope) => scope.read(LONG_ROWS_SQL, []));
    expect(rows).toHaveLength(LONG_NOTES);
    expect(questionPayloadBytes(rows)).toBeGreaterThan(QUESTION_STEP_RESULT_CAP_BYTES);

    const { steps } = await desk.run(scriptedProvider(reads(LONG_ROWS_SQL), answers()));

    expect(steps[0]?.result).toEqual({
      outcome: "failed",
      message: QUESTION_STEP_RESULT_TOO_LARGE,
    });
  });
});

describe("it refuses, and never truncates", () => {
  test("the over-size step carries no rows at all, not fewer rows", async () => {
    const { steps } = await bulkyDesk().run(scriptedProvider(reads(LONG_ROWS_SQL), answers()));
    const refused = steps[0]?.result;

    if (refused?.outcome !== "failed") throw new Error("the read was not refused");
    // A truncating implementation returns `outcome: "rows"` with a shorter array. There is no
    // array here to be short.
    expect(refused).not.toHaveProperty("rows");
    expect(Object.keys(refused).sort()).toEqual(["message", "outcome"]);
  });

  test("and not one row of it reaches the next prompt", async () => {
    const { prompts } = await bulkyDesk().run(
      scriptedProvider(
        reads(LONG_ROWS_SQL),
        reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`),
        answers(),
      ),
    );

    // The prompt is where a truncation would show: a sampled or trimmed result is still text
    // the model reads and answers from.
    expect(prompts[1]).toContain(QUESTION_STEP_RESULT_TOO_LARGE);
    expect(prompts[1]).not.toContain(MARKER);
    expect(prompts[1]).not.toContain("x".repeat(200));
  });
});

describe("the refusal is worded for the model", () => {
  test("tells it to narrow or to aggregate, and says nothing was trimmed", () => {
    for (const refusal of REFUSALS) {
      expect(refusal).toContain("Nothing was trimmed to fit");
      expect(refusal).toMatch(/narrow|shorter/i);
      expect(refusal).toContain("GROUP BY");
      expect(refusal).toContain("count");
      expect(refusal).toMatch(/read again|answer from what you have/);
    }
    // Three different facts get three different sentences: a refusal the model is meant to
    // act on has to be true about why.
    expect(new Set(REFUSALS).size).toBe(REFUSALS.length);
    expect(QUESTION_STEP_RESULT_TOO_LARGE).toContain("That returned too much");
    expect(QUESTION_PAYLOAD_BUDGET_SPENT).toContain("no room left to carry");
    expect(QUESTION_STATEMENT_TOO_LARGE).toContain("was not run");
  });

  test("and carries no measurement at all", () => {
    // No size, no row count, no ceiling quoted. A model cannot count bytes to a number it is
    // told, and a message with no digits in it cannot leak one into a sentence written from it.
    for (const refusal of REFUSALS) {
      expect(refusal).not.toMatch(/\d/);
      for (const machinery of ["byte", "KB", "cap", "limit", "budget"]) {
        expect({ machinery, present: refusal.includes(machinery) }).toEqual({
          machinery,
          present: false,
        });
      }
    }
  });
});

describe("the loop narrows after a refusal", () => {
  test("spends one read on it and goes on to answer", async () => {
    const { result, steps, prompts } = await bulkyDesk().run(
      scriptedProvider(
        reads(LONG_ROWS_SQL),
        reads(`SELECT count(*) AS total FROM ${NOTES_TABLE} WHERE length(text) > 1000`),
        answers(),
      ),
    );

    if (result.ending !== "answered") throw new Error("the fixture answers");
    expect(result.steps).toHaveLength(2);
    expect(steps[0]?.result.outcome).toBe("failed");
    expect(steps[1]?.result).toEqual({ outcome: "rows", rows: [{ total: LONG_NOTES }] });
    // One read consumed, exactly as a failed statement consumes one.
    expect(prompts[0]).toContain(`- ${QUESTION_STEP_BUDGET} of ${QUESTION_STEP_BUDGET}.`);
    expect(prompts[1]).toContain(`- ${QUESTION_STEP_BUDGET - 1} of ${QUESTION_STEP_BUDGET}.`);
  });

  test("a refused step spends none of the question's payload, so a small read still fits", async () => {
    const { steps } = await bulkyDesk().run(
      scriptedProvider(reads(LONG_ROWS_SQL), reads(EVERY_ID_SQL), answers()),
    );

    expect(steps[1]?.result.outcome).toBe("rows");
    expect(questionPayloadSpent(steps)).toBeLessThanOrEqual(QUESTION_RESULT_PAYLOAD_BUDGET_BYTES);
  });
});

describe("the cap bounds a whole ten-step question", () => {
  test("ten reads that each fit on their own do not, and the question stops accumulating", async () => {
    // Every read is legal: five long notes render just under the per-step cap, which alone would
    // admit all ten — the n²/2 blowup 6.3/02 measured at 2,653,692 characters for one question.
    const desk = bulkyDesk();
    const oneRead = `${LONG_ROWS_SQL} LIMIT 5`;
    const rows = await desk.inScope((scope) => scope.read(oneRead, []));
    const perStep = questionPayloadBytes(rows);
    expect(perStep).toBeLessThanOrEqual(QUESTION_STEP_RESULT_CAP_BYTES);

    const { result, steps, prompts } = await desk.run(scriptedProvider(reads(oneRead)));

    expect(result).toEqual({ ending: "budget_spent", stepsTaken: QUESTION_STEP_BUDGET });
    expect(steps).toHaveLength(QUESTION_STEP_BUDGET);

    const admitted = steps.filter((step) => step.result.outcome === "rows");
    const refused = steps.filter((step) => step.result.outcome === "failed");
    expect(admitted.length).toBe(4);
    expect(admitted.length).toBeLessThan(QUESTION_STEP_BUDGET);
    expect(refused.length).toBe(QUESTION_STEP_BUDGET - admitted.length);
    for (const step of refused) {
      expect(step.result).toEqual({ outcome: "failed", message: QUESTION_PAYLOAD_BUDGET_SPENT });
    }

    // The claim itself: what the whole question accumulated, not what one step returned.
    expect(questionPayloadSpent(steps)).toBeLessThanOrEqual(QUESTION_RESULT_PAYLOAD_BUDGET_BYTES);

    // And what that buys where the cost actually lands. Every prompt re-renders every prior
    // result, so this is the number the cap exists to bound.
    const total = prompts.reduce((sum, prompt) => sum + prompt.length, 0);
    expect(prompts).toHaveLength(QUESTION_STEP_BUDGET + 1);
    expect(Math.max(...prompts.map((prompt) => prompt.length))).toBeLessThan(100_000);
    // Bracketed rather than merely bounded: an upper bound alone passes for a cap so tight
    // that nothing is ever admitted, which is a different failure with the same green tick.
    expect(total).toBeGreaterThan(400_000);
    expect(total).toBeLessThan(700_000);

    // Every read token back, on a question that spent most of its steps being refused.
    expect(desk.readerCounts()).toEqual([0, 0]);
  });

  test("and statements that never return a row are weighed too, before they run", async () => {
    // The channel a row-only budget cannot see: a statement's text and its bound values are
    // re-rendered into every later prompt, and the values are where a person's own data reaches.
    const desk = bulkyDesk();
    const { result, steps, prompts } = await desk.run(
      scriptedProvider(reads(`SELECT text FROM ${NOTES_TABLE} WHERE text = ?`, [BULKY_PARAMETER])),
    );

    expect(result).toEqual({ ending: "budget_spent", stepsTaken: QUESTION_STEP_BUDGET });
    const matchedNothing = steps.filter((step) => step.result.outcome === "rows");
    expect(matchedNothing.length).toBeGreaterThan(0);
    for (const step of matchedNothing) {
      expect(step.result).toEqual({ outcome: "rows", rows: [] });
    }
    // The rest are refused *before* the statement runs, on the weight of the call alone.
    const refused = steps.filter((step) => step.result.outcome === "failed");
    expect(refused.length).toBeGreaterThan(0);
    for (const step of refused) {
      expect(step.result).toEqual({ outcome: "failed", message: QUESTION_PAYLOAD_BUDGET_SPENT });
    }
    expect(desk.executed()).toBe(matchedNothing.length);

    // Bounded, where before this budget the same fixture accumulated with the cap reading zero. A
    // refused step still costs the statement, so the bound is the budget plus one per refusal.
    expect(questionPayloadSpent(steps)).toBeLessThan(
      QUESTION_RESULT_PAYLOAD_BUDGET_BYTES + QUESTION_STEP_BUDGET * QUESTION_STEP_RESULT_CAP_BYTES,
    );
    expect(prompts.reduce((sum, prompt) => sum + prompt.length, 0)).toBeLessThan(700_000);
  });

  test("a question that has spent its budget can still be answered from what it read", async () => {
    // The recovery the other way round: not a smaller read, but the answer the refusal offers
    // when there is nothing smaller left to ask for.
    const desk = bulkyDesk();
    const oneRead = `${LONG_ROWS_SQL} LIMIT 5`;
    const { result, steps } = await desk.run(
      scriptedProvider(...Array.from({ length: 5 }, () => reads(oneRead)), answers()),
    );

    if (result.ending !== "answered") throw new Error("the fixture answers");
    expect(steps).toHaveLength(5);
    expect(steps[4]?.result).toEqual({
      outcome: "failed",
      message: QUESTION_PAYLOAD_BUDGET_SPENT,
    });
    expect(questionPayloadSpent(steps)).toBeLessThanOrEqual(QUESTION_RESULT_PAYLOAD_BUDGET_BYTES);
  });
});

describe("a statement too large to carry is refused before it runs", () => {
  test("and is the one refusal recorded without the statement that caused it", async () => {
    const desk = bulkyDesk();
    const { steps } = await desk.run(
      scriptedProvider(
        reads(`SELECT text FROM ${NOTES_TABLE} WHERE text = ?`, ["z".repeat(20 * 1024)]),
        reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`),
        answers(),
      ),
    );

    expect(steps[0]).toEqual({
      call: null,
      // What it would have opened outlives the statement it could not quote: a collection's name
      // is what a person calls their own things, and never the machinery this refusal is about.
      collections: [NOTES_CAPABILITY.label],
      plan: { empty: "no rows" },
      result: { outcome: "failed", message: QUESTION_STATEMENT_TOO_LARGE },
    });
    // Never run, and never quoted back into the prompt that refuses it.
    expect(desk.executed()).toBe(1);
    expect(questionStepBytes(steps[0] as QuestionStep)).toBeLessThan(
      QUESTION_STEP_RESULT_CAP_BYTES,
    );
    // And the loop carries on: the next, ordinary read is admitted.
    expect(steps[1]?.result).toEqual({ outcome: "rows", rows: [{ total: 659 }] });
  });

  test("at the byte", () => {
    expect(questionStatementRefusal(QUESTION_STEP_RESULT_CAP_BYTES)).toBeNull();
    expect(questionStatementRefusal(QUESTION_STEP_RESULT_CAP_BYTES + 1)).toBe(
      QUESTION_STATEMENT_TOO_LARGE,
    );
  });
});

describe("nothing about the cap reaches a user-facing sentence", () => {
  test("the ending Aluna speaks is unchanged by a question full of refusals", async () => {
    const { result } = await bulkyDesk().run(scriptedProvider(reads(LONG_ROWS_SQL)));

    expect(result.ending).toBe("budget_spent");
    expect(questionEndingNarration(result.ending)).toBe(QUESTION_BUDGET_SPENT_SENTENCE);
    expect(questionEndingNarration("answered")).toBeNull();
  });

  test("and carries no refusal, no size and no count", () => {
    const sentence = QUESTION_BUDGET_SPENT_SENTENCE;

    expect(sentence).not.toMatch(/\d/);
    for (const refusal of REFUSALS) expect(sentence).not.toContain(refusal);
    for (const machinery of [
      "too much",
      "trimmed",
      "narrow",
      "aggregate",
      "GROUP BY",
      "byte",
      "row",
      "size",
      "cap",
      "limit",
      "budget",
    ]) {
      expect({ machinery, present: sentence.includes(machinery) }).toEqual({
        machinery,
        present: false,
      });
    }
  });
});
