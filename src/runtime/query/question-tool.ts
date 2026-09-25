// The one tool a question is offered (PLAN decisions 5, 6 and 14; ADR-0008). It is the physically
// read-only adapter — no second tool, no escape hatch — and every statement runs in the worker
// against the database file attached `mode=ro`, so a mutating statement fails at the SQLite seam.
// What lives here is an offer, not a guard, and nothing in this file may become that seam.
//
// `questionToolCallSchema` is derived from `QUESTION_TOOLS` and the derivation refuses an inventory
// holding anything but one tool, or a second tool could be described in the prompt while the schema
// admitted only the first. None of this is `CapabilitySpec.tools` (`src/registry/tools.ts`).
//
// The wire shape is what OpenAI's strict structured outputs accept: every property required,
// `additionalProperties: false`, `enum`s rather than `const`s. `read` is required-and-nullable
// because strict mode refuses an absent key, as `proposed_identity` is in `src/pipeline/intent`.

import { z } from "zod";

import type { QueryWorkerValue } from "./query-worker.ts";

/** The only tool there is. */
export const READ_ONLY_QUERY_TOOL = "run_read_only_query";

/**
 * One bound value, narrower than {@link QueryWorkerValue}, which also carries `Uint8Array`: a
 * model emits JSON, so promising a blob would describe something that never arrives.
 */
export const questionParameterSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]) satisfies z.ZodType<QueryWorkerValue>;
export type QuestionParameter = z.infer<typeof questionParameterSchema>;

// Non-blank through a refinement rather than `.min(1)`: a refinement emits nothing into the JSON
// Schema, and `minLength` is a keyword OpenAI's strict `json_schema` mode rejects.
const sqlText = z.string().refine((text) => text.trim().length > 0, "must not be blank");

/**
 * The kinds of step there are (decision 14). `question-narration.ts` keys one authored sentence
 * to each, through a switch a seventh member fails type-check against.
 */
export const QUESTION_STEP_LABELS = [
  "naming",
  "counting",
  "totalling",
  "listing",
  "dates",
  "other",
] as const;

export const questionStepLabelSchema = z.enum(QUESTION_STEP_LABELS);
export type QuestionStepLabel = z.infer<typeof questionStepLabelSchema>;

/** The label a step with no readable call falls back to (6.3/02); see `question-narration.ts`. */
export const QUESTION_STEP_FALLBACK_LABEL: QuestionStepLabel = "other";

/**
 * What each label means, in the model's own terms, rendered into the tool's description off this
 * record so the prompt cannot describe a vocabulary the schema does not gate. Never shown.
 */
export const QUESTION_STEP_LABEL_HINTS = Object.freeze({
  naming: "reading the distinct values of a field, to find out what this person calls things",
  counting: "counting how many rows there are",
  totalling: "adding a number up across rows — a sum, or an average built from one",
  listing: "reading the rows themselves",
  dates: "looking at when rows were saved, or narrowing to a stretch of time",
  other: "none of the above describes this step; pick it last",
}) satisfies Readonly<Record<QuestionStepLabel, string>>;

const readOnlyQueryCallSchema = z.strictObject({
  tool: z.enum([READ_ONLY_QUERY_TOOL]),
  /** One statement. The worker refuses a second one riding behind a `;`. */
  sql: sqlText,
  /**
   * Which of decision 14's kinds of step this is, and deliberately the only thing the model
   * may say about what a step is: there is no field here for words of its own.
   */
  label: questionStepLabelSchema,
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
    "Set label to the kind of step this is, so the person can be told what is happening. One of:",
    ...QUESTION_STEP_LABELS.map((label) => `  ${label} — ${QUESTION_STEP_LABEL_HINTS[label]}`),
  ]),
  call: readOnlyQueryCallSchema,
});

/**
 * The offered set. Frozen, and one member: this array is what the prompt describes and what
 * the turn's schema is derived from, so the count is the offer rather than a claim about it.
 */
export const QUESTION_TOOLS: readonly QuestionTool[] = Object.freeze([readOnlyQueryTool]);

/**
 * The single offered tool, or a throw. Called at module load below, so an inventory that grew a
 * second member fails the process rather than offering one tool and validating another.
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

/**
 * What a turn may decide: run one more read, stop reading and answer from what it has, or say
 * this desk holds nowhere for what was asked about (decision 20). The third runs no statement
 * and writes no answer; `question-no-home.ts` is where it ends.
 */
export const QUESTION_DECISIONS = ["read", "answer", "no_home"] as const;
export type QuestionNextStep = (typeof QUESTION_DECISIONS)[number];

const questionDecisionObject = z.strictObject({
  next: z.enum(QUESTION_DECISIONS),
  /** The statement to run, and `null` for either decision that stops reading. */
  read: questionToolCallSchema.nullable(),
});

/**
 * The schema one turn's generation is validated against. The refinement makes the two fields one
 * decision, so the turn refuses every mismatch rather than handing the loop a shape to interpret.
 */
export const questionDecisionSchema = questionDecisionObject.superRefine((decision, ctx) => {
  if (decision.next === "read" && decision.read === null) {
    ctx.addIssue({ code: "custom", path: ["read"], message: "a read must carry its statement" });
  }
  if (decision.next !== "read" && decision.read !== null) {
    ctx.addIssue({ code: "custom", path: ["read"], message: "only a read runs a statement" });
  }
});

export type QuestionDecision = z.infer<typeof questionDecisionSchema>;
