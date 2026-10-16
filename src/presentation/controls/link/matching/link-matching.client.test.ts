// While Aluna matches the names a field already holds, run through the shipped
// `public/controls/link-control.js` and `link-matching.js` on the renderer's own forms: the press's
// answer arrives a line at a time, the note atop the form and every faded chain, Save and Delete
// standing between the two, and the prompt bar's report once the second line lands.

import { describe, expect, test } from "bun:test";
import { PICK_UNKNOWN } from "#shell/controls/link-control.js";
import { answerLines, holdWhileMatching, NOTE_CLASS } from "#shell/controls/link-matching.js";
import { capabilityActionUrl } from "#shell/core/routes.js";
import { setPending } from "#shell/records/record-mutations.js";
import {
  capabilityRecordsRegionId,
  renderCreateForm,
  renderEditForm,
} from "../../../fields/field-renderer.ts";
import { renderRecordView } from "../../../records/record-view/record-view.ts";
import { Doc, type El, parseHtml } from "../../double/choice-picker.test-support.ts";
import {
  AUTHOR,
  bookCapability,
  held,
  installLinkGlobals,
  linkScene,
  listed,
  matched,
  NOTE,
  REPORT,
  type Reply,
  settle,
  TITLE,
  written,
} from "../link-control.test-support.ts";
import { matchingReport } from "../link-copy.ts";

installLinkGlobals();

const BOOKS = {
  ...bookCapability([AUTHOR, TITLE]),
  actions: ["create", "read", "update", "delete"],
};

/** An open record's Edit form, with Delete beside Save and Cancel. */
const EDIT_FORM = renderEditForm(BOOKS as never, { id: "book-1" });

/** A press's answer whose lines the test sends when it chooses. */
function answering() {
  const answer = matched([]);
  const reply: Reply = () => answer.response;
  return { ...answer, reply };
}

/** The Edit form opened on its author chain, and a press on the chooser's first option. */
async function pressed(reply: Reply) {
  const scene = await linkScene([listed(), reply], EDIT_FORM);
  await scene.press(scene.button);
  await scene.press(scene.options()[0] as El);
  const form = scene.doc.querySelector("form") as El;
  const button = (selector: string) => form.querySelector(selector) as El;
  return {
    scene,
    form,
    note: () => form.querySelector(`.${NOTE_CLASS}`),
    titleChain: scene.chooserOf("edit-books-title").button,
    save: button('button[type="submit"]'),
    remove: button("[data-record-delete]"),
    cancel: button("[data-record-cancel]"),
    author: scene.doc.getElementById("edit-books-author") as El,
  };
}

const reported = (sentence: string) => ({ sentence, refused: false });
const refused = (sentence: string) => ({ sentence, refused: true });

