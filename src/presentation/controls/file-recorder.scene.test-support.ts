// A form holding one file field, mounted with the voice recorder over a stand-in microphone, and
// the clicks that walk it into a recording, shared by the recorder's suites.

import { afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountFileFields, type Picked, type Transfer } from "#design/file-field.js";
import { installDomGlobals } from "./choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "./choice-picker.test-support.ts";
import { settle, standInMedia } from "./file-recorder.test-support.ts";

/** The DOM the recorder's scenes run in, for one suite, and the page's `document` put back after. */
export function useRecorderScenes(): void {
  installDomGlobals();
  const had = Reflect.getOwnPropertyDescriptor(globalThis, "document");
  afterAll(() => {
    if (had) Object.defineProperty(globalThis, "document", had);
    else Reflect.deleteProperty(globalThis, "document");
  });
}

export const RECORDED = new Uint8Array(
  readFileSync(resolve(import.meta.dir, "../../platform/files/recordings/firefox-156.webm")),
);

export type Scene = ReturnType<typeof scene>;

/** A form with one field that takes `kind`, mounted over `media`, with its save beside it. */
export function scene(
  media = standInMedia(),
  kind = "audio",
  attributes = "",
  upload?: (picked: Picked) => ReturnType<Transfer>,
) {
  const doc = new Doc();
  parseHtml(
    `<form class="form"><div class="field file" id="memo" data-file-field data-kind="${kind}" ${attributes}>
  <span class="field__label caps" id="memo-label">Recording</span>
  <div data-file-body></div>
  <span class="field__guidance" id="memo-guidance"></span>
</div><button type="submit" data-held-save><span data-held-save-label>Save</span></button></form>`,
    doc,
  );
  const picks: Picked[] = [];
  const transfer: Transfer = (picked) => {
    picks.push(picked);
    return upload ? upload(picked) : { done: new Promise(() => {}), abort: () => {} };
  };
  const holds: { label: string; release: () => void; released: boolean }[] = [];
  const hold = (_host: unknown, label: string, release: () => void) => {
    const entry = { label, release, released: false };
    holds.push(entry);
    return () => {
      entry.released = true;
    };
  };
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  mountFileFields(doc as never, transfer, { recorder: media.env, hold });
  const host = doc.querySelector("#memo") as El;
  const q = (selector: string) => host.querySelector(selector);
  const press = async (selector: string) => {
    const button = q(selector);
    if (!button) throw new Error(`no ${selector} in the ${stateOf()} state`);
    button.focus();
    doc.fire("click", button);
    await settle();
  };
  /** A person's next press comes a moment after the last change, as the recorder asks. */
  const act = (name: string) => {
    media.tick(500);
    return press(`[data-recorder-do="${name}"]`);
  };
  const stateOf = () => q("[data-recorder]")?.getAttribute("data-state") ?? null;
  const said = () => q(".file__live")?.textContent ?? "";
  const save = () => doc.querySelector("[data-held-save-label]")?.textContent;
  const focused = () => {
    const active = doc.activeElement;
    return active.getAttribute("aria-label") ?? active.textContent?.trim();
  };
  const guidance = () => q(".field__guidance")?.textContent ?? "";
  return { doc, host, media, picks, holds, q, press, act, stateOf, said, save, focused, guidance };
}

/** Record, with a second heard. */
export async function recording(s: Scene) {
  await s.press("[data-file-record]");
  s.media.tick(1000);
}

/** A whole recording: the chunks the browser gave, then Stop. */
export async function recorded(s: Scene) {
  await recording(s);
  s.media.recorder?.emit(RECORDED.subarray(0, 20_000));
  s.media.recorder?.emit(RECORDED.subarray(20_000));
  await s.act("stop");
}
