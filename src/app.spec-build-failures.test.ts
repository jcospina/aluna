// GET /demo/spec-build (builder-stage liveness, fake provider) — the failure
// slices: a missing key, a behavioral gate failure, a commit-stage rollback, a
// behavioral test-generation provider error, and a validation-marker mismatch. Each
// proves failure is data (a recorded metrics row and a developer-only diagnostic)
// and that nothing internal leaks into product-voice narration. Split from the
// happy-path app.spec-build.test.ts so each describe stays under the line budget;
// shared setup and fixtures live in app.test-support.ts.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ZodType } from "zod";
import {
  BEHAVIORAL_SUITE,
  CREATE_HANDLER,
  collectSseEvents,
  createScratchDbEnv,
  DELETE_HANDLER,
  eventData,
  ITEM_RENDERER,
  makeMetricsRecorder,
  makeScratchApp,
  makeSpecProvider,
  NOTES_INCARNATION_ID,
  NOTES_SPEC,
  notesCapabilityRow,
  READ_HANDLER,
  readSse,
  SEARCH_HANDLER,
  teardownScratchDbEnv,
  throwingProvider,
  UPDATE_HANDLER,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";
import type { PlatformDatabase } from "./db.ts";
import type { GenerationMetrics } from "./metrics/index.ts";
import type { DeepPartial, GenerateResult, Provider } from "./provider/index.ts";
import {
  getCapability,
  insertCapability,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "./registry/index.ts";

setDefaultTimeout(15_000);

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

function committingApp(provider: Provider, recordMetrics: (m: GenerationMetrics) => void) {
  return makeScratchApp({ dir, conns, artifactsRoot }, provider, recordMetrics);
}

function makeSpecProviderWithBehavioralError(
  spec: unknown,
  error: Error,
): { provider: Provider; prompts: string[] } {
  const prompts: string[] = [];
  const responses = [
    spec,
    { content: ITEM_RENDERER },
    { content: CREATE_HANDLER },
    { content: READ_HANDLER },
    { content: UPDATE_HANDLER },
    { content: DELETE_HANDLER },
    { content: SEARCH_HANDLER },
  ];
  const provider: Provider = {
    generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      const response = responses.shift();

      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        if (response !== undefined) yield response as DeepPartial<T>;
      }

      if (response === undefined) {
        return {
          partialStream: stream(),
          object: Promise.reject(error),
          usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
        };
      }

      return {
        partialStream: stream(),
        object: Promise.resolve(response as T),
        usage: Promise.resolve({ inputTokens: 41, outputTokens: 12, totalTokens: 53 }),
      };
    },
  };
  return { provider, prompts };
}

const MISSING_MARKER_CREATE_HANDLER = [
  "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
  '  if (String(input.values.text ?? "").trim().length === 0) {',
  "    return '<div class=\"error\">Any friendly copy can go here.</div>';",
  "  }",
  "  const note = mutation.create({ text: input.values.text });",
  "  return present(note);",
  "}",
].join("\n");

const VALIDATION_ERROR_SUITE = {
  cases: BEHAVIORAL_SUITE.cases.map((testCase) =>
    testCase.action === "create" && testCase.expectedError
      ? { ...testCase, name: "missing note text emits stable validation markers" }
      : testCase,
  ),
};

describe("GET /demo/spec-build (builder-stage liveness, fake provider) — provider failure", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-spec-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a missing key streams a warm apology, not a crash", async () => {
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: throwingProvider("Missing OMNI_API_KEY. ..."),
      recordMetrics,
    });
    const res = await app.request("/demo/spec-build?prompt=track%20notes");
    expect(res.status).toBe(200);

    const payload = await readSse(res);
    const events = collectSseEvents(payload);
    const dataFor = (name: string) => eventData(events, name);

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("done")).toBe("error");
    expect(dataFor("build-error-preview")).toContain("Missing OMNI_API_KEY");
    expect(dataFor("build-error-preview")).toContain("Error");
    // No product commit/fragment on the failure path, and no internals leak through
    // product copy.
    expect(payload).not.toContain("event: fragment");
    expect(payload).not.toContain("event: commit");
    expect(dataFor("narration")).not.toMatch(/OMNI_API_KEY|api key|provider/i);
    // The build never started (the provider threw before any stage), so no metrics
    // row is written — the demo records generations, not failed admissions.
    expect(rows).toHaveLength(0);
  });

  test("a behavioral test-generation provider error is captured in the developer preview", async () => {
    const { provider } = makeSpecProviderWithBehavioralError(
      NOTES_SPEC,
      new Error("Invalid schema for response_format 'response': Missing required expectedError."),
    );
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20notes")),
    );
    const dataFor = (name: string) => eventData(events, name);
    const preview = JSON.parse(dataFor("build-error-preview")) as {
      errorName: string;
      message: string;
    };

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("narration")).not.toMatch(/response_format|schema|expectedError/i);
    expect(dataFor("done")).toBe("error");
    expect(preview.errorName).toBe("CapabilityGateError");
    expect(preview.message).toContain("Invalid schema for response_format");
    expect(preview.message).toContain("expectedError");
    // The behavioral test-generation failure is recorded as a gate/behavioral failure.
    expect(rows[0]?.outcome).toBe("failure");
    expect(rows[0]?.failure).toMatchObject({ stage: "gate", rung: "behavioral" });
  });
});

