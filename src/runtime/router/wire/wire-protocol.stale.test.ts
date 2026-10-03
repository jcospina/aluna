// A form drawn before an evolution (Module 7 PLAN decision 34): it names a field since hidden, or
// a create leaves out a field added since. Either is a stale form, told so in a sentence, and only
// once the request is otherwise well formed: a malformed one stays a protocol error.

import { describe, expect, test } from "bun:test";
import { mintFileKey } from "../../../platform/files/store/ledger.ts";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  PHOTO_FIELD,
} from "../../../registry/fields/file.test-support.ts";
import type { CapabilitySpec, SpecField } from "../../../registry/index.ts";
import { notesSpec } from "../../../registry/spec/spec.test-support.ts";
import { MissingRequiredFieldsError } from "../../data/index.ts";
import {
  ALUNA_DRAWN_MARKER,
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  asFormChanged,
  FormChangedError,
  parseCapabilityRequest,
  WireProtocolError,
} from "./wire-protocol.ts";

const hide = (field: SpecField): SpecField => ({ ...field, lifecycle: "inactive" });

function specWith(fields: readonly SpecField[]): CapabilitySpec {
  return notesSpec({ schema: { fields: [...fields] } });
}

function post(entries: readonly [string, string][]): Request {
  return new Request("http://localhost/capability/notes/create", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(entries).toString(),
  });
}

const caption: [string, string][] = [
  [ALUNA_PRESENT_MARKER, "caption"],
  ["caption", "Dawn"],
];

function parse(
  action: "create" | "update",
  entries: readonly [string, string][],
  spec: CapabilitySpec,
) {
  const target: [string, string][] = action === "update" ? [[ALUNA_RECORD_ID_MARKER, "r1"]] : [];
  return parseCapabilityRequest(post([...target, ...entries]), action, spec);
}

describe("a form naming a field evolution hid", () => {
  const MOOD: SpecField = {
    name: "mood",
    label: "Mood",
    type: "string",
    required: false,
    lifecycle: "active",
  };

  test("is stale whether the field holds text or files", async () => {
    for (const hidden of [MOOD, PHOTO_FIELD]) {
      const refused = parse(
        "update",
        [...caption, [ALUNA_PRESENT_MARKER, hidden.name]],
        specWith([CAPTION_FIELD, hide(hidden)]),
      );
      await expect(refused).rejects.toBeInstanceOf(FormChangedError);
      await expect(refused).rejects.toMatchObject({ fields: [hidden.name], action: "update" });
    }
  });

  test("is stale when a hidden list of words arrives in any shape a list control posts", async () => {
    const tags: SpecField = { ...MOOD, name: "tags", label: "Tags", type: "string[]" };
    const spec = specWith([CAPTION_FIELD, hide(tags)]);
    const marker: [string, string] = [ALUNA_PRESENT_MARKER, "tags"];
    for (const posted of [
      [["tags", "calm, bright"]],
      [
        ["tags", "calm"],
        ["tags", "bright"],
      ],
      [["tags", ""]],
    ] as [string, string][][]) {
      for (const action of ["create", "update"] as const) {
        await expect(parse(action, [...caption, marker, ...posted], spec)).rejects.toBeInstanceOf(
          FormChangedError,
        );
      }
    }
  });

  test("is stale when only the marker of an empty list of files arrives", async () => {
    const spec = specWith([CAPTION_FIELD, hide(ALBUM_FIELD)]);
    for (const action of ["create", "update"] as const) {
      await expect(
        parse(action, [...caption, [ALUNA_PRESENT_MARKER, "album"]], spec),
      ).rejects.toBeInstanceOf(FormChangedError);
    }
  });

  test("saves once the field is back, and once the form no longer names it", async () => {
    const reactivated = specWith([CAPTION_FIELD, MOOD]);
    const parsed = await parse(
      "update",
      [...caption, [ALUNA_PRESENT_MARKER, "mood"], ["mood", "calm"]],
      reactivated,
    );
    expect(parsed.input.values).toEqual({ caption: "Dawn", mood: "calm" });
    const redrawn = await parse("update", caption, specWith([CAPTION_FIELD, hide(MOOD)]));
    expect(redrawn.input.values).toEqual({ caption: "Dawn" });
  });

  test("stays a protocol error when the request is malformed anyway", async () => {
    const spec = specWith([CAPTION_FIELD, hide(PHOTO_FIELD)]);
    const key = mintFileKey();
    const photo: [string, string][] = [
      [ALUNA_PRESENT_MARKER, "photo"],
      ["photo", key],
    ];
    const malformed: [string, readonly [string, string][]][] = [
      ["no record target", [...caption, ...photo]],
      ["two record targets", [[ALUNA_RECORD_ID_MARKER, "r2"], ...caption, ...photo]],
      ["a colonless drawn marker", [...caption, ...photo, [ALUNA_DRAWN_MARKER, "photo"]]],
      ["a drawn key that is no key", [...caption, ...photo, [ALUNA_DRAWN_MARKER, "photo:nope"]]],
      ["a duplicate marker", [...caption, ...photo, [ALUNA_PRESENT_MARKER, "photo"]]],
      ["an unknown field beside it", [...caption, ...photo, ["surprise", "1"]]],
    ];
    for (const [name, entries] of malformed) {
      const request = post(
        name === "no record target" ? entries : [[ALUNA_RECORD_ID_MARKER, "r1"], ...entries],
      );
      const refused = await parseCapabilityRequest(request, "update", spec).catch((error) => error);
      expect({ name, refused }).toEqual({ name, refused: expect.any(WireProtocolError) });
    }
    const drawnOnCreate = await parse(
      "create",
      [...caption, ...photo, [ALUNA_DRAWN_MARKER, `photo:${key}`]],
      spec,
    ).catch((error) => error);
    expect(drawnOnCreate).toBeInstanceOf(WireProtocolError);
  });
});

