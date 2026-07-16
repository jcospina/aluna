import { describe, expect, test } from "bun:test";

import {
  type CapabilitySearchState,
  createDebouncedCapabilitySearch,
  DEFAULT_SEARCH_DEBOUNCE_MS,
  handOffRecordsRegionToSearch,
} from "../../public/search-chrome.js";

interface ScheduledWork {
  readonly callback: () => void;
  readonly delayMs: number;
  cancelled: boolean;
}

function controlledSchedule() {
  const work: ScheduledWork[] = [];
  return {
    cancel: (timer: ReturnType<typeof setTimeout>) => {
      const item = timer as unknown as ScheduledWork;
      item.cancelled = true;
    },
    runLatest: () => {
      const item = work.findLast((candidate) => !candidate.cancelled);
      if (!item) throw new Error("No scheduled search to run.");
      item.cancelled = true;
      item.callback();
    },
    schedule: (callback: () => void, delayMs: number) => {
      const item: ScheduledWork = { callback, delayMs, cancelled: false };
      work.push(item);
      return item as unknown as ReturnType<typeof setTimeout>;
    },
    work,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(0);
  }
  throw new Error("Timed out waiting for scheduled search work.");
}

describe("debounced capability search", () => {
  test("typing debounces to one encoded GET search request and renders its shared fragment", async () => {
    const scheduled = controlledSchedule();
    const requested: Array<{ url: string; init?: RequestInit }> = [];
    const rendered: string[] = [];
    const states: CapabilitySearchState[] = [];
    const search = createDebouncedCapabilitySearch({
      readUrl: "/capability/journal/read",
      searchUrl: "/capability/journal/search",
      schedule: scheduled.schedule,
      cancelSchedule: scheduled.cancel,
      request: async (url, init) => {
        requested.push({ url, init });
        return new Response('<article data-detail-template="detail-journal-1">match</article>');
      },
      render: (html) => rendered.push(html),
      state: (state) => states.push(state),
    });

    search.update("caf");
    search.update("café & notes");

    expect(requested).toEqual([]);
    expect(scheduled.work).toHaveLength(2);
    expect(scheduled.work[0]).toMatchObject({ cancelled: true, delayMs: 300 });
    expect(scheduled.work[1]).toMatchObject({ cancelled: false, delayMs: 300 });
    scheduled.runLatest();
    await waitUntil(() => rendered.length === 1);

    expect(DEFAULT_SEARCH_DEBOUNCE_MS).toBe(300);
    expect(requested).toHaveLength(1);
    expect(requested[0]?.url).toBe("/capability/journal/search?q=caf%C3%A9%20%26%20notes");
    expect(requested[0]?.init?.headers).toEqual({ "HX-Request": "true" });
    expect(requested[0]?.init?.method).toBeUndefined();
    expect(rendered[0]).toContain("data-detail-template");
    expect(states).toEqual(["loading", "loading", "results"]);
  });

  test("whitespace-only typing and Clear restore canonical read without calling search", async () => {
    const scheduled = controlledSchedule();
    const urls: string[] = [];
    const queries: string[] = [];
    const rendered: string[] = [];
    const search = createDebouncedCapabilitySearch({
      readUrl: "/capability/journal/read",
      searchUrl: "/capability/journal/search",
      schedule: scheduled.schedule,
      cancelSchedule: scheduled.cancel,
      request: async (url) => {
        urls.push(url);
        return new Response("<article>canonical read</article>");
      },
      render: (html) => rendered.push(html),
      state: () => undefined,
      queryChanged: (query) => queries.push(query),
    });

    search.update("\u2003 \n\t");
    scheduled.runLatest();
    await waitUntil(() => rendered.length === 1);
    await search.searchNow("");

    expect(urls).toEqual(["/capability/journal/read", "/capability/journal/read"]);
    expect(urls).not.toContain("/capability/journal/search");
    expect(rendered).toEqual([
      "<article>canonical read</article>",
      "<article>canonical read</article>",
    ]);
    expect(queries).toEqual(["\u2003 \n\t", ""]);
  });

  test("empty search results become a platform no-matches state", async () => {
    const states: CapabilitySearchState[] = [];
    let rendered = "stale";
    const search = createDebouncedCapabilitySearch({
      readUrl: "/capability/journal/read",
      searchUrl: "/capability/journal/search",
      request: async () => new Response(""),
      render: (html) => {
        rendered = html;
      },
      state: (state) => states.push(state),
    });

    await search.searchNow("missing");

    expect(rendered).toBe("");
    expect(states).toEqual(["loading", "no-matches"]);
  });
});

describe("capability search request ownership", () => {
  test("the HTMX handoff aborts an actual pending external request and removes its trigger", () => {
    const externalRequest = new AbortController();
    const attributes = new Set(["hx-get", "hx-trigger"]);
    const region = {
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as Parameters<typeof handOffRecordsRegionToSearch>[0];
    const htmx = {
      trigger: (node: typeof region, eventName: string) => {
        expect(node).toBe(region);
        expect(eventName).toBe("htmx:abort");
        externalRequest.abort();
      },
    };

    handOffRecordsRegionToSearch(region, htmx);

    expect(externalRequest.signal.aborted).toBe(true);
    expect(attributes).toEqual(new Set());
  });

  test("an older response cannot overwrite a newer query", async () => {
    const responses = new Map<string, (response: Response) => void>();
    const rendered: string[] = [];
    const search = createDebouncedCapabilitySearch({
      readUrl: "/capability/journal/read",
      searchUrl: "/capability/journal/search",
      request: (url) =>
        new Promise((resolve) => {
          responses.set(url, resolve);
        }),
      render: (html) => rendered.push(html),
      state: () => undefined,
    });

    const older = search.searchNow("old").catch(() => undefined);
    const newer = search.searchNow("new");
    responses.get("/capability/journal/search?q=new")?.(new Response("new result"));
    await newer;
    responses.get("/capability/journal/search?q=old")?.(new Response("old result"));
    await older;

    expect(rendered).toEqual(["new result"]);
  });

  test("the first interaction cancels the View's external initial read before debounce", () => {
    const scheduled = controlledSchedule();
    let externalReadCancellations = 0;
    const search = createDebouncedCapabilitySearch({
      readUrl: "/capability/journal/read",
      searchUrl: "/capability/journal/search",
      schedule: scheduled.schedule,
      cancelSchedule: scheduled.cancel,
      request: async () => new Response("never reached"),
      render: () => undefined,
      state: () => undefined,
      cancelExternalRead: () => {
        externalReadCancellations += 1;
      },
    });

    search.update("newest query");

    expect(externalReadCancellations).toBe(1);
    expect(scheduled.work).toHaveLength(1);
  });

  test("a failed request preserves rendered records and exposes an error state", async () => {
    const states: CapabilitySearchState[] = [];
    const rendered: string[] = [];
    const search = createDebouncedCapabilitySearch({
      readUrl: "/capability/journal/read",
      searchUrl: "/capability/journal/search",
      request: async () => new Response("unavailable", { status: 503 }),
      render: (html) => rendered.push(html),
      state: (state) => states.push(state),
    });

    await expect(search.searchNow("notes")).rejects.toThrow("status 503");
    expect(rendered).toEqual([]);
    expect(states).toEqual(["loading", "error"]);
  });
});
