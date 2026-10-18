// A linked field, run through the shipped `public/controls/linked-field.js` on the markup the
// renderer writes: drawn as the dropdown of the target's records around the field's own input,
// searched by typing into it, never free-typed, saying when its text matches no record, and plain
// text again when its link turns out to be gone.

import { describe, expect, test } from "bun:test";
import { NO_RESULTS } from "#design/controls/listbox-search.js";
import { capabilityPickUrl } from "#shell/core/routes.js";
import { CREATE_CANCELLED_EVENT } from "#shell/core/shell-dom.js";
import {
  FIELD_NOT_LINKED_CODE,
  linkNoticeSentence,
} from "../../../../lifecycle/link/presentation.ts";
import { notesRow } from "../../../../runtime/router/dispatch/router.test-support.ts";
import { elementsOf, moduleSources } from "../../../../server/http/served-page.test-support.ts";
import { probeField } from "../../../fields/field-renderer.test-support.ts";
import { readSource } from "../../../safety/source.test-support.ts";
import { Doc, type El, parseHtml } from "../../double/choice-picker.test-support.ts";
import { startedOn } from "../../double/started-module.test-support.ts";
import {
  failed,
  held,
  installLinkGlobals,
  noticed,
  settle,
  unreachable,
} from "../link-control.test-support.ts";
import { chooseTargetRecord, disconnectFieldName, unmatchedTargetLine } from "../link-copy.ts";
import {
  AUTHOR,
  dropdownScene,
  editBook,
  linkedBooks,
  NAMES,
  newBook,
  partsOf,
  posted,
  records,
  TITLE,
} from "./linked-field.test-support.ts";

installLinkGlobals();

const PICK_URL = capabilityPickUrl("books", "author");
/** The refusal for a field whose link is gone, as the pick route renders it. */
const notLinked = noticed(
  { code: FIELD_NOT_LINKED_CODE, source: { row: notesRow(), field: "text" } },
  422,
);

describe("the shipped page runs the client against what the server writes", () => {
  test("the shell loads it as a module, and it starts itself on the document it finds", async () => {
    expect(moduleSources(await elementsOf(readSource("public/index.html")))).toContain(
      "/static/controls/linked-field.js",
    );
    const asked: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      asked.push(url);
      return records()({ url, method: "GET", body: "" });
    };
    const doc = new Doc();
    parseHtml(newBook(), doc);
    await startedOn("controls/linked-field.js", doc);
    await settle();
    expect(asked).toEqual([PICK_URL]);
    expect(doc.querySelector('[role="combobox"]')).not.toBeNull();
  });
});

