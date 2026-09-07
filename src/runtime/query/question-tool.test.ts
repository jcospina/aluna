// The offer itself: exactly one tool, and a wire shape a strict provider will accept.
//
// These assertions are cheap and they are the ones that decay silently. "The model is
// offered exactly one tool" stops being true the moment a second entry is added to an
// inventory nothing counts, and the schema going out of step with the offer is how a
// prompt could describe two tools while the model may only say one of them.

import { describe, expect, test } from "bun:test";
import { zodSchema } from "ai";

import {
  QUESTION_TOOLS,
  type QuestionTool,
  questionParameterSchema,
  questionToolCallSchema,
  READ_ONLY_QUERY_TOOL,
  theOnlyQuestionTool,
} from "./question-tool.ts";

function jsonSchema(): Record<string, unknown> {
  return zodSchema(questionToolCallSchema).jsonSchema as Record<string, unknown>;
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
      questionToolCallSchema.safeParse({ tool: "write", sql: "SELECT 1", parameters: [] }).success,
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
    expect(schema.required).toEqual(["tool", "sql", "parameters"]);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties as object).sort()).toEqual(["parameters", "sql", "tool"]);
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
        parameters: ["groceries"],
      }).parameters,
    ).toEqual(["groceries"]);
    expect(
      questionToolCallSchema.safeParse({ tool: READ_ONLY_QUERY_TOOL, sql: "   ", parameters: [] })
        .success,
    ).toBe(false);
  });

  test("requires parameters, so a statement that binds nothing says so explicitly", () => {
    expect(
      questionToolCallSchema.safeParse({ tool: READ_ONLY_QUERY_TOOL, sql: "SELECT 1" }).success,
    ).toBe(false);
    expect(
      questionToolCallSchema.safeParse({
        tool: READ_ONLY_QUERY_TOOL,
        sql: "SELECT 1",
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
