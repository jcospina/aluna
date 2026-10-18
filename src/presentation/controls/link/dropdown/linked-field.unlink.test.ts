// The broken chain inside a linked field, run through the shipped clients in a framed window: it
// asks once over the window, as a form with unsaved changes asks, the answer that keeps the link
// changes nothing, and Disconnect posts the press the list read and gives every copy of the field
// back as the plain text field the server draws, its chain back.

import { afterEach, describe, expect, test } from "bun:test";
import { startLinkControls } from "#shell/controls/link-control.js";
import { holdWhileMatching } from "#shell/controls/link-matching.js";
import { pageOf } from "#shell/controls/link-notices.js";
import {
  DISCONNECT,
  KEEP_CONNECTED,
  UNLINK_UNKNOWN,
  UNLINK_UNWRITTEN,
} from "#shell/controls/unlink/unlink-field.js";
import { capabilityLinkUrl, unlinkFieldUrl } from "#shell/core/routes.js";
import { backOutOfLeaving, startLeavingGuard } from "#shell/desk/leaving-a-run.js";
import {
  UNSAVED_LEAVING_BACK_SELECTOR,
  UNSAVED_LEAVING_GO_SELECTOR,
  UNSAVED_LEAVING_SELECTOR,
} from "#shell/desk/leaving-unsaved-changes.js";
import {
  FIELD_NOT_LINKED_CODE,
  FIELD_UNLINKED_CODE,
  LINK_STALE_CODE,
  type LinkNotice,
  linkNoticeSentence,
} from "../../../../lifecycle/link/presentation.ts";
import { notesRow } from "../../../../runtime/router/dispatch/router.test-support.ts";
import type { Doc, El } from "../../double/choice-picker.test-support.ts";
import {
  type Exchange,
  held,
  installLinkGlobals,
  noticed,
  type Reply,
  settle,
  unreachable,
} from "../link-control.test-support.ts";
import { connectFieldName } from "../link-copy.ts";
import {
  dropdownScene,
  editBook,
  linkedBooks,
  newBook,
  records,
  UNLINKING,
} from "./linked-field.test-support.ts";

installLinkGlobals();

const LINK_URL = capabilityLinkUrl("books", "author");
const UNLINK_URL = unlinkFieldUrl(LINK_URL);

const page = globalThis as unknown as { document?: unknown };
afterEach(() => {
  backOutOfLeaving();
  delete page.document;
});

/**
 * Mistborn open in Edit inside the window with a second copy of the field on the page, the
 * new-record form's (or Mistborn's when the new-record form is the one asked for), the Link
 * control and the window's question wired as the page wires them. Every read of the field's list
 * after the first takes `reads`; each write takes the next of `writes`. `asked` is every request
 * after the field's first read, as the server would read it.
 */
async function windowScene(
  writes: Reply[],
  form = editBook("Brandon Sanderson"),
  reads: Reply = records(),
) {
  const other = form.includes("data-record-edit-form") ? newBook() : editBook("Octavia E. Butler");
  const html = `<section class="window"><div class="window__body">${form}${other}</div></section>`;
  const scene = await dropdownScene([records(), records()], html);
  const asked: Exchange[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init: RequestInit = {},
  ) => {
    const exchange = { url, method: init.method ?? "GET", body: String(init.body ?? "") };
    asked.push(exchange);
    const reply = exchange.method === "GET" ? reads : writes.shift();
    if (!reply) throw new Error(`nothing answers ${url}`);
    return reply(exchange);
  };
  page.document = scene.doc;
  startLeavingGuard(scene.doc as never);
  startLinkControls(scene.doc as never);
  const body = scene.doc.querySelector(".window__body") as El;
  return {
    ...scene,
    asked,
    body,
    veil: () => scene.doc.querySelector(UNSAVED_LEAVING_SELECTOR),
    press: () => scene.doc.fire("click", scene.unlink),
    answer: (selector: string) => {
      scene.doc.fire("click", scene.doc.querySelector(selector) as El);
      return settle();
    },
  };
}

