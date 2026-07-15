import { describe, expect, test } from "bun:test";

import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  parseCapabilityRequest,
  WireProtocolError,
} from "./wire-protocol.ts";

function spec(): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        {
          name: "pinned",
          label: "Pinned",
          type: "boolean",
          required: false,
          lifecycle: "active",
        },
        {
          name: "retired",
          label: "Retired",
          type: "string",
          required: false,
          lifecycle: "inactive",
        },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward note.", shows: ["text"] },
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read"],
    prompt_context: "Stores notes.",
  };
}

function listSpec(
  required = false,
  mode: "comma_separated" | "repeatable" = "repeatable",
): CapabilitySpec {
  return {
    ...spec(),
    schema: {
      fields: [
        {
          name: "tags",
          label: "Tags",
          type: "string[]",
          required,
          lifecycle: "active",
        },
      ],
    },
    ui_intent: {
      form: { list_inputs: [{ field: "tags", mode }] },
      item: { direction: "A tag-forward note.", shows: ["tags"] },
      collection: { layout: "feed" },
      detail: { shows: ["tags"] },
    },
    behavioral_errors: required
      ? [
          {
            action: "create",
            trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
            code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
            fields: ["tags"],
            expected_markers: BEHAVIORAL_ERROR_MARKERS,
          },
        ]
      : [],
  };
}

function post(entries: readonly [string, string][]): Request {
  return new Request("http://localhost/capability/notes/create", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(entries).toString(),
  });
}

describe("reserved capability wire protocol", () => {
  test("strips markers and returns scalar values plus the validated submitted-field set", async () => {
    const parsed = await parseCapabilityRequest(
      post([
        ["text", "Buy milk"],
        [ALUNA_PRESENT_MARKER, "text"],
        [ALUNA_PRESENT_MARKER, "pinned"],
      ]),
      "create",
      spec(),
    );

    expect(parsed).toEqual({
      input: {
        values: { text: "Buy milk" },
        submittedFields: new Set(["text", "pinned"]),
      },
    });
    expect(parsed.input.values).not.toHaveProperty(ALUNA_PRESENT_MARKER);
    expect(parsed.input.values).not.toHaveProperty(ALUNA_RECORD_ID_MARKER);
  });

  test("preserves repeated list order and normalizes one list value to an array", async () => {
    const repeated = await parseCapabilityRequest(
      post([
        ["tags", "second"],
        ["tags", "first"],
        [ALUNA_PRESENT_MARKER, "tags"],
      ]),
      "create",
      listSpec(),
    );
    expect(repeated.input.values.tags).toEqual(["second", "first"]);

    const singleton = await parseCapabilityRequest(
      post([
        ["tags", "solo"],
        [ALUNA_PRESENT_MARKER, "tags"],
      ]),
      "create",
      listSpec(),
    );
    expect(singleton.input.values.tags).toEqual(["solo"]);
  });

  test("normalizes comma-separated values before Handler input without changing repeatable commas", async () => {
    const commaSeparated = await parseCapabilityRequest(
      post([
        ["tags", "Drama, Historical fiction, , Classic, Drama"],
        [ALUNA_PRESENT_MARKER, "tags"],
      ]),
      "create",
      listSpec(true, "comma_separated"),
    );
    expect(commaSeparated.input.values.tags).toEqual([
      "Drama",
      "Historical fiction",
      "Classic",
      "Drama",
    ]);

    const delimiterOnly = await parseCapabilityRequest(
      post([
        ["tags", " , , "],
        [ALUNA_PRESENT_MARKER, "tags"],
      ]),
      "create",
      listSpec(false, "comma_separated"),
    );
    expect(delimiterOnly.input.values.tags).toEqual([]);

    const repeatable = await parseCapabilityRequest(
      post([
        ["tags", "Doe, Jane"],
        [ALUNA_PRESENT_MARKER, "tags"],
      ]),
      "create",
      listSpec(false, "repeatable"),
    );
    expect(repeatable.input.values.tags).toEqual(["Doe, Jane"]);
  });

  test("rejects duplicate scalar input and invalid presence markers deterministically", async () => {
    await expect(
      parseCapabilityRequest(
        post([
          ["text", "one"],
          ["text", "two"],
          [ALUNA_PRESENT_MARKER, "text"],
          [ALUNA_PRESENT_MARKER, "pinned"],
        ]),
        "create",
        spec(),
      ),
    ).rejects.toBeInstanceOf(WireProtocolError);

    await expect(
      parseCapabilityRequest(
        post([
          ["text", "one"],
          [ALUNA_PRESENT_MARKER, "text"],
        ]),
        "create",
        spec(),
      ),
    ).rejects.toThrow(/missing submitted field markers/i);

    await expect(
      parseCapabilityRequest(
        post([
          ["text", "one"],
          [ALUNA_PRESENT_MARKER, "text"],
          [ALUNA_PRESENT_MARKER, "text"],
          [ALUNA_PRESENT_MARKER, "pinned"],
        ]),
        "create",
        spec(),
      ),
    ).rejects.toThrow(/duplicate submitted field marker/i);
  });

  test("validates the record-target seam before generated code can consume it", async () => {
    await expect(parseCapabilityRequest(post([]), "update", spec())).rejects.toThrow(
      /exactly one nonblank record target/i,
    );
    await expect(
      parseCapabilityRequest(
        post([
          [ALUNA_RECORD_ID_MARKER, "one"],
          [ALUNA_RECORD_ID_MARKER, "two"],
        ]),
        "delete",
        spec(),
      ),
    ).rejects.toThrow(/exactly one nonblank record target/i);
    await expect(
      parseCapabilityRequest(post([[ALUNA_RECORD_ID_MARKER, "   "]]), "delete", spec()),
    ).rejects.toThrow(/exactly one nonblank record target/i);
    await expect(
      parseCapabilityRequest(
        post([
          [ALUNA_PRESENT_MARKER, "text"],
          [ALUNA_PRESENT_MARKER, "pinned"],
          [ALUNA_RECORD_ID_MARKER, "record-1"],
        ]),
        "create",
        spec(),
      ),
    ).rejects.toThrow(/not accepted for create/i);

    const parsed = await parseCapabilityRequest(
      post([[ALUNA_RECORD_ID_MARKER, "record-1"]]),
      "delete",
      spec(),
    );
    expect(parsed.recordTarget).toBe("record-1");
    expect(parsed.input.values).toEqual({});
  });

  test("rejects unknown reserved keys", async () => {
    await expect(
      parseCapabilityRequest(
        post([
          ["text", "one"],
          [ALUNA_PRESENT_MARKER, "text"],
          [ALUNA_PRESENT_MARKER, "pinned"],
          ["__aluna_surprise", "nope"],
        ]),
        "create",
        spec(),
      ),
    ).rejects.toThrow(/unknown reserved marker/i);
  });
});
