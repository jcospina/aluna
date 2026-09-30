// The capability search running: its request core driven with its own seams, and the real
// `public/records/search-chrome.js` started on the collection the server renders — typing, Enter, Clear,
// a post-save re-read taking the region, and a form missing what the search needs.

import { afterEach, describe, expect, test } from "bun:test";
import { regionScopeReport, releaseRegionContent } from "#shell/core/region-scope.js";
import { COLLECTION_COUNT_LABEL_ATTR } from "#shell/records/collection-count.js";
import { RECORDS_REFRESH_START_EVENT } from "#shell/records/records-refresh.js";
import {
  recordsRegionStatusMessage,
  searchUrlWithQuery,
} from "#shell/records/records-region-status.js";
import {
  createDebouncedCapabilitySearch,
  DEFAULT_SEARCH_DEBOUNCE_MS,
} from "#shell/records/search-chrome.js";
import type { El } from "../../controls/double/choice-picker.test-support.ts";
import { capabilityRecordsRegionId } from "../../fields/field-renderer.ts";
import { named } from "../../records/collection/collection-page.test-support.ts";
import { renderCollection } from "../../records/collection/list-container.ts";
import {
  CAPABILITY,
  recordDesk,
  standingWindow,
} from "../../records/record-view/record-view.test-support.ts";
import { renderCollectionCountSidecar } from "../../records/region/collection-count.ts";

/** A claim that never coordinates with anything, so the core's own invalidation is what is asked. */
function freeClaims() {
  const claims: { released: number; aborted: number }[] = [];
  return {
    claims,
    claimRequest: () => {
      const seen = { released: 0, aborted: 0 };
      claims.push(seen);
      return {
        signal: new AbortController().signal,
        isCurrent: () => true,
        abort: () => {
          seen.aborted += 1;
        },
        release: () => {
          seen.released += 1;
        },
      };
    },
  };
}

/** Requests that answer only when told, in whatever order a test tells them. */
function heldRequests() {
  const held: { url: string; answer: (body: string) => void; fail: () => void }[] = [];
  return {
    held,
    request: (url: string) =>
      new Promise<Response>((resolve, reject) => {
        held.push({
          url,
          answer: (body) => resolve(new Response(body)),
          fail: () => reject(new Error("severed")),
        });
      }),
  };
}

const turns = async () => {
  for (let turn = 0; turn < 5; turn += 1) await Bun.sleep(0);
};

describe("the search core, asked through its own seams", () => {
  test("a response overtaken by a newer query is dropped, whoever issued the claims", async () => {
    const { claimRequest } = freeClaims();
    const { held, request } = heldRequests();
    const rendered: string[] = [];
    const search = createDebouncedCapabilitySearch({
      readUrl: "/read",
      searchUrl: "/search",
      render: (html) => rendered.push(html),
      state: () => {},
      claimRequest,
      request,
    });
    const first = search.searchNow("old");
    const second = search.searchNow("new");
    held[1]?.answer("<p>new</p>");
    await second;
    held[0]?.answer("<p>old</p>");
    await first;
    expect(rendered).toEqual(["<p>new</p>"]);
  });

  test("a failure overtaken by a newer query says nothing and throws nothing", async () => {
    const { claimRequest } = freeClaims();
    const { held, request } = heldRequests();
    const states: string[] = [];
    const search = createDebouncedCapabilitySearch({
      readUrl: "/read",
      searchUrl: "/search",
      render: () => {},
      state: (state) => states.push(state),
      claimRequest,
      request,
    });
    const first = search.searchNow("old");
    const second = search.searchNow("new");
    held[1]?.answer("<p>new</p>");
    await second;
    held[0]?.fail();
    await expect(first).resolves.toBeUndefined();
    expect(states).not.toContain("error");
  });

  test("every claim is released when its request ends, and a finished one is never aborted", async () => {
    const { claims, claimRequest } = freeClaims();
    const search = createDebouncedCapabilitySearch({
      readUrl: "/read",
      searchUrl: "/search",
      render: () => {},
      state: () => {},
      claimRequest,
      request: () => Promise.resolve(new Response("<p>x</p>")),
    });
    await search.searchNow("one");
    search.update("two");
    search.dispose();
    expect(claims).toEqual([{ released: 1, aborted: 0 }]);
  });

  test("the request still out when an older one ends late is the one a newer query stops", async () => {
    const { claims, claimRequest } = freeClaims();
    const { held, request } = heldRequests();
    const search = createDebouncedCapabilitySearch({
      readUrl: "/read",
      searchUrl: "/search",
      render: () => {},
      state: () => {},
      claimRequest,
      request,
    });
    const first = search.searchNow("a");
    void search.searchNow("b");
    held[0]?.answer("");
    await first;
    search.update("c");
    expect(claims.map(({ aborted }) => aborted)).toEqual([1, 1]);
    search.dispose();
  });

  test("an empty query settles idle, and an answer of only space is no match", async () => {
    const states: string[] = [];
    const answers = ["<p>all of it</p>", " \n "];
    const search = createDebouncedCapabilitySearch({
      readUrl: "/read",
      searchUrl: "/search",
      render: () => {},
      state: (state) => states.push(state),
      request: () => Promise.resolve(new Response(answers.shift())),
    });
    await search.searchNow("");
    await search.searchNow("zzz");
    expect(states).toEqual(["loading", "idle", "loading", "no-matches"]);
  });

  test("searching now stops the search that was waiting out its debounce", async () => {
    const scheduled: { cancelled: boolean }[] = [];
    const asked: string[] = [];
    const search = createDebouncedCapabilitySearch({
      readUrl: "/read",
      searchUrl: "/search",
      render: () => {},
      state: () => {},
      request: (url) => {
        asked.push(url);
        return Promise.resolve(new Response(""));
      },
      schedule: () => {
        const one = { cancelled: false };
        scheduled.push(one);
        return one as never;
      },
      cancelSchedule: (timer) => {
        (timer as unknown as { cancelled: boolean }).cancelled = true;
      },
    });
    search.update("a");
    await search.searchNow("b");
    expect(scheduled).toEqual([{ cancelled: true }]);
    expect(asked).toEqual([searchUrlWithQuery("/search", "b")]);
  });
});

