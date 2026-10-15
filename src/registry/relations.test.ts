// Which stored relations hold (ADR-0011): both ends active single-line text fields, the target in
// its capability as it is now, and its text no longer than the source takes. The form draws a
// dropdown and the pick route reads records only for a relation that holds; any other is dormant.

import { describe, expect, test } from "bun:test";

import { holdingRelations, type RelatedCapability, type Relation } from "./relations.ts";
import type { SpecField } from "./spec/spec.ts";

const text = (name: string, extra: Partial<SpecField> = {}): SpecField => ({
  name,
  label: name,
  type: "string",
  required: false,
  lifecycle: "active",
  ...extra,
});

function capability(
  id: string,
  fields: readonly SpecField[],
  extra: { longText?: string[]; relations?: Relation[] } = {},
): RelatedCapability {
  return {
    id,
    incarnation_id: `${id}-lifetime`,
    schema: { fields },
    ui_intent: { form: { long_text: extra.longText ?? [] } },
    relations: extra.relations ?? [],
  };
}

const TO_NAME: Relation = {
  field: "author",
  to: { capability: "authors", incarnation: "authors-lifetime", field: "name" },
};

const books = (author: Partial<SpecField> = {}, relations: Relation[] = [TO_NAME]) =>
  capability("books", [text("title"), text("author", author)], { relations });
const authors = (name: Partial<SpecField> = {}, longText: string[] = []) =>
  capability("authors", [text("name", name)], { longText });

describe("a relation holds while both ends do", () => {
  test("both ends active single-line text, the target fitting the source", () => {
    expect(holdingRelations(books(), [books(), authors()])).toEqual([TO_NAME]);
    const limited = books({ max_length: 120 });
    expect(holdingRelations(limited, [limited, authors({ max_length: 120 })])).toEqual([TO_NAME]);
  });
});

describe("a relation is dormant once either end stops being one it could hold", () => {
  test("the source field hidden, or drawn as long text", () => {
    const hidden = books({ lifecycle: "inactive" });
    expect(holdingRelations(hidden, [hidden, authors()])).toEqual([]);
    const long = capability("books", [text("author")], {
      longText: ["author"],
      relations: [TO_NAME],
    });
    expect(holdingRelations(long, [long, authors()])).toEqual([]);
  });

  test("the target field hidden, drawn as long text, or not there at all", () => {
    for (const target of [
      authors({ lifecycle: "inactive" }),
      authors({}, ["name"]),
      capability("authors", [text("pen_name")]),
    ]) {
      expect(holdingRelations(books(), [books(), target])).toEqual([]);
    }
  });

  test("the target capability gone from the desk, or the lifetime it pinned over", () => {
    expect(holdingRelations(books(), [books()])).toEqual([]);
    const rebuilt = { ...authors(), incarnation_id: "authors-next-lifetime" };
    expect(holdingRelations(books(), [books(), rebuilt])).toEqual([]);
  });

  test("the target able to hold more than the source takes", () => {
    const limited = books({ max_length: 80 });
    for (const target of [authors({ max_length: 120 }), authors()]) {
      expect(holdingRelations(limited, [limited, target])).toEqual([]);
    }
  });
});
