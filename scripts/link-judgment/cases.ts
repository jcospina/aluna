// The eight link-judgment cases: a desk, a request, and what should link. A leaf: the entry
// imports it before any root is moved to scratch, so it may import nothing that opens one.

/** Each scratch desk's spec, copied from the owner's published one except Movies. */
export const DESKS = {
  books: { file: "books.json", version: 2 },
  authors: { file: "authors.json", version: 1 },
  movies: { file: "movies.json", version: 1 },
  readingLog: { file: "reading-log.json", version: 2 },
} as const;

export type DeskName = keyof typeof DESKS;

/** The calls a case can make, in order, each at most once. */
export const STAGES = ["resolver", "spec writer", "link step"] as const;

/** A field of a desk capability that a relation should point at. */
interface ExpectedTarget {
  readonly desk: DeskName;
  readonly field: string;
}

export interface EightCase {
  readonly number: number;
  readonly desk: readonly DeskName[];
  readonly request: string;
  /** What should link, in the case's own words. */
  readonly expected: string;
  /** Exactly what a hit links; null where either answer is right. */
  readonly targets: readonly ExpectedTarget[] | null;
}

export const EIGHT_CASES: readonly EightCase[] = [
  {
    number: 1,
    desk: ["books"],
    request: "Track how many copies of each book I own",
    expected: "book → Books · title",
    targets: [{ desk: "books", field: "title" }],
  },
  {
    number: 2,
    desk: ["books"],
    request: "Track the movies I watch",
    expected: "none",
    targets: [],
  },
  {
    number: 3,
    desk: ["books"],
    request: "Keep the articles I read",
    expected: "none",
    targets: [],
  },
  {
    number: 4,
    desk: ["books"],
    request: "Who borrowed which book, and when",
    expected: "book → Books · title",
    targets: [{ desk: "books", field: "title" }],
  },
  {
    number: 5,
    desk: ["authors"],
    request: "Track my books",
    expected: "author → Authors · name",
    targets: [{ desk: "authors", field: "name" }],
  },
  {
    number: 6,
    desk: ["books", "movies"],
    request: "Which films were adapted from which books",
    expected: "one to each",
    targets: [
      { desk: "books", field: "title" },
      { desk: "movies", field: "title" },
    ],
  },
  {
    number: 7,
    desk: ["books"],
    request: "Books I want to buy",
    expected: "either; measures the lean",
    targets: null,
  },
  {
    number: 8,
    desk: ["readingLog"],
    request: "Keep a list of the books I want to read",
    expected: "either; the owner's real data",
    targets: null,
  },
];
