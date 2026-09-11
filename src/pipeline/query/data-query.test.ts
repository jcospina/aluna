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
  type FakeWorkerLog,
  fakeWorkers,
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
        signal: undefined,
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
      {
        intent: intent("data_query"),
        question: "how many notes are about groceries?",
        signal: undefined,
      },
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
      signal: undefined,
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
      { intent: intent("data_query"), question: "how many notes do I have?", signal: undefined },
    );
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });

  test("gives the scope back when the budget is spent", async () => {
    const scratch = desk();

    const loop = await runDataQuery(
      scratch.deps(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)),
      { intent: intent("data_query"), question: "how many notes do I have?", signal: undefined },
    );

    expect(loop).toEqual({ ending: "budget_spent", stepsTaken: QUESTION_STEP_BUDGET });
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });

  test("a failed statement still ends the scope cleanly rather than throwing", async () => {
    const scratch = desk();

    const loop = await runDataQuery(
      scratch.deps(reads(`UPDATE ${NOTES_TABLE} SET text = 'x'`), answers()),
      { intent: intent("data_query"), question: "rewrite my notes", signal: undefined },
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
      { intent: intent("data_query"), question: "how many notes do I have?", signal: undefined },
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
        runDataQuery(deps, {
          intent: intent(type),
          question: "build me a thing",
          signal: undefined,
        }),
      ).rejects.toBeInstanceOf(NotADataQuestionError);

      // Nothing was asked of the model and no token was taken.
      expect((deps.provider as { prompts: string[] }).prompts).toEqual([]);
      expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
    }
  });
});

/**
 * How long a test waits before calling a promise stuck rather than slow. Far above the chain of
 * microtasks a cancel and a release take, and no part of any claim here: a regression stops the
 * question for ever rather than slowly.
 */
const SETTLE_MS = 2_000;

/** Wait for the question to be inside a statement, which is where a cancel has work to do. */
async function untilReading(log: FakeWorkerLog): Promise<void> {
  for (let tries = 0; tries < 400 && log.calls.length === 0; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * What the question ended as, or that it never ended. Raced rather than awaited: a cancel that
 * stopped killing would leave the read outstanding for ever, and a regression that hangs the
 * suite is one nobody reads.
 */
async function settled(running: Promise<unknown>): Promise<string> {
  return await Promise.race([
    running.then(
      () => "answered",
      (error: Error) => error.constructor.name,
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), SETTLE_MS)),
  ]);
}

// The person's own two triggers — asking something else, dismissing the answer — arrive as this
// job's cancellation (`public/desk-answer-window.js` raises them, `src/server/app.ts` routes
// them). What is proved here is that they reach 6.2/03's one entry point rather than stopping at
// the model: a question between statements ends, and a question inside one is killed.
describe("a question the person gave up on", () => {
  test("terminates the worker mid-statement and gives the whole catalog back", async () => {
    const scratch = desk();
    // `hold` keeps the statement outstanding, which is the state a cancel has to beat: an
    // in-worker `bun:sqlite` read can never observe a signal, so nothing but a kill ends one.
    const { log, createWorker } = fakeWorkers([], { hold: true });
    const gaveUp = new AbortController();

    const running = runDataQuery(
      {
        ...scratch.deps(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`), answers()),
        createWorker,
      },
      {
        intent: intent("data_query"),
        question: "how many notes do I have?",
        signal: gaveUp.signal,
      },
    );
    await untilReading(log);
    expect(log.calls).toHaveLength(1);

    gaveUp.abort();

    expect(await settled(running)).toBe("WholeCatalogReadCancelledError");
    // Terminated, not waited for. And the token set goes back where a cancelled body unwinds,
    // which is what turns the deletion drain's deadline into a mechanism (decisions 10, 13).
    expect(log.closed).toBe(1);
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });

  test("a question already given up on never opens a worker at all", async () => {
    const scratch = desk();
    const { log, createWorker } = fakeWorkers([], { hold: true });
    const gaveUp = new AbortController();
    gaveUp.abort();

    const running = runDataQuery(
      {
        ...scratch.deps(reads(`SELECT count(*) AS total FROM ${NOTES_TABLE}`), answers()),
        createWorker,
      },
      {
        intent: intent("data_query"),
        question: "how many notes do I have?",
        signal: gaveUp.signal,
      },
    );

    // A person can ask twice inside one tick, and the second question must not leave the first
    // one's thread behind it. The scope opens, the first generation is refused on the signal the
    // cancel aborted, and the whole thing unwinds without a statement ever being written.
    expect(await settled(running)).toBe("ProviderAbortedError");
    expect(log.created).toBe(0);
    expect(log.calls).toEqual([]);
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });
});