type Desk = Awaited<ReturnType<typeof recordDesk>>;
const host = globalThis as Record<string, unknown>;
const TIMERS = ["fetch", "setTimeout", "clearTimeout"] as const;
let desk: Desk | undefined;
let before: [string, PropertyDescriptor | undefined][] = [];

/** Put back every global the page stood up, and let its region's work go. */
function leave() {
  if (desk === undefined) return;
  releaseRegionContent(desk.region as never);
  for (const [name, descriptor] of before) {
    if (descriptor) Object.defineProperty(host, name, descriptor);
    else Reflect.deleteProperty(host, name);
  }
  desk.restore();
  desk = undefined;
}

afterEach(leave);

/** The collection with search started, its requests and timers kept, run only when told. */
async function searching(
  answer: (url: string) => Promise<Response> = () => Promise.resolve(new Response("")),
) {
  const standing = await recordDesk(renderCollection({ capability: CAPABILITY }), {
    capabilityId: CAPABILITY.id,
    modules: ["records/search-chrome.js"],
  });
  desk = standing;
  const asked: string[] = [];
  const timers: { run: () => void; delay: number; cancelled: boolean }[] = [];
  before = TIMERS.map((name) => [name, Reflect.getOwnPropertyDescriptor(host, name)]);
  const stood: Record<(typeof TIMERS)[number], unknown> = {
    fetch: (url: string) => {
      asked.push(url);
      return answer(url);
    },
    setTimeout: (run: () => void, delay: number) => {
      const timer = { run, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer: { cancelled: boolean }) => {
      if (timer) timer.cancelled = true;
    },
  };
  for (const [name, value] of Object.entries(stood)) {
    Object.defineProperty(host, name, { value, configurable: true, writable: true });
  }
  const controllers = () =>
    regionScopeReport().filter(({ label }) => label === "search controller").length;
  const standingClaims = controllers();
  const form = standing.doc.querySelector('form[role="search"]') as El;
  const input = form.querySelector('input[type="search"]') as El;
  const records = standing.doc.getElementById(capabilityRecordsRegionId(CAPABILITY.id)) as El;
  return {
    doc: standing.doc,
    press: standing.press,
    asked,
    timers,
    form,
    input,
    records,
    clear: named(form, "button", "Clear"),
    type: (words: string) => {
      input.value = words;
      standing.doc.fire("input", input);
    },
    /** Run every timer still waiting, the way the page's clock would once the debounce is up. */
    wait: async () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run();
      await turns();
    },
    /** The search's claims on the page, counted from what was standing when it was put up. */
    claims: () => controllers() - standingClaims,
  };
}

