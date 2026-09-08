// The offer itself: exactly one tool, and a wire shape a strict provider will accept.
//
// These assertions are cheap and they are the ones that decay silently. "The model is
// offered exactly one tool" stops being true the moment a second entry is added to an
// inventory nothing counts, and the schema going out of step with the offer is how a
// prompt could describe two tools while the model may only say one of them.

import { describe, expect, test } from "bun:test";
import { zodSchema } from "ai";

import {
  QUESTION_DECISIONS,
  QUESTION_STEP_FALLBACK_LABEL,
  QUESTION_STEP_LABEL_HINTS,
  QUESTION_STEP_LABELS,
  QUESTION_TOOLS,
  type QuestionTool,
  questionDecisionSchema,
  questionParameterSchema,
  questionStepLabelSchema,
  questionToolCallSchema,
  READ_ONLY_QUERY_TOOL,
  theOnlyQuestionTool,
} from "./question-tool.ts";

function jsonSchema(): Record<string, unknown> {
  return zodSchema(questionToolCallSchema).jsonSchema as Record<string, unknown>;
}

function decisionJsonSchema(): Record<string, unknown> {
  return zodSchema(questionDecisionSchema).jsonSchema as Record<string, unknown>;
}

function aRead(sql = "SELECT 1"): unknown {
  return {
    next: "read",
    read: { tool: READ_ONLY_QUERY_TOOL, sql, label: "counting", parameters: [] },
  };
}

describe("the offered tool set", () => {
  test("has exactly one member, and it is the read-only query", () => {
    expect(QUESTION_TOOLS).toHaveLength(1);
    expect(QUESTION_TOOLS.map((tool) => tool.name)).toEqual([READ_ONLY_QUERY_TOOL]);
  });

  test("is frozen, so a second tool cannot be pushed into it at runtime", () => {
    expect(Object.isFrozen(QUESTION_TOOLS)).toBe(true);
  });

  test("names the tool the model may call, and the schema admits only that name", () => {
    const schema = jsonSchema();
    const properties = schema.properties as Record<string, { enum?: readonly string[] }>;
    expect(properties.tool?.enum).toEqual([READ_ONLY_QUERY_TOOL]);
    expect(
      questionToolCallSchema.safeParse({
        tool: "write",
        sql: "SELECT 1",
        label: "counting",
        parameters: [],
      }).success,
    ).toBe(false);
  });

  test("refuses to derive a call schema from an inventory that is not exactly one tool", () => {
    const [only] = QUESTION_TOOLS as readonly QuestionTool[];
    expect(only).toBeDefined();
    expect(() => theOnlyQuestionTool([])).toThrow(/exactly one tool/);
    expect(() => theOnlyQuestionTool([only as QuestionTool, only as QuestionTool])).toThrow(
      /exactly one tool/,
    );
    expect(theOnlyQuestionTool()).toBe(only as QuestionTool);
  });

  test("tells the model to bind values rather than write them into the SQL", () => {
    const description = theOnlyQuestionTool().description.join(" ");
    expect(description).toContain("?");
    expect(description.toLowerCase()).toContain("parameters");
  });
});

