import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  collectSseEvents,
  createScratchDbEnv,
  makeMetricsRecorder,
  makeScratchApp,
  makeSpecProvider,
  NOTES_SPEC,
  readSse,
  teardownScratchDbEnv,
} from "./app.test-support.ts";
import type { PlatformDatabase } from "./db.ts";
import { finalizeGenerationLifecycleFailure, startGenerationLifecycle } from "./metrics/index.ts";

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
  const abandonedIncarnation = "44444444-4444-4444-8444-444444444444";
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
  const { provider } = makeSpecProvider(NOTES_SPEC);
  const { recordMetrics } = makeMetricsRecorder();
  const app = makeScratchApp({ dir, conns, artifactsRoot }, provider, recordMetrics);

  const events = collectSseEvents(
    await readSse(await app.request("/demo/spec-build?prompt=track%20my%20notes")),
  );

  expect(events.at(-1)).toMatchObject({ event: "done", data: "ok" });
  expect(existsSync(abandoned)).toBe(false);
});
