// Zero matched rows is never stated as a fact about this person's life (PLAN decision 17).
//
// The desk is one collection whose three rows are filed under one word and whose amounts cancel,
// so the same statement asked under two words is the pair the whole issue is about: one word
// nothing is filed under, one word whose rows really do add to zero.
//
// Everything here runs against the real worker, because the claim is about what SQLite answers.
// The two results decision 17 names get a fixture each — a `count` answering `0`, a `sum`
// answering `NULL` — and they are one situation and two results.
//
// The adversarial block is the load-bearing one. A returned value cannot be read on its own, so
// the fixtures there are the statements a model would have to write to make the platform say a
// zero it never matched: a defaulted sum, a bound value echoed into the select list, a literal, a
// count with arithmetic on it, an EXISTS with no aggregate at all.
//
// Whether the two sentences read as speech is the sign-off gate's, not a fixture's.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { QueryWorkerRow } from "./query-worker.ts";
import {
  answers,
  EXPENSES_CAPABILITY,
  EXPENSES_TABLE,
  NOTES_CAPABILITY,
  NOTES_TABLE,
  type QuestionDesk,
  questionDesk,
  reads,
  registeredSpecs,
  SCRIPTED_ANSWER,
  scriptedProvider,
  scriptedProviderSaying,
} from "./question.test-support.ts";
import { QUESTION_ANSWER_NOTHING_MATCHED, questionAnswerSchema } from "./question-answer.ts";
import {
  QUESTION_NOTHING_FOUND,
  QUESTION_NOTHING_FOUND_ANYWHERE,
  QUESTION_NOTHING_WORKED,
  questionNothingFoundSentence,
} from "./question-narration.ts";
import {
  type QuestionStepPlan,
  questionFoundNothing,
  questionStepMatchedRows,
} from "./question-nothing-found.ts";
import { QUESTION_COMPUTATION_RULES, type QuestionStep } from "./question-turn.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";
import { assertWholeCatalogQuery } from "./whole-catalog-query-scope.ts";

let platforms: ScratchPlatforms;

/** A word nothing on this desk is filed under, and the one a question about it would use. */
const UNSPENT = "cheese";

/** The word all three rows are filed under, whose amounts cancel: a zero the data does support. */
const REFUNDED = "refund";
const REFUNDED_AMOUNTS = [5, -3, -2];

const TOTAL_UNDER = `SELECT sum(amount) AS total FROM ${EXPENSES_TABLE} WHERE text = ?`;
const COUNT_UNDER = `SELECT count(*) AS how_many FROM ${EXPENSES_TABLE} WHERE text = ?`;
const ROWS_UNDER = `SELECT amount FROM ${EXPENSES_TABLE} WHERE text = ?`;
const EVERY_CATEGORY = `SELECT DISTINCT text AS category FROM ${EXPENSES_TABLE}`;

function seedRefunds(database: Database): void {
  database.run(`DELETE FROM ${EXPENSES_TABLE}`);
  const insert = database.prepare(
    `INSERT INTO ${EXPENSES_TABLE} (id, created_at, extra, text, amount) VALUES (?, ?, '{}', ?, ?)`,
  );
  REFUNDED_AMOUNTS.forEach((amount, index) => {
    insert.run(`refund-${index}`, "2026-07-08 09:00:00", REFUNDED, amount);
  });
  insert.finalize();
}

function refundDesk(): QuestionDesk {
  return questionDesk(platforms, seedRefunds);
}

/** One statement, run under one word, and then answered. */
function askUnder(desk: QuestionDesk, sql: string, parameters: readonly string[] = [UNSPENT]) {
  return desk.run(
    scriptedProvider(reads(sql, [...parameters], "totalling"), answers()),
    `what about ${parameters[0] ?? "everything"}?`,
  );
}

/** What she said, for a result of either speaking ending. */
function said(run: Awaited<ReturnType<QuestionDesk["run"]>>): string {
  return run.result.ending === "budget_spent" ? "" : run.result.answer;
}