describe("the call's wire shape", () => {
  test("marks every property required and forbids extra ones", () => {
    const schema = jsonSchema();
    expect(schema.required).toEqual(["tool", "sql", "label", "parameters"]);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties as object).sort()).toEqual([
      "label",
      "parameters",
      "sql",
      "tool",
    ]);
  });

  test("carries none of the keywords OpenAI's strict structured outputs refuses", () => {
    const emitted = JSON.stringify(jsonSchema());
    for (const keyword of ["oneOf", "minLength", "maxLength", "pattern", "format", "default"]) {
      expect({ keyword, present: emitted.includes(keyword) }).toEqual({ keyword, present: false });
    }
  });

  test("accepts a bound statement and rejects a blank one", () => {
    expect(
      questionToolCallSchema.parse({
        tool: READ_ONLY_QUERY_TOOL,
        sql: "SELECT count(*) AS total FROM cap_notes WHERE text = ?",
        label: "counting",
        parameters: ["groceries"],
      }).parameters,
    ).toEqual(["groceries"]);
    expect(
      questionToolCallSchema.safeParse({
        tool: READ_ONLY_QUERY_TOOL,
        sql: "   ",
        label: "counting",
        parameters: [],
      }).success,
    ).toBe(false);
  });

  test("requires parameters, so a statement that binds nothing says so explicitly", () => {
    expect(
      questionToolCallSchema.safeParse({
        tool: READ_ONLY_QUERY_TOOL,
        sql: "SELECT 1",
        label: "counting",
      }).success,
    ).toBe(false);
    expect(
      questionToolCallSchema.safeParse({
        tool: READ_ONLY_QUERY_TOOL,
        sql: "SELECT 1",
        label: "counting",
        parameters: [],
      }).success,
    ).toBe(true);
  });

  test("binds the scalars a model can emit and nothing it cannot", () => {
    for (const value of ["text", 42, true, null]) {
      expect(questionParameterSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [new Uint8Array([1]), { a: 1 }, ["a"], undefined]) {
      expect(questionParameterSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("the decision a turn is generated against", () => {
  test("offers exactly two moves, and neither of them is a second tool", () => {
    const properties = decisionJsonSchema().properties as Record<
      string,
      { enum?: readonly string[] }
    >;
    expect(properties.next?.enum).toEqual([...QUESTION_DECISIONS]);
    expect(QUESTION_DECISIONS).toEqual(["read", "answer"]);
    // The read it may ask for is the offered tool's own call, nested rather than restated, so a
    // second member in the inventory still fails at load rather than slipping past.
    expect(JSON.stringify(decisionJsonSchema())).toContain(READ_ONLY_QUERY_TOOL);
  });

  test("marks every property required and forbids extra ones, nested object included", () => {
    const schema = decisionJsonSchema();
    expect(schema.required).toEqual(["next", "read"]);
    expect(schema.additionalProperties).toBe(false);

    const read = (schema.properties as { read: { anyOf: readonly Record<string, unknown>[] } })
      .read;
    const [object, nothing] = read.anyOf;
    expect(object?.required).toEqual(["tool", "sql", "label", "parameters"]);
    expect(object?.additionalProperties).toBe(false);
    expect(nothing).toEqual({ type: "null" });
  });

  test("carries none of the keywords OpenAI's strict structured outputs refuses", () => {
    // `anyOf` is what a required-nullable emits and is accepted; `oneOf` is not, which is
    // why the two branches are a nullable rather than a discriminated union.
    const emitted = JSON.stringify(decisionJsonSchema());
    for (const keyword of ["oneOf", "minLength", "maxLength", "pattern", "format", "default"]) {
      expect({ keyword, present: emitted.includes(keyword) }).toEqual({ keyword, present: false });
    }
    expect(emitted).toContain("anyOf");
  });

  test("a read must carry its statement and an answer must not", () => {
    expect(questionDecisionSchema.safeParse(aRead()).success).toBe(true);
    expect(questionDecisionSchema.safeParse({ next: "answer", read: null }).success).toBe(true);
    expect(questionDecisionSchema.safeParse({ next: "read", read: null }).success).toBe(false);
    expect(
      questionDecisionSchema.safeParse({
        next: "answer",
        read: { tool: READ_ONLY_QUERY_TOOL, sql: "SELECT 1", label: "counting", parameters: [] },
      }).success,
    ).toBe(false);
  });

  test("refuses an absent read key, which is what a model omitting it would send", () => {
    expect(questionDecisionSchema.safeParse({ next: "answer" }).success).toBe(false);
  });

  test("holds the call schema to its own rules inside the wrapper", () => {
    expect(questionDecisionSchema.safeParse(aRead("   ")).success).toBe(false);
    expect(
      questionDecisionSchema.safeParse({
        next: "read",
        read: { tool: "write", sql: "SELECT 1", label: "counting", parameters: [] },
      }).success,
    ).toBe(false);
  });
});

describe("the label a call carries", () => {
  test("is a closed set covering decision 14's kinds of step, plus one fallback", () => {
    expect([...QUESTION_STEP_LABELS]).toEqual([
      "naming",
      "counting",
      "totalling",
      "listing",
      "dates",
      "other",
    ]);
    expect(QUESTION_STEP_LABELS).toContain(QUESTION_STEP_FALLBACK_LABEL);
  });

  test("reaches the wire as an enum, so a strict provider can only send a member of it", () => {
    const properties = jsonSchema().properties as Record<string, { enum?: readonly string[] }>;
    expect(properties.label?.enum).toEqual([...QUESTION_STEP_LABELS]);
  });

  test("refuses a label outside the set, and a call that carries none at all", () => {
    for (const label of QUESTION_STEP_LABELS) {
      expect(
        questionToolCallSchema.safeParse({
          tool: READ_ONLY_QUERY_TOOL,
          sql: "SELECT 1",
          label,
          parameters: [],
        }).success,
      ).toBe(true);
    }
    // The shape a model extending the vocabulary itself would send: a word nobody wrote a
    // sentence for. It fails the schema exactly as an unknown tool name does.
    for (const label of ["summarising", "seeing what you call things", "", null]) {
      expect(questionStepLabelSchema.safeParse(label).success).toBe(false);
      expect(
        questionToolCallSchema.safeParse({
          tool: READ_ONLY_QUERY_TOOL,
          sql: "SELECT 1",
          label,
          parameters: [],
        }).success,
      ).toBe(false);
    }
    expect(
      questionToolCallSchema.safeParse({
        tool: READ_ONLY_QUERY_TOOL,
        sql: "SELECT 1",
        parameters: [],
      }).success,
    ).toBe(false);
  });

  test("is described to the model off the same list the schema gates, hint by hint", () => {
    const described = theOnlyQuestionTool().description.join("\n");
    for (const label of QUESTION_STEP_LABELS) {
      expect(described).toContain(`${label} — ${QUESTION_STEP_LABEL_HINTS[label]}`);
    }
  });

  test("is the only thing the model may say about what a step is", () => {
    // No second field for words of its own: a strict object refuses the extra key rather
    // than carrying a sentence the platform did not write.
    expect(
      questionToolCallSchema.safeParse({
        tool: READ_ONLY_QUERY_TOOL,
        sql: "SELECT 1",
        label: "counting",
        parameters: [],
        narration: "Crunching the numbers, 60% done!",
      }).success,
    ).toBe(false);
  });
});
