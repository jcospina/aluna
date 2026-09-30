// What the record's render view names its way back by (`design/controls.html`, "Inside the open
// record"): the record's title, or New and its noun while it is being created.

import { describe, expect, test } from "bun:test";
import { RECORD_TITLE_ATTRIBUTE } from "#shell/core/shell-dom.js";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import type { RenderableCapability } from "../../fields/field-renderer.ts";
import { renderCollection } from "../collection/list-container.ts";
import { CAPABILITY, RECORD, TEMPLATE_ID } from "./record-view.test-support.ts";
import { recordTitle, renderRecordView } from "./record-view.ts";

const withFields = (fields: RenderableCapability["schema"]["fields"]): RenderableCapability => ({
  ...CAPABILITY,
  schema: { fields },
});

const text = (name: string, lifecycle: "active" | "inactive" = "active") =>
  ({ name, label: name, type: "string", required: false, lifecycle }) as const;

describe("a record's title", () => {
  test("is the first line of its first filled text field, as it was saved", () => {
    const capability = withFields([
      { name: "on", label: "On", type: "date", required: false, lifecycle: "active" },
      text("hidden", "inactive"),
      text("blank"),
      text("caption"),
      text("notes"),
    ]);
    const record = {
      on: "2026-09-12",
      hidden: "Old",
      blank: "  ",
      caption: "\n  Her first steps\nin the hall",
      notes: "x",
    };
    expect(recordTitle(capability, record)).toBe("Her first steps");
  });

  test("is cut to forty characters a reader sees, never inside one", () => {
    const long = `${"a".repeat(38)}👩‍👩‍👧 and on`;
    const title = recordTitle(withFields([text("caption")]), { caption: long });
    expect(title).toBe(`${"a".repeat(38)}👩‍👩‍👧…`);
    const fits = "b".repeat(40);
    expect(recordTitle(withFields([text("caption")]), { caption: fits })).toBe(fits);
  });

  test("is the record's noun when it has no filled text, never the name the collection's Back uses", () => {
    const title = recordTitle(withFields([text("caption")]), { caption: null });
    expect(title).toBe("Note");
    expect(title).not.toBe(CAPABILITY.label);
  });
});

describe("the title a surface carries", () => {
  const title = (root: El, selector: string) =>
    root.querySelector(selector)?.getAttribute(RECORD_TITLE_ATTRIBUTE);

  test("is the record's on a record's view, and New and its noun on the create panel", () => {
    const view = parseHtml(renderRecordView(CAPABILITY, RECORD, TEMPLATE_ID), new Doc());
    expect(title(view, "[data-record-view]")).toBe(RECORD.text);
    const collection = parseHtml(renderCollection({ capability: CAPABILITY }), new Doc());
    expect(title(collection, ".capability-collection__create")).toBe(`New ${CAPABILITY.noun}`);
  });

  test("is words, never markup", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const markup = renderRecordView(CAPABILITY, { ...RECORD, text: hostile }, TEMPLATE_ID);
    expect(markup).not.toContain("<img");
    expect(title(parseHtml(markup, new Doc()), "[data-record-view]")).toBe(hostile);
  });
});
