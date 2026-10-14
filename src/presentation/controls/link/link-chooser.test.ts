// The chooser's panel as the server writes it, and the one rule the copy module applies to a label.
// The panel is parsed rather than read as a string: what the client and a screen reader meet is the
// tree, its roles and the ids one element points another at.

import { describe, expect, test } from "bun:test";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";
import { type ChooserList, renderChooserList, renderChooserPanel } from "./link-chooser.ts";
import { AUTHOR, chooserTarget, NAMES, SHELF } from "./link-control.test-support.ts";
import {
  CHOOSER_EMPTY,
  chooserHeading,
  chooserLine,
  labelInSentence,
  SUGGESTED_GROUP,
  targetName,
} from "./link-copy.ts";

const PREFIX = "cap-books-author-link-list";

const TITLES = chooserTarget("reading_log", "Reading Log", { name: "title", label: "Title" }, [
  "The Dispossessed",
]);
const LOG_AUTHOR = chooserTarget("reading_log", "Reading Log", { name: "by", label: "By" });

function drawn(list: ChooserList) {
  const root = parseHtml(renderChooserList(PREFIX, list), new Doc());
  const groups = root.querySelectorAll('[role="group"]');
  return {
    root,
    groups,
    options: root.querySelectorAll('[role="option"]'),
    heading: (group: El) => root.querySelector(`#${group.getAttribute("aria-labelledby")}`),
    /** What an option is called, apart from the note of values written beside it. */
    label: (option: El) => option.ownText,
  };
}

/** The whole panel the chooser's read answers, for the book's Author field. */
function panel(list: ChooserList) {
  const root = parseHtml(
    renderChooserPanel(PREFIX, { noun: "book", field: AUTHOR }, list),
    new Doc(),
  );
  const scroll = root.querySelector(".listbox__scroll") as El;
  return {
    root,
    scroll,
    head: root.querySelector(".link-control__head") as El,
    at: (id: string | null) => root.querySelector(`#${id}`),
    empty: root.querySelector(".listbox__empty"),
  };
}

