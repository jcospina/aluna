import { describe, expect, test } from "bun:test";

import { renderBuildEnding } from "../../server/http/fragments.ts";
import { FAILED_BUILD_ENDING } from "../streaming/terminal-presentation.ts";
import { createBuildJobQueue } from "./build-jobs.ts";

describe("BuildJobQueue", () => {
  test("expires abandoned pending jobs without disturbing newer work", async () => {
    let now = 0;
    let pipelineCalls = 0;
    const ids = ["abandoned", "current"];
    const queue = createBuildJobQueue({
      createId: () => ids.shift() ?? "unexpected",
      now: () => now,
      pendingJobTtlMs: 20,
      pipeline: async () => {
        pipelineCalls += 1;
      },
    });
    queue.create("never streamed");
    now = 21;
    queue.create("still current");

    const abandonedEvents: string[] = [];
    await queue.stream(
      "abandoned",
      async (_event, data) => {
        abandonedEvents.push(data);
      },
      () => false,
    );
    await queue.stream(
      "current",
      async () => undefined,
      () => false,
    );

    // The abandoned job is gone — `missing` is what a stream for an unknown id answers.
    expect(abandonedEvents).toEqual(["missing"]);
    expect(pipelineCalls).toBe(1);
  });

  test("a pipeline that threw without presenting still ends the narration and holds", async () => {
    // The last resort — a double fault, since every pipeline presents its own terminal.
    // It has no restoration to give back, but it is a build that failed, and a failure
    // that promoted its apology into the window would take the person's open capability
    // out with it (PLAN decisions 23 and 25).
    const queue = createBuildJobQueue({
      createId: () => "build-1",
      pipeline: async () => {
        throw new Error("the pipeline itself came apart");
      },
    });
    queue.create("make me something");

    const events: Array<{ event: string; data: string }> = [];
    await queue.stream(
      "build-1",
      async (event, data) => {
        events.push({ event, data });
      },
      () => false,
    );

    expect(events.map(({ event }) => event)).toEqual(["narration", "done"]);
    expect(events[0]?.data).toContain("data-build-ending");
    expect(events[0]?.data).toBe(renderBuildEnding("build-1", FAILED_BUILD_ENDING));
    expect(events[0]?.data).not.toContain("came apart");
    expect(events[1]?.data).toBe("error");
  });
});