describe("typing into the search, on the collection the server renders", () => {
  test("waits out the form's own debounce, then shows what the search answered, counted", async () => {
    const sentence = "2 of 5 notes";
    const page = await searching(() =>
      Promise.resolve(
        new Response(`${renderCollectionCountSidecar(sentence)}<article>match</article>`),
      ),
    );
    page.form.setAttribute("data-search-debounce-ms", "120");
    page.type("oat");
    page.type("oat milk");
    expect(page.timers.map(({ delay, cancelled }) => [delay, cancelled])).toEqual([
      [120, true],
      [120, false],
    ]);
    expect(page.claims()).toBe(1);
    await page.wait();
    expect(page.asked).toEqual([
      searchUrlWithQuery(page.form.getAttribute("data-search-url") as string, "oat milk"),
    ]);
    expect(page.records.textContent).toBe("match");
    expect(page.doc.querySelector(`[${COLLECTION_COUNT_LABEL_ATTR}]`)?.textContent).toBe(sentence);
  });

  test("a form that names no debounce waits the default", async () => {
    const page = await searching();
    page.form.removeAttribute("data-search-debounce-ms");
    page.type("oat");
    expect(page.timers.map(({ delay }) => delay)).toEqual([DEFAULT_SEARCH_DEBOUNCE_MS]);
  });

  test("with no htmx on the page the answer is still shown", async () => {
    const page = await searching(() => Promise.resolve(new Response("<article>match</article>")));
    standingWindow().htmx = undefined;
    page.type("oat");
    await page.wait();
    expect(page.records.textContent).toBe("match");
    expect(page.form.getAttribute("data-search-state")).toBe("results");
  });

  test("a search that fails says the search failed", async () => {
    const page = await searching(() => Promise.resolve(new Response("", { status: 500 })));
    page.type("oat");
    await page.wait();
    const status = page.doc.querySelector("[data-capability-search-status]") as El;
    expect(status.textContent).toBe(recordsRegionStatusMessage("error", "search"));
  });

  test("a form missing its region, its read or its search does nothing and throws nothing", async () => {
    for (const missing of ["data-records-region-id", "data-read-url", "data-search-url"]) {
      const page = await searching();
      page.form.removeAttribute(missing);
      expect(() => page.type("oat")).not.toThrow();
      expect(() => page.doc.fire("submit", page.form)).not.toThrow();
      expect(() => page.press(page.clear)).not.toThrow();
      await page.wait();
      expect(page.asked).toEqual([]);
      leave();
    }
  });
});

describe("Enter and Clear", () => {
  test("Enter searches at once, and the page does not submit the form", async () => {
    const page = await searching();
    page.input.value = "oat";
    expect(page.doc.fire("submit", page.form).prevented).toBe(true);
    await turns();
    expect(page.asked).toHaveLength(1);
  });

  test("another form's submission is none of the search's business", async () => {
    const page = await searching();
    const create = named(page.doc, "form", `Add to ${CAPABILITY.label}`);
    expect(page.doc.fire("submit", create).prevented).toBe(false);
    expect(() => page.press(create)).not.toThrow();
    expect(page.asked).toEqual([]);
  });

  test("Clear puts the keyboard back in the search, whether the read lands or fails", async () => {
    for (const answer of [
      () => Promise.resolve(new Response("")),
      () => Promise.reject(new Error("severed")),
    ]) {
      const page = await searching(answer);
      page.type("oat");
      page.press(page.clear);
      await turns();
      expect(page.doc.activeElement).toBe(page.input);
      leave();
    }
  });
});

describe("what takes the search's work away", () => {
  test("the region letting go stops a waiting search, and the next keystroke starts afresh", async () => {
    const page = await searching();
    page.type("oat");
    releaseRegionContent(page.form as never);
    await page.wait();
    expect([page.asked, page.claims()]).toEqual([[], 0]);
    page.type("milk");
    expect(page.claims()).toBe(1);
  });

  test("a post-save re-read starting in the region stops a waiting search", async () => {
    const page = await searching();
    page.records.dispatchEvent(new CustomEvent(RECORDS_REFRESH_START_EVENT, { bubbles: true }));
    page.type("oat");
    page.records.dispatchEvent(new CustomEvent(RECORDS_REFRESH_START_EVENT, { bubbles: true }));
    await page.wait();
    expect(page.asked).toEqual([]);
  });
});