describe("a linked field is drawn as a dropdown around its own input", () => {
  test("the input searches and posts nothing; a hidden carrier posts the text under the field's name", async () => {
    const scene = await dropdownScene([records()], editBook("Brandon Sanderson"));
    expect(scene.input.hasAttribute("name")).toBe(false);
    expect(scene.input.getAttribute("aria-autocomplete")).toBe("list");
    expect(scene.input.getAttribute("aria-expanded")).toBe("false");
    expect(scene.input.getAttribute("aria-controls")).toBe(scene.list.id);
    expect(scene.carrier.getAttribute("type")).toBe("hidden");
    expect(scene.carrier.value).toBe("Brandon Sanderson");
    const form = scene.root.closest("form") as El;
    expect(posted(form).filter(([name]) => name === "author")).toEqual([
      ["author", "Brandon Sanderson"],
    ]);
  });

  test("the broken chain sits inside its boundary before the chevron, pressable once read", async () => {
    const scene = await dropdownScene([records()]);
    const shell = scene.input.parent as El;
    expect(shell.children.map((child) => child.className)).toEqual([
      "field__input",
      "linked-field__slot",
      "listbox__chevron",
    ]);
    expect(scene.unlink.hasAttribute("disabled")).toBe(false);
    expect(scene.unlink.getAttribute("aria-label")).toBe(disconnectFieldName("book", AUTHOR));
    expect(scene.panel.hidden).toBe(true);
    // The label names the list, so a reader hears the field's name over its records.
    expect(
      scene.doc.getElementById(scene.list.getAttribute("aria-labelledby") ?? "")?.textContent,
    ).toContain(AUTHOR.label);
  });

  test("an empty field asks for a pick around the target's noun", async () => {
    const scene = await dropdownScene([records()]);
    expect(scene.input.value).toBe("");
    expect(scene.input.getAttribute("placeholder")).toBe(chooseTargetRecord("author"));
    expect(scene.line.hidden).toBe(true);
  });

  test("a field with a length limit gives up its counter, which counted typing it no longer takes", async () => {
    const limited = probeField("string", { name: "author", label: "Author", max_length: 120 });
    const scene = await dropdownScene([records()], newBook(linkedBooks([limited, TITLE])));
    expect(scene.field.querySelector(".field__guidance--count")).toBeNull();
    expect(scene.input.hasAttribute("maxlength")).toBe(false);
    const described = (scene.input.getAttribute("aria-describedby") ?? "").split(" ");
    for (const id of described) expect(scene.doc.getElementById(id)).not.toBeNull();
    // The line asking for a pick is named only while it shows, and an empty field shows none.
    expect(described).not.toContain(scene.line.id);
  });

  test("a required field is required on the carrier the platform's check reads, never natively", async () => {
    const required = probeField("string", { name: "author", label: "Author", required: true });
    const scene = await dropdownScene([records()], newBook(linkedBooks([required, TITLE])));
    expect(scene.carrier.hasAttribute("data-choice-required")).toBe(true);
    expect(scene.input.hasAttribute("required")).toBe(false);
    expect(scene.input.getAttribute("aria-required")).toBe("true");
  });

  test("an unlinked field is left as it was drawn", async () => {
    const scene = await dropdownScene([records()]);
    const title = scene.doc.querySelector('input[name="title"]') as El;
    expect(title.closest("[data-linked-field]")).toBeNull();
    expect(scene.asked).toEqual([PICK_URL]);
  });
});

describe("text that matches no record", () => {
  test("stays the field's value, in the field, with the line asking for a pick", async () => {
    const scene = await dropdownScene([records()], editBook("Ursula Le Guin"));
    expect(scene.input.value).toBe("Ursula Le Guin");
    expect(scene.carrier.value).toBe("Ursula Le Guin");
    expect(scene.line.hidden).toBe(false);
    expect(scene.line.textContent).toBe(unmatchedTargetLine("author"));
    expect(
      scene.options().every((option) => option.getAttribute("aria-selected") === "false"),
    ).toBe(true);
  });

  test("text a record holds, spaced or cased differently, is matched and chosen in the list", async () => {
    const scene = await dropdownScene([records()], editBook("  brandon sanderson "));
    expect(scene.line.hidden).toBe(true);
    const chosen = scene
      .options()
      .filter((option) => option.getAttribute("aria-selected") === "true");
    expect(chosen.map((option) => option.textContent)).toEqual(["Brandon Sanderson"]);
  });

  test("accents are not folded: they tell two names apart", async () => {
    const scene = await dropdownScene([records(["Peña"])], editBook("Pena"));
    expect(scene.line.hidden).toBe(false);
  });

  test("nothing is said before the records are read", async () => {
    const answer = held(records());
    const scene = await dropdownScene([answer.reply], editBook("Ursula Le Guin"));
    expect(scene.line.hidden).toBe(true);
    answer.release();
    await settle();
    expect(scene.line.hidden).toBe(false);
  });
});