describe("while the names are matched", () => {
  test("the note sits atop the form, and the chains fade with Save and Delete, not Cancel", async () => {
    const answer = answering();
    const page = await pressed(answer.reply);
    answer.send({ note: NOTE });
    await settle();

    expect(page.form.children[0]).toBe(page.note() as El);
    expect(page.note()?.getAttribute("role")).toBe("status");
    expect(page.note()?.textContent).toBe(NOTE);
    expect([page.titleChain, page.save, page.remove].map((one) => one.disabled)).toEqual([
      true,
      true,
      true,
    ]);
    expect(page.cancel.disabled).toBe(false);
    expect(page.author.closest("[data-linked-field]")).not.toBeNull();
    expect(page.scene.said).toEqual([]);
  });

  test("both clear when the report lands, which the bar says without a refusal's cue", async () => {
    const answer = answering();
    const page = await pressed(answer.reply);
    answer.send({ note: NOTE });
    await settle();
    answer.send({ report: REPORT });
    answer.end();
    await settle();

    expect(page.note()).toBeNull();
    expect([page.titleChain, page.save, page.remove].map((one) => one.disabled)).toEqual([
      false,
      false,
      false,
    ]);
    expect(page.scene.said).toEqual([reported(REPORT)]);
    expect(page.scene.doc.activeElement).toBe(page.author);
  });

  test("a button already disabled is not given back", async () => {
    const answer = answering();
    const scene = await linkScene([listed(), answer.reply], EDIT_FORM);
    const save = scene.doc.querySelector('button[type="submit"]') as El;
    save.disabled = true;
    await scene.press(scene.button);
    await scene.press(scene.options()[0] as El);
    answer.send({ note: NOTE });
    answer.send({ report: REPORT });
    answer.end();
    await settle();
    expect(save.disabled).toBe(true);
  });

  test("focus on a button that fades goes to the dropdown being connected", async () => {
    const answer = answering();
    const page = await pressed(answer.reply);
    page.save.focus();
    answer.send({ note: NOTE });
    await settle();
    expect(page.save.disabled).toBe(true);
    expect(page.scene.doc.activeElement).toBe(page.author);
  });

  test("a form opened meanwhile fades too, and is given back with the rest", async () => {
    const answer = answering();
    const page = await pressed(answer.reply);
    answer.send({ note: NOTE });
    await settle();
    const opened = parseHtml(renderCreateForm(bookCapability([AUTHOR, TITLE])), new Doc());
    const form = opened.querySelector("form") as El;
    page.scene.doc.documentElement?.append(form);
    await settle();
    const add = form.querySelector('button[type="submit"]') as El;
    expect(add.disabled).toBe(true);
    answer.send({ report: REPORT });
    answer.end();
    await settle();
    expect(add.disabled).toBe(false);
  });

  test("a save that ends meanwhile keeps Save faded, and has it back at the end", async () => {
    const answer = answering();
    const page = await pressed(answer.reply);
    setPending(page.form as never, true, "[data-record-cancel]");
    answer.send({ note: NOTE });
    await settle();
    setPending(page.form as never, false, "[data-record-cancel]");
    expect(page.save.disabled).toBe(true);
    answer.send({ report: REPORT });
    answer.end();
    await settle();
    expect(page.save.disabled).toBe(false);
  });

  test("nothing fades while the press only waits its turn", async () => {
    const waiting = held(written);
    const page = await pressed(waiting.reply);
    expect(page.note()).toBeNull();
    expect(page.save.disabled).toBe(false);
    waiting.release();
    await settle();
    expect(page.note()).toBeNull();
    expect(page.scene.said).toEqual([reported(REPORT)]);
  });
});

describe("when the matching ends", () => {
  test("with nothing to report, the bar says nothing", async () => {
    const empty = matchingReport({ noun: "book", plural: "books" }, "author", {
      linked: 0,
      unmatched: 0,
    });
    const answer = answering();
    const page = await pressed(answer.reply);
    answer.send({ note: NOTE });
    answer.send({ report: empty });
    answer.end();
    await settle();
    expect(page.scene.said).toEqual([]);
    expect(page.note()).toBeNull();
  });

  test("with no report, the page is given back and the bar says it cannot tell what connected", async () => {
    const answer = answering();
    const page = await pressed(answer.reply);
    answer.send({ note: NOTE });
    answer.end();
    await settle();
    expect(page.scene.said).toEqual([refused(PICK_UNKNOWN)]);
    expect(page.note()).toBeNull();
    expect(page.save.disabled).toBe(false);
  });

  test("an answer with no note is none a written pick sends: the chain stays", async () => {
    const answer = answering();
    const page = await pressed(answer.reply);
    answer.end();
    await settle();
    expect(page.scene.said).toEqual([refused(PICK_UNKNOWN)]);
    expect(page.author.closest("[data-link-control]")).not.toBeNull();
    expect(page.author.closest("[data-linked-field]")).toBeNull();
  });
});

describe("once the names are matched", () => {
  /** A press from `html`, answered in full. */
  async function matchedFrom(html: string, after: Reply[] = []) {
    const scene = await linkScene([listed(), written, ...after], html);
    await scene.press(scene.button);
    await scene.press(scene.options()[0] as El);
    return scene;
  }

  test("the list on the page is read again, so each card carries the mark it now has", async () => {
    const list = `<div id="${capabilityRecordsRegionId("books")}"></div>`;
    const read: Reply = () => new Response("", { status: 200 });
    const scene = await matchedFrom(renderCreateForm(bookCapability()) + list, [read]);
    expect(scene.exchanges.at(-1)).toMatchObject({
      method: "GET",
      url: capabilityActionUrl("books", "read"),
    });
  });

  test("focus on a card goes back to it, unless the person went elsewhere meanwhile", async () => {
    const card = (text: string) =>
      `<button type="button" id="card-1" class="capability-item">${text}</button>`;
    const list = `<div id="${capabilityRecordsRegionId("books")}">${card("before")}</div>`;
    for (const elsewhere of [false, true]) {
      const answer = answering();
      const read = held(() => new Response(card("after"), { status: 200 }));
      const html = renderCreateForm(bookCapability([AUTHOR, TITLE])) + list;
      const scene = await linkScene([listed(), answer.reply, read.reply], html);
      await scene.press(scene.button);
      await scene.press(scene.options()[0] as El);
      answer.send({ note: NOTE });
      await settle();
      (scene.doc.getElementById("card-1") as El).focus();
      answer.send({ report: REPORT });
      answer.end();
      await settle();
      const title = scene.doc.getElementById("cap-books-title") as El;
      if (elsewhere) title.focus();
      read.release();
      await settle();
      const now = scene.doc.activeElement as El | null;
      expect(now?.getAttribute("id")).toBe(elsewhere ? "cap-books-title" : "card-1");
      expect(scene.doc.getElementById("card-1")?.textContent).toBe("after");
    }
  });

  test("an open record reads nothing: its list is read when the person goes back to it", async () => {
    const scene = await matchedFrom(EDIT_FORM);
    expect(scene.exchanges.map((exchange) => exchange.method)).toEqual(["GET", "POST"]);
    expect(scene.said).toEqual([reported(REPORT)]);
  });
});

