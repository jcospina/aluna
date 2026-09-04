import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as shellCount from "#shell/collection-count.js";
import { readCollectionCountFromSwap, splitCollectionCount } from "#shell/collection-count.js";
import { installDomGlobals } from "../controls/choice-picker.fixture.test-support.ts";
import { Doc, parseHtml } from "../controls/choice-picker.test-support.ts";
import type { RenderableCapability } from "../fields/field-renderer.ts";
import {
  COLLECTION_COUNT_LABEL_ATTR,
  COLLECTION_COUNT_SIDECAR_PREFIX,
  COLLECTION_COUNT_SIDECAR_SUFFIX,
  capabilityCountLabelId,
  collectionCountSentence,
  filteredCollectionCountSentence,
  renderCollectionCountLabel,
  renderCollectionCountSidecar,
} from "./collection-count.ts";
import { countRenderedItems, renderCollection, renderItemWrapper } from "./list-container.ts";

// The collection's count is platform chrome (PLAN decision 32): no spec field declares
// it, no generated artifact renders it, and the number rides the same read the records
// arrive in. These pin the two halves that have to agree — what the server writes at the
// head of a records answer, and what the shell reads back off it.

const SAMPLE: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  noun: "task",
  schema: { fields: [] },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  actions: ["create", "read", "update", "delete", "search"],
};

describe("what the collection says", () => {
  test("states the number in the capability's own noun", () => {
    expect(collectionCountSentence(3, "task")).toBe("3 tasks");
    expect(collectionCountSentence(1, "task")).toBe("1 task");
  });

  test("says nothing at zero — the platform empty state speaks for a bare collection", () => {
    expect(collectionCountSentence(0, "task")).toBe("");
  });

  test("pluralizes the nouns English spells one way", () => {
    expect(collectionCountSentence(2, "recipe")).toBe("2 recipes");
    expect(collectionCountSentence(2, "entry")).toBe("2 entries");
    expect(collectionCountSentence(2, "box")).toBe("2 boxes");
    expect(collectionCountSentence(2, "dish")).toBe("2 dishes");
    expect(collectionCountSentence(2, "match")).toBe("2 matches");
    expect(collectionCountSentence(2, "address")).toBe("2 addresses");
    expect(collectionCountSentence(2, "day")).toBe("2 days");
    expect(collectionCountSentence(2, "child")).toBe("2 children");
    expect(collectionCountSentence(2, "person")).toBe("2 people");
    expect(collectionCountSentence(2, "tea tasting")).toBe("2 tea tastings");
  });

  test("declines the nouns English spells more than one way, and states the number alone", () => {
    // `-f`/`-fe` (leaf/chief), `-o` (potato/photo) and anything already ending in `s`
    // (a series, or a model that emitted a plural) each have two answers.
    for (const noun of ["leaf", "knife", "shelf", "life", "potato", "hero", "series", "notes"]) {
      expect(collectionCountSentence(7, noun)).toBe("7");
      // Declined once is declined at every count, so the label never changes shape.
      expect(collectionCountSentence(1, noun)).toBe("1");
    }
  });

  test("never counts what English does not count", () => {
    for (const noun of ["data", "equipment", "furniture", "news", "information"]) {
      expect(collectionCountSentence(7, noun)).toBe("7");
    }
  });

  test("never glues an English plural onto a noun that is not written in Latin letters", () => {
    for (const noun of ["메모", "笔记", "ノート", "воспоминание", "مذكرة", "note."]) {
      expect(collectionCountSentence(7, noun)).toBe("7");
      expect(collectionCountSentence(1, noun)).toBe("1");
    }
  });

  test("writes a large number the way a person reads one", () => {
    expect(collectionCountSentence(1234567, "note")).toBe("1,234,567 notes");
  });
});