describe("typing only searches", () => {
  test("it keeps the records whose name holds every typed word, landing on the first", async () => {
    const scene = await dropdownScene([records(), records()]);
    scene.type("san");
    await settle();
    expect(scene.panel.hidden).toBe(false);
    expect(scene.kept()).toEqual(["Brandon Sanderson"]);
    expect(scene.active()).toBe(scene.options()[0]?.id ?? null);
    scene.type("LE GUIN");
    expect(scene.kept()).toEqual(["Ursula K. Le Guin"]);
  });

  test("a search that keeps nothing says so, and Enter picks nothing", async () => {
    const scene = await dropdownScene([records(), records()]);
    scene.type("tolkien");
    await settle();
    expect(scene.panel.textContent).toContain(NO_RESULTS);
    expect(scene.key("Enter").prevented).toBe(true);
    expect(scene.carrier.value).toBe("");
  });

  test("leaving without a pick puts back the text the field holds, however it leaves", async () => {
    for (const leave of ["Escape", "Tab", "outside", "blur"] as const) {
      const scene = await dropdownScene([records(), records()], editBook("Octavia E. Butler"));
      scene.input.focus();
      scene.type("tolkien");
      await settle();
      if (leave === "outside") scene.doc.fire("pointerdown", scene.doc.body);
      else if (leave === "blur") scene.doc.fire("focusout", scene.input, { relatedTarget: null });
      else scene.key(leave);
      expect(scene.panel.hidden, leave).toBe(true);
      expect(scene.input.value, leave).toBe("Octavia E. Butler");
      expect(scene.carrier.value, leave).toBe("Octavia E. Butler");
    }
  });

  test("text the field holds that no record matches is put back too: leaving never clears it", async () => {
    const scene = await dropdownScene([records(), records()], editBook("Ursula Le Guin"));
    scene.type("");
    await settle();
    scene.key("Escape");
    expect(scene.input.value).toBe("Ursula Le Guin");
    expect(scene.carrier.value).toBe("Ursula Le Guin");
  });
});

describe("a pick fills the field with the record's text", () => {
  test("Enter on the search's first match picks it, announces it, and takes the line away", async () => {
    const scene = await dropdownScene([records(), records()], editBook("Ursula Le Guin"));
    scene.type("san");
    await settle();
    expect(scene.key("Enter").prevented).toBe(true);
    expect(scene.carrier.value).toBe("Brandon Sanderson");
    expect(scene.input.value).toBe("Brandon Sanderson");
    expect(scene.panel.hidden).toBe(true);
    expect(scene.line.hidden).toBe(true);
    expect(scene.doc.changes).toEqual([{ value: "Brandon Sanderson" }]);
  });

  test("a press on a record picks it", async () => {
    const scene = await dropdownScene([records(), records()]);
    scene.doc.fire("click", scene.input);
    await settle();
    scene.doc.fire("click", scene.options()[1] as El);
    expect(scene.carrier.value).toBe(NAMES[1] as string);
  });

  test("picking the record the field already picked announces nothing", async () => {
    const book = editBook("Brandon Sanderson", linkedBooks(), "author-0");
    const scene = await dropdownScene([records(), records()], book);
    scene.key("Enter");
    await settle();
    expect(scene.active()).toBe(scene.options()[0]?.id ?? null);
    scene.key("Enter");
    expect(scene.doc.changes).toEqual([]);
  });

  test("picking the record whose text the field holds, but never picked, is a change", async () => {
    const scene = await dropdownScene([records(), records()], editBook("Brandon Sanderson"));
    scene.key("Enter");
    await settle();
    expect(scene.active()).toBe(scene.options()[0]?.id ?? null);
    scene.key("Enter");
    expect(scene.doc.changes).toHaveLength(1);
  });

  test("the form posts the picked text, and never what was typed to find it", async () => {
    const scene = await dropdownScene([records(), records()]);
    scene.type("oct");
    await settle();
    scene.key("Enter");
    const form = scene.root.closest("form") as El;
    const sent = posted(form);
    expect(sent.filter(([name]) => name === "author")).toEqual([["author", "Octavia E. Butler"]]);
    expect(sent.some(([, value]) => value === "oct")).toBe(false);
  });

  test("a finished create form puts the field back to empty", async () => {
    const scene = await dropdownScene([records(), records()]);
    scene.type("san");
    await settle();
    scene.key("Enter");
    scene.doc.fire(CREATE_CANCELLED_EVENT, scene.root.closest("form") as El);
    expect(scene.carrier.value).toBe("");
    expect(scene.input.value).toBe("");
    expect(scene.line.hidden).toBe(true);
  });
});

