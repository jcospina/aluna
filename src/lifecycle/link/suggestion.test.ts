import { describe, expect, test } from "bun:test";

import { SEVENTH_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import type { CapabilityRow } from "../../registry/index.ts";
import {
  AUTHORS,
  BOOKS,
  deskRow,
  MEMOS,
  READING_LOG,
  textField,
} from "../../server/routes/lifecycle/link.test-support.ts";
import { type LinkTarget, linkTargets } from "./rules.ts";
import { suggestedTarget } from "./suggestion.ts";

/** A capability with a field of its own called author, to stand against Authors' record noun. */
const LOANS = deskRow({
  id: "loans",
  label: "Loans",
  noun: "loan",
  plural: "loans",
  incarnation: SEVENTH_INCARNATION_ID,
  fields: [textField("borrower", "Borrower"), textField("author", "Author", { max_length: 100 })],
});

const catalog: readonly CapabilityRow[] = [
  deskRow(AUTHORS),
  LOANS,
  deskRow(BOOKS),
  deskRow(READING_LOG),
  deskRow(MEMOS),
];

function suggestionFor(capability: string, field: string): string | undefined {
  const row = catalog.find((candidate) => candidate.id === capability) as CapabilityRow;
  const clicked = row.schema.fields.find((candidate) => candidate.name === field);
  if (!clicked) throw new Error(`${capability} has no ${field}`);
  const suggested: LinkTarget | undefined = suggestedTarget(
    clicked,
    linkTargets({ row, field }, catalog),
  );
  return suggested && `${suggested.row.id}.${suggested.field}`;
}

describe("Aluna's suggestion", () => {
  test("`author` suggests Authors and its first single-line text field", () => {
    expect(suggestionFor("books", "author")).toBe("authors.name");
  });

  test("a record noun outweighs a field merely called the same, wherever it is listed", () => {
    const books = deskRow(BOOKS);
    const clicked = books.schema.fields.find((field) => field.name === "author");
    if (!clicked) throw new Error("Books has no author");
    const targets = linkTargets({ row: books, field: "author" }, [LOANS, deskRow(AUTHORS)]);
    expect(targets.map((target) => `${target.row.id}.${target.field}`)[0]).toBe("loans.author");
    const suggested = suggestedTarget(clicked, targets);
    expect(suggested && `${suggested.row.id}.${suggested.field}`).toBe("authors.name");
  });

  test("a field's own name or label is matched when no record noun is", () => {
    expect(suggestionFor("reading_log", "title")).toBe("books.title");
  });

  test("names split where they break, and fold case and accents as search does", () => {
    const row = deskRow({
      ...MEMOS,
      fields: [textField("autor_principal", "Áuthor name")],
    });
    const targets = linkTargets({ row, field: "autor_principal" }, catalog);
    const clicked = row.schema.fields[0];
    if (!clicked) throw new Error("no field");
    const suggested = suggestedTarget(clicked, targets);
    expect(suggested && `${suggested.row.id}.${suggested.field}`).toBe("authors.name");
  });

  test("a field called by one word of the clicked label is not called the same", () => {
    const plants = deskRow({
      ...MEMOS,
      id: "houseplants",
      fields: [textField("plant_name", "Plant name", { max_length: 120 })],
    });
    const targets = linkTargets({ row: plants, field: "plant_name" }, catalog);
    expect(targets.map((target) => `${target.row.id}.${target.field}`)).toContain("authors.name");
    const clicked = plants.schema.fields[0];
    if (!clicked) throw new Error("no field");
    expect(suggestedTarget(clicked, targets)).toBeUndefined();
  });

  test("nothing alike, nothing suggested: the list keeps its order", () => {
    expect(suggestionFor("memos", "subject")).toBeUndefined();
  });
});
