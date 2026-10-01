// What an edit's file fields say they held when the form was drawn (Module 7 PLAN decision 16), as
// the server draws it, and as `public/controls/file-field.js` moves it once the form's save commits.
// Read back through the wire parser, so the browser's rewrite and the server's reading agree.

import { describe, expect, test } from "bun:test";

import { keepSavedFileFields } from "#shell/controls/file-field.js";
import { FILE_FIELD_ATTRIBUTES as WIRE } from "#shell/core/shell-dom.js";
import { FILE_URL_PREFIX } from "../../../platform/files/file-url.ts";
import { mintFileKey } from "../../../platform/files/store/ledger.ts";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../registry/fields/file.test-support.ts";
import { FILE_CLEAR_VALUE, FILE_REMOVE_PREFIX } from "../../../runtime/data/index.ts";
import {
  ALUNA_DRAWN_MARKER,
  drawnFileValue,
  parseCapabilityRequest,
} from "../../../runtime/router/wire/wire-protocol.ts";
import { renderCreateForm, renderEditForm } from "../../fields/field-renderer.ts";
import { renderableFromSpec } from "../../fields/renderable-capability.ts";
import { installDomGlobals } from "../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";

installDomGlobals();

const spec = () => photoSpec([CAPTION_FIELD, PHOTO_FIELD, ALBUM_FIELD]);
const capability = () => ({ ...renderableFromSpec(spec()), incarnationId: "inc-7" });
const held = (key: string) => ({
  url: `${FILE_URL_PREFIX}${key}`,
  name: `${key}.jpg`,
  kind: "image",
  mime: "image/jpeg",
  size: 9,
});

function drawn(html: string): string[] {
  const doc = new Doc();
  const form = doc.createElement("div");
  parseHtml(html, form);
  return (form.querySelectorAll(`input[name="${ALUNA_DRAWN_MARKER}"]`) as El[]).map(
    (input) => input.getAttribute("value") ?? "",
  );
}

/** What the server reads off the form's inputs as it stands, posted as an edit. */
function readBack(form: El) {
  const body = new URLSearchParams();
  for (const input of form.querySelectorAll("input[name]") as El[]) {
    body.append(input.getAttribute("name") ?? "", (input as unknown as { value: string }).value);
  }
  const request = new Request("http://aluna.test/", { method: "POST", body });
  return parseCapabilityRequest(request, "update", spec());
}

describe("the drawn marker", () => {
  test("an edit draws what each file field holds, a list's in order", () => {
    const [photo, a, b] = [mintFileKey(), mintFileKey(), mintFileKey()];
    const record = { id: "r1", caption: "Dawn", photo: held(photo), album: [held(b), held(a)] };
    expect(drawn(renderEditForm(capability(), record)).sort()).toEqual(
      [drawnFileValue(ALBUM_FIELD.name, [b, a]), drawnFileValue(PHOTO_FIELD.name, [photo])].sort(),
    );
  });

  test("an edit of fields that hold nothing draws them empty, and a create draws none", () => {
    const record = { id: "r1", caption: "Dawn", photo: null, album: [] };
    expect(drawn(renderEditForm(capability(), record)).sort()).toEqual(
      [drawnFileValue(ALBUM_FIELD.name, []), drawnFileValue(PHOTO_FIELD.name, [])].sort(),
    );
    expect(drawn(renderCreateForm(capability()))).toEqual([]);
  });
});

describe("a form whose save committed", () => {
  function savedForm(photoPosted: (old: string) => string) {
    const [old, next, a, b, c] = [
      mintFileKey(),
      mintFileKey(),
      mintFileKey(),
      mintFileKey(),
      mintFileKey(),
    ];
    const doc = new Doc();
    const form = doc.createElement("form");
    const record = { id: "r1", caption: "Dawn", photo: held(old), album: [held(a), held(b)] };
    parseHtml(renderEditForm(capability(), record), form);
    const value = form.querySelector(`[${WIRE.value}]`) as unknown as { value: string };
    value.value = photoPosted(next);
    const holder = form.querySelector(`[${WIRE.keys}]`) as El;
    for (const child of [...holder.children]) child.remove();
    for (const key of [b, c, `${FILE_REMOVE_PREFIX}${a}`]) {
      const input = doc.createElement("input");
      input.setAttribute("name", ALBUM_FIELD.name);
      (input as unknown as { value: string }).value = key;
      holder.append(input);
    }
    keepSavedFileFields(form as never, () => {});
    return { form, next, b, c };
  }

  test("says it was drawn holding what it saved, and removes nothing a second time", async () => {
    const { form, next, b, c } = savedForm((key) => key);
    const parsed = await readBack(form);
    expect(parsed.drawnFiles).toEqual(
      new Map([
        [PHOTO_FIELD.name, [next]],
        [ALBUM_FIELD.name, [b, c]],
      ]),
    );
    expect(parsed.input.values[ALBUM_FIELD.name]).toEqual([b, c]);
    expect(form.querySelector(`[${WIRE.value}]`)?.getAttribute(WIRE.heldKey)).toBe(next);
  });

  test("once cleared, says it holds nothing and posts nothing to clear", async () => {
    const { form } = savedForm(() => FILE_CLEAR_VALUE);
    const parsed = await readBack(form);
    expect(parsed.drawnFiles?.get(PHOTO_FIELD.name)).toEqual([]);
    expect(parsed.input.values[PHOTO_FIELD.name]).toBe("");
    expect(form.querySelector(`[${WIRE.value}]`)?.getAttribute(WIRE.heldKey)).toBe("");
  });
});
