// The scaffolding, exercised through the real app.
//
// This is the only place in the module where the whole path runs from an HTTP request:
// classify, open the whole-catalog scope, offer one tool, run the statement in the worker.
// It is scaffolding and its removal has an owner — 6.5/05 — which is exactly why the
// assertions here name what they are proving, so they can be re-homed rather than deleted.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZodType } from "zod";

import { INTENT_RESOLVER_PROMPT_PREFIX } from "../../../pipeline/intent/index.ts";
import { openDatabase, type PlatformDatabase } from "../../../platform/persistence/db.ts";
import { runMigrations } from "../../../platform/persistence/migrations.ts";
import type { DeepPartial, GenerateResult, Provider } from "../../../platform/provider/index.ts";
import { QUESTION_TURN_PROMPT_PREFIX, READ_ONLY_QUERY_TOOL } from "../../../runtime/query/index.ts";
import { catalogueWithRecords, NOTES_TABLE } from "../../../runtime/query/question.test-support.ts";
import { createApp } from "../../app.ts";
import { DEMO_QUESTION_PATH } from "./demo-question.ts";

const DATA_QUERY_INTENT = {
  type: "data_query",
  confidence: 0.94,
  target_capability: null,
  resolution: "none",
  proposed_identity: null,
  proposed_action: "Look at what is saved.",
  user_facing_label: "Let me look at what you've saved.",
  requires_confirmation: false,
};

const NEW_CAPABILITY_INTENT = {
  ...DATA_QUERY_INTENT,
  type: "new_capability",
  resolution: "new",
  user_facing_label: "I'll make you a place for that.",
};

/**
 * One provider answering two different questions, told apart by the prompt each stage
 * builds rather than by call order — the seam both prefixes are exported for.
 */
function stagedProvider(intent: unknown, sql: string): Provider {
  return {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      const answer = prompt.startsWith(INTENT_RESOLVER_PROMPT_PREFIX)
        ? intent
        : prompt.startsWith(QUESTION_TURN_PROMPT_PREFIX)
          ? { tool: READ_ONLY_QUERY_TOOL, sql, parameters: ["groceries"] }
          : undefined;
      const object = (async () => schema.parse(answer))();
      object.catch(() => {});
      return {
        partialStream: (async function* () {
          yield answer as DeepPartial<T>;
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

let directory: string;
let databases: PlatformDatabase;
const previousNodeEnv = process.env.NODE_ENV;

function app(intent: unknown, sql: string) {
  return createApp({
    getProvider: () => stagedProvider(intent, sql),
    buildDatabases: databases,
    artifactsRoot: join(directory, "artifacts"),
    capabilityRouter: { databases },
  });
}

function ask(question: string): RequestInit {
  return { method: "POST", body: new URLSearchParams({ question }) };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omni-crud-demo-question-"));
  databases = openDatabase(join(directory, "test.db"));
  runMigrations(databases.readwrite);
  catalogueWithRecords(databases.readwrite);
});

afterEach(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  databases.readwrite.close();
  databases.readonly.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("the one-question-turn exercise", () => {
  test("runs a classified data_query end to end and shows what came back", async () => {
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE} WHERE text = ?`,
    ).request(DEMO_QUESTION_PATH, ask("how many grocery notes do I have?"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("data_query");
    // Exactly one tool was offered, and the page says how many.
    expect(html).toContain("Tools offered (1)");
    expect(html).toContain(READ_ONLY_QUERY_TOOL);
    // The statement, its bound value, and the rows the worker produced.
    expect(html).toContain("WHERE text = ?");
    expect(html).toContain("groceries");
    expect(html).toContain("&quot;total&quot;: 2");
  });

  test("shows a failed statement rather than ending the exercise", async () => {
    const response = await app(DATA_QUERY_INTENT, `SELECT nowhere FROM ${NOTES_TABLE}`).request(
      DEMO_QUESTION_PATH,
      ask("what did I spend?"),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Statement failed");
    expect(html).toContain("no such column");
  });

  test("a mutating statement comes back as a refusal from SQLite, not a 500", async () => {
    const response = await app(DATA_QUERY_INTENT, `DELETE FROM ${NOTES_TABLE}`).request(
      DEMO_QUESTION_PATH,
      ask("delete everything"),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("readonly database");
    expect(
      (
        databases.readonly.query(`SELECT count(*) AS total FROM ${NOTES_TABLE}`).get() as {
          total: number;
        }
      ).total,
    ).toBe(3);
  });

  test("takes no turn for a prompt classified as anything else", async () => {
    const response = await app(NEW_CAPABILITY_INTENT, "SELECT 1").request(
      DEMO_QUESTION_PATH,
      ask("keep track of my plants"),
    );
    const html = await response.text();

    expect(html).toContain("new_capability");
    expect(html).not.toContain("Tool call");
  });

  test("renders the form on its own", async () => {
    const response = await app(DATA_QUERY_INTENT, "SELECT 1").request(DEMO_QUESTION_PATH);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<form");
  });
});

describe("what the page does with a hostile request", () => {
  test("escapes the question it reflects back into the form", async () => {
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE}`,
    ).request(DEMO_QUESTION_PATH, ask('</textarea><img src=x onerror="alert(1)">'));
    const html = await response.text();

    // The question is user input reflected into markup; without the escape the textarea
    // closes early and the tag is live. No test posted markup before this one, so deleting
    // the escape left the whole suite green.
    expect(html).not.toContain("</textarea><img");
    expect(html).toContain("&lt;/textarea&gt;&lt;img");
  });

  test("renders a malformed body instead of 500ing", async () => {
    const response = await app(DATA_QUERY_INTENT, "SELECT 1").request(DEMO_QUESTION_PATH, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=zz" },
      body: "garbage",
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("That was not a form");
  });

  test("refuses a cross-site post, which would spend provider tokens", async () => {
    const response = await app(DATA_QUERY_INTENT, "SELECT 1").request(DEMO_QUESTION_PATH, {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
      body: new URLSearchParams({ question: "how many notes?" }),
    });

    expect(response.status).toBe(403);
  });

  test("still accepts the page's own post", async () => {
    const response = await app(
      DATA_QUERY_INTENT,
      `SELECT count(*) AS total FROM ${NOTES_TABLE}`,
    ).request(DEMO_QUESTION_PATH, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
      body: new URLSearchParams({ question: "how many notes?" }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Tool call");
  });
});

describe("the developer gate", () => {
  test("answers nothing in production, on either method", async () => {
    process.env.NODE_ENV = "production";
    const built = app(DATA_QUERY_INTENT, `SELECT count(*) AS total FROM ${NOTES_TABLE}`);

    expect((await built.request(DEMO_QUESTION_PATH)).status).toBe(404);
    expect((await built.request(DEMO_QUESTION_PATH, ask("how many notes?"))).status).toBe(404);
    // The product surface is untouched by the gate.
    expect((await built.request("/")).status).toBe(200);
  });

  test("answers outside production", async () => {
    process.env.NODE_ENV = "development";
    expect((await app(DATA_QUERY_INTENT, "SELECT 1").request(DEMO_QUESTION_PATH)).status).toBe(200);
  });
});
