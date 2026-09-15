import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlatformDatabase } from "../persistence/db.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../persistence/scratch-db.test-support.ts";
import { INTENT_RESOLUTION_METRICS_TABLE } from "../persistence/table-names.ts";
import {
  getIntentResolutionMetrics,
  intentResolutionMetrics,
  intentResolutionMetricsSchema,
  listIntentResolutionMetrics,
  type QuestionCost,
  questionCostSchema,
  writeIntentResolutionMetrics,
} from "./intent-resolution-store.ts";

let env: ScratchDbEnv;
let conns: PlatformDatabase;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-resolution-metrics-");
  conns = env.conns;
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

/** The one content-free measurement every test here writes, differing only in what classified it. */
const measured = (type: "reject" | "data_query", targetCapability: string | null) => ({
  intent: { type, confidence: 0.72, targetCapability },
  model: "gpt-5",
  durationMs: 18,
  usage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 },
  catalogFingerprint: `sha256:${"a".repeat(64)}`,
});

describe("best-effort intent resolution metrics", () => {
  test("stores content-free resolver classification, timing, usage, and catalog binding", () => {
    const metrics = intentResolutionMetrics({
      promptJobId: "prompt-reject",
      resolver: measured("reject", null),
    });

    writeIntentResolutionMetrics(metrics, conns.readwrite);

    expect(getIntentResolutionMetrics("prompt-reject", conns.readonly)).toMatchObject(metrics);
    expect(listIntentResolutionMetrics(conns.readonly)).toHaveLength(1);
    const columns = conns.readonly
      .query(
        `SELECT name FROM pragma_table_info('${INTENT_RESOLUTION_METRICS_TABLE}') ORDER BY cid`,
      )
      .all() as { name: string }[];
    expect(columns.map(({ name }) => name)).toEqual([
      "prompt_job_id",
      "outcome",
      "resolver_measurement",
      "created_at",
      "steps_taken",
      "elapsed_ms",
    ]);
    // A refusal ran no loop, and a zero would read as a question that spent one read and found
    // nothing. The two columns are absent from the row rather than filled in with a number.
    expect(getIntentResolutionMetrics("prompt-reject", conns.readonly)?.question).toBeUndefined();
  });

  test("is keyed by prompt job and rejects prompt/user content fields", () => {
    const metrics = intentResolutionMetrics({
      promptJobId: "prompt-once",
      resolver: measured("data_query", "notes"),
    });
    writeIntentResolutionMetrics(metrics, conns.readwrite);

    expect(() => writeIntentResolutionMetrics(metrics, conns.readwrite)).toThrow();
    expect(() =>
      intentResolutionMetricsSchema.parse({
        ...metrics,
        prompt: "show me private notes",
      }),
    ).toThrow();
  });
});

describe("what one question cost, and the two integers it may be said in", () => {
  const asked = (promptJobId: string, question: QuestionCost) =>
    intentResolutionMetrics({
      promptJobId,
      resolver: measured("data_query", "notes"),
      question,
    });

  test("steps taken and wall-clock elapsed survive the round trip", () => {
    writeIntentResolutionMetrics(
      asked("prompt-asked", { stepsTaken: 4, elapsedMs: 1_820 }),
      conns.readwrite,
    );

    expect(getIntentResolutionMetrics("prompt-asked", conns.readonly)?.question).toEqual({
      stepsTaken: 4,
      elapsedMs: 1_820,
    });
  });

  test("and the cost may say those two things and nothing else", () => {
    // The strict schema is the first of the two walls: a field added at a call site is refused
    // here, whatever it was named and whatever it carried.
    for (const smuggled of [
      { sql: "SELECT * FROM cap_notes" },
      { prompt: "how many notes did I write?" },
      { capability: "notes" },
      { answer: "three" },
    ]) {
      expect(() =>
        questionCostSchema.parse({ stepsTaken: 2, elapsedMs: 300, ...smuggled }),
      ).toThrow();
    }
    // And neither number may be a shape that is not a count of something.
    for (const notANumber of [{ stepsTaken: "four" }, { elapsedMs: "1820" }, { stepsTaken: 1.5 }]) {
      expect(() =>
        questionCostSchema.parse({ stepsTaken: 2, elapsedMs: 300, ...notANumber }),
      ).toThrow();
    }
    expect(() => questionCostSchema.parse({ stepsTaken: -1, elapsedMs: 300 })).toThrow();
  });

  test("and the database refuses text in them even when nothing validated it first", () => {
    // The second wall, and the one that holds when the first is bypassed: these are INTEGER
    // columns on a STRICT table, so a sentence cannot be stored in them at all. This writes
    // straight past the schema, which is the only way to prove the database is the one refusing.
    writeIntentResolutionMetrics(
      asked("prompt-typed", { stepsTaken: 1, elapsedMs: 9 }),
      conns.readwrite,
    );

    for (const column of ["steps_taken", "elapsed_ms"]) {
      expect(() =>
        conns.readwrite.run(
          `UPDATE ${INTENT_RESOLUTION_METRICS_TABLE} SET ${column} = ? WHERE prompt_job_id = ?`,
          ["SELECT title FROM cap_notes", "prompt-typed"],
        ),
      ).toThrow(/cannot store TEXT value/);
      expect(() =>
        conns.readwrite.run(
          `UPDATE ${INTENT_RESOLUTION_METRICS_TABLE} SET ${column} = ? WHERE prompt_job_id = ?`,
          [-1, "prompt-typed"],
        ),
      ).toThrow(/CHECK constraint failed/);
    }
  });
});