/** What the bound reads off one statement's plan, without running the statement. */
function planOf(desk: QuestionDesk, sql: string, parameters: readonly string[] = []) {
  const database = desk.database.readonly;
  return assertWholeCatalogQuery(database, registeredSpecs(database), sql, [...parameters]).plan;
}

/** A step built by hand, for the sentence and for results SQLite would need contriving to make. */
function stepOf(
  rows: readonly QueryWorkerRow[],
  plan: QuestionStepPlan,
  collections: readonly string[] = [EXPENSES_CAPABILITY.label],
): QuestionStep {
  return { call: null, collections, plan, result: { outcome: "rows", rows } };
}

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

describe("the platform reads the plan, so no step's classification is the model's", () => {
  test("a sum answers NULL over nothing, so its plan promises no figure that answers zero", () => {
    expect(planOf(refundDesk(), TOTAL_UNDER, [UNSPENT])).toEqual({ empty: "one row", answers: [] });
  });

  test("a count answers zero, and the plan says so for the column that carries it", () => {
    expect(planOf(refundDesk(), COUNT_UNDER, [UNSPENT])).toEqual({
      empty: "one row",
      answers: [0],
    });
  });

  test("a whole-table count is the same promise through a different opcode", () => {
    expect(planOf(refundDesk(), `SELECT count(*) AS how_many FROM ${EXPENSES_TABLE}`)).toEqual({
      empty: "one row",
      answers: [0],
    });
  });

  test("a statement that aggregates nothing hands back a row only when a row matched", () => {
    expect(planOf(refundDesk(), ROWS_UNDER, [UNSPENT])).toEqual({ empty: "no rows" });
  });

  test("a count the result never reads is not one of its answers", () => {
    // Read off the registers the result row is built from, so a count in a subquery or a HAVING
    // cannot inflate what the empty row is allowed to hold and silence a real zero.
    const desk = refundDesk();
    const inner = `${TOTAL_UNDER} AND (SELECT count(*) FROM ${EXPENSES_TABLE}) > 0`;
    const having = `SELECT sum(amount) AS total FROM ${EXPENSES_TABLE} GROUP BY text HAVING count(*) > 0`;

    expect(planOf(desk, inner, [UNSPENT])).toEqual({ empty: "one row", answers: [] });
    expect(planOf(desk, having)).toEqual({ empty: "one row", answers: [] });
  });
});

describe("NULL from a sum over no rows", () => {
  test("is a search that matched nothing, and she says so about her search", async () => {
    const run = await askUnder(refundDesk(), TOTAL_UNDER);

    expect(run.steps[0]?.result).toEqual({ outcome: "rows", rows: [{ total: null }] });
    expect(questionStepMatchedRows(run.steps[0] as QuestionStep)).toBe(false);
    expect(run.result.ending).toBe("nothing_found");
    expect(said(run)).toBe(
      `Looking at your ${EXPENSES_CAPABILITY.label}, ${QUESTION_NOTHING_FOUND}`,
    );
  });

  test("and the NULL is never read out as a zero, because no generation is asked for one", async () => {
    const run = await askUnder(refundDesk(), TOTAL_UNDER);

    expect(run.answerPrompts).toEqual([]);
    // The sentence is the whole of what she says, and it carries no figure at all.
    expect(QUESTION_NOTHING_FOUND).not.toMatch(/\d/);
  });
});

describe("zero from a count", () => {
  test("is the same situation through a different result, and ends the same way", async () => {
    const run = await askUnder(refundDesk(), COUNT_UNDER);

    expect(run.steps[0]?.result).toEqual({ outcome: "rows", rows: [{ how_many: 0 }] });
    expect(questionStepMatchedRows(run.steps[0] as QuestionStep)).toBe(false);
    expect(run.result.ending).toBe("nothing_found");
    expect(said(run)).toContain(QUESTION_NOTHING_FOUND);
  });

  test("and a count that is not zero is rows, so the ordinary answer is written", async () => {
    const run = await askUnder(refundDesk(), COUNT_UNDER, [REFUNDED]);

    expect(run.steps[0]?.result).toEqual({ outcome: "rows", rows: [{ how_many: 3 }] });
    expect(run.result.ending).toBe("answered");
  });
});

