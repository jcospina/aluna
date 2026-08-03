// POST /prompt → GET /build/:id/stream (builder stages, fake provider) — the failure
// slices *after admission*: a provider that dies mid-build, a behavioral gate failure, a
// commit-stage rollback, a behavioral test-generation provider error, and a
// validation-marker mismatch. (A provider that is unavailable before classification
// never reaches the Builder; that slice lives in app.resolver-pipeline.test.ts.) Each
// proves failure is data (a recorded metrics row and a developer-only diagnostic)
// and that nothing internal leaks into product-voice narration. Split from the
// happy-path app.spec-build.test.ts so each describe stays under the line budget;
// shared setup and fixtures live in app.test-support.ts.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ZodType } from "zod";
import type { IntentClassification } from "../intent-resolver/index.ts";
import { listGenerationLifecycles } from "../metrics/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { createMetricsRecorder, type RecordMetrics } from "../pipeline/index.ts";
import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import {
  getCapability,
  insertCapability,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  BEHAVIORAL_SUITE,
  CREATE_HANDLER,
  createScratchDbEnv,
  DELETE_HANDLER,
  eventData,
  ITEM_RENDERER,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  NEW_CAPABILITY_INTENT,
  NOTES_INCARNATION_ID,
  NOTES_SPEC,
  notesCapabilityRow,
  READ_HANDLER,
  runPromptBuild,
  SEARCH_HANDLER,
  teardownScratchDbEnv,
  UPDATE_HANDLER,
} from "./app.test-support.ts";

setDefaultTimeout(15_000);

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

function committingApp(provider: Provider, recordMetrics: RecordMetrics) {
  return makeScratchApp({ dir, conns, artifactsRoot }, provider, recordMetrics);
}

// Answers the resolver, then throws on every Builder-owned call — the shape of a
// provider that dies after admission, once the durable `running` row is already open.
function providerFailingAfterResolution(intent: IntentClassification, message: string): Provider {
  let resolved = false;
  return {
    generate<T>(_prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      if (resolved) throw new Error(message);
      resolved = true;
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield intent as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(intent as T),
        usage: Promise.resolve({ inputTokens: 41, outputTokens: 12, totalTokens: 53 }),
      };
    },
  };
}

function makeSpecProviderWithBehavioralError(
  intent: IntentClassification,
  spec: unknown,
  error: Error,
): { provider: Provider; prompts: string[] } {
  const prompts: string[] = [];
  const responses = [
    intent,
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
      // Behavioral test generation is identified by its prompt: it now runs *before* the
      // units, so a fixed queue position can no longer stand for "the behavioral call".
      const response = prompt.startsWith("Generate deterministic black-box behavioral tests")
        ? undefined
        : responses.shift();

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

describe("POST /prompt → GET /build/:id/stream (builder stages, fake provider) — provider failure", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-spec-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a provider that dies after admission streams a warm apology, not a crash", async () => {
    // A provider that answers the resolver and then fails is the only way to reach the
    // Builder's own failure path: a provider that is unavailable from the start never
    // gets past classification (that case lives in app.resolver-pipeline.test.ts).
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(
      providerFailingAfterResolution(NEW_CAPABILITY_INTENT, "Missing OMNI_API_KEY. ..."),
      recordMetrics,
    );

    const { payload, events } = await runPromptBuild(app, "track notes");
    const dataFor = (name: string) => eventData(events, name);

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("done")).toBe("error");
    expect(dataFor("build-error-preview")).toContain("Missing OMNI_API_KEY");
    expect(dataFor("build-error-preview")).toContain("Error");
    // Failure restores the neutral canonical surface through `fragment`; only real
    // activation may use `commit`.
    expect(dataFor("fragment")).toContain('data-build-restoration="neutral"');
    expect(payload).not.toContain("event: commit");
    expect(dataFor("narration")).not.toMatch(/OMNI_API_KEY|api key|provider/i);
    // Admission already happened under the active lease, so the failed provider call is
    // measured as a typed spec-generation failure against this build's own durable row,
    // not silently lost.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "failure",
      failure: { stage: "spec_gen" },
    });
    const metricEvents = events.filter((event) => event.event === "metrics-preview");
    expect(JSON.parse(metricEvents[0]?.data ?? "null")).toMatchObject({
      lifecycleStatus: "running",
      outcome: null,
    });
    expect(JSON.parse(metricEvents.at(-1)?.data ?? "null")).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "spec_generation_failed",
    });
  });

  test("a behavioral test-generation provider error is captured in the developer preview", async () => {
    const { provider } = makeSpecProviderWithBehavioralError(
      NEW_CAPABILITY_INTENT,
      NOTES_SPEC,
      new Error("Invalid schema for response_format 'response': Missing required expectedError."),
    );
    const { lifecycles, rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const { events } = await runPromptBuild(app, "track notes");
    const dataFor = (name: string) => eventData(events, name);
    const preview = JSON.parse(dataFor("build-error-preview")) as {
      errorName: string;
      message: string;
    };

    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("narration")).not.toMatch(/response_format|schema|expectedError/i);
    expect(dataFor("done")).toBe("error");
    // Generation now happens before the Gate exists, so it carries its own typed
    // error — but the failure is still the behavioral tier's, and is recorded as such.
    expect(preview.errorName).toBe("BehavioralTestGenerationError");
    expect(preview.message).toContain("Invalid schema for response_format");
    expect(preview.message).toContain("expectedError");
    expect(rows[0]?.outcome).toBe("failure");
    expect(rows[0]?.failure).toMatchObject({ stage: "behavioral_test_generation" });
    expect(rows[0]?.failure).not.toHaveProperty("rung");
    expect(lifecycles.at(-1)).toMatchObject({
      outcome: "gate_failed",
      measurement: { failure: { stage: "behavioral_test_generation" } },
      stages: expect.arrayContaining([
        { stage: "behavioral_test_generation", state: "executed" },
        { stage: "gate_behavioral", state: "skipped" },
      ]),
    });
  });
});