describe("what a filtered collection says", () => {
  test("states both numbers, and neither of them stands alone", () => {
    expect(filteredCollectionCountSentence(3, 22, "note")).toBe("3 of 22 notes");
    expect(filteredCollectionCountSentence(1, 22, "note")).toBe("1 of 22 notes");
  });

  test("nothing matched says so, beside a total that is not zero", () => {
    // The case decision 32 exists for. A capability with 22 notes and a search that
    // found none of them must never read as a capability with no notes.
    expect(filteredCollectionCountSentence(0, 22, "note")).toBe("0 of 22 notes");
  });

  test("the total governs the noun, because the noun belongs to the collection", () => {
    expect(filteredCollectionCountSentence(0, 1, "note")).toBe("0 of 1 note");
    expect(filteredCollectionCountSentence(1, 1, "note")).toBe("1 of 1 note");
    expect(filteredCollectionCountSentence(2, 3, "entry")).toBe("2 of 3 entries");
  });

  test("a bare collection is not a filtered one, and says nothing here", () => {
    // Nothing to filter, so nothing to qualify: the platform empty state is what a
    // collection with no records says, and it says it once.
    expect(filteredCollectionCountSentence(0, 0, "note")).toBe("");
  });

  test("a pair that cannot both be true is not stated at all", () => {
    // The rows are selected before the total is counted and the two are not one
    // transaction, so a delete landing between them yields more matched than there are.
    // "3 of 1 notes" is not a number to repair into a plausible one.
    expect(filteredCollectionCountSentence(3, 1, "note")).toBe("");
    expect(filteredCollectionCountSentence(-1, 22, "note")).toBe("");
  });

  test("a declined noun leaves the pair, which is true in every language", () => {
    for (const noun of ["leaf", "potato", "series", "data", "메모", "مذكرة"]) {
      expect(filteredCollectionCountSentence(2, 7, noun)).toBe("2 of 7");
    }
  });

  test("writes both numbers the way a person reads them", () => {
    expect(filteredCollectionCountSentence(1234, 1234567, "note")).toBe("1,234 of 1,234,567 notes");
  });
});

describe("the matched number is read off the answer, never re-derived", () => {
  const wrap = (id: string) =>
    renderItemWrapper(`<p>${id}</p>`, { id }, { templateId: `record-tasks-${id}` });

  test("counts the wrappers the platform itself rendered", () => {
    expect(countRenderedItems("")).toBe(0);
    expect(countRenderedItems(`<div>${wrap("a")}${wrap("b")}${wrap("c")}</div>`)).toBe(3);
  });

  test("a card with nothing to open counts too — it is still a rendered record", () => {
    expect(countRenderedItems(renderItemWrapper("<p>x</p>", { id: "x" }))).toBe(1);
  });

  test("a Handler's own element wearing the class is not a record", () => {
    // The wrapper writes the class and the payload together, so both are asked for. A
    // capability that lays its items out in `<div class="capability-item stack">` of its
    // own is not adding records to the collection, and must not add to its count.
    expect(countRenderedItems('<div class="capability-item stack">not a record</div>')).toBe(0);
    expect(countRenderedItems('<div class="capability-item">not a record</div>')).toBe(0);
  });

  test("a record whose own text spells the class name is not a record", () => {
    // Why this is parsed rather than scanned: the wrapper writes its class in two
    // attribute orders already, and record data is a string a person typed.
    const hostile = renderItemWrapper(
      '<p>class="capability-item"</p>',
      { id: "a" },
      {
        templateId: "record-tasks-a",
      },
    );
    expect(countRenderedItems(hostile)).toBe(1);
  });
});