describe("rows that matched and total zero", () => {
  test("are a zero the data supports, so the answer is written the ordinary way", async () => {
    const run = await askUnder(refundDesk(), TOTAL_UNDER, [REFUNDED]);

    expect(run.steps[0]?.result).toEqual({ outcome: "rows", rows: [{ total: 0 }] });
    expect(questionStepMatchedRows(run.steps[0] as QuestionStep)).toBe(true);
    expect(run.result.ending).toBe("answered");
    // The figure crosses whole, which is what lets her state it.
    expect(run.answerPrompts[0]).toContain('"total":0');
  });

  test("and the two endings are told apart by the result alone, not by the statement", async () => {
    const desk = refundDesk();
    const nothing = await askUnder(desk, TOTAL_UNDER);
    const zero = await askUnder(desk, TOTAL_UNDER, [REFUNDED]);

    expect(desk.statements()).toEqual([TOTAL_UNDER, TOTAL_UNDER]);
    expect(nothing.result.ending).toBe("nothing_found");
    expect(zero.result.ending).toBe("answered");
  });

  test("and an average of exactly zero is a figure too, rounding in the SQL included", async () => {
    const desk = refundDesk();
    const rounded = `SELECT round(avg(amount), 2) AS average FROM ${EXPENSES_TABLE} WHERE text = ?`;

    expect((await askUnder(desk, rounded, [REFUNDED])).result.ending).toBe("answered");
    expect((await askUnder(desk, rounded)).result.ending).toBe("nothing_found");
  });
});

describe("a read that came back with no rows at all", () => {
  test("matched nothing, whatever its plan says", async () => {
    const run = await askUnder(refundDesk(), ROWS_UNDER);

    expect(run.steps[0]?.result).toEqual({ outcome: "rows", rows: [] });
    expect(run.result.ending).toBe("nothing_found");
  });
});

describe("a question whose statements never came back", () => {
  test("did not search, so she does not report a search", async () => {
    // She found four hundred rows and could not carry them. *I couldn't find anything* would be
    // a false claim about her own search, which is the same untruth pointed the other way.
    const run = await refundDesk().run(
      scriptedProvider(reads(`SELECT nowhere FROM ${NOTES_TABLE}`), answers()),
      "what about anything?",
    );

    expect(run.steps[0]?.result.outcome).toBe("failed");
    expect(run.result).toMatchObject({ ending: "nothing_worked", answer: QUESTION_NOTHING_WORKED });
    expect(said(run)).not.toContain("no such column");
  });

  test("and neither does a question that ran no statement at all", async () => {
    const run = await refundDesk().run(scriptedProvider(answers()), "what about anything?");

    expect(run.result).toEqual({
      ending: "nothing_worked",
      steps: [],
      answer: QUESTION_NOTHING_WORKED,
    });
    expect(run.answerPrompts).toEqual([]);
  });
});