describe("POST /prompt → GET /build/:id/stream (builder stages, fake provider) — behavioral gate evidence", () => {
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
    const { provider } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC, failingSuite, {
      // A v1 fragment failure is conservatively attributed because item.ts was generated.
      // Return every Handler byte-identically: five real measured calls, no invented defect,
      // and no admissible rewrite that could make the impossible assertion pass.
      repairs: [CREATE_HANDLER, READ_HANDLER, UPDATE_HANDLER, DELETE_HANDLER, SEARCH_HANDLER],
    });
    const { lifecycles, rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const { events } = await runPromptBuild(app, "track notes");
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
    // intent + spec + five Action suites + six initial units + five conservative Handler
    // attempts. Every fake call costs 53 tokens, including the resolver's own and the
    // byte-identical repairs that did not publish.
    expect(rows[0]?.usage?.totalTokens).toBe(53 * 18);
    expect(
      rows[0]?.unitAttempts?.filter((unit) => unit.kind === "handler").map((unit) => unit.attempts),
    ).toEqual([2, 2, 2, 2, 2]);
    expect(
      lifecycles.at(-1)?.stages.find((stage) => stage.stage === "gate_behavioral"),
    ).toMatchObject({ state: "executed" });
    expect(lifecycles.at(-1)?.stages).toContainEqual({
      stage: "behavioral_test_execution",
      state: "executed",
      test: { kind: "behavioral-suite", name: "read" },
    });
    expect(
      lifecycles
        .at(-1)
        ?.stages.filter((stage) => stage.stage === "unit_generation")
        .every((stage) => stage.state === "generated"),
    ).toBe(true);

    // Commit is unreachable when a gate rung fails: the transaction rolled back, so
    // nothing committed — no registry row, no cap_<id> table, no artifacts on disk —
    // and no commit-preview or commit swap was streamed.
    expect(events.map((event) => event.event)).not.toContain("commit-preview");
    expect(dataFor("fragment")).toContain('data-build-restoration="neutral"');
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

describe("POST /prompt → GET /build/:id/stream (builder stages, fake provider) — commit rollback", () => {
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
    // failure path directly. The prompt deliberately shares no token with the live
    // Notes row, so the deterministic duplicate guard lets the build through and the
    // collision happens where this test wants it — at commit.)
    insertCapability(notesCapabilityRow(), conns.readwrite);
    const { provider } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC);
    const recordMetrics = createMetricsRecorder(conns.readwrite);
    const app = committingApp(provider, recordMetrics);

    const { events } = await runPromptBuild(app, "log the books I finish");
    const eventNames = events.map((event) => event.event);
    const dataFor = (name: string) => eventData(events, name);

    // The gate was reached and passed, but commit failed: no committed capability is
    // announced, just the warm apology and a `done` error.
    expect(eventNames).toContain("gate-preview");
    expect(eventNames).not.toContain("commit-preview");
    expect(dataFor("fragment")).toContain('data-build-restoration="neutral"');
    expect(eventNames).not.toContain("commit");
    expect(dataFor("narration")).toMatch(/mind trying again/i);
    expect(dataFor("done")).toBe("error");

    // Failure is data: recorded as a commit-stage failure, carrying the full
    // pre-commit measurements (every gate rung passed).
    const lifecycle = listGenerationLifecycles(conns.readonly)[0];
    expect(lifecycle).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "activation_failed",
      measurement: { failure: { stage: "commit" } },
    });
    expect(lifecycle?.measurement?.gateRungs?.map((rung) => rung.rung)).toEqual([
      "structural",
      "smoke",
      "behavioral",
      "design-lint",
    ]);
    expect(lifecycle?.stages.find((stage) => stage.stage === "publication")).toMatchObject({
      state: "executed",
    });
    expect(lifecycle?.stages.find((stage) => stage.stage === "activation")).toMatchObject({
      state: "executed",
    });

    // The transaction rolled back: the prior capability is untouched (still its
    // original pointer), and the build committed nothing new.
    expect(getCapability("notes", conns.readonly)?.artifacts_path).toBe(
      `capabilities/notes/${NOTES_INCARNATION_ID}/v1/`,
    );
  });
});

describe("POST /prompt → GET /build/:id/stream (builder stages, fake provider) — validation markers", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-spec-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a validation marker mismatch is visible in the developer-only diagnostic", async () => {
    const { provider } = makePromptBuildProvider(
      NEW_CAPABILITY_INTENT,
      NOTES_SPEC,
      VALIDATION_ERROR_SUITE,
      { create: MISSING_MARKER_CREATE_HANDLER },
    );
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const { events } = await runPromptBuild(app, "track notes");
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