describe("the sidecar the server writes and the shell reads", () => {
  test("the shell and the platform agree on the marker", () => {
    expect(shellCount.COLLECTION_COUNT_SIDECAR_PREFIX).toBe(COLLECTION_COUNT_SIDECAR_PREFIX);
    expect(shellCount.COLLECTION_COUNT_SIDECAR_SUFFIX).toBe(COLLECTION_COUNT_SIDECAR_SUFFIX);
    expect(shellCount.COLLECTION_COUNT_LABEL_ATTR).toBe(COLLECTION_COUNT_LABEL_ATTR);
  });

  test("a sentence round-trips through the sidecar", () => {
    const body = `${renderCollectionCountSidecar("3 tasks")}<article>one</article>`;
    expect(splitCollectionCount(body)).toEqual({
      sentence: "3 tasks",
      records: "<article>one</article>",
    });
  });

  test("an empty sentence is a sidecar, not the absence of one — it clears the label", () => {
    expect(splitCollectionCount(renderCollectionCountSidecar(""))).toEqual({
      sentence: "",
      records: "",
    });
  });

  test("it is a comment, so a records region holding only it still matches :empty", () => {
    const sidecar = renderCollectionCountSidecar("");
    expect(sidecar.startsWith("<!--")).toBe(true);
    expect(sidecar.endsWith("-->")).toBe(true);
  });

  test("no noun can close the comment early", () => {
    // `-->` and a bare `>` are the only ways out of a comment, and the payload is
    // encoded so it can hold neither — a hostile noun ends up as text in the label,
    // never as markup in the region.
    const hostile = '--> <img src=x onerror=alert(1)> "quoted" & <b>-';
    const body = renderCollectionCountSidecar(hostile);
    expect(body.slice(COLLECTION_COUNT_SIDECAR_PREFIX.length, -3)).not.toContain("-");
    expect(body.slice(COLLECTION_COUNT_SIDECAR_PREFIX.length, -3)).not.toContain(">");
    expect(splitCollectionCount(body)).toEqual({ sentence: hostile, records: "" });
  });

  test("a response with no sidecar leaves the label exactly as it was", () => {
    expect(splitCollectionCount("<article>one</article>")).toEqual({
      sentence: undefined,
      records: "<article>one</article>",
    });
  });

  test("an unterminated or undecodable sidecar never states a number", () => {
    // An unterminated comment swallows whatever follows it, so there are no records in
    // that answer to render — and the label says nothing rather than keeping a number
    // this answer did not confirm.
    expect(splitCollectionCount(`${COLLECTION_COUNT_SIDECAR_PREFIX}3%20tasks<article>a`)).toEqual({
      sentence: "",
      records: "",
    });
    expect(splitCollectionCount(`${COLLECTION_COUNT_SIDECAR_PREFIX}%E0%A4%A-->`).sentence).toBe("");
  });
});

describe("the label the chrome carries", () => {
  test("is empty in the chrome — the count is never the container's own stale copy", () => {
    const label = renderCollectionCountLabel(SAMPLE);
    expect(label).toBe(
      `<p class="capability-count caps" id="tasks-count" ${COLLECTION_COUNT_LABEL_ATTR}></p>`,
    );
    expect(capabilityCountLabelId("tasks")).toBe("tasks-count");
  });
});

