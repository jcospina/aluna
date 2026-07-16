import { describe, expect, test } from "bun:test";

import {
  committedRecordsRefreshTarget,
  refreshCommittedRecords,
} from "../../public/detail-modal-refresh.js";

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

    expect(result).toEqual({ region, query: "" });
    expect(region.innerHTML).toBe("<article>committed</article>");
    expect(processed).toEqual([region]);
  });

  test("reruns the active nonblank search query instead of canonical read", async () => {
    const region = { innerHTML: "stale" };
    const requested: string[] = [];

    const result = await refreshCommittedRecords({
      region,
      readUrl: "/capability/tasks/read",
      searchUrl: "/capability/tasks/search",
      activeQuery: " café & notes ",
      request: async (url) => {
        requested.push(url);
        return new Response("<article>matching committed search</article>");
      },
    });

    expect(result).toEqual({ region, query: "café & notes" });
    expect(requested).toEqual(["/capability/tasks/search?q=caf%C3%A9%20%26%20notes"]);
    expect(region.innerHTML).toBe("<article>matching committed search</article>");
  });

  test("whitespace active search falls back to canonical read", () => {
    expect(
      committedRecordsRefreshTarget({
        readUrl: "/capability/tasks/read",
        searchUrl: "/capability/tasks/search",
        activeQuery: "\n\t ",
      }),
    ).toEqual({ url: "/capability/tasks/read", query: "" });
  });

  test("rejects an HTTP failure without replacing the stale records region", async () => {
    const region = { innerHTML: "stale" };

    await expect(
      refreshCommittedRecords({
        region,
        readUrl: "/capability/tasks/read",
        request: async () => new Response("unavailable", { status: 503 }),
      }),
    ).rejects.toThrow("Committed records refresh failed with status 503");
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
