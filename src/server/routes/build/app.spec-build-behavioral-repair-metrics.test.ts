// Truthful v1 behavioral-repair metrics. This narrow end-to-end slice pins the same
// provider-accounting contract as evolution: initial unit work is measured before the Gate,
// then behavioral repair usage is added once and folded into the affected unit's attempts.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";

import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  BEHAVIORAL_SUITE,
  createScratchDbEnv,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  NEW_CAPABILITY_INTENT,
  NOTES_SPEC,
  runPromptBuild,
  teardownScratchDbEnv,
  UPDATE_HANDLER,
} from "../../app.test-support.ts";

// A full build plus a repair round-trip, twice over HTTP. Matches the sibling build
// suites' bound so a loaded shard cannot time this out at the 5s default.
setDefaultTimeout(15_000);

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

describe("v1 behavioral repair metrics", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-repair-metrics-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("counts the successful repair provider call exactly once", async () => {
    const permissive = UPDATE_HANDLER.replace(
      '  if (input.submittedFields.has("text") && String(input.values.text ?? "").trim().length === 0) return \'<div data-role="error" data-error-code="missing_required_fields" data-error-fields="text">Tell me what to save.</div>\';\n',
      "",
    );
    expect(permissive).not.toBe(UPDATE_HANDLER);
    const { provider, prompts } = makePromptBuildProvider(
      NEW_CAPABILITY_INTENT,
      NOTES_SPEC,
      BEHAVIORAL_SUITE,
      { update: permissive, updateRepair: UPDATE_HANDLER },
    );
    const { rows, lifecycles, recordMetrics } = makeMetricsRecorder();
    const app = makeScratchApp({ dir, conns, artifactsRoot }, provider, recordMetrics);

    const { events } = await runPromptBuild(app, "track notes");

    expect(events.at(-1)).toMatchObject({ event: "done", data: "ok" });
    // intent + spec + five Action suites + six initial units + one update repair. Every
    // fake call costs 53 tokens; 15 would expose a double count and 13 would expose a
    // dropped repair.
    expect(prompts).toHaveLength(14);
    expect(rows[0]?.usage?.totalTokens).toBe(53 * 14);
    expect(rows[0]?.unitAttempts?.find((unit) => unit.name === "update")?.attempts).toBe(2);
    expect(lifecycles.at(-1)?.stages).toContainEqual({
      stage: "behavioral_test_execution",
      state: "executed",
      test: { kind: "behavioral-suite", name: "update" },
    });
  });
});
