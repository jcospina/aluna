// A capability's records region: what it says about each state it is in, and who may fill it. Run
// through the real `public/records-region-status.js` and `public/records-region-requests.js`.

import { describe, expect, test } from "bun:test";

import {
  createRecordsRegionRequestCoordinator,
  recordsRegionRequestCoordinator,
} from "#shell/records-region-requests.js";
import {
  applyRecordsRegionState,
  recordsRegionStatusMessage,
  searchUrlWithQuery,
} from "#shell/records-region-status.js";
import { regionScopeReport } from "#shell/region-scope.js";
import { installDomGlobals } from "../controls/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../controls/choice-picker.test-support.ts";
import { capabilityRecordsRegionId } from "../fields/field-renderer.ts";
import { renderCollection } from "./list-container.ts";
import { CAPABILITY } from "./record-view.test-support.ts";

installDomGlobals();

const STATES = ["idle", "loading", "results", "no-matches", "error"] as const;

describe("what the region says about each state", () => {
  test("every state but idle says something, and no two things it says are the same", () => {
    const said = ["search", "refresh"].flatMap((act) =>
      STATES.map((state) => recordsRegionStatusMessage(state, act as "search")),
    );
    expect(said.filter((sentence) => sentence === "")).toHaveLength(2);
    const spoken = said.filter((sentence) => sentence !== "");
    expect(new Set(spoken).size).toBe(5);
    expect(recordsRegionStatusMessage("idle", "search")).toBe("");
  });

  test("only a failure is told apart by what failed", () => {
    for (const state of ["loading", "results", "no-matches"] as const) {
      expect(recordsRegionStatusMessage(state, "search")).toBe(
        recordsRegionStatusMessage(state, "refresh"),
      );
    }
    // Someone who saved a record did not search for anything, so only a search's failure says so.
    expect(recordsRegionStatusMessage("error", "search")).toContain("search");
    expect(recordsRegionStatusMessage("error", "refresh")).not.toContain("search");
  });

  test("a state nobody named is a bug that says which", () => {
    expect(() => recordsRegionStatusMessage("paused" as never, "search")).toThrow(/paused/);
  });

  test("a query joins a search address that already asks something", () => {
    expect(searchUrlWithQuery("/capability/notes/search?page=2", "oat milk")).toBe(
      "/capability/notes/search?page=2&q=oat%20milk",
    );
  });
});

describe("where the region's state is written", () => {
  const collection = () => {
    const doc = new Doc();
    parseHtml(renderCollection({ capability: CAPABILITY }), doc);
    return {
      doc,
      form: doc.querySelector("[data-capability-search]") as El,
      region: doc.getElementById(capabilityRecordsRegionId(CAPABILITY.id)) as El,
      status: doc.querySelector("[data-capability-search-status]") as El,
    };
  };

  test("the region is busy only while loading, and the collection and its line say each state", () => {
    for (const state of STATES) {
      const page = collection();
      applyRecordsRegionState(page.form as never, page.region as never, state, "search");
      expect(page.region.getAttribute("aria-busy")).toBe(state === "loading" ? "true" : "false");
      expect(
        page.doc.querySelector(".capability-collection")?.getAttribute("data-search-state"),
      ).toBe(state);
      expect(page.form.getAttribute("data-search-state")).toBe(state);
      expect(page.status.textContent).toBe(recordsRegionStatusMessage(state, "search"));
    }
  });

  test("a form outside any collection, or a collection with no status line, is still written", () => {
    const page = collection();
    page.status.remove();
    expect(() =>
      applyRecordsRegionState(page.form as never, page.region as never, "results", "search"),
    ).not.toThrow();
    const loose = parseHtml("<form></form>", new Doc()).querySelector("form") as El;
    expect(() =>
      applyRecordsRegionState(loose as never, page.region as never, "error", "refresh"),
    ).not.toThrow();
    expect(loose.getAttribute("data-search-state")).toBe("error");
  });
});

describe("one read at a time in a region", () => {
  test("a newer claim takes the region; an older one aborting or finishing late leaves it", () => {
    const { claim } = createRecordsRegionRequestCoordinator();
    const older = claim();
    const newer = claim();
    expect([older.signal.aborted, older.isCurrent(), newer.isCurrent()]).toEqual([
      true,
      false,
      true,
    ]);
    older.abort();
    older.release();
    expect(newer.isCurrent()).toBe(true);
  });

  test("a claim that finished is no longer the region's, and the next is", () => {
    const { claim } = createRecordsRegionRequestCoordinator();
    const done = claim();
    done.release();
    expect([done.isCurrent(), done.signal.aborted]).toEqual([false, false]);
    const next = claim();
    expect([next.isCurrent(), done.signal.aborted]).toEqual([true, false]);
    next.abort();
    expect(next.isCurrent()).toBe(false);
  });

  test("a region has one coordinator however often it is asked, and its reads are released with it", () => {
    const region = parseHtml(
      "<section data-content-region='records'></section>",
      new Doc(),
    ).querySelector("section") as El;
    const count = () => regionScopeReport().filter(({ label }) => label === "records read").length;
    const standing = count();
    const reads = () => count() - standing;
    const first = recordsRegionRequestCoordinator(region as never).claim();
    expect(reads()).toBe(1);
    const second = recordsRegionRequestCoordinator(region as never).claim();
    expect([first.signal.aborted, second.isCurrent()]).toEqual([true, true]);
    first.release();
    second.abort();
    expect([second.signal.aborted, reads()]).toEqual([true, 0]);
    const third = recordsRegionRequestCoordinator(region as never).claim();
    third.release();
    expect([third.isCurrent(), reads()]).toEqual([false, 0]);
  });
});
