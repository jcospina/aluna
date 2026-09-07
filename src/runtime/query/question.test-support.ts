// The two things every question suite needs and neither should invent twice: a desk with
// real capability tables holding real rows, and a provider that answers with a tool call
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
import type { QuestionToolCall } from "./question-tool.ts";

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

export interface ScriptedProvider extends Provider {
  /** Every prompt the turn built, in order. */
  readonly prompts: string[];
}

/**
 * A provider that answers each `generate` with the next scripted tool call, validated
 * through the same schema the real spine validates against — so a fixture that could never
 * come off the wire fails here rather than passing a test the product would not.
 */
export function scriptedProvider(...calls: readonly QuestionToolCall[]): ScriptedProvider {
  const prompts: string[] = [];
  let next = 0;

  return {
    prompts,
    generate<T>(prompt: string, schema: Parameters<Provider["generate"]>[1]): GenerateResult<T> {
      prompts.push(prompt);
      const scripted = calls[Math.min(next, calls.length - 1)];
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