/** Each form on the page, one copy of the field in each. */
function copies(doc: Doc): El[] {
  return doc.querySelectorAll("form");
}

/** Notes' text, unlinked meanwhile: the pick route's answer names the chain it takes back. */
const NOTES_UNLINKED: LinkNotice = {
  code: FIELD_UNLINKED_CODE,
  source: { row: notesRow(), field: "text" },
};
const NOTES_CHAIN = connectFieldName(
  notesRow().noun,
  notesRow().schema.fields.find((field) => field.name === "text") ?? { label: "" },
);

/** An element as a reader of its markup meets it: tag, attributes in name order, children. */
function shape(node: El): unknown {
  const attributes = Object.entries(node.attributes).sort(([a], [b]) => (a < b ? -1 : 1));
  return [node.tag, attributes, node.children.map(shape)];
}

describe("the broken chain asks once, over the window", () => {
  test("is held still until the list says what it asks, then can be pressed", async () => {
    const gate = held(records());
    const scene = await dropdownScene([gate.reply], editBook("Brandon Sanderson"));
    expect(scene.unlink.disabled).toBe(true);
    gate.release();
    await settle();
    expect(scene.unlink.disabled).toBe(false);
  });

  test("draws the question in the window's body, with focus on the answer that keeps the link", async () => {
    const scene = await windowScene([]);
    scene.press();
    const veil = scene.veil() as El;
    expect(veil.parent).toBe(scene.body);
    const lines = veil.querySelectorAll("p");
    expect(lines.map((line) => [line.className, line.textContent])).toEqual([
      ["window__leaving-lead", UNLINKING.lead],
      ["window__leaving-detail", UNLINKING.detail],
    ]);
    const keep = veil.querySelector(UNSAVED_LEAVING_BACK_SELECTOR) as El;
    const go = veil.querySelector(UNSAVED_LEAVING_GO_SELECTOR) as El;
    expect([keep.textContent, keep.className]).toEqual([KEEP_CONNECTED, "btn btn--outline"]);
    expect([go.textContent, go.className]).toEqual([DISCONNECT, "btn btn--danger"]);
    const described = lines.map((line) => line.id).join(" ");
    expect([keep, go].map((button) => button.getAttribute("aria-describedby"))).toEqual([
      described,
      described,
    ]);
    expect(scene.doc.activeElement).toBe(keep);
    const form = scene.body.querySelector("form") as El & { inert?: boolean };
    expect(form.inert).toBe(true);
  });

  test("a second press while it stands asks nothing more", async () => {
    const scene = await windowScene([]);
    scene.press();
    scene.press();
    expect(scene.doc.querySelectorAll(UNSAVED_LEAVING_SELECTOR)).toHaveLength(1);
    expect(scene.doc.activeElement).toBe(
      scene.doc.querySelector(UNSAVED_LEAVING_BACK_SELECTOR) as El,
    );
  });

  test("the answer that keeps the link changes nothing and puts focus back on the broken chain", async () => {
    const scene = await windowScene([]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_BACK_SELECTOR);
    expect(scene.veil()).toBeNull();
    expect(scene.asked).toEqual([]);
    expect(scene.doc.querySelector("[data-linked-field]")).toBe(scene.root);
    expect(scene.doc.activeElement).toBe(scene.unlink);
    expect((scene.body.querySelector("form") as El & { inert?: boolean }).inert).toBe(false);
  });

  test("Escape keeps the link too", async () => {
    const scene = await windowScene([]);
    scene.press();
    scene.doc.fire("keydown", scene.doc.activeElement, { key: "Escape" });
    await settle();
    expect(scene.veil()).toBeNull();
    expect(scene.asked).toEqual([]);
  });
});

const unlinked: Reply = () => new Response(null, { status: 204 });