describe("the records are read as the desk is now", () => {
  test("every opening reads them again, and takes in the new list where it stands", async () => {
    const scene = await dropdownScene([records(), records([...NAMES, "Ann Leckie"])]);
    scene.key("ArrowDown");
    await settle();
    expect(scene.asked).toEqual([PICK_URL, PICK_URL]);
    expect(scene.kept()).toContain("Ann Leckie");
  });

  test("an opening before the first read lands waits for it, and opens on what was typed", async () => {
    const first = held(records());
    const scene = await dropdownScene([first.reply]);
    scene.type("but");
    expect(scene.panel.hidden).toBe(true);
    first.release();
    await settle();
    expect(scene.panel.hidden).toBe(false);
    expect(scene.kept()).toEqual(["Octavia E. Butler"]);
    expect(scene.asked).toEqual([PICK_URL]);
  });

  test("an opening let go of before the read lands does not open when it does", async () => {
    const first = held(records());
    const scene = await dropdownScene([first.reply]);
    scene.key("ArrowDown");
    scene.doc.fire("pointerdown", scene.doc.body);
    first.release();
    await settle();
    expect(scene.panel.hidden).toBe(true);
  });
});

describe("a read that fails", () => {
  test("is said on the bar to someone waiting to open the list, with the notice's own words", async () => {
    const notice = { code: "link_stale" as const, moved: null, opening: true as const };
    for (const [reply, said] of [
      [noticed(notice, 409), linkNoticeSentence(notice)],
      [unreachable, null],
      [failed, null],
    ] as const) {
      const first = held(reply);
      const scene = await dropdownScene([first.reply]);
      scene.key("ArrowDown");
      first.release();
      await settle();
      expect(scene.panel.hidden).toBe(true);
      expect(scene.said).toHaveLength(1);
      if (said) expect(scene.said[0]).toEqual({ sentence: said, refused: true });
    }
  });

  test("says nothing when nobody is waiting, and keeps the text the field holds", async () => {
    const scene = await dropdownScene([failed], editBook("Brandon Sanderson"));
    expect(scene.said).toEqual([]);
    expect(scene.input.value).toBe("Brandon Sanderson");
    expect(scene.line.hidden).toBe(true);
  });

  test("a field whose link is gone is plain text again, holding its text, with its counter back", async () => {
    const limited = probeField("string", { name: "author", label: "Author", max_length: 120 });
    const html = editBook("Ursula Le Guin", linkedBooks([limited, TITLE]));
    const scene = await dropdownScene([notLinked], html);
    const input = scene.doc.getElementById("edit-books-author") as El;
    expect(scene.doc.querySelector("[data-linked-field]")).toBeNull();
    expect(input.getAttribute("name")).toBe("author");
    expect(input.value).toBe("Ursula Le Guin");
    expect(input.getAttribute("maxlength")).toBe("120");
    expect(input.hasAttribute("role")).toBe(false);
    expect(scene.doc.querySelector('[name="author"][type="hidden"][data-choice-value]')).toBeNull();
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
    for (const id of described) expect(scene.doc.getElementById(id)).not.toBeNull();
    expect(scene.said).toEqual([]);
  });
});

describe("a linked field arriving later", () => {
  test("is drawn when it lands in the page, and not before", async () => {
    // Held inert until a swap puts it in the page, as a record view arrives from its address.
    const scene = await dropdownScene(
      [records(), records()],
      `<template id="arriving">${editBook("Brandon Sanderson")}</template>`,
    );
    const arriving = scene.doc.querySelector("template") as El;
    expect((arriving.content as El).querySelector('[role="combobox"]')).toBeNull();
    const opened = (arriving.content as El).cloneNode(true);
    scene.doc.append(opened);
    await settle();
    const parts = partsOf(scene.doc, "author");
    expect(parts.input.value).toBe("Brandon Sanderson");
    expect(parts.input.getAttribute("placeholder")).toBe(chooseTargetRecord("author"));
  });
});
