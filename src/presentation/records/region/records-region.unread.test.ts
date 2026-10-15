// A capability is empty only once a read says so. The window draws its data-free surface before the
// records region has asked for anything, so until a read answers, the region must not say its
// capability is empty. Run against the window's own markup, the shipped `public/css/collection.css`
// and the real `public/records/records-region-status.js`.

import { describe, expect, test } from "bun:test";
import { recordsRegionStatusMessage } from "#shell/records/records-region-status.js";
import { notesRow } from "../../../runtime/router/dispatch/router.test-support.ts";
import { READ_UNAVAILABLE_FRAGMENT } from "../../../runtime/router/wire/failure-responses.ts";
import { renderCachedCapabilitySurfaceIn } from "../../../server/http/cached-view.ts";
import { installDomGlobals } from "../../controls/double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import { startedOn } from "../../controls/double/started-module.test-support.ts";
import { capabilityRecordsRegionId } from "../../fields/field-renderer.ts";
import { rules } from "../../safety/source.test-support.ts";
import { cascadedDisplay } from "../../safety/stylesheet-cascade.test-support.ts";
import { renderItemWrapper } from "../collection/list-container.ts";

installDomGlobals();

const STYLESHEET = rules("public/css/collection.css");
const EMPTY_STATE = "capability-empty";
const READ_FAILED = recordsRegionStatusMessage("error", "refresh");

/** The window as the server first draws it, before htmx has asked the region for anything. */
async function drawnWindow() {
  const row = notesRow();
  const doc = new Doc();
  parseHtml(renderCachedCapabilitySurfaceIn(row, [row]), doc);
  await startedOn("records/records-region-status.js", doc);
  const region = doc.getElementById(capabilityRecordsRegionId(row.id)) as El;
  const emptyState = doc.querySelector(`.${EMPTY_STATE}`) as El;
  const status = doc.querySelector("[data-capability-search-status]") as El;
  return {
    region,
    saysEmpty: () => cascadedDisplay(STYLESHEET, emptyState, EMPTY_STATE) !== "none",
    says: () => status.textContent,
    /** What htmx does with a read's answer: the region's content becomes the answer. */
    answer: (html: string) => {
      region.innerHTML = html;
    },
    fail: (failure: string, from: El = region) => doc.fire(failure, from),
  };
}

describe("a records region its read has not answered", () => {
  test("does not say its capability is empty", async () => {
    const page = await drawnWindow();
    expect(page.saysEmpty()).toBe(false);
    expect(page.says()).toBe("");
  });

  test("whose read fails with nothing to show says the read failed, and still not that it is empty", async () => {
    for (const failure of ["htmx:sendError", "htmx:responseError"]) {
      const page = await drawnWindow();
      page.fail(failure);
      expect([failure, page.says(), page.saysEmpty()]).toEqual([failure, READ_FAILED, false]);
    }
  });

  test("says nothing of a read let go, or of a request that was not the region's own", async () => {
    const page = await drawnWindow();
    page.fail("htmx:sendAbort");
    page.fail("htmx:responseError", page.region.firstElementChild as El);
    expect([page.says(), page.saysEmpty()]).toEqual(["", false]);
  });
});

describe("a records region its read has answered", () => {
  test("says its capability is empty once the read answers with nothing", async () => {
    const page = await drawnWindow();
    page.answer("");
    expect(page.saysEmpty()).toBe(true);
  });

  test("does not, once the read answers with records", async () => {
    const page = await drawnWindow();
    page.answer(renderItemWrapper("<h3>Buy milk</h3>", { id: "note-1", text: "Buy milk" }));
    expect(page.saysEmpty()).toBe(false);
  });

  test("leaves a refusal the read answered with to speak for itself", async () => {
    const page = await drawnWindow();
    page.answer(READ_UNAVAILABLE_FRAGMENT);
    page.fail("htmx:responseError");
    expect([page.says(), page.saysEmpty()]).toEqual(["", false]);
  });
});
