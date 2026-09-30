import { describe, expect, test } from "bun:test";
import {
  answerRange,
  contentRange,
  MAX_SPAN_BYTES,
  type RangeAnswer,
  strongEtag,
  unsatisfiedRange,
} from "./byte-range.ts";

const SIZE = 1000;
const ETAG = strongEtag("a-key");

const asked = (range: string | undefined, ifRange?: string) =>
  answerRange(range, ifRange, SIZE, ETAG);

const span = (start: number, length: number): RangeAnswer => ({
  kind: "span",
  span: { start, length },
});

describe("one range", () => {
  test("from first to last, both inclusive, is the span between them", () => {
    expect(asked("bytes=0-0")).toEqual(span(0, 1));
    expect(asked("bytes=0-499")).toEqual(span(0, 500));
    expect(asked("bytes=500-999")).toEqual(span(500, 500));
    expect(asked("bytes=999-999")).toEqual(span(999, 1));
  });

  test("open-ended, or ending past the file, runs to the last byte", () => {
    expect(asked("bytes=0-")).toEqual(span(0, SIZE));
    expect(asked("bytes=900-")).toEqual(span(900, 100));
    expect(asked("bytes=900-5000")).toEqual(span(900, 100));
    expect(asked(`bytes=0-${"9".repeat(400)}`)).toEqual(span(0, SIZE));
  });

  test("as a suffix is the file's last bytes, or all of it when the suffix is longer", () => {
    expect(asked("bytes=-1")).toEqual(span(999, 1));
    expect(asked("bytes=-100")).toEqual(span(900, 100));
    expect(asked("bytes=-5000")).toEqual(span(0, SIZE));
  });

  test("reads its unit without regard to case, and the space around its parts", () => {
    expect(asked("BYTES=10-19")).toEqual(span(10, 10));
    expect(asked("bytes = 10-19 ")).toEqual(span(10, 10));
    expect(asked("bytes=, 10-19,")).toEqual(span(10, 10));
  });
});

describe("a span longer than the cap", () => {
  const huge = 3 * MAX_SPAN_BYTES;
  const long = (range: string) => answerRange(range, undefined, huge, ETAG);

  test("keeps its start when it names one, and its end when it is a suffix", () => {
    expect(long("bytes=0-")).toEqual(span(0, MAX_SPAN_BYTES));
    expect(long(`bytes=10-${huge}`)).toEqual(span(10, MAX_SPAN_BYTES));
    expect(long(`bytes=-${huge}`)).toEqual(span(huge - MAX_SPAN_BYTES, MAX_SPAN_BYTES));
    expect(long("bytes=-100")).toEqual(span(huge - 100, 100));
  });
});

describe("a range the file doesn't hold", () => {
  test("starting at or past its end, or an empty suffix, is unsatisfiable", () => {
    for (const range of ["bytes=1000-", "bytes=1000-1001", "bytes=5000-6000", "bytes=-0"]) {
      expect(asked(range)).toEqual({ kind: "unsatisfiable" });
    }
    expect(asked(`bytes=${"9".repeat(400)}-`)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("a Range answered with the whole file", () => {
  test("is one this grammar can't read", () => {
    for (const range of [
      "",
      "bytes",
      "bytes=",
      "bytes=-",
      "bytes=a-b",
      "bytes=1.5-2",
      "bytes=+1-2",
      "bytes=0x10-20",
      "bytes=20-10",
      "bytes=1 - 2",
      "items=0-10",
      "0-10",
    ]) {
      expect(asked(range)).toEqual({ kind: "whole" });
    }
  });

  test("is a list of ranges, even when one of them could not be satisfied", () => {
    expect(asked("bytes=0-10, 20-30")).toEqual({ kind: "whole" });
    expect(asked("bytes=0-10,5000-")).toEqual({ kind: "whole" });
  });

  test("is one whose If-Range isn't the file's strong validator", () => {
    expect(asked("bytes=0-9", ETAG)).toEqual(span(0, 10));
    expect(asked("bytes=0-9", ` ${ETAG} `)).toEqual(span(0, 10));
    for (const ifRange of [
      `W/${ETAG}`,
      strongEtag("another-key"),
      "a-key",
      "Mon, 28 Sep 2026 10:00:00 GMT",
      "",
    ]) {
      expect(asked("bytes=0-9", ifRange)).toEqual({ kind: "whole" });
    }
  });

  test("is any request without a Range, and any Range of an empty file", () => {
    expect(asked(undefined)).toEqual({ kind: "whole" });
    expect(asked(undefined, ETAG)).toEqual({ kind: "whole" });
    expect(answerRange("bytes=0-", undefined, 0, ETAG)).toEqual({ kind: "whole" });
  });
});

describe("the headers a range is answered with", () => {
  test("name the span's last byte, where the span names the byte after it", () => {
    expect(contentRange({ start: 0, length: 1 }, SIZE)).toBe("bytes 0-0/1000");
    expect(contentRange({ start: 900, length: 100 }, SIZE)).toBe("bytes 900-999/1000");
    expect(unsatisfiedRange(SIZE)).toBe("bytes */1000");
  });

  test("validate the file by its key, strongly", () => {
    expect(strongEtag("a-key")).toBe('"a-key"');
  });
});
