// The count sidecar at the edges of the swap it rides: the real `public/collection-count.js`,
// asked directly and started on a document, over the collection the server renders.

import { describe, expect, test } from "bun:test";

import {
  applyCollectionCount,
  COLLECTION_COUNT_LABEL_ATTR,
  readCollectionCountFromSwap,
  splitCollectionCount,
} from "#shell/collection-count.js";
import { capabilityActionUrl } from "#shell/routes.js";
import { installDomGlobals } from "../controls/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../controls/choice-picker.test-support.ts";
import { startedOn } from "../controls/started-module.test-support.ts";
import { renderCollectionCountSidecar } from "./collection-count.ts";
import { renderCollection } from "./list-container.ts";
import { CAPABILITY } from "./record-view.test-support.ts";

installDomGlobals();

const READ = { verb: "get", path: capabilityActionUrl(CAPABILITY.id, "read") };
const counted = (sentence: string) =>
  `${renderCollectionCountSidecar(sentence)}<article>a</article>`;

function collection() {
  const doc = new Doc();
  parseHtml(renderCollection({ capability: CAPABILITY, loadThroughRead: true }), doc);
  return {
    doc,
    region: doc.querySelector('[data-content-region="records"]') as El,
    label: doc.querySelector(`[${COLLECTION_COUNT_LABEL_ATTR}]`) as El,
  };
}

describe("what a swap's count may be read from", () => {
  test("only a GET: a POST to the read route is a Handler's, whatever it claims", () => {
    const { region, label } = collection();
    const detail = {
      serverResponse: counted("9 notes"),
      target: region,
      requestConfig: { ...READ, verb: "post" },
    };
    expect(readCollectionCountFromSwap(detail, region)).toBe(false);
    expect([detail.serverResponse, label.textContent]).toEqual([counted("9 notes"), ""]);
  });

  test("a request that says no verb, or nothing at all about itself, is read from nowhere", () => {
    const { region } = collection();
    for (const requestConfig of [{ path: READ.path }, undefined]) {
      expect(
        readCollectionCountFromSwap(
          { serverResponse: counted("9"), target: region, requestConfig },
          region,
        ),
      ).toBe(false);
    }
    expect(readCollectionCountFromSwap(undefined, region)).toBe(false);
  });

  test("a region marked records but not named as one, or named but not marked, is not the records", () => {
    const doc = new Doc();
    parseHtml(
      `<section class="capability-collection"><p ${COLLECTION_COUNT_LABEL_ATTR}></p>` +
        `<div id="elsewhere" data-content-region="records"></div><div id="${CAPABILITY.id}-records"></div></section>`,
      doc,
    );
    const [marked, named] = [
      doc.getElementById("elsewhere"),
      doc.getElementById(`${CAPABILITY.id}-records`),
    ] as El[];
    for (const target of [marked, named]) {
      expect(
        readCollectionCountFromSwap(
          { serverResponse: counted("9"), target, requestConfig: READ },
          target,
        ),
      ).toBe(false);
    }
    expect(
      readCollectionCountFromSwap({ serverResponse: counted("9"), requestConfig: READ }, undefined),
    ).toBe(false);
  });

  test("an answer with no sidecar is handed on as it came, and says it took nothing", () => {
    const { region, label } = collection();
    label.textContent = "3 notes";
    const detail = { serverResponse: "<article>a</article>", target: region, requestConfig: READ };
    expect(readCollectionCountFromSwap(detail, region)).toBe(false);
    expect([detail.serverResponse, label.textContent]).toEqual(["<article>a</article>", "3 notes"]);
  });
});

describe("writing the count", () => {
  test("no sentence leaves the label as it was", () => {
    const { region, label } = collection();
    label.textContent = "3 notes";
    applyCollectionCount(region as never, undefined);
    expect(label.textContent).toBe("3 notes");
  });

  test("off a browser there is no label to write, and nothing fails", () => {
    const standing = Reflect.getOwnPropertyDescriptor(globalThis, "HTMLElement");
    Reflect.deleteProperty(globalThis, "HTMLElement");
    try {
      const region = { closest: () => ({ querySelector: () => ({ textContent: "" }) }) };
      expect(() => applyCollectionCount(region as never, "3 notes")).not.toThrow();
    } finally {
      if (standing) Object.defineProperty(globalThis, "HTMLElement", standing);
    }
  });

  test("an answer that is not text has no sidecar", () => {
    const split = splitCollectionCount(undefined as never);
    expect([split.sentence, split.records]).toEqual([undefined, undefined as never]);
  });
});

describe("the module on the page", () => {
  test("started on a document, it takes the count off every records read htmx is about to swap", async () => {
    const { doc, region, label } = collection();
    await startedOn("collection-count.js", doc);
    const detail = { serverResponse: counted("3 notes"), target: region, requestConfig: READ };
    doc.fire("htmx:beforeSwap", region, { detail });
    expect([detail.serverResponse, label.textContent]).toEqual(["<article>a</article>", "3 notes"]);
  });
});
