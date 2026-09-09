// Where a classified `data_query` stops being a deflection.
//
// The claims here are about the seam rather than about SQL: that only this intent opens a
// scope, that the scope really is the whole catalog and really closes, and that its tokens
// go back on every ending the loop has — an answer, a spent budget, a failed statement and a
// throw. Decision 11 asks for release in `finally`, and `finally` is only worth what the
// endings that reach it prove.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { IntentClassification, IntentType } from "../../pipeline/intent/index.ts";
import {
  createQueryWorker,
  QUESTION_STEP_BUDGET,
  type QuestionDecision,
  type QuestionStep,
  READ_ONLY_QUERY_TOOL,
} from "../../runtime/query/index.ts";
import {
  answers,
  catalogueWithRecords,
  EXPENSES_TABLE,
  NOTES_TABLE,
  reads,
  scriptedProvider,
} from "../../runtime/query/question.test-support.ts";
import {
  createScratchPlatforms,
  gatesFor,
  readerCounts,
  type ScratchPlatforms,
} from "../../runtime/query/read-scope.test-support.ts";
import { NotADataQuestionError, runDataQuery } from "./data-query.ts";

let platforms: ScratchPlatforms;

function intent(type: IntentType): IntentClassification {
  return {
    type,
    confidence: 0.9,
    target_capability: type === "data_query" ? null : "notes",
    resolution: type === "data_query" ? "none" : "extend",
    proposed_identity: null,
    proposed_action: "Look at what is saved.",
    user_facing_label: "Let me look at what you've saved.",
    requires_confirmation: false,
  } as IntentClassification;
}

function desk() {
  const platform = platforms.migrated();
  catalogueWithRecords(platform.database.readwrite);
  const readGates = gatesFor(platform.database);
  return {
    platform,
    readGates,
    deps(...decisions: readonly QuestionDecision[]) {
      return {
        provider: scriptedProvider(...decisions),
        readGates,
        database: platform.database.readonly,
        createWorker: () => createQueryWorker(platform.path),
      };
    },
  };
}

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

describe("a classified data_query", () => {
  test("opens the whole-catalog scope, calls the one tool and gets rows from the worker", async () => {
    const scratch = desk();
    const steps: QuestionStep[] = [];

    const loop = await runDataQuery(
      scratch.deps(
        reads(`SELECT sum(amount) AS spent FROM ${EXPENSES_TABLE} WHERE text = ?`, ["groceries"]),
        answers(),
      ),
      {
        intent: intent("data_query"),
        question: "how much did I spend on groceries?",
        onStep: (step) => steps.push(step),
      },
    );

    expect(loop.ending).toBe("answered");
    expect(steps.map((step) => step.call?.tool)).toEqual([READ_ONLY_QUERY_TOOL]);
    expect(steps[0]?.result).toEqual({ outcome: "rows", rows: [{ spent: 12.5 }] });
  });

  test("keeps taking turns inside the one scope until the model stops reading", async () => {
    const scratch = desk();

    const loop = await runDataQuery(
      scratch.deps(
        reads(`SELECT DISTINCT text FROM ${NOTES_TABLE}`),
        reads(`SELECT count(*) AS total FROM ${NOTES_TABLE} WHERE text = ?`, ["groceries"]),
        answers(),
      ),
      { intent: intent("data_query"), question: "how many notes are about groceries?" },
    );

    if (loop.ending !== "answered") throw new Error("the fixture answers");
    expect(loop.steps).toHaveLength(2);
    expect(loop.steps[1]?.result).toEqual({ outcome: "rows", rows: [{ total: 2 }] });
  });

  test("hands each result back where the model reads it", async () => {
    const scratch = desk();
    const deps = scratch.deps(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`), answers());

    await runDataQuery(deps, {
      intent: intent("data_query"),
      question: "how many notes do I have?",
    });

    const prompts = (deps.provider as { prompts: string[] }).prompts;
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("how many notes do I have?");
    expect(prompts[1]).toContain('"total":3');
  });

  test("gives the scope back when the question is answered", async () => {
    const scratch = desk();

    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
    await runDataQuery(
      scratch.deps(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`), answers()),
      { intent: intent("data_query"), question: "how many notes do I have?" },
    );
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });

  test("gives the scope back when the budget is spent", async () => {
    const scratch = desk();

    const loop = await runDataQuery(
      scratch.deps(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)),
      { intent: intent("data_query"), question: "how many notes do I have?" },
    );

    expect(loop).toEqual({ ending: "budget_spent", stepsTaken: QUESTION_STEP_BUDGET });
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });

  test("a failed statement still ends the scope cleanly rather than throwing", async () => {
    const scratch = desk();

    const loop = await runDataQuery(
      scratch.deps(reads(`UPDATE ${NOTES_TABLE} SET text = 'x'`), answers()),
      { intent: intent("data_query"), question: "rewrite my notes" },
    );

    // Nothing was read, so the question ends having found nothing; what this fixture is about
    // is that the refusal travelled back as a step and the scope went back with it.
    if (loop.ending === "budget_spent") throw new Error("the fixture stops after one step");
    expect(loop.steps[0]?.result.outcome).toBe("failed");
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });

  test("a question that ends mid-flight gives the scope back too", async () => {
    const scratch = desk();
    const deps = scratch.deps(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`), answers());

    // The gate closing under a running question is what 6.2/03 made a kill; what matters
    // here is that the throw travels out through the scope's own `finally`.
    const failing = runDataQuery(
      {
        ...deps,
        readActiveCatalog: () => {
          throw new Error("the catalog went away mid-question");
        },
      },
      { intent: intent("data_query"), question: "how many notes do I have?" },
    );

    await expect(failing).rejects.toThrow(/went away/);
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });
});

describe("every other intent", () => {
  test("never opens a read scope", async () => {
    for (const type of ["new_capability", "extend_capability", "ui_change", "reject"] as const) {
      const scratch = desk();
      const deps = scratch.deps(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`));

      await expect(
        runDataQuery(deps, { intent: intent(type), question: "build me a thing" }),
      ).rejects.toBeInstanceOf(NotADataQuestionError);

      // Nothing was asked of the model and no token was taken.
      expect((deps.provider as { prompts: string[] }).prompts).toEqual([]);
      expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
    }
  });
});
