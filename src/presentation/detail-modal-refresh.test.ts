import { describe, expect, test } from "bun:test";

import { refreshCommittedRecords } from "../../public/detail-modal-refresh.js";

describe("refreshCommittedRecords", () => {
  test("replaces the region only after a successful committed read and reprocesses it", async () => {
    const region = { innerHTML: "stale" };
    const processed: Array<{ innerHTML: string }> = [];

    const result = await refreshCommittedRecords({
      region,
      readUrl: "/capability/tasks/read",
      request: async (url, init) => {
        expect(url).toBe("/capability/tasks/read");
        expect(init?.headers).toEqual({ "HX-Request": "true" });
        return new Response("<article>committed</article>");
      },
      process: (refreshed) => processed.push(refreshed),
    });

    expect(result).toBe(region);
    expect(region.innerHTML).toBe("<article>committed</article>");
    expect(processed).toEqual([region]);
  });

  test("rejects an HTTP failure without replacing the stale records region", async () => {
    const region = { innerHTML: "stale" };

    await expect(
      refreshCommittedRecords({
        region,
        readUrl: "/capability/tasks/read",
        request: async () => new Response("unavailable", { status: 503 }),
      }),
    ).rejects.toThrow("status 503");
    expect(region.innerHTML).toBe("stale");
  });

  test("rejects a network failure without replacing the stale records region", async () => {
    const region = { innerHTML: "stale" };

    await expect(
      refreshCommittedRecords({
        region,
        readUrl: "/capability/tasks/read",
        request: async () => {
          throw new TypeError("offline");
        },
      }),
    ).rejects.toThrow("offline");
    expect(region.innerHTML).toBe("stale");
  });
});
