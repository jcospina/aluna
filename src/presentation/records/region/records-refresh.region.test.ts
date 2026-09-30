// The post-save re-read on a real records region: the real `public/records/records-refresh.js` run on the
// collection the server renders, so the state it writes, the count it lands, the event it
// announces and the claim it holds are the ones a person's desk would see.

import { describe, expect, test } from "bun:test";
import { regionScopeReport } from "#shell/core/region-scope.js";
import { COLLECTION_COUNT_LABEL_ATTR } from "#shell/records/collection-count.js";
import {
  committedRecordsRefreshTarget,
  RECORDS_REFRESH_START_EVENT,
  refreshCommittedRecords,
  refreshCommittedRecordsForMutation,
} from "#shell/records/records-refresh.js";
import { recordsRegionRequestCoordinator } from "#shell/records/records-region-requests.js";
import { recordsRegionStatusMessage } from "#shell/records/records-region-status.js";
import { installDomGlobals } from "../../controls/double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import {
  capabilityRecordsRegionId,
  type RenderableCapability,
} from "../../fields/field-renderer.ts";
import { named } from "../collection/collection-page.test-support.ts";
import { renderCollection } from "../collection/list-container.ts";
import { CAPABILITY } from "../record-view/record-view.test-support.ts";
import { renderCollectionCountSidecar } from "./collection-count.ts";

installDomGlobals();

/** A collection as the server renders it, with what a refresh can change on it read back. */
function collection(capability: RenderableCapability = CAPABILITY) {
  const doc = new Doc();
  parseHtml(renderCollection({ capability, items: "<article>stale</article>" }), doc);
  const region = doc.getElementById(capabilityRecordsRegionId(capability.id)) as El;
  const announced: string[] = [];
  doc.addEventListener(RECORDS_REFRESH_START_EVENT, (event) => {
    announced.push((event as unknown as { target: El }).target === region ? "region" : "other");
  });
  const search = doc.querySelector("[data-capability-search]") as El | null;
  const reads = () => regionScopeReport().filter(({ label }) => label === "records read").length;
  const standing = reads();
  return {
    doc,
    region,
    announced,
    search,
    create: named(doc, "form", `Add to ${capability.label}`),
    state: () => doc.querySelector(".capability-collection")?.getAttribute("data-search-state"),
    said: () => doc.querySelector("[data-capability-search-status]")?.textContent,
    /** The page's read claims, counted from what was standing when it was put up. */
    reads: () => reads() - standing,
  };
}

const answering =
  (body: string, status = 200) =>
  () =>
    Promise.resolve(new Response(body, { status }));

describe("a re-read with no search standing", () => {
  test("announces itself, lands the records and the count, and settles idle with the region free", async () => {
    const page = collection();
    const during: unknown[] = [];
    const result = await refreshCommittedRecords({
      region: page.region as never,
      readUrl: "/read",
      request: () => {
        during.push(page.state());
        return answering(`${renderCollectionCountSidecar("3 notes")}<article>fresh</article>`)();
      },
    });
    expect(during).toEqual(["idle"]);
    expect(page.announced).toEqual(["region"]);
    expect([result.applied, page.region.textContent]).toEqual([true, "fresh"]);
    expect(page.doc.querySelector(`[${COLLECTION_COUNT_LABEL_ATTR}]`)?.textContent).toBe("3 notes");
    expect([page.state(), page.said(), page.region.getAttribute("aria-busy")]).toEqual([
      "idle",
      "",
      "false",
    ]);
    expect(page.reads()).toBe(0);
  });

  test("with no query given at all, it reads the collection rather than searching", () => {
    expect(committedRecordsRefreshTarget({ readUrl: "/read", searchUrl: "/search" })).toEqual({
      url: "/read",
      query: "",
    });
  });
});

