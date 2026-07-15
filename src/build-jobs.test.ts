import { describe, expect, test } from "bun:test";

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

    expect(abandonedEvents).toEqual(["missing"]);
    expect(pipelineCalls).toBe(1);
  });
});