describe("the panel a read answers", () => {
  test("with targets: the heading and the line over a listbox named and described by them", () => {
    const drawn = panel({ suggested: NAMES, groups: [[SHELF]] });
    expect(drawn.root.children.map((child) => child.className)).toEqual([
      "link-control__head",
      "listbox__scroll",
    ]);
    expect(drawn.scroll.id).toBe(PREFIX);
    expect(drawn.scroll.getAttribute("role")).toBe("listbox");
    expect(drawn.scroll.hasAttribute("data-listbox-list")).toBe(true);
    const heading = drawn.at(drawn.scroll.getAttribute("aria-labelledby"));
    const line = drawn.at(drawn.scroll.getAttribute("aria-describedby"));
    expect(heading?.parent).toBe(drawn.head);
    expect(line?.parent).toBe(drawn.head);
    expect(heading?.textContent).toBe(chooserHeading("book", AUTHOR));
    expect(line?.textContent).toBe(chooserLine("book", AUTHOR));
    expect(drawn.scroll.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(drawn.empty).toBeNull();
  });

  test("with nothing to pick: the heading over an empty listbox, and the empty sentence, no line", () => {
    const drawn = panel({ groups: [] });
    expect(drawn.at(drawn.scroll.getAttribute("aria-labelledby"))?.textContent).toBe(
      chooserHeading("book", AUTHOR),
    );
    expect(drawn.head.children).toHaveLength(1);
    expect(drawn.root.textContent).not.toContain(chooserLine("book", AUTHOR));
    expect(drawn.scroll.hasAttribute("aria-describedby")).toBe(false);
    expect([drawn.scroll.getAttribute("role"), drawn.scroll.hidden]).toEqual(["listbox", false]);
    expect(drawn.scroll.children).toEqual([]);
    expect(drawn.empty?.getAttribute("role")).toBe("status");
    expect(drawn.empty?.textContent).toBe(CHOOSER_EMPTY);
    expect(drawn.empty?.hidden).toBe(false);
  });

  test("a noun and a label with markup in them stay text in the heading and the line", () => {
    const field = { ...AUTHOR, label: `<i>Writer</i> & co` };
    const html = renderChooserPanel(PREFIX, { noun: `<b>tome</b>`, field }, { groups: [[SHELF]] });
    const root = parseHtml(html, new Doc());
    expect(root.querySelectorAll("b, i")).toEqual([]);
    expect(root.querySelector(".link-control__head")?.textContent).toBe(
      chooserHeading(`<b>tome</b>`, field) + chooserLine(`<b>tome</b>`, field),
    );
  });

  test("every id in it is its own, under the list's id, whatever a capability is called", () => {
    for (const id of ["suggested", "heading", "line", "option"]) {
      const named = (name: string) => chooserTarget(id, "Things", { name, label: name });
      const drawn = panel({ suggested: NAMES, groups: [[named("one"), named("two")], [SHELF]] });
      const ids = drawn.root.querySelectorAll("[id]").map((node) => node.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((one) => one.startsWith(PREFIX))).toBe(true);
      for (const group of drawn.root.querySelectorAll('[role="group"]')) {
        const heading = drawn.at(group.getAttribute("aria-labelledby"));
        expect(heading?.parent).toBe(group);
      }
    }
  });
});

describe("the order the list is read in", () => {
  test("the suggestion stands first in its own group, named with its capability", () => {
    const list = drawn({ suggested: NAMES, groups: [[SHELF], [TITLES, LOG_AUTHOR]] });
    const [first] = list.groups;
    expect(list.heading(first as El)?.textContent).toBe(SUGGESTED_GROUP);
    expect(first?.querySelectorAll('[role="option"]').map(list.label)).toEqual([
      targetName(NAMES.capabilityLabel, NAMES.field),
    ]);
  });

  test("every other group is headed by its capability, in the order given, its fields by label", () => {
    const list = drawn({ suggested: NAMES, groups: [[SHELF], [TITLES, LOG_AUTHOR]] });
    const rest = list.groups.slice(1);
    expect(rest.map((group) => list.heading(group)?.textContent)).toEqual([
      SHELF.capabilityLabel,
      TITLES.capabilityLabel,
    ]);
    expect(rest.map((group) => group.querySelectorAll('[role="option"]').map(list.label))).toEqual([
      [SHELF.field.label],
      [TITLES.field.label, LOG_AUTHOR.field.label],
    ]);
  });

  test("with no suggestion the groups stand alone, and an empty one draws nothing", () => {
    const list = drawn({ groups: [[], [SHELF]] });
    expect(list.groups.map((group) => list.heading(group)?.textContent)).toEqual([
      SHELF.capabilityLabel,
    ]);
  });

  test("nothing to pick draws nothing at all", () => {
    expect(renderChooserList(PREFIX, { groups: [] })).toBe("");
  });
});

describe("each option", () => {
  const list = drawn({ suggested: NAMES, groups: [[SHELF], [TITLES, LOG_AUTHOR]] });

  test("is an option with an id of its own under the prefix", () => {
    const ids = list.options.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith(`${PREFIX}-`))).toBe(true);
    const everyId = list.root.querySelectorAll("[id]").map((node) => node.id);
    expect(new Set(everyId).size).toBe(everyId.length);
    expect(list.options.map((option) => option.getAttribute("aria-selected"))).toEqual(
      list.options.map(() => "false"),
    );
  });

  test("a capability called suggested heads its own group, not the Suggested one", () => {
    const named = chooserTarget("suggested", "Suggested ideas", { name: "idea", label: "Idea" });
    const list = drawn({ suggested: NAMES, groups: [[named]] });
    const headingIds = list.groups.map((group) => group.getAttribute("aria-labelledby"));
    expect(new Set(headingIds).size).toBe(2);
    expect(list.groups.map((group) => list.heading(group)?.textContent)).toEqual([
      SUGGESTED_GROUP,
      "Suggested ideas",
    ]);
  });

  test("carries the press its pick posts, unchanged", () => {
    const presses = list.options.map((option) =>
      [...new URLSearchParams(option.getAttribute("data-link-press") ?? "")].sort(),
    );
    expect(presses).toEqual(
      [NAMES, SHELF, TITLES, LOG_AUTHOR].map((target) => [...target.press].sort()),
    );
  });

  test("names its target field as its value", () => {
    expect(list.options.map((option) => option.getAttribute("data-value"))).toEqual(
      [NAMES, SHELF, TITLES, LOG_AUTHOR].map((one) => `${one.capabilityId}.${one.field.name}`),
    );
  });

  test("is described by a note of its values, and has neither when it has none", () => {
    const [names, shelf] = list.options as [El, El];
    const note = names.querySelector(".listbox__note") as El;
    expect(note.textContent).toBe(NAMES.preview.join(", "));
    expect(names.getAttribute("aria-describedby")).toBe(note.id);
    expect(shelf.querySelector(".listbox__note")).toBeNull();
    expect(shelf.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("what a person typed stays text", () => {
  test("labels, values and the press are escaped wherever they land", () => {
    const hostile = chooserTarget(
      "zines",
      `<b class="x">Zines & "Co"</b>`,
      { name: "title", label: `Title <i>it</i>` },
      [`<img src=x onerror="go()">`, `Tom & Jerry's`],
    );
    hostile.press.set("target_field", `a"b<c>&d`);
    const list = drawn({ suggested: hostile, groups: [[hostile]] });
    expect(list.root.querySelectorAll("b, i, img")).toEqual([]);
    const [suggested, grouped] = list.options as [El, El];
    expect(list.label(suggested)).toBe(targetName(hostile.capabilityLabel, hostile.field));
    expect(list.label(grouped)).toBe(hostile.field.label);
    expect(list.heading(list.groups[1] as El)?.textContent).toBe(hostile.capabilityLabel);
    expect(grouped.querySelector(".listbox__note")?.textContent).toBe(hostile.preview.join(", "));
    expect(grouped.getAttribute("data-link-press")).toBe(hostile.press.toString());
  });
});

describe("a label inside a sentence", () => {
  test.each([
    ["Author", "author"],
    ["Due date", "due date"],
    ["A", "a"],
    ["Émile", "émile"],
    ["eBook", "eBook"],
    ["ISBN", "ISBN"],
    ["ISBN number", "ISBN number"],
    ["MP3 file", "MP3 file"],
    ["Isbn", "isbn"],
    ["LinkedIn URL", "LinkedIn URL"],
    ["YouTube channel", "YouTube channel"],
    ["Wi-Fi password", "Wi-Fi password"],
    ["I.D.", "I.D."],
    ["Follow-up date", "follow-up date"],
    ["E-mail", "e-mail"],
    ["Owner's name", "owner's name"],
    ["Owner’s name", "owner’s name"],
  ])("%s reads as %s", (label, inSentence) => {
    expect(labelInSentence(label)).toBe(inSentence);
  });
});