describe("Disconnect", () => {
  test("posts the press the list read, once", async () => {
    const scene = await windowScene([unlinked]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.veil()).toBeNull();
    expect(scene.asked.map(({ url, method }) => [url, method])).toEqual([[UNLINK_URL, "POST"]]);
    expect(Object.fromEntries(new URLSearchParams(scene.asked[0]?.body))).toEqual(UNLINKING.press);
  });

  test("gives every copy back as the plain text field, holding its text, its chain focused", async () => {
    const gate = held(unlinked);
    const scene = await windowScene([gate.reply]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    // Held still while it is out, the broken chain lets go of focus, as a browser takes it.
    expect(scene.unlink.disabled).toBe(true);
    expect(scene.doc.activeElement).toBe(scene.doc.body);
    gate.release();
    await settle();
    for (const root of copies(scene.doc)) {
      expect(root.querySelector("[data-linked-field]")).toBeNull();
      expect(root.querySelector(`[data-link-url="${LINK_URL}"]`)).not.toBeNull();
    }
    const input = scene.doc.querySelector('input[name="author"]') as El;
    expect(input.getAttribute("type")).toBe("text");
    expect(input.value).toBe("Brandon Sanderson");
    expect(scene.doc.querySelector('input[name="__aluna_link"]')).toBeNull();
    const chain = scene.doc.querySelector(".link-control__button") as El;
    expect(chain.getAttribute("aria-label")).toBe(UNLINKING.connect);
    expect(scene.doc.activeElement).toBe(chain);
    // The Link control takes the chain that came back as one the server drew.
    await scene.doc.arrivals();
    expect(chain.closest("[data-link-control]")?.getAttribute("data-link-chooser-mounted")).toBe(
      "true",
    );
  });

  test("the copy it gives back is the one the server draws for a field that can be connected", async () => {
    const scene = await windowScene([unlinked]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    const drawn = await dropdownScene([], newBook(linkedBooks(undefined, [])));
    const server = drawn.doc.querySelector("[data-link-control]") as El;
    const rebuilt = copies(scene.doc)[1]?.querySelector("[data-link-control]") as El;
    // The page's Link control has already taken it as one the server drew; the drawing has not.
    rebuilt.removeAttribute("data-link-chooser-mounted");
    expect(shape(rebuilt)).toEqual(shape(server));
  });

  test("on the new-record form too, which keeps the name picked in it", async () => {
    const scene = await windowScene([unlinked], newBook());
    scene.type("oct");
    await settle();
    scene.key("Enter");
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    const input = scene.doc.querySelector('input[name="author"]') as El;
    expect(input.closest("[data-link-control]")).not.toBeNull();
    expect(input.value).toBe("Octavia E. Butler");
  });
});

describe("Disconnect while something else is out", () => {
  test("holds the broken chain still while it is out, so a second press asks nothing", async () => {
    const stale = { code: LINK_STALE_CODE, moved: notesRow(), disconnecting: true } as const;
    const gate = held(noticed(stale, 409));
    const scene = await windowScene([gate.reply]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.unlink.disabled).toBe(true);
    scene.press();
    expect(scene.veil()).toBeNull();
    gate.release();
    await settle();
    expect(scene.unlink.disabled).toBe(false);
    expect(scene.doc.activeElement).toBe(scene.unlink);
    expect(scene.asked.map(({ method }) => method)).toEqual(["POST", "GET"]);
  });

  test("is not asked while a write for the field is out, and the bar says so", async () => {
    const scene = await windowScene([]);
    pageOf(scene.doc as never).writing.add(LINK_URL);
    scene.press();
    expect(scene.veil()).toBeNull();
    expect(scene.said.at(-1)).toEqual({ sentence: UNLINK_UNWRITTEN, refused: true });
  });

  test("a yes that finds a write for the field out sends nothing, and the bar says so", async () => {
    const scene = await windowScene([unlinked]);
    scene.press();
    pageOf(scene.doc as never).writing.add(LINK_URL);
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.asked).toEqual([]);
    expect(scene.said.at(-1)).toEqual({ sentence: UNLINK_UNWRITTEN, refused: true });
  });

  test("reads the collection again, so no card keeps a mark for the field", async () => {
    const form = `${newBook()}<div id="books-records"></div>`;
    const scene = await windowScene([unlinked], form);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.asked.map(({ url, method }) => [url, method])).toEqual([
      [UNLINK_URL, "POST"],
      ["/capability/books/read", "GET"],
    ]);
  });

  test("lands focus in the field while names are matched meanwhile, its chain faded", async () => {
    const gate = held(unlinked);
    const scene = await windowScene([gate.reply]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    const release = holdWhileMatching(scene.body.querySelector("form") as never, "…", null);
    gate.release();
    await settle();
    const chain = scene.doc.querySelector(`[data-link-url="${LINK_URL}"] .link-control__button`);
    expect((chain as El).disabled).toBe(true);
    expect(scene.doc.activeElement).toBe(scene.doc.querySelector('input[name="author"]') as El);
    release();
  });

  test("asked as names began to be matched still lands focus in the field", async () => {
    const scene = await windowScene([unlinked]);
    scene.press();
    const release = holdWhileMatching(scene.body.querySelector("form") as never, "…", null);
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.asked.map(({ method }) => method)).toEqual(["POST"]);
    expect(scene.doc.activeElement).toBe(scene.doc.querySelector('input[name="author"]') as El);
    release();
  });

  test("that finds the field unlinked from another tab while it was asked writes nothing", async () => {
    const scene = await windowScene([], undefined, noticed(NOTES_UNLINKED, 422));
    scene.press();
    // A refused save reads the list again, which finds the field holds no relation anymore.
    scene.doc.fire("htmx:afterRequest", scene.body.querySelector("form") as El, {
      detail: { xhr: { status: 422 } },
    });
    await settle();
    expect(scene.doc.querySelector("[data-linked-field]")).toBeNull();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.asked.map(({ method }) => method)).toEqual(["GET"]);
    const chain = scene.doc.querySelector(`[data-link-url="${LINK_URL}"] .link-control__button`);
    expect(scene.doc.activeElement).toBe(chain as El);
  });

  test("that lands after the person moved on leaves focus where they put it", async () => {
    const gate = held(unlinked);
    const scene = await windowScene([gate.reply]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    const title = scene.doc.querySelector('input[name="title"]') as El;
    title.focus();
    gate.release();
    await settle();
    expect(scene.doc.querySelector("[data-linked-field]")).toBeNull();
    expect(scene.doc.activeElement).toBe(title);
  });
});