describe("GET /demo/spec-build (builder-stage liveness, fake provider) — behavioral gate evidence", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-spec-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a behavioral gate failure sends developer evidence without leaking into narration", async () => {
    const failingSuite = {
      cases: BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.action === "read" && testCase.expectedError === null
          ? {
              ...testCase,
              name: "expects text that read never returns",
              expectFragmentIncludes: ["Definitely absent"],
              expectedRows: [
                ...testCase.expectedRows,
                { values: [{ field: "text", value: "Definitely absent" }] },
              ],
            }
          : testCase,
      ),
    };
    const { provider } = makeSpecProvider(NOTES_SPEC, failingSuite);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20notes")),
    );
    const dataFor = (name: string) => eventData(events, name);
    const preview = JSON.parse(dataFor("build-error-preview")) as {
      errorName: string;
      diagnostic: {
        failure: string;
        testCase: { name: string };
        scratchRows: Array<{ text: string }>;
        fragment: string;
      };
    };

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("narration")).not.toMatch(/handler|behavioral|gate|scratch/i);
    expect(dataFor("done")).toBe("error");
    expect(preview.errorName).toBe("CapabilityGateError");
    expect(preview.diagnostic.testCase.name).toBe("expects text that read never returns");
    expect(preview.diagnostic.failure).toContain("Definitely absent");
    expect(preview.diagnostic.scratchRows).toEqual([expect.objectContaining({ text: "Read me" })]);
    expect(preview.diagnostic.fragment).toContain("Read me");

    // Failure is data: one metrics row, outcome failure, pinpointing the rung that
    // failed (the behavioral gate), with the timings up to that point present.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("failure");
    expect(rows[0]?.failure).toMatchObject({ stage: "gate", rung: "behavioral" });
    expect(rows[0]?.capabilityId).toBe("notes");
    expect(rows[0]?.timings?.specGenMs).toBeGreaterThanOrEqual(0);

    // Commit is unreachable when a gate rung fails: the transaction rolled back, so
    // nothing committed — no registry row, no cap_<id> table, no artifacts on disk —
    // and no commit-preview or commit swap was streamed.
    expect(events.map((event) => event.event)).not.toContain("commit-preview");
    expect(events.map((event) => event.event)).not.toContain("fragment");
    expect(events.map((event) => event.event)).not.toContain("commit");
    expect(getCapability("notes", conns.readonly)).toBeNull();
    expect(
      conns.readwrite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cap_notes'")
        .get(),
    ).toBeNull();
    expect(existsSync(resolve(artifactsRoot, "notes"))).toBe(false);
  });
});

describe("GET /demo/spec-build (builder-stage liveness, fake provider) — commit rollback", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-spec-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a commit-stage failure rolls back and records it, leaving the prior capability intact", async () => {
    // A capability is already registered at this id, so commit's registry insert
    // collides — the gate passes but the build fails at the terminal commit step.
    // (The resolver normally prevents id collisions; this forces the commit-stage
    // failure path directly.)
    insertCapability(notesCapabilityRow(), conns.readwrite);
    const { provider } = makeSpecProvider(NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20notes")),
    );
    const eventNames = events.map((event) => event.event);
    const dataFor = (name: string) => eventData(events, name);

    // The gate was reached and passed, but commit failed: no committed capability is
    // announced, just the warm apology and a `done` error.
    expect(eventNames).toContain("gate-preview");
    expect(eventNames).not.toContain("commit-preview");
    expect(eventNames).not.toContain("fragment");
    expect(eventNames).not.toContain("commit");
    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("done")).toBe("error");

    // Failure is data: recorded as a commit-stage failure, carrying the full
    // pre-commit measurements (every gate rung passed).
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("failure");
    expect(rows[0]?.failure).toMatchObject({ stage: "commit" });
    expect(rows[0]?.gateRungs?.map((rung) => rung.rung)).toEqual([
      "structural",
      "smoke",
      "behavioral",
      "design-lint",
    ]);

    // The transaction rolled back: the prior capability is untouched (still its
    // original pointer), and the build committed nothing new.
    expect(getCapability("notes", conns.readonly)?.artifacts_path).toBe(
      `capabilities/notes/${NOTES_INCARNATION_ID}/v1/`,
    );
  });
});

describe("GET /demo/spec-build (builder-stage liveness, fake provider) — validation markers", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-spec-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a validation marker mismatch is visible in the developer-only demo diagnostic", async () => {
    const { provider } = makeSpecProvider(NOTES_SPEC, VALIDATION_ERROR_SUITE, {
      create: MISSING_MARKER_CREATE_HANDLER,
    });
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20notes")),
    );
    const dataFor = (name: string) => eventData(events, name);
    const preview = JSON.parse(dataFor("build-error-preview")) as {
      errorName: string;
      diagnostic: {
        failure: string;
        testCase: { name: string; expectedError: { code: string; fields: string[] } };
        fragment: string;
        scratchRows: unknown[];
      };
    };

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("narration")).not.toMatch(/handler|behavioral|gate|scratch/i);
    expect(dataFor("done")).toBe("error");
    expect(preview.errorName).toBe("CapabilityGateError");
    expect(preview.diagnostic.testCase.name).toBe(
      "missing note text emits stable validation markers",
    );
    expect(preview.diagnostic.testCase.expectedError).toMatchObject({
      code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      fields: ["text"],
    });
    expect(preview.diagnostic.failure).toContain('data-role="error"');
    expect(preview.diagnostic.fragment).toContain("Any friendly copy");
    expect(preview.diagnostic.scratchRows).toEqual([]);
    // Recorded as a behavioral-gate failure.
    expect(rows[0]?.outcome).toBe("failure");
    expect(rows[0]?.failure).toMatchObject({ stage: "gate", rung: "behavioral" });
  });
});