describe("the model cannot override the classification", () => {
  test("a model writing the forbidden sentence is not the one who ends the question", async () => {
    const claiming = questionAnswerSchema.parse({
      looked_at: `Looking at your ${EXPENSES_CAPABILITY.label}`,
      found: `you spent nothing on ${UNSPENT}`,
    });
    const run = await refundDesk().run(
      scriptedProviderSaying(claiming, reads(TOTAL_UNDER, [UNSPENT], "totalling"), answers()),
      `how much did I spend on ${UNSPENT}?`,
    );

    // It was never asked: nothing found runs no answer generation, so there is no sentence of
    // the model's anywhere in this ending.
    expect(run.answerPrompts).toEqual([]);
    expect(said(run)).not.toContain(claiming.found);
    expect(said(run)).not.toBe(SCRIPTED_ANSWER);
    expect(said(run)).toContain(QUESTION_NOTHING_FOUND);
  });

  test("and neither is a model writing SQL that answers where SQLite would not", async () => {
    // Every one of these hands back a value out of nothing — a defaulted null, a bound value
    // echoed back, a literal, arithmetic on a count, a plan with no aggregate at all. The plan
    // stops being readable, and an unreadable plan promises nothing.
    const desk = refundDesk();
    const forged = [
      [`SELECT coalesce(sum(amount), 0) AS total FROM ${EXPENSES_TABLE} WHERE text = ?`, [UNSPENT]],
      [`SELECT ifnull(sum(amount), 0) AS total FROM ${EXPENSES_TABLE} WHERE text = ?`, [UNSPENT]],
      [
        `SELECT ? AS category, count(*) AS how_many FROM ${EXPENSES_TABLE} WHERE text = ?`,
        [UNSPENT, UNSPENT],
      ],
      [
        `SELECT 'nothing' AS what, sum(amount) AS total FROM ${EXPENSES_TABLE} WHERE text = ?`,
        [UNSPENT],
      ],
      [`SELECT count(*) + 1 AS how_many FROM ${EXPENSES_TABLE} WHERE text = ?`, [UNSPENT]],
      [`SELECT EXISTS(SELECT 1 FROM ${EXPENSES_TABLE} WHERE text = ?) AS any_at_all`, [UNSPENT]],
      [`SELECT json_group_array(text) AS items FROM ${EXPENSES_TABLE} WHERE text = ?`, [UNSPENT]],
      [`SELECT total(amount) AS total FROM ${EXPENSES_TABLE} WHERE text = ?`, [UNSPENT]],
    ] as const;

    for (const [sql, parameters] of forged) {
      const run = await askUnder(desk, sql, parameters);
      expect([sql, run.result.ending]).toEqual([sql, "nothing_found"]);
      expect([sql, run.answerPrompts]).toEqual([sql, []]);
    }
  });

  test("and the turn asks for the shape that keeps the difference readable", () => {
    expect(QUESTION_COMPUTATION_RULES.join(" ")).toContain("coalesce");
  });
});

describe("a question that found something as well", () => {
  test("is written by the model, and the step that matched nothing carries no figure", async () => {
    const run = await refundDesk().run(
      scriptedProvider(
        reads(EVERY_CATEGORY, [], "naming"),
        reads(TOTAL_UNDER, [UNSPENT], "totalling"),
        answers(),
      ),
      `how much did I spend on ${UNSPENT}?`,
    );
    const prompt = run.answerPrompts[0] as string;

    expect(run.result.ending).toBe("answered");
    // She still says she looked there, and there is no NULL beside it to read as a zero.
    expect(prompt).toContain(QUESTION_ANSWER_NOTHING_MATCHED);
    expect(prompt).toContain(UNSPENT);
    expect(prompt).not.toContain('"total":null');
  });

  test("and a model that would claim it anyway has no figure in the prompt to claim from", async () => {
    // The honest bound on the mixed path, recorded rather than asserted away: once any step
    // matched, the sentence is the model's. What the platform holds is that the unmatched step
    // carries no figure, so a claim about it is a fabrication rather than a misread result.
    const claiming = questionAnswerSchema.parse({
      looked_at: `Looking at your ${EXPENSES_CAPABILITY.label}`,
      found: `you spent nothing on ${UNSPENT}`,
    });
    const run = await refundDesk().run(
      scriptedProviderSaying(
        claiming,
        reads(EVERY_CATEGORY, [], "naming"),
        reads(TOTAL_UNDER, [UNSPENT], "totalling"),
        answers(),
      ),
      `how much did I spend on ${UNSPENT}?`,
    );

    expect(run.result.ending).toBe("answered");
    expect(said(run)).toContain(claiming.found);
    expect(run.answerPrompts[0]).not.toContain("null");
  });
});