describe("a Disconnect that did not happen", () => {
  test("says why, keeps the field linked, and reads its list again for the next press", async () => {
    const stale = { code: LINK_STALE_CODE, moved: notesRow(), disconnecting: true } as const;
    const scene = await windowScene([noticed(stale, 409)]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.said.at(-1)).toEqual({ sentence: linkNoticeSentence(stale), refused: true });
    expect(scene.doc.querySelector("[data-linked-field]")).toBe(scene.root);
    expect(scene.asked.map(({ method }) => method)).toEqual(["POST", "GET"]);
  });

  test("a field unlinked already is plain text with the chain its answer names, and says so", async () => {
    const scene = await windowScene([noticed(NOTES_UNLINKED, 422)]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    const sentence = linkNoticeSentence(NOTES_UNLINKED);
    expect(scene.said.at(-1)).toEqual({ sentence, refused: true });
    for (const root of copies(scene.doc)) {
      expect(root.querySelector("[data-linked-field]")).toBeNull();
      const chain = root.querySelector(`[data-link-url="${LINK_URL}"] .link-control__button`);
      expect(chain?.getAttribute("aria-label")).toBe(NOTES_CHAIN);
    }
  });

  test("a relation a build left dormant reads the list again, and the field is plain text", async () => {
    const dormant: LinkNotice = {
      code: FIELD_NOT_LINKED_CODE,
      source: { row: notesRow(), field: "text" },
    };
    const scene = await windowScene([noticed(dormant, 422)], undefined, noticed(dormant, 422));
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.asked.map(({ method }) => method)).toEqual(["POST", "GET"]);
    // The copy whose list was read again.
    const [pressed] = copies(scene.doc) as [El];
    expect(pressed.querySelector("[data-linked-field]")).toBeNull();
    expect(pressed.querySelector(`[data-link-url="${LINK_URL}"]`)).toBeNull();
    expect(pressed.querySelector('input[name="author"]')?.getAttribute("type")).toBe("text");
  });

  test("a refusal with no words says it could not disconnect", async () => {
    const failed: Reply = () => new Response("Internal Server Error", { status: 500 });
    const scene = await windowScene([failed]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.said.at(-1)).toEqual({ sentence: UNLINK_UNWRITTEN, refused: true });
  });

  test("a lost connection says it cannot tell, and leaves the field as it was", async () => {
    const scene = await windowScene([unreachable]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.said.at(-1)).toEqual({ sentence: UNLINK_UNKNOWN, refused: true });
    expect(scene.doc.querySelector("[data-linked-field]")).toBe(scene.root);
  });
});

