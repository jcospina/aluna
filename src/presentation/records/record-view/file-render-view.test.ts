// The record's render view (`public/records/file-render-view.js`), its rules run in Bun against
// structural doubles: the way back it draws, where it returns the keyboard, and what it stops.

import { describe, expect, test } from "bun:test";
import {
  openerSelector,
  pausePreviews,
  unload,
  viewMarkup,
} from "#shell/records/file-render-view.js";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";

/** A player that records what was done to it. */
function player() {
  const done: string[] = [];
  return {
    done,
    pause: () => void done.push("pause"),
    removeAttribute: (name: string) => void done.push(`remove ${name}`),
    load: () => void done.push("load"),
  };
}

const scope = (media: unknown[]) => ({ querySelectorAll: () => media });

describe("the render view's way back", () => {
  test("names the record and the file, as words", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const root = parseHtml(
      viewMarkup(hostile, { name: hostile, size: 1, url: "/files/k" }),
      new Doc(),
    );
    expect(root.querySelector("img")).toBeNull();
    const back = root.querySelector("[data-file-view-back]") as El;
    expect(back.getAttribute("aria-label")).toBe(`Back to ${hostile}`);
    expect(back.textContent).toBe(hostile);
    expect(root.querySelector(".detail__title")?.textContent).toBe(hostile);
    expect(root.querySelector("[data-file-view]")).not.toBeNull();
  });

  test("returns the keyboard to the field's Open, or to the list row it was opened from", () => {
    expect(openerSelector(undefined)).toBe("[data-file-open]");
    expect(openerSelector("e3")).toBe('[data-file-entry="e3"] [data-file-list-open]');
    expect(openerSelector('e"]\\x')).toBe('[data-file-entry="e\\"]\\\\x"] [data-file-list-open]');
  });
});

describe("what the render view stops", () => {
  test("puts the form's preview down when a file opens in full", () => {
    const preview = player();
    pausePreviews(scope([preview, { notAPlayer: true }]));
    expect(preview.done).toEqual(["pause"]);
  });

  test("stops a player it takes off the page from fetching as well as playing", () => {
    const shown = player();
    unload(scope([shown]));
    expect(shown.done).toEqual(["pause", "remove src", "load"]);
  });
});