describe("holding the page", () => {
  /** A record's whole view, its Delete question beside its Edit form, on a page of its own. */
  function recordView() {
    const doc = parseHtml(
      renderRecordView(BOOKS as never, { id: "book-1" }, "record-books-1"),
      new Doc(),
    );
    const button = (selector: string) => doc.querySelector(selector) as El;
    return {
      form: doc.querySelector("form.capability-edit-form") as El,
      faded: () =>
        [
          button('.capability-edit-form button[type="submit"]'),
          button("[data-record-delete]"),
          button('[data-record-delete-form] button[type="submit"]'),
          button(".link-control__button"),
        ].map((one) => one.disabled),
    };
  }

  test("fades the Delete question's own button with Save and Delete", () => {
    const view = recordView();
    const release = holdWhileMatching(view.form as never, NOTE, null);
    expect(view.faded()).toEqual([true, true, true, true]);
    release();
    expect(view.faded()).toEqual([false, false, false, false]);
  });

  test("keeps one note for two fields at once, and gives the page back after the last", async () => {
    const view = recordView();
    const first = holdWhileMatching(view.form as never, NOTE, null);
    const second = holdWhileMatching(view.form as never, `${NOTE} `, null);
    await settle();
    const notes = () => view.form.querySelectorAll(`.${NOTE_CLASS}`);
    expect(notes()).toHaveLength(1);
    first();
    expect(notes()).toHaveLength(1);
    expect(view.faded()).toEqual([true, true, true, true]);
    second();
    expect(notes()).toHaveLength(0);
    expect(view.faded()).toEqual([false, false, false, false]);
  });

  test("gives a form whose save is out its faded buttons back once that save ends", () => {
    const view = recordView();
    setPending(view.form as never, true, "[data-record-cancel]");
    holdWhileMatching(view.form as never, NOTE, null)();
    expect(view.faded()).toEqual([true, true, false, true]);
    setPending(view.form as never, false, "[data-record-cancel]");
    expect(view.faded()).toEqual([false, false, false, false]);
  });

  test("a faded chain opens nothing, and a panel left open takes no pick", async () => {
    const scene = await linkScene([listed()], EDIT_FORM);
    await scene.press(scene.button);
    const form = scene.doc.querySelector("form") as El;
    const release = holdWhileMatching(form as never, NOTE, null);
    await scene.press(scene.options()[0] as El);
    await scene.press(scene.chooserOf("edit-books-title").button);
    expect(scene.exchanges.map((exchange) => exchange.method)).toEqual(["GET"]);
    release();
  });
});

describe("the answer's lines", () => {
  test("are read whole across the chunks they arrive in, and a line that is no object is passed", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of ['{"no', 'te":"a"}\n[1]\nnot json\n{"rep', 'ort":"b"}\n'])
          controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const line = answerLines(new Response(body));
    expect(await line()).toEqual({ note: "a" });
    expect(await line()).toEqual({ report: "b" });
    expect(await line()).toBeNull();
  });

  test("include the last one, though no line break follows it", async () => {
    const line = answerLines(new Response('{"note":"a"}\n{"report":"b"}'));
    expect(await line()).toEqual({ note: "a" });
    expect(await line()).toEqual({ report: "b" });
    expect(await line()).toBeNull();
  });
});
