// A build lays out a capability that keeps files by the draw of its own incarnation, and the spec
// preview it streams last is the spec that builds (7.4/03).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { drawnFileCardLayout } from "../../builder/spec/layout-draw.ts";
import {
  makeSpecProvider,
  notesIntent,
  recordingSend,
} from "../../builder/spec/spec-gen.test-support.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../platform/persistence/scratch-db.test-support.ts";
import { CAPTION_FIELD, PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import type { CapabilitySpec } from "../../registry/index.ts";
import type { DemoBuildAccumulator } from "../metrics-recorder.ts";
import { runSpecBuildStages } from "./build-run.ts";

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-build-run-");
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

function showingThePhoto(): CapabilitySpec {
  const spec = photoSpec([CAPTION_FIELD, PHOTO_FIELD]);
  const ui_intent = {
    ...spec.ui_intent,
    collection: { layout: "feed" as const },
    item: { ...spec.ui_intent.item, shows: ["caption", "photo"] },
  };
  return { ...spec, ui_intent };
}

/** The last spec a build stopped right after its spec stage previewed, and its accumulator. */
async function specStage(incarnationId: string) {
  const { events, send } = recordingSend();
  const acc: DemoBuildAccumulator = { usages: [], timings: {} };
  await runSpecBuildStages(
    send,
    () => true,
    makeSpecProvider(showingThePhoto()),
    "keep my photos",
    notesIntent(),
    "build-run-test",
    incarnationId,
    acc,
    env.conns,
    env.artifactsRoot,
    () => {},
    () => {},
  );
  const previews = events.filter(({ event }) => event === "spec-preview");
  const last = JSON.parse(previews.at(-1)?.data ?? "null") as CapabilitySpec;
  return { last, acc };
}

describe("a build of a capability whose card shows a file", () => {
  test("lays it out by its own incarnation's draw, and previews that layout last", async () => {
    const ids = Array.from({ length: 16 }, (_, index) => `inc_build_${index}`);
    const drawn = new Set<string>();
    for (const id of ids) {
      const { last, acc } = await specStage(id);
      expect(acc.incarnationId).toBe(id);
      expect(last.ui_intent.collection.layout).toBe(drawnFileCardLayout(id));
      drawn.add(last.ui_intent.collection.layout);
    }
    expect(drawn.size).toBeGreaterThan(1);
  });
});
