// The one tool a question is offered (PLAN decisions 5 and 6, ADR-0008).
//
// **One tool, and it is the physically read-only adapter.** No second tool, no escape
// hatch, no side channel. An agent loop is normally dangerous because an agent can act;
// this one can only look, so the blast radius is zero by construction rather than by
// behaviour. Every statement written here runs against the worker's
// `SQLITE_OPEN_READONLY` connection, so a mutating statement fails at the SQLite seam
// however wrong the model goes — and nothing in this file is allowed to become that seam.
// What lives here is an *offer*, not a guard.
//
// **The inventory and the schema are one thing.** `questionToolCallSchema` is derived from
// `QUESTION_TOOLS` rather than written beside it, and the derivation refuses an inventory
// that does not hold exactly one tool. A second tool therefore cannot be described in the
// prompt while the schema goes on admitting only the first — which is the shape that would
// make "the model is offered exactly one tool" quietly stop being true.
//
// **Nothing here is `CapabilitySpec.tools`.** That word already names the fixed five-Action
// inventory every capability is born with (`src/registry/tools.ts`); this is the loop's,
// and the two never meet. Hence `QUESTION_TOOLS`.
//
// **A turn's decision is not a second tool.** The loop (6.3/02) asks the model for one of
// two things at every step — read again, or stop reading because there is enough to answer
// — and `questionDecisionSchema` is that choice wrapped around this file's one call. It
// nests the *derived* schema rather than the literal one, so the invariant above survives
// the wrapping: the thing the model may say is still whatever the single offered tool
// describes, and an inventory that grew a second member still fails at load.
//
// The wire shape is checked against what OpenAI's strict structured outputs accept: every
// property required, `additionalProperties: false`, the tool name an `enum` rather than a
// `const`, and the parameter scalar a plain type union — the same union the behavioral
// suite schema already sends through this provider contract. The decision's `read` is
// required-and-nullable for the same reason `proposed_identity` is in
// `src/pipeline/intent/schema.ts`: an absent key is what strict mode refuses, and the
// cross-field rule that makes `null` mean something is a refinement, which emits nothing.

import { z } from "zod";

import type { QueryWorkerValue } from "./query-worker.ts";

/** The only tool there is. */
export const READ_ONLY_QUERY_TOOL = "run_read_only_query";

/**
 * One bound value. Deliberately narrower than {@link QueryWorkerValue}, which also carries
 * `Uint8Array`: a model emits JSON, and promising a blob it cannot write would be a wire
 * shape describing something that never arrives.
 */
export const questionParameterSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]) satisfies z.ZodType<QueryWorkerValue>;
export type QuestionParameter = z.infer<typeof questionParameterSchema>;

// Non-blank through a refinement rather than `.min(1)`: a refinement emits nothing into the
// JSON Schema, and `minLength` is a keyword OpenAI's strict `json_schema` mode rejects. The
// runtime validation is identical; what changes is that the wire shape now matches what the
// header above claims for it, which `question-tool.test.ts` asserts rather than trusts.
const sqlText = z.string().refine((text) => text.trim().length > 0, "must not be blank");

const readOnlyQueryCallSchema = z.strictObject({
  tool: z.enum([READ_ONLY_QUERY_TOOL]),
  /** One statement. The worker refuses a second one riding behind a `;`. */
  sql: sqlText,
  /**
   * The values `?` stands for, in order. Always present — an empty array is how a statement
   * that binds nothing says so, and an *absent* key is what OpenAI's strict mode refuses.
   */
  parameters: z.array(questionParameterSchema),
});

export type QuestionToolCall = z.infer<typeof readOnlyQueryCallSchema>;

export interface QuestionTool {
  readonly name: string;
  /** What the model is told this tool does, rendered into the turn's prompt verbatim. */
  readonly description: readonly string[];
  /** The shape one call to it takes, and the schema its turn is generated against. */
  readonly call: z.ZodType<QuestionToolCall>;
}

const readOnlyQueryTool: QuestionTool = Object.freeze({
  name: READ_ONLY_QUERY_TOOL,
  description: Object.freeze([
    "Run one read-only SQL SELECT across the collections below and get its rows back.",
    "Write one statement. It may join across every collection listed, and no other table exists to it.",
    "Never write a value into the SQL. Put a ? where the value goes and pass the value in parameters, in order.",
    "A statement that fails comes back to you with what went wrong, and you may write another one.",
  ]),
  call: readOnlyQueryCallSchema,
});

/**
 * The offered set. Frozen, and one member: this array is what the prompt describes and what
 * the turn's schema is derived from, so the count is the offer rather than a claim about it.
 */
export const QUESTION_TOOLS: readonly QuestionTool[] = Object.freeze([readOnlyQueryTool]);

/**
 * The single offered tool, or a throw. Called at module load below, so an inventory that
 * grew a second member fails the process rather than silently offering one tool and
 * validating another.
 */
export function theOnlyQuestionTool(tools: readonly QuestionTool[] = QUESTION_TOOLS): QuestionTool {
  const [only] = tools;
  if (!only || tools.length !== 1) {
    throw new Error(
      `A question is offered exactly one tool; this inventory holds ${tools.length}.`,
    );
  }
  return only;
}

/** The one call shape there is, derived from the one offered tool. */
export const questionToolCallSchema = theOnlyQuestionTool().call;

/** What a turn may decide: run one more read, or stop reading and answer from what it has. */
export const QUESTION_DECISIONS = ["read", "answer"] as const;
export type QuestionNextStep = (typeof QUESTION_DECISIONS)[number];

const questionDecisionObject = z.strictObject({
  next: z.enum(QUESTION_DECISIONS),
  /** The statement to run, and `null` when the model is done reading. */
  read: questionToolCallSchema.nullable(),
});

/**
 * The schema one turn's generation is validated against.
 *
 * The refinement is what makes the two fields one decision: a `read` without a statement is
 * a step that cannot run, and an `answer` carrying one is a model asking for a read it just
 * said it does not need. Both come back as a generation the turn refuses rather than as a
 * shape the loop has to interpret.
 */
export const questionDecisionSchema = questionDecisionObject.superRefine((decision, ctx) => {
  if (decision.next === "read" && decision.read === null) {
    ctx.addIssue({ code: "custom", path: ["read"], message: "a read must carry its statement" });
  }
  if (decision.next === "answer" && decision.read !== null) {
    ctx.addIssue({ code: "custom", path: ["read"], message: "an answer runs no statement" });
  }
});

export type QuestionDecision = z.infer<typeof questionDecisionSchema>;
