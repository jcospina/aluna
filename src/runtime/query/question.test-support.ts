// The two things every question suite needs and neither should invent twice: a desk with
// real capability tables holding real rows, and a provider that answers with the decisions
// the test chose.
//
// The tables are physical on purpose. A question's whole claim is that a statement runs in
// the read-only worker against the one documented database file, and a fake worker over a
// fixed row set can prove none of it — not that a write fails at the SQLite seam, not that
// an unknown column comes back as words the model can read, and not that a bound parameter
// is bound rather than pasted. This module is not run as a test by bun.

import type { Database } from "bun:sqlite";

import type { DeepPartial, GenerateResult, Provider } from "../../platform/provider/index.ts";
import {
  type CapabilitySpec,
  capabilitySpecFromRow,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import { validSpec } from "../../registry/spec/spec.test-support.ts";
import { insertCapability } from "../../registry/store/store.ts";
import { applyCapabilityTableDdl } from "../data/index.ts";
import { QUESTION_STEP_BUDGET } from "./question-loop.ts";
import {
  type QuestionDecision,
  type QuestionToolCall,
  READ_ONLY_QUERY_TOOL,
} from "./question-tool.ts";
import {
  buildQuestionTurnPrompt,
  type QuestionStep,
  type QuestionTurnDeps,
  type QuestionTurnInput,
  runQuestionTurn,
} from "./question-turn.ts";

export const NOTES_CAPABILITY = {
  id: "notes",
  incarnationId: "11111111-1111-4111-8111-111111111111",
};
export const EXPENSES_CAPABILITY = {
  id: "expenses",
  incarnationId: "22222222-2222-4222-8222-222222222222",
};

export const NOTES_TABLE = "cap_notes";
export const EXPENSES_TABLE = "cap_expenses";

function notesSpec(): CapabilitySpec {
  return validSpec({
    id: NOTES_CAPABILITY.id,
    label: "Notes",
    noun: "note",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
      ],
    },
    prompt_context: "Stores the user's text notes.",
  });
}

function expensesSpec(): CapabilitySpec {
  return validSpec({
    id: EXPENSES_CAPABILITY.id,
    label: "Expenses",
    noun: "expense",
    schema: {
      fields: [
        { name: "text", label: "What", type: "string", required: true, lifecycle: "active" },
        { name: "amount", label: "Amount", type: "number", required: true, lifecycle: "active" },
      ],
    },
    prompt_context: "Stores what the user spent.",
  });
}

function register(database: Database, spec: CapabilitySpec, incarnationId: string): void {
  insertCapability(
    {
      ...spec,
      incarnation_id: incarnationId,
      version: 1,
      artifacts_path: `capabilities/${spec.id}/${incarnationId}/v1/`,
      seed: 184206,
    },
    database,
  );
  applyCapabilityTableDdl(spec, database);
}

/**
 * Two registered capabilities with their physical tables and a few rows each: three notes,
 * and two expenses whose `text` deliberately matches one of the notes so a statement that
 * joins the two collections has something to find.
 */
export function catalogueWithRecords(database: Database): readonly CapabilitySpec[] {
  const specs = [notesSpec(), expensesSpec()];
  register(database, specs[0] as CapabilitySpec, NOTES_CAPABILITY.incarnationId);
  register(database, specs[1] as CapabilitySpec, EXPENSES_CAPABILITY.incarnationId);

  const note = database.prepare(
    `INSERT INTO ${NOTES_TABLE} (id, created_at, extra, text) VALUES (?, ?, '{}', ?)`,
  );
  note.run("note-1", "2026-07-01 09:00:00", "groceries");
  note.run("note-2", "2026-07-02 09:00:00", "rent");
  note.run("note-3", "2026-08-01 09:00:00", "groceries");
  note.finalize();

  const expense = database.prepare(
    `INSERT INTO ${EXPENSES_TABLE} (id, created_at, extra, text, amount) VALUES (?, ?, '{}', ?, ?)`,
  );
  expense.run("expense-1", "2026-07-03 09:00:00", "groceries", 12.5);
  expense.run("expense-2", "2026-07-04 09:00:00", "rent", 900);
  expense.finalize();

  return specs;
}