describe("a re-read under a standing search", () => {
  test("says it is searching while out, then what the search found", async () => {
    for (const [body, state] of [
      ["<article>match</article>", "results"],
      ["  ", "no-matches"],
    ] as const) {
      const page = collection();
      const during: unknown[] = [];
      await refreshCommittedRecords({
        region: page.region as never,
        readUrl: "/read",
        searchUrl: "/search",
        activeQuery: "oat",
        request: () => {
          during.push(page.state());
          return Promise.resolve(new Response(body));
        },
      });
      expect([during, page.state(), page.said()]).toEqual([
        ["loading"],
        state,
        recordsRegionStatusMessage(state, "refresh"),
      ]);
    }
  });

  test("a failed re-read says it could not refresh, and lets the region go", async () => {
    const page = collection();
    const refresh = refreshCommittedRecords({
      region: page.region as never,
      readUrl: "/read",
      request: answering("", 500),
    });
    await expect(refresh).rejects.toThrow();
    expect([page.state(), page.said(), page.region.textContent]).toEqual([
      "error",
      recordsRegionStatusMessage("error", "refresh"),
      "stale",
    ]);
    expect(page.reads()).toBe(0);
  });
});

describe("who owns the region", () => {
  test("a re-read takes the region from a read already out, and an older re-read lands nothing", async () => {
    const page = collection();
    const reading = recordsRegionRequestCoordinator(page.region as never).claim();
    let finishOlder: (response: Response) => void = () => {};
    const older = refreshCommittedRecords({
      region: page.region as never,
      readUrl: "/read",
      request: () =>
        new Promise((resolve) => {
          finishOlder = resolve;
        }),
    });
    expect(reading.signal.aborted).toBe(true);
    await refreshCommittedRecords({
      region: page.region as never,
      readUrl: "/read",
      request: answering("<article>newer</article>"),
    });
    finishOlder(new Response("<article>older</article>"));
    expect(await older).toEqual({ applied: false, region: page.region as never, query: "" });
    expect(page.region.textContent).toBe("newer");
  });
});

describe("an older re-read that fails after a newer one landed", () => {
  test("says nothing and throws nothing, and the newer records stand", async () => {
    const page = collection();
    let failOlder: (error: Error) => void = () => {};
    const older = refreshCommittedRecords({
      region: page.region as never,
      readUrl: "/read",
      request: () =>
        new Promise((_, reject) => {
          failOlder = reject;
        }),
    });
    await refreshCommittedRecords({
      region: page.region as never,
      readUrl: "/read",
      request: answering("<article>newer</article>"),
    });
    failOlder(new Error("severed"));
    expect(await older).toEqual({ applied: false, region: page.region as never, query: "" });
    expect([page.state(), page.region.textContent]).toEqual(["idle", "newer"]);
  });
});

describe("a capability with no search", () => {
  const plain: RenderableCapability = { ...CAPABILITY, actions: ["create", "read", "update"] };

  /** `run` with `doc` as the page's document, put back exactly as it was afterwards. */
  async function onPage(doc: Doc, run: () => Promise<unknown>) {
    const standing = Reflect.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      value: doc,
      configurable: true,
      writable: true,
    });
    try {
      return await run();
    } finally {
      if (standing) Object.defineProperty(globalThis, "document", standing);
      else Reflect.deleteProperty(globalThis, "document");
    }
  }

  test("its create form's re-read still lands, and the region is no longer busy", async () => {
    const page = collection(plain);
    const asked: string[] = [];
    expect(page.search).toBeNull();
    const result = (await onPage(page.doc, () =>
      refreshCommittedRecordsForMutation({
        form: page.create as never,
        request: (url: string) => {
          asked.push(url);
          return answering("<article>fresh</article>")();
        },
      }),
    )) as { applied: boolean } | null;
    expect(result?.applied).toBe(true);
    expect(asked).toEqual([page.create.getAttribute("data-read-url") as string]);
    expect(page.region.getAttribute("aria-busy")).toBe("false");
  });

  test("a failed re-read still lets the region stop being busy", async () => {
    const page = collection(plain);
    page.region.setAttribute("aria-busy", "true");
    await expect(
      onPage(page.doc, () =>
        refreshCommittedRecordsForMutation({
          form: page.create as never,
          request: answering("", 503),
        }),
      ),
    ).rejects.toThrow();
    expect(page.region.getAttribute("aria-busy")).toBe("false");
  });
});