describe("a Disconnect lost while Aluna connects a field", () => {
  test("gives the broken chain back faded, until the names are matched", async () => {
    const gate = held(unreachable);
    const scene = await windowScene([gate.reply]);
    scene.press();
    await scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    const release = holdWhileMatching(scene.body.querySelector("form") as never, "…", null);
    gate.release();
    await settle();
    expect(scene.unlink.disabled).toBe(true);
    release();
    expect(scene.unlink.disabled).toBe(false);
  });
});

describe("unlinked from another tab", () => {
  test("a list read that finds the field unlinked gives every copy its chain back", async () => {
    const scene = await windowScene([], undefined, noticed(NOTES_UNLINKED, 422));
    scene.input.focus();
    scene.type("b");
    await settle();
    // The person was typing in the field, and the field is still where focus is.
    expect(scene.doc.activeElement).toBe(scene.doc.querySelector('input[name="author"]') as El);
    for (const root of copies(scene.doc)) {
      expect(root.querySelector("[data-linked-field]")).toBeNull();
      const chain = root.querySelector(`[data-link-url="${LINK_URL}"] .link-control__button`);
      expect(chain?.getAttribute("aria-label")).toBe(NOTES_CHAIN);
    }
  });
});

describe("while this page links the field", () => {
  test("a read that finds no relation yet is read again once the press lets go, and opens", async () => {
    let first = true;
    const reads: Reply = (exchange) => {
      const reply = first ? noticed(NOTES_UNLINKED, 422) : records();
      first = false;
      return reply(exchange);
    };
    const scene = await windowScene([], undefined, reads);
    const { writing } = pageOf(scene.doc as never);
    writing.add(LINK_URL);
    scene.type("b");
    await settle();
    // A read asked for meanwhile, as a refused save asks, waits on the same one.
    scene.doc.fire("htmx:afterRequest", scene.body.querySelector("form") as El, {
      detail: { xhr: { status: 422 } },
    });
    await settle();
    expect(scene.asked.map(({ method }) => method)).toEqual(["GET"]);
    expect(scene.doc.querySelector("[data-linked-field]")).toBe(scene.root);
    writing.delete(LINK_URL);
    await settle();
    expect(scene.asked.map(({ method }) => method)).toEqual(["GET", "GET"]);
    expect(scene.doc.querySelector("[data-linked-field]")).toBe(scene.root);
    expect(scene.panel.hidden).toBe(false);
    expect(scene.said).toEqual([]);
  });
});

describe("while Aluna connects a field", () => {
  test("a dropdown first read meanwhile fades its broken chain, and gets it back after", async () => {
    const gate = held(records());
    const scene = await dropdownScene([gate.reply], editBook("Brandon Sanderson"));
    const release = holdWhileMatching(scene.root.closest("form") as never, "…", null);
    gate.release();
    await settle();
    expect(scene.unlink.disabled).toBe(true);
    release();
    expect(scene.unlink.disabled).toBe(false);
  });

  test("the broken chain fades with Save and Delete, and comes back after", async () => {
    const scene = await windowScene([]);
    const release = holdWhileMatching(scene.body.querySelector("form") as never, "…", null);
    await scene.doc.arrivals();
    const fading = scene.doc.querySelector(".linked-field__unlink") as El;
    expect(fading.disabled).toBe(true);
    release();
    expect(fading.disabled).toBe(false);
  });
});
