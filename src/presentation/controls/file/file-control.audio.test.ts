// A sound in the product's own path: the edit form the server draws, filled by the drawn control
// (`design/scripts/files/file-field.js`), and the record's render view (`public/records/file-render-view.js`).

import { describe, expect, test } from "bun:test";

import { FILE_FIELD_OPEN, FILE_FIELD_HOOKS as HOOKS } from "#design/files/file-field.js";
import { RECORD_TITLE_ATTRIBUTE } from "#shell/core/shell-dom.js";
import { openRenderView } from "#shell/records/file-render-view.js";
import { FILE_URL_PREFIX } from "../../../platform/files/file-url.ts";
import { mintFileKey } from "../../../platform/files/store/ledger.ts";
import {
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../registry/fields/file.test-support.ts";
import { renderEditForm } from "../../fields/field-renderer.ts";
import { renderableFromSpec } from "../../fields/renderable-capability.ts";
import { installDomGlobals } from "../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";
import { drawnFileFields, hooked, travelling } from "./file-field.test-support.ts";

installDomGlobals();
const mountFileFields = drawnFileFields();

const MEMO = {
  url: `${FILE_URL_PREFIX}${mintFileKey()}`,
  name: "Recording 14.m4a",
  kind: "audio",
  mime: "audio/mp4",
  size: 412_880,
};

/** An edit of a memo whose file field takes sounds, drawn by the control inside its record. */
function memoInRecord() {
  const spec = photoSpec([CAPTION_FIELD, { ...PHOTO_FIELD, accepts: ["audio"] }]);
  const capability = { ...renderableFromSpec(spec), incarnationId: "inc-7" };
  const doc = new Doc();
  const surface = doc.createElement("div");
  surface.setAttribute(RECORD_TITLE_ATTRIBUTE, "The bench idea");
  parseHtml(renderEditForm(capability, { id: "r1", caption: "Bench", photo: MEMO }), surface);
  doc.body.append(surface);
  mountFileFields(doc, travelling);
  const host = surface.querySelector(hooked(HOOKS.field)) as El;
  return { doc, surface, host };
}

describe("a held sound in the edit form", () => {
  test("is a row that plays with its own toggle, and an Open to its full player", () => {
    const { host } = memoInRecord();
    expect(host.getAttribute(HOOKS.kind)).toBe("audio");
    expect(host.querySelector(".file__row")).not.toBeNull();
    expect(host.querySelector("audio")?.getAttribute("src")).toBe(MEMO.url);
    expect(host.querySelector("[data-file-play]")).not.toBeNull();
    expect(host.querySelector("img, video")).toBeNull();
    expect(host.querySelector("[data-file-open]")).not.toBeNull();
  });

  test("opens in the render view as a player that seeks, under a way back to the record", () => {
    const { doc, surface, host } = memoInRecord();
    const opened: unknown[] = [];
    doc.addEventListener(FILE_FIELD_OPEN, (event) => opened.push(event.detail));
    doc.fire("click", host.querySelector("[data-file-open]") as El);
    expect(opened).toEqual([expect.objectContaining({ kind: "audio", field: host })]);

    const view = openRenderView(opened[0] as never) as unknown as El;
    expect(view).not.toBeNull();
    expect(surface.hasAttribute("data-file-viewing")).toBe(true);
    expect(view.querySelector("audio")?.getAttribute("src")).toBe(MEMO.url);
    expect(view.querySelector("[data-file-player-seek]")).not.toBeNull();
    expect(view.querySelector("[data-file-view-back]")?.textContent).toBe("The bench idea");
  });
});
