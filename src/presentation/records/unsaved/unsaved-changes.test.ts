// What a record form holds that no save has (`public/records/unsaved-changes.js`), read off a
// parsed create form and edit form as the person starts on them and changes them.

import { afterAll, describe, expect, test } from "bun:test";
import { FILE_FIELD_HOOKS, registerFileControl } from "#design/files/file-field.js";
import {
  hasUnsavedChanges,
  letGoOfChanges,
  startUnsavedChanges,
} from "#shell/records/unsaved-changes.js";
import { installDomGlobals } from "../../controls/double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";

installDomGlobals();
const had = Reflect.getOwnPropertyDescriptor(globalThis, "document");
afterAll(() => {
  if (had) Object.defineProperty(globalThis, "document", had);
  else Reflect.deleteProperty(globalThis, "document");
});

type Field = El & { value: string; checked: boolean };

/** A window holding a record's edit form and a capability's create form, with the reading started. */
function forms() {
  const doc = new Doc();
  parseHtml(
    `<section class="window">` +
      `<form data-record-edit-form><input name="title" value="Dawn">` +
      `<input type="datetime-local" data-edit-datetime-input="taken_at" value="2026-10-01T09:30">` +
      `<div data-list-field-row><input name="tags" value="sea"></div>` +
      `<input type="hidden" data-edit-datetime-value="taken_at" name="taken_at" value="2026-10-01T09:30:12.345Z">` +
      `<div ${FILE_FIELD_HOOKS.field}></div>` +
      `<input type="checkbox" name="framed" value="yes"><input type="file" name="photo-pick">` +
      `<select name="album"><option value="sea" selected>Sea</option><option value="hills">Hills</option></select></form>` +
      `<form data-post-mutation-refresh data-mutation-kind="create"><input name="title"></form>` +
      `<form data-search><input name="q"></form>` +
      `</section>`,
    doc,
  );
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  startUnsavedChanges(doc as never);
  const [edit, create, search] = doc.querySelectorAll("form") as El[];
  const field = (form: El | undefined, name: string) =>
    form?.querySelector(`[name="${name}"]`) as Field;
  const win = doc.querySelector(".window") as El;
  return { doc, win, edit, create, search, field };
}

describe("a record form", () => {
  test("has no unsaved changes until a field it was started with changes", () => {
    const { doc, win, edit, field } = forms();
    const title = field(edit, "title");
    doc.fire("focusin", title);
    expect(hasUnsavedChanges(win as never)).toBe(false);
    const drawn = title.value;
    title.value = "Dusk";
    expect(hasUnsavedChanges(win as never)).toBe(true);
    title.value = drawn;
    expect(hasUnsavedChanges(win as never)).toBe(false);
  });

  test("counts a box ticked and a choice moved, and not a file picked", () => {
    const { doc, win, edit, field } = forms();
    doc.fire("pointerdown", field(edit, "framed"));
    field(edit, "photo-pick").value = "C:\\fakepath\\dusk.jpg";
    expect(hasUnsavedChanges(win as never)).toBe(false);
    field(edit, "framed").checked = true;
    expect(hasUnsavedChanges(win as never)).toBe(true);
    field(edit, "framed").checked = false;
    field(edit, "album").value = "hills";
    expect(hasUnsavedChanges(edit as never)).toBe(true);
  });

  test("is not counted while its save is on the way", () => {
    const { doc, win, create, field } = forms();
    doc.fire("focusin", field(create, "title"));
    field(create, "title").value = "Picnic";
    create?.setAttribute("aria-busy", "true");
    expect(hasUnsavedChanges(win as never)).toBe(false);
  });

  test("starts again once it is put back with reset, as a cancelled or saved create is", async () => {
    const { doc, win, create, field } = forms();
    const title = field(create, "title");
    doc.fire("focusin", title);
    title.value = "Picnic";
    (create as El).reset();
    await Promise.resolve();
    expect(hasUnsavedChanges(win as never)).toBe(false);
    title.value = "Picnic again";
    expect(hasUnsavedChanges(win as never)).toBe(true);
  });

  test("is the only kind of form that counts", () => {
    const { doc, win, search, field } = forms();
    doc.fire("focusin", field(search, "q"));
    field(search, "q").value = "sea";
    expect(hasUnsavedChanges(win as never)).toBe(false);
  });

  test("counts a recording made or kept unsent, and not a recorder still asking for the microphone", () => {
    const { win, edit } = forms();
    let loses = false;
    const host = edit?.querySelector(`[${FILE_FIELD_HOOKS.field}]`) as El;
    const asking = () => ["recording"];
    registerFileControl(host as never, { uploading: asking, loses: () => loses, settle: () => {} });
    expect(hasUnsavedChanges(win as never)).toBe(false);
    loses = true;
    expect(hasUnsavedChanges(win as never)).toBe(true);
  });

  test("takes what a committed save sent as saved, and still counts what was typed after", () => {
    const { doc, win, edit, field } = forms();
    const title = field(edit, "title");
    doc.fire("focusin", title);
    title.value = "Dusk";
    doc.fire("htmx:beforeSend", edit as El, { detail: { elt: edit } });
    doc.fire("htmx:afterRequest", edit as El, { detail: { elt: edit, successful: true } });
    expect(hasUnsavedChanges(win as never)).toBe(false);
    title.value = "Dusk, later";
    doc.fire("htmx:beforeSend", edit as El, { detail: { elt: edit } });
    title.value = "Dusk, later still";
    doc.fire("htmx:afterRequest", edit as El, { detail: { elt: edit, successful: true } });
    expect(hasUnsavedChanges(win as never)).toBe(true);
  });

  test("is let go of by a confirmed leave, and asked about again when touched after one that failed", () => {
    const { doc, win, edit, field } = forms();
    const title = field(edit, "title");
    doc.fire("focusin", title);
    title.value = "Dusk";
    letGoOfChanges(win as never);
    expect(hasUnsavedChanges(win as never)).toBe(false);
    doc.fire("pointerdown", title);
    expect(hasUnsavedChanges(win as never)).toBe(true);
  });

  test("does not count a list row added and left blank, which the server drops", () => {
    const { doc, win, edit, field } = forms();
    doc.fire("focusin", field(edit, "tags"));
    const row = doc.createElement("div");
    row.setAttribute("data-list-field-row", "");
    const blank = doc.createElement("input");
    blank.setAttribute("name", "tags");
    row.append(blank);
    (edit as El).append(row);
    expect(hasUnsavedChanges(win as never)).toBe(false);
    (blank as Field).value = "hills";
    expect(hasUnsavedChanges(win as never)).toBe(true);
  });

  test("reads a datetime by the field typed into, not the exact value behind it", () => {
    const { doc, win, edit, field } = forms();
    const typed = edit?.querySelector("[data-edit-datetime-input]") as Field;
    doc.fire("focusin", typed);
    field(edit, "taken_at").value = "2026-10-01T09:30";
    expect(hasUnsavedChanges(win as never)).toBe(false);
    typed.value = "2026-10-02T09:30";
    expect(hasUnsavedChanges(win as never)).toBe(true);
  });
});
