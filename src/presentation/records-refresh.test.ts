import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  committedRecordsRefreshTarget,
  RECORDS_REFRESH_START_EVENT,
  refreshCommittedRecords,
} from "#shell/records-refresh.js";
import { createRecordsRegionRequestCoordinator } from "#shell/records-region-requests.js";
import { registerRegionRelease } from "#shell/region-scope.js";
import { createDebouncedCapabilitySearch } from "#shell/search-chrome.js";

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

    expect(result).toEqual({ applied: true, region, query: "" });
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

    expect(result).toEqual({ applied: true, region, query: "café & notes" });
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

describe("records region request ownership", () => {
  test("a newer search owns the region over an older mutation refresh", async () => {
    const coordinator = createRecordsRegionRequestCoordinator();
    const responses = new Map<string, (response: Response) => void>();
    const region = { innerHTML: "before mutation" };

    const olderRefresh = refreshCommittedRecords({
      region,
      readUrl: "/capability/tasks/read",
      activeQuery: "old",
      searchUrl: "/capability/tasks/search",
      claimRequest: coordinator.claim,
      request: (url) =>
        new Promise((resolve) => {
          responses.set(url, resolve);
        }),
    });
    const newerSearch = createDebouncedCapabilitySearch({
      readUrl: "/capability/tasks/read",
      searchUrl: "/capability/tasks/search",
      claimRequest: coordinator.claim,
      request: (url) =>
        new Promise((resolve) => {
          responses.set(url, resolve);
        }),
      render: (html) => {
        region.innerHTML = html;
      },
      state: () => undefined,
    });

    const searchDone = newerSearch.searchNow("new");
    responses.get("/capability/tasks/search?q=new")?.(new Response("new search result"));
    await searchDone;
    responses.get("/capability/tasks/search?q=old")?.(new Response("old refresh result"));

    expect(await olderRefresh).toEqual({ applied: false, region, query: "old" });
    expect(region.innerHTML).toBe("new search result");
  });

  test("a newer mutation refresh owns the region over an older search", async () => {
    const coordinator = createRecordsRegionRequestCoordinator();
    const responses = new Map<string, (response: Response) => void>();
    const region = { innerHTML: "before search" };
    const olderSearch = createDebouncedCapabilitySearch({
      readUrl: "/capability/tasks/read",
      searchUrl: "/capability/tasks/search",
      claimRequest: coordinator.claim,
      request: (url) =>
        new Promise((resolve) => {
          responses.set(url, resolve);
        }),
      render: (html) => {
        region.innerHTML = html;
      },
      state: () => undefined,
    });

    const searchDone = olderSearch.searchNow("old");
    const newerRefresh = refreshCommittedRecords({
      region,
      readUrl: "/capability/tasks/read",
      activeQuery: "new",
      searchUrl: "/capability/tasks/search",
      claimRequest: coordinator.claim,
      request: (url) =>
        new Promise((resolve) => {
          responses.set(url, resolve);
        }),
    });
    responses.get("/capability/tasks/search?q=new")?.(new Response("new refresh result"));
    expect(await newerRefresh).toEqual({ applied: true, region, query: "new" });
    responses.get("/capability/tasks/search?q=old")?.(new Response("old search result"));
    await searchDone;

    expect(region.innerHTML).toBe("new refresh result");
  });

  test("the newest of two mutation refreshes is the only one allowed to render", async () => {
    const coordinator = createRecordsRegionRequestCoordinator();
    const responses = new Map<string, (response: Response) => void>();
    const region = { innerHTML: "before refreshes" };
    const request = (url: string) =>
      new Promise<Response>((resolve) => {
        responses.set(url, resolve);
      });
    const older = refreshCommittedRecords({
      region,
      readUrl: "/capability/tasks/read?generation=old",
      claimRequest: coordinator.claim,
      request,
    });
    const newer = refreshCommittedRecords({
      region,
      readUrl: "/capability/tasks/read?generation=new",
      claimRequest: coordinator.claim,
      request,
    });

    responses.get("/capability/tasks/read?generation=new")?.(new Response("newest records"));
    expect(await newer).toEqual({ applied: true, region, query: "" });
    responses.get("/capability/tasks/read?generation=old")?.(new Response("stale records"));
    expect(await older).toEqual({ applied: false, region, query: "" });
    expect(region.innerHTML).toBe("newest records");
  });
});

/**
 * The refresh takes the region before it claims it, and that order is the whole of
 * whether a mutation's aftermath renders at all: the release runs over everything the
 * region still holds, so a claim made first is the first thing it aborts.
 *
 * Executed rather than read, which means standing up just enough of a browser for the
 * module's own `region instanceof Element` question to have an answer. Both globals are
 * put back afterwards, so nothing else in the process sees them.
 */
class RegionElement extends EventTarget {
  innerHTML = "";
  readonly isConnected = true;
  readonly attributes: Record<string, string> = {};
  readonly classList = { contains: () => false };
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  closest(): null {
    return null;
  }
  querySelectorAll(): readonly never[] {
    return [];
  }
  contains(): boolean {
    return false;
  }
}

describe("a refresh takes the region before it claims it", () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  // The three names the module reaches for when it decides it is talking to a browser.
  const shims = { Element: RegionElement, HTMLFormElement: class {}, window: {} };
  const absent = Object.keys(shims).filter((name) => !(name in globals));

  beforeAll(() => {
    for (const name of absent) globals[name] = shims[name as keyof typeof shims];
  });
  afterAll(() => {
    for (const name of absent) delete globals[name];
  });

  test("releases the read that was already filling it, and still renders its own", async () => {
    const region = new RegionElement();
    const viewRead = new AbortController();
    const announced: string[] = [];
    region.addEventListener(RECORDS_REFRESH_START_EVENT, () =>
      announced.push("search stands down"),
    );
    // What the View's own one-shot read looks like to the region rule.
    registerRegionRelease(region, "records read", () => viewRead.abort());

    const result = await refreshCommittedRecords({
      region,
      readUrl: "/capability/tasks/read",
      request: async (_url, init) => {
        expect(init?.signal?.aborted).toBe(false);
        return new Response("<article>committed</article>");
      },
    });

    expect(announced).toEqual(["search stands down"]);
    expect(viewRead.signal.aborted).toBe(true);
    expect(result.applied).toBe(true);
    expect(region.innerHTML).toBe("<article>committed</article>");
    expect(region.attributes["aria-busy"]).toBe("false");
  });
});