describe("a create form drawn before a field was added", () => {
  test("is stale when it leaves the new field out", async () => {
    const MOOD: SpecField = {
      name: "mood",
      label: "Mood",
      type: "string",
      required: false,
      lifecycle: "active",
    };
    const refused = parse("create", caption, specWith([CAPTION_FIELD, MOOD]));
    await expect(refused).rejects.toBeInstanceOf(FormChangedError);
    await expect(refused).rejects.toMatchObject({ fields: ["mood"], action: "create" });
  });

  test("still leaves an optional file field out freely, as a create may", async () => {
    const parsed = await parse("create", caption, specWith([CAPTION_FIELD, PHOTO_FIELD]));
    expect(parsed.input.values).toEqual({ caption: "Dawn" });
  });
});

describe("a save refused for a required field", () => {
  const submitted = (...fields: string[]) => ({ values: {}, submittedFields: new Set(fields) });

  test("is a stale form when any missing field was never drawn", () => {
    const missing = new MissingRequiredFieldsError("notes", ["caption", "photo"], "update");
    expect(asFormChanged(missing, submitted("caption"))).toBeInstanceOf(FormChangedError);
    expect(asFormChanged(missing, submitted())).toBeInstanceOf(FormChangedError);
  });

  test("stays itself when the form drew every missing field", () => {
    const missing = new MissingRequiredFieldsError("notes", ["caption", "photo"], "update");
    expect(asFormChanged(missing, submitted("caption", "photo"))).toBe(missing);
  });
});

describe("a create carrying no markers at all", () => {
  test("came from no form, and stays a protocol error", async () => {
    await expect(
      parseCapabilityRequest(post([["caption", "Dawn"]]), "create", specWith([CAPTION_FIELD])),
    ).rejects.toBeInstanceOf(WireProtocolError);
    await expect(
      parseCapabilityRequest(post([]), "create", specWith([CAPTION_FIELD])),
    ).rejects.toBeInstanceOf(WireProtocolError);
  });

  test("is a whole create when every field is hidden and the form draws no control", async () => {
    const parsed = await parseCapabilityRequest(
      post([]),
      "create",
      specWith([hide(CAPTION_FIELD)]),
    );
    expect(parsed.input.values).toEqual({});
  });
});
