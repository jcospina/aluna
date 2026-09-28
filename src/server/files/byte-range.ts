// The one Range a file answers (Module 7 PLAN decision 25; RFC 9110 §14). Bun 1.3.12 answers every
// Range on a `Bun.file` body with the whole file, so `/files/:key` reads the header itself. One
// byte range is served; a list of them is served whole, as a server may, and so is a header this
// grammar can't read. `If-Range` holds a range to the strong validator the route sends. A span is
// at most {@link MAX_SPAN_BYTES}, which a player asks past, since the route reads it whole.

import type { ByteSpan } from "../../platform/files/object-store.ts";

/** What a `Range` asks of a file: all of it, one span, or a span the file doesn't hold. */
export type RangeAnswer =
  | { readonly kind: "whole" }
  | { readonly kind: "span"; readonly span: ByteSpan }
  | { readonly kind: "unsatisfiable" };

const WHOLE: RangeAnswer = { kind: "whole" };

/** The most one span holds: enough for a player's next few seconds, and cheap to hold in memory. */
export const MAX_SPAN_BYTES = 4 * 1024 * 1024;

function span(start: number, end: number): RangeAnswer {
  return { kind: "span", span: { start, length: Math.min(end - start + 1, MAX_SPAN_BYTES) } };
}

/** A suffix asks for the file's end, where a player looks for what it needs: a cap keeps it. */
function suffixSpan(start: number, end: number): RangeAnswer {
  return span(Math.max(start, end + 1 - MAX_SPAN_BYTES), end);
}

/** `first-last`, `first-` or `-suffix`, as digits only. */
const RANGE_SPEC = /^(\d*)-(\d*)$/;

/** The `Content-Range` of `span` in a file of `size` bytes, its end inclusive, unlike a span's. */
export function contentRange(span: ByteSpan, size: number): string {
  return `bytes ${span.start}-${span.start + span.length - 1}/${size}`;
}

/** The `Content-Range` a 416 carries: the file's size, and no span. */
export function unsatisfiedRange(size: number): string {
  return `bytes */${size}`;
}

/** The strong validator of a file: its key never names other bytes. */
export function strongEtag(key: string): string {
  return `"${key}"`;
}

function answerOne(spec: string, size: number): RangeAnswer {
  const parts = RANGE_SPEC.exec(spec);
  if (!parts) return WHOLE;
  const [, first = "", last = ""] = parts;
  if (first === "") {
    if (last === "") return WHOLE;
    const suffix = Number(last);
    if (suffix === 0) return { kind: "unsatisfiable" };
    return suffixSpan(Math.max(0, size - suffix), size - 1);
  }
  const start = Number(first);
  const end = last === "" ? Number.POSITIVE_INFINITY : Number(last);
  if (end < start) return WHOLE;
  if (start >= size) return { kind: "unsatisfiable" };
  return span(start, Math.min(end, size - 1));
}

/**
 * What a request's `Range` and `If-Range` ask of a file of `size` bytes whose strong validator is
 * `etag`. An `If-Range` that isn't that validator, a date among them, asks for the whole file.
 */
export function answerRange(
  range: string | undefined,
  ifRange: string | undefined,
  size: number,
  etag: string,
): RangeAnswer {
  if (range === undefined || size === 0) return WHOLE;
  if (ifRange !== undefined && ifRange.trim() !== etag) return WHOLE;
  const equals = range.indexOf("=");
  if (equals < 0 || range.slice(0, equals).trim().toLowerCase() !== "bytes") return WHOLE;
  const specs = range
    .slice(equals + 1)
    .split(",")
    .map((spec) => spec.trim())
    .filter((spec) => spec !== "");
  const [only] = specs;
  return specs.length === 1 && only !== undefined ? answerOne(only, size) : WHOLE;
}
