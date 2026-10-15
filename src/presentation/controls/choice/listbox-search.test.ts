// The listbox's search, as `design/scripts/controls/listbox-search.js` decides it for the design's
// listbox and the desk's picker alike: text folded exactly as a capability's own search folds it,
// every typed word required, a note never read, and the key each part of the keyboard answers to.

import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  containsEveryWord,
  foldForSearch,
  NO_RESULTS,
  narrow,
  optionLabel,
  searchIntent,
  searchWords,
} from "#design/controls/listbox-search.js";
import { normalizeSearchText } from "../../../runtime/data/index.ts";
import { installDomGlobals } from "../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";

installDomGlobals();

describe("text is folded as a capability's own search folds it", () => {
  test("the same as the server's fold, for any text at all", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme-composite" }), (text) => {
        expect(foldForSearch(text)).toBe(normalizeSearchText(text));
      }),
      { numRuns: 2000 },
    );
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        expect(foldForSearch(text)).toBe(normalizeSearchText(text));
      }),
      { numRuns: 2000 },
    );
  });

  test("case and the accents on Latin letters go, and another script's marks stay", () => {
    for (const text of ["Café", "CAFE", "Café", "ÅNGSTRÖM", "façade", "ﬁle", "हिंदी", "がくせい"]) {
      expect(foldForSearch(text)).toBe(normalizeSearchText(text));
    }
    expect(foldForSearch("Peña")).toBe("pena");
    expect(foldForSearch("がくせい")).not.toBe(foldForSearch("かくせい"));
  });
});

describe("a query is every word typed", () => {
  test("split on any run of space, each folded, none of them empty", () => {
    expect(searchWords("  Le\tGUIN\n  ursula ")).toEqual(["le", "guin", "ursula"]);
    expect(searchWords("   ")).toEqual([]);
    expect(searchWords("")).toEqual([]);
  });

  test("a label keeps its place only when it holds every word, in any order and anywhere", () => {
    const label = "Ursula K. Le Guin";
    expect(containsEveryWord(label, searchWords("guin URS"))).toBe(true);
    expect(containsEveryWord(label, searchWords("sula"))).toBe(true);
    expect(containsEveryWord(label, searchWords("guin octavia"))).toBe(false);
    expect(containsEveryWord(label, [])).toBe(true);
    expect(containsEveryWord("Peña Nieto", searchWords("pena"))).toBe(true);
  });
});

describe("what the list reads, and what it says", () => {
  const panel = () =>
    parseHtml(
      `<div class="listbox__panel"><div class="listbox__scroll" role="listbox">` +
        `<div role="group"><div class="listbox__group" role="presentation">Open</div>` +
        `<div role="option" data-value="paid">Paid<span class="listbox__note">closes it</span></div></div>` +
        `<div role="group"><div class="listbox__group" role="presentation">Closed</div>` +
        `<div role="option" data-value="void">Void</div></div>` +
        `</div></div>`,
      new Doc(),
    ).querySelector(".listbox__panel") as El;

  test("an option is called by its label, never by its note", () => {
    const option = panel().querySelector('[data-value="paid"]') as El;
    expect(optionLabel(option as never)).toBe("Paid");
  });

  test("narrowing hides what it does not keep, and a group left holding nothing", () => {
    const list = panel();
    const kept = narrow(list as never, "void");
    expect(kept.map((option) => option.getAttribute("data-value"))).toEqual(["void"]);
    const groups = list.querySelectorAll('[role="group"]');
    expect(groups.map((group) => group.hidden)).toEqual([true, false]);
    expect(narrow(list as never, "closes")).toEqual([]);
  });

  test("the sentence under the list is made once, empty, and speaks only when nothing is kept", () => {
    const list = panel();
    narrow(list as never, "");
    const sentences = () => list.querySelectorAll(".listbox__empty");
    expect(sentences()).toHaveLength(1);
    expect(sentences()[0]?.getAttribute("role")).toBe("status");
    expect(sentences()[0]?.textContent).toBe("");
    narrow(list as never, "nothing");
    expect(sentences()[0]?.textContent).toBe(NO_RESULTS);
    narrow(list as never, "pa");
    expect(sentences()).toHaveLength(1);
    expect(sentences()[0]?.textContent).toBe("");
  });
});

describe("the keys a field that searches answers", () => {
  test("closed, the arrows and Enter open it, and every other key is typing", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter"])
      expect(searchIntent(key, false)).toBe("open");
    for (const key of [" ", "Home", "End", "a", "Escape", "Tab", "Backspace"]) {
      expect(searchIntent(key, false)).toBeNull();
    }
  });

  test("open, the arrows walk, Enter picks, Escape and Tab leave, and the rest is typing", () => {
    expect(searchIntent("ArrowDown", true)).toBe("next");
    expect(searchIntent("ArrowUp", true)).toBe("previous");
    expect(searchIntent("Enter", true)).toBe("pick");
    expect(searchIntent("Escape", true)).toBe("leave");
    expect(searchIntent("Tab", true)).toBe("leave");
    for (const key of [" ", "Home", "End", "a", "Backspace"])
      expect(searchIntent(key, true)).toBeNull();
  });
});