describe("what she says when a search matched nothing", () => {
  test("names one collection, two, or three, and never what the model bound", () => {
    const one = stepOf([], { empty: "no rows" });
    const two = stepOf([], { empty: "no rows" }, [
      EXPENSES_CAPABILITY.label,
      NOTES_CAPABILITY.label,
    ]);
    const three = stepOf([], { empty: "no rows" }, ["A", "B", "C"]);

    expect(questionNothingFoundSentence([one])).toBe(
      `Looking at your ${EXPENSES_CAPABILITY.label}, ${QUESTION_NOTHING_FOUND}`,
    );
    expect(questionNothingFoundSentence([two])).toContain(
      `${EXPENSES_CAPABILITY.label} and ${NOTES_CAPABILITY.label},`,
    );
    expect(questionNothingFoundSentence([three])).toContain("A, B and C,");
  });

  test("names a collection once however many steps read it", () => {
    const step = stepOf([], { empty: "no rows" });

    expect(questionNothingFoundSentence([step, step, step])).toBe(
      questionNothingFoundSentence([step]),
    );
  });

  test("and claims nothing at all when no statement of hers opened a collection", () => {
    expect(questionNothingFoundSentence([stepOf([], { empty: "no rows" }, [])])).toBe(
      QUESTION_NOTHING_FOUND_ANYWHERE,
    );
  });
});

describe("what one result means, read off the values and the plan", () => {
  test("a count's zero is nothing matched, and a sum's zero is a total", () => {
    expect(questionStepMatchedRows(stepOf([{ n: 0 }], { empty: "one row", answers: [0] }))).toBe(
      false,
    );
    expect(questionStepMatchedRows(stepOf([{ total: 0 }], { empty: "one row", answers: [] }))).toBe(
      true,
    );
  });

  test("a count and a sum together answer 0 and NULL, and that is still nothing matched", () => {
    const plan = { empty: "one row", answers: [0] } as const;

    expect(questionStepMatchedRows(stepOf([{ n: 0, total: null }], plan))).toBe(false);
    // The same pair over rows that cancel: the count is what proves a row was seen.
    expect(questionStepMatchedRows(stepOf([{ n: 3, total: 0 }], plan))).toBe(true);
    // And a second zero against one count is a row that was scanned into it.
    expect(questionStepMatchedRows(stepOf([{ n: 0, other: 0 }], plan))).toBe(true);
  });

  test("a row of nothing but nulls is the row an aggregate returns over nothing", () => {
    const plan = { empty: "one row", answers: [] } as const;

    expect(questionStepMatchedRows(stepOf([{ earliest: null, latest: null }], plan))).toBe(false);
    expect(questionStepMatchedRows(stepOf([{ earliest: "2026-07-01" }], plan))).toBe(true);
  });

  test("an unreadable plan promises nothing, so its step matched nothing", () => {
    expect(questionStepMatchedRows(stepOf([{ total: 0 }], { empty: "unreadable" }))).toBe(false);
    expect(questionStepMatchedRows(stepOf([{ total: 42 }], { empty: "unreadable" }))).toBe(false);
  });

  test("a failed step matched nothing, and is not a search she may report", () => {
    const failed: QuestionStep = {
      call: null,
      collections: [],
      plan: { empty: "unreadable" },
      result: { outcome: "failed", message: "no such column" },
    };

    expect(questionStepMatchedRows(failed)).toBe(false);
    expect(questionFoundNothing([failed])).toBe(false);
    expect(
      questionFoundNothing([failed, stepOf([{ n: 0 }], { empty: "one row", answers: [0] })]),
    ).toBe(true);
    expect(
      questionFoundNothing([failed, stepOf([{ n: 4 }], { empty: "one row", answers: [0] })]),
    ).toBe(false);
  });

  test("a question that took no step at all searched nothing", () => {
    expect(questionFoundNothing([])).toBe(false);
  });
});
