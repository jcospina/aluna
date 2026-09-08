import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  finalizeGenerationLifecycleFailure,
  startGenerationLifecycle,
} from "../../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { FOURTH_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import {
  createScratchDbEnv,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  NEW_CAPABILITY_INTENT,
  NOTES_SPEC,
  runPromptBuild,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

beforeEach(() => {
  ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prebuild-reconcile-"));
});

afterEach(() => {
  teardownScratchDbEnv({ dir, conns, artifactsRoot });
});

test("lease-head pre-build reconciliation removes a proven abandoned staging build", async () => {
  const abandonedIncarnation = FOURTH_INCARNATION_ID;
  const abandonedBuild = "abandoned-before-next-build";
  const abandoned = join(
    artifactsRoot,
    "abandoned_notes",
    abandonedIncarnation,
    ".staging",
    abandonedBuild,
  );
  mkdirSync(abandoned, { recursive: true });
  startGenerationLifecycle(
    {
      buildId: abandonedBuild,
      incarnationId: abandonedIncarnation,
      capabilityId: "abandoned_notes",
    },
    conns.readwrite,
  );
  finalizeGenerationLifecycleFailure(
    {
      buildId: abandonedBuild,
      incarnationId: abandonedIncarnation,
      outcome: "publication_failed",
      stages: [],
    },
    conns.readwrite,
  );
  const { provider } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC);
  const { recordMetrics } = makeMetricsRecorder();
  const app = makeScratchApp({ dir, conns, artifactsRoot }, provider, recordMetrics);

  const { events } = await runPromptBuild(app, "track my notes");

  expect(events.at(-1)).toMatchObject({ event: "done", data: "ok" });
  expect(existsSync(abandoned)).toBe(false);
});