describe("the transport every collection's first load goes through", () => {
  installDomGlobals();

  /** What htmx reports for the region's own one-shot read. */
  const READ_REQUEST = { verb: "get", path: "/capability/tasks/read" };

  function collection() {
    const root = parseHtml(
      renderCollection({ capability: SAMPLE, loadThroughRead: true }),
      new Doc(),
    );
    const region = root.querySelector('[data-content-region="records"]');
    const label = root.querySelector(`[${COLLECTION_COUNT_LABEL_ATTR}]`);
    if (!region || !label) throw new Error("the rendered collection is missing its own chrome");
    return { region, label };
  }

  test("takes the count off the answer and hands htmx the records alone", () => {
    const { region, label } = collection();
    const detail = {
      serverResponse: `${renderCollectionCountSidecar("3 tasks")}<article>a</article>`,
      target: region,
      shouldSwap: true,
      requestConfig: READ_REQUEST,
    };

    expect(readCollectionCountFromSwap(detail, region)).toBe(true);
    expect(detail.serverResponse).toBe("<article>a</article>");
    expect(label.textContent).toBe("3 tasks");
  });

  test("an emptied collection clears the label it had", () => {
    const { region, label } = collection();
    readCollectionCountFromSwap(
      {
        serverResponse: renderCollectionCountSidecar("3 tasks"),
        target: region,
        requestConfig: READ_REQUEST,
      },
      region,
    );
    readCollectionCountFromSwap(
      {
        serverResponse: renderCollectionCountSidecar(""),
        target: region,
        requestConfig: READ_REQUEST,
      },
      region,
    );
    expect(label.textContent).toBe("");
  });

  test("a Handler cannot forge a count on an answer aimed anywhere but the records", () => {
    // A mutation's answer carries no platform sidecar, so position zero belongs to the
    // generated Handler — and the fragment enforcer passes a comment straight through.
    const { region, label } = collection();
    const forged = `${renderCollectionCountSidecar("9,999 tasks — sign in again")}<p>ok</p>`;
    const form = region.closest(".capability-collection")?.querySelector("form");
    if (!form) throw new Error("the rendered collection is missing its search form");
    const detail = { serverResponse: forged, target: form, shouldSwap: true };

    expect(readCollectionCountFromSwap(detail, form)).toBe(false);
    expect(detail.serverResponse).toBe(forged);
    expect(label.textContent).toBe("");
  });

  test("nor by aiming its own create form at the records region", () => {
    // Aiming there is the Handler's to choose: it composes its own create form, and
    // `hx-target="#tasks-records"` in generated markup is not executable, so nothing
    // upstream removes it. The request is what it cannot choose — a create is a POST.
    const { region, label } = collection();
    const forged = `${renderCollectionCountSidecar("9,999 tasks — sign in again")}<p>ok</p>`;
    const detail = {
      serverResponse: forged,
      target: region,
      shouldSwap: true,
      requestConfig: { verb: "post", path: "/capability/tasks/create" },
    };

    expect(readCollectionCountFromSwap(detail, region)).toBe(false);
    expect(detail.serverResponse).toBe(forged);
    expect(label.textContent).toBe("");
  });

  test("nor by answering for a capability whose region this is not", () => {
    const { region, label } = collection();
    const detail = {
      serverResponse: renderCollectionCountSidecar("9,999 tasks"),
      target: region,
      shouldSwap: true,
      requestConfig: { verb: "get", path: "/capability/other/read" },
    };
    expect(readCollectionCountFromSwap(detail, region)).toBe(false);
    expect(label.textContent).toBe("");
  });

  test("a search answers with its query on the path, and still counts", () => {
    const { region, label } = collection();
    const detail = {
      serverResponse: `${renderCollectionCountSidecar("1 of 3 tasks")}<article>a</article>`,
      target: region,
      shouldSwap: true,
      requestConfig: { verb: "get", path: "/capability/tasks/search?q=milk" },
    };
    expect(readCollectionCountFromSwap(detail, region)).toBe(true);
    expect(label.textContent).toBe("1 of 3 tasks");
  });

  test("a swap another rule has cancelled writes nothing", () => {
    const { region, label } = collection();
    const detail = {
      serverResponse: renderCollectionCountSidecar("3 tasks"),
      target: region,
      shouldSwap: false,
      requestConfig: READ_REQUEST,
    };
    expect(readCollectionCountFromSwap(detail, region)).toBe(false);
    expect(label.textContent).toBe("");
  });
});

describe("CSS parity", () => {
  const css = readFileSync(
    join(import.meta.dir, "../../../public/css/collection.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  /** The declarations of the rule whose selector list is exactly `selector`. */
  function body(selector: string): string {
    const rule = css.split("}").find((block) => block.split("{")[0]?.trim() === selector);
    return rule?.split("{")[1]?.trim() ?? "";
  }

  test("the count label owns its own box rather than the paragraph margin", () => {
    expect(body(".capability-count")).toContain("margin: 0");
  });

  test("an empty count takes no room, so a bare collection states its emptiness once", () => {
    expect(body(".capability-count:empty")).toContain("display: none");
  });
});