/** The specs the registry holds, in the order `readActiveRegistryCatalog` returns them. */
export function registeredSpecs(database: Database): readonly CapabilitySpec[] {
  return readActiveRegistryCatalog(database).capabilities.map(capabilitySpecFromRow);
}

/** A decision to run one statement. */
export function reads(
  sql: string,
  parameters: QuestionToolCall["parameters"] = [],
): QuestionDecision {
  return { next: "read", read: { tool: READ_ONLY_QUERY_TOOL, sql, parameters } };
}

/** A decision to stop reading. What Aluna then says is 6.4's. */
export function answers(): QuestionDecision {
  return { next: "answer", read: null };
}

/**
 * One turn that ran a statement, for a suite that scripts only `read` decisions — a turn
 * that came back as an answer there is the fixture having drifted rather than a case to
 * handle. The decision itself, and the budget it is spent against, belong to
 * `question-loop.test.ts`.
 */
export async function oneTurn(
  deps: QuestionTurnDeps,
  input: Omit<QuestionTurnInput, "budget">,
): Promise<QuestionStep> {
  const turn = await runQuestionTurn(deps, { ...input, budget: QUESTION_STEP_BUDGET });
  if (turn.kind !== "step") throw new Error("the scripted decision was a read; the turn was not");
  return turn.step;
}

/** The prompt the next turn of a question would be built from, at a fresh budget. */
export function nextPrompt(
  question: string,
  specs: readonly CapabilitySpec[],
  steps: readonly QuestionStep[],
): string {
  return buildQuestionTurnPrompt({ question, specs, steps, budget: QUESTION_STEP_BUDGET });
}

/**
 * A provider that resolves `object` to whatever the test chose, in order, *without* parsing
 * it — the only way to exercise the turn's own re-validation, which is what stands between a
 * non-conforming object and the worker. The last value repeats once the list runs out.
 */
export function providerResolving(...values: readonly unknown[]): Provider {
  let next = 0;
  return {
    generate<T>(): GenerateResult<T> {
      const value = values[Math.min(next, values.length - 1)];
      next += 1;
      return {
        partialStream: (async function* () {
          yield value as DeepPartial<T>;
        })(),
        object: Promise.resolve(value as T),
        usage: Promise.resolve({
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        }),
      };
    },
  };
}

/** A provider whose generation faults, the way a connection that is not there does. */
export function providerFaulting(error: Error): Provider {
  return {
    generate<T>(): GenerateResult<T> {
      const object = Promise.reject(error) as Promise<T>;
      object.catch(() => {});
      return {
        partialStream: (async function* () {})(),
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

export interface ScriptedProvider extends Provider {
  /** Every prompt the turn built, in order. */
  readonly prompts: string[];
}

/**
 * A provider that answers each `generate` with the next scripted decision, validated
 * through the same schema the real spine validates against — so a fixture that could never
 * come off the wire fails here rather than passing a test the product would not.
 *
 * A script that runs out repeats its last decision, which is what makes a one-entry script of
 * `reads(...)` a question that never converges — the fixture the ten-step budget needs.
 */
export function scriptedProvider(...decisions: readonly QuestionDecision[]): ScriptedProvider {
  const prompts: string[] = [];
  let next = 0;

  return {
    prompts,
    generate<T>(prompt: string, schema: Parameters<Provider["generate"]>[1]): GenerateResult<T> {
      prompts.push(prompt);
      const scripted = decisions[Math.min(next, decisions.length - 1)];
      next += 1;
      const object = (async () => (schema as { parse(value: unknown): T }).parse(scripted))();
      // A rejected object with nothing awaiting it yet is an unhandled rejection, and the
      // turn awaits it one microtask later.
      object.catch(() => {});
      return {
        partialStream: (async function* () {
          yield scripted as DeepPartial<T>;
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
