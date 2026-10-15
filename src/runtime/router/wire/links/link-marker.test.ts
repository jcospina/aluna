// The pick a linked field posts beside its text (ADR-0011): one reserved marker per
// submitted field, parsed and taken out of the input before generated code runs. Whether its field
// holds a relation and its id a record is the router's to judge, so neither is judged here.

import { describe, expect, test } from "bun:test";
import { linkFieldValue } from "#shell/core/shell-dom.js";
import { notesSpec } from "../../../../registry/spec/spec.test-support.ts";
import {
  ALUNA_LINK_MARKER,
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  parseCapabilityRequest,
  type WireProtocolAction,
  WireProtocolError,
} from "../wire-protocol.ts";

const SPEC = notesSpec();

function post(entries: readonly [string, string][], method = "POST"): Request {
  const body = new URLSearchParams([...entries]);
  if (method === "GET") return new Request(`http://aluna.test/?${body}`);
  return new Request("http://aluna.test/", {
    method,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

/** A save's entries: the text, its presence, Pinned's presence, and each marker in `markers`. */
function save(markers: readonly string[], text = "Brandon Sanderson"): [string, string][] {
  return [
    ["text", text],
    [ALUNA_PRESENT_MARKER, "text"],
    [ALUNA_PRESENT_MARKER, "pinned"],
    ...markers.map((marker): [string, string] => [ALUNA_LINK_MARKER, marker]),
  ];
}

const parse = (entries: readonly [string, string][], action: WireProtocolAction = "create") =>
  parseCapabilityRequest(post(entries), action, SPEC);

describe("a save's pick", () => {
  test("is parsed by field and taken out of the input", async () => {
    const parsed = await parse(save([linkFieldValue("text", "author-2")]));
    expect(parsed.picks).toEqual(new Map([["text", "author-2"]]));
    expect(parsed.input.values).toEqual({ text: "Brandon Sanderson" });
    expect(Object.keys(parsed.input.values)).not.toContain(ALUNA_LINK_MARKER);
  });

  test("keeps an id with a colon in it whole, since only the first one ends the field", async () => {
    const parsed = await parse(save([linkFieldValue("text", "made:up")]));
    expect(parsed.picks).toEqual(new Map([["text", "made:up"]]));
  });

  test("is carried by an edit too", async () => {
    const entries = [
      ...save([linkFieldValue("text", "author-2")]),
      [ALUNA_RECORD_ID_MARKER, "n-1"],
    ];
    const parsed = await parse(entries as [string, string][], "update");
    expect(parsed.picks).toEqual(new Map([["text", "author-2"]]));
  });

  test("is absent from a save that posts none", async () => {
    expect((await parse(save([]))).picks).toBeUndefined();
  });
});

describe("a malformed pick is a protocol error", () => {
  const cases: [string, readonly string[]][] = [
    ["a field the capability does not have", [linkFieldValue("author", "author-2")]],
    ["no field at all", ["author-2"]],
    ["a blank id", [linkFieldValue("text", " ")]],
    ["the same field twice", [linkFieldValue("text", "a"), linkFieldValue("text", "b")]],
  ];
  for (const [what, markers] of cases) {
    test(`naming ${what}`, async () => {
      await expect(parse(save(markers))).rejects.toBeInstanceOf(WireProtocolError);
    });
  }

  test("for a field holding no text, which picks nothing", async () => {
    for (const text of ["", "   "]) {
      const entries = save([linkFieldValue("text", "author-2")], text);
      await expect(parse(entries)).rejects.toBeInstanceOf(WireProtocolError);
    }
  });

  test("naming a field the form did not submit", async () => {
    const entries: [string, string][] = [
      ["text", "Brandon Sanderson"],
      [ALUNA_PRESENT_MARKER, "text"],
      [ALUNA_RECORD_ID_MARKER, "n-1"],
      [ALUNA_LINK_MARKER, linkFieldValue("pinned", "author-2")],
    ];
    await expect(parse(entries, "update")).rejects.toBeInstanceOf(WireProtocolError);
  });

  test("on a read, a search or a delete", async () => {
    const marker: [string, string] = [ALUNA_LINK_MARKER, linkFieldValue("text", "author-2")];
    const requests: [WireProtocolAction, Request][] = [
      ["read", post([marker], "GET")],
      ["search", post([marker], "GET")],
      ["delete", post([[ALUNA_RECORD_ID_MARKER, "n-1"], marker])],
    ];
    for (const [action, request] of requests) {
      await expect(parseCapabilityRequest(request, action, SPEC)).rejects.toBeInstanceOf(
        WireProtocolError,
      );
    }
  });
});
