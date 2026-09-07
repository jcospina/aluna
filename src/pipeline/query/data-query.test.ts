// Where a classified `data_query` stops being a deflection.
//
// The claims here are about the seam rather than about SQL: that only this intent opens a
// scope, that the scope really is the whole catalog and really closes, and that the step's
// result comes back somewhere the model can read it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { IntentClassification, IntentType } from "../../pipeline/intent/index.ts";
import {
  createQueryWorker,
  type QuestionToolCall,
  READ_ONLY_QUERY_TOOL,
} from "../../runtime/query/index.ts";
import {
  catalogueWithRecords,
  EXPENSES_TABLE,
  NOTES_TABLE,
  scriptedProvider,
} from "../../runtime/query/question.test-support.ts";
import {
  createScratchPlatforms,
  gatesFor,
  readerCounts,
  type ScratchPlatforms,
} from "../../runtime/query/read-scope.test-support.ts";
import { NotADataQuestionError, runDataQueryTurn } from "./data-query.ts";

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

function call(sql: string, parameters: QuestionToolCall["parameters"] = []): QuestionToolCall {
  return { tool: READ_ONLY_QUERY_TOOL, sql, parameters };
}

function desk() {
  const platform = platforms.migrated();
  catalogueWithRecords(platform.database.readwrite);
  const readGates = gatesFor(platform.database);
  return {
    platform,
    readGates,
    deps(turn: QuestionToolCall) {
      return {
        provider: scriptedProvider(turn),
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

    const turn = await runDataQueryTurn(
      scratch.deps(
        call(`SELECT sum(amount) AS spent FROM ${EXPENSES_TABLE} WHERE text = ?`, ["groceries"]),
      ),
      { intent: intent("data_query"), question: "how much did I spend on groceries?" },
    );

    expect(turn.step.call.tool).toBe(READ_ONLY_QUERY_TOOL);
    expect(turn.step.result).toEqual({ outcome: "rows", rows: [{ spent: 12.5 }] });
  });

  test("hands the result back where the model reads it", async () => {
    const scratch = desk();

    const turn = await runDataQueryTurn(
      scratch.deps(call(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)),
      { intent: intent("data_query"), question: "how many notes do I have?" },
    );

    expect(turn.nextPrompt).toContain("how many notes do I have?");
    expect(turn.nextPrompt).toContain('"total":3');
  });

  test("gives the scope back when the turn is over", async () => {
    const scratch = desk();

    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
    await runDataQueryTurn(scratch.deps(call(`SELECT count(*) AS total FROM ${NOTES_TABLE}`)), {
      intent: intent("data_query"),
      question: "how many notes do I have?",
    });
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });

  test("a failed statement still ends the scope cleanly rather than throwing", async () => {
    const scratch = desk();

    const turn = await runDataQueryTurn(
      scratch.deps(call(`UPDATE ${NOTES_TABLE} SET text = 'x'`)),
      { intent: intent("data_query"), question: "rewrite my notes" },
    );

    expect(turn.step.result.outcome).toBe("failed");
    expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
  });
});

describe("every other intent", () => {
  test("never opens a read scope", async () => {
    for (const type of ["new_capability", "extend_capability", "ui_change", "reject"] as const) {
      const scratch = desk();
      const deps = scratch.deps(call(`SELECT count(*) AS total FROM ${NOTES_TABLE}`));

      await expect(
        runDataQueryTurn(deps, { intent: intent(type), question: "build me a thing" }),
      ).rejects.toBeInstanceOf(NotADataQuestionError);

      // Nothing was asked of the model and no token was taken.
      expect((deps.provider as { prompts: string[] }).prompts).toEqual([]);
      expect(readerCounts(scratch.readGates)).toEqual([0, 0]);
    }
  });
});
