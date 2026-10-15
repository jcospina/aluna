// The chooser behind the chain, run through the shipped `public/controls/link-control.js` on the
// markup the renderer writes, with the platform's own panel and notices standing in for the server.
// What it owes beyond the picker it extends: a panel read whole each time it opens, a pick that is a
// write rather than a value, a refusal spoken on the prompt bar, and every copy of a linked field
// left in the wrapper its dropdown is drawn in, as the server draws a linked field.

import { describe, expect, test } from "bun:test";
import {
  CHOOSER_UNREAD,
  mountLinkChoosers,
  PICK_UNKNOWN,
  PICK_UNWRITTEN,
} from "#shell/controls/link-control.js";
import { capabilityLinkUrl } from "#shell/core/routes.js";
import { CREATE_CANCELLED_EVENT, RECORD_CREATED_EVENT } from "#shell/core/shell-dom.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/desk/prompt-bar.js";
import { linkNoticeSentence } from "../../../lifecycle/link/presentation.ts";
import { elementsOf, moduleSources } from "../../../server/http/served-page.test-support.ts";
import { renderCreateForm, renderEditForm } from "../../fields/field-renderer.ts";
import { readSource } from "../../safety/source.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";
import { startedOn } from "../double/started-module.test-support.ts";
import {
  AUTHOR,
  bookCapability,
  cutOff,
  deskWithTemplate,
  failed,
  held,
  installLinkGlobals,
  linkScene,
  listed,
  NAMES,
  noticed,
  openScene,
  REFUSED,
  SHELF,
  STALE,
  settle,
  TITLE,
  unreachable,
  written,
} from "./link-control.test-support.ts";
import { CHOOSER_EMPTY } from "./link-copy.ts";

installLinkGlobals();

const LINK_URL = capabilityLinkUrl("books", AUTHOR.name);
const refusal = (sentence: string) => ({ sentence, refused: true });
const WITHDRAWN = { sentence: "" };

describe("the shipped page runs the client against what the server writes", () => {
  test("the shell loads it as a module, and it starts itself on the document it finds", async () => {
    expect(moduleSources(await elementsOf(readSource("public/index.html")))).toContain(
      "/static/controls/link-control.js",
    );
    const scene = await linkScene([listed()], "");
    const doc = new Doc();
    parseHtml(renderCreateForm(bookCapability()), doc);
    await startedOn("controls/link-control.js", doc);
    doc.fire("click", doc.querySelector(".link-control__button") as El);
    await settle();
    expect(scene.exchanges).toHaveLength(1);
  });

  test("a form that arrives later is mounted on arrival, and mounting twice mounts nothing", async () => {
    const scene = await linkScene([listed()], "");
    parseHtml(renderCreateForm(bookCapability()), scene.doc);
    await scene.doc.arrivals();
    const button = scene.doc.querySelector(".link-control__button") as El;
    await scene.press(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(mountLinkChoosers(scene.doc as never, new Set())).toEqual([]);
  });
});

describe("opening reads the panel", () => {
  test("it asks under the list's own id, puts the panel in, and opens on the first option", async () => {
    const scene = await openScene();
    expect(scene.exchanges).toEqual([
      { url: `${LINK_URL}?for=${scene.input.id}-link-list`, method: "GET", body: "" },
    ]);
    expect(scene.button.getAttribute("aria-controls")).toBe(scene.scroll().id);
    expect(scene.options().map((option) => option.getAttribute("data-value"))).toEqual([
      `${NAMES.capabilityId}.${NAMES.field.name}`,
      `${SHELF.capabilityId}.${SHELF.field.name}`,
    ]);
    expect(scene.panel.hidden).toBe(false);
    expect(scene.button.getAttribute("aria-expanded")).toBe("true");
    expect(scene.button.getAttribute("aria-activedescendant")).toBe((scene.options()[0] as El).id);
    expect([scene.head() === null, scene.line() === null, scene.empty()]).toEqual([
      false,
      false,
      null,
    ]);
  });

  test("End opens it onto the last option of the list just read", async () => {
    const scene = await linkScene([listed()]);
    await scene.key("End", scene.button);
    const last = scene.options().at(-1) as El;
    expect(scene.button.getAttribute("aria-activedescendant")).toBe(last.id);
    expect(last.id).not.toBe((scene.options()[0] as El).id);
  });

  test("nothing to pick opens an empty listbox with the empty sentence and no line", async () => {
    const scene = await linkScene([listed({ groups: [] })]);
    await scene.press(scene.button);
    expect(scene.button.getAttribute("aria-expanded")).toBe("true");
    expect(scene.options()).toEqual([]);
    expect(scene.scroll().getAttribute("role")).toBe("listbox");
    expect(scene.scroll().hidden).toBe(false);
    expect(scene.line()).toBeNull();
    expect(scene.empty()?.textContent).toBe(CHOOSER_EMPTY);
  });

  test("the empty sentence is put in a turn after the panel shows, so a reader hears it", async () => {
    const scene = await linkScene([listed({ groups: [] })]);
    const realTimeout = globalThis.setTimeout;
    const later: (() => void)[] = [];
    globalThis.setTimeout = ((run: () => void) => later.push(run)) as unknown as typeof setTimeout;
    try {
      scene.doc.fire("click", scene.button);
      for (let turn = 0; turn < 20 && scene.panel.hidden; turn += 1) {
        await new Promise((resolve) => realTimeout(resolve, 0));
      }
    } finally {
      globalThis.setTimeout = realTimeout;
    }
    expect(scene.panel.hidden).toBe(false);
    expect(scene.empty()?.textContent).toBe("");
    for (const run of later) run();
    expect(scene.empty()?.textContent).toBe(CHOOSER_EMPTY);
  });

  test("every opening reads a fresh panel: a filled list replaces the empty one, scrolled home", async () => {
    const scene = await linkScene([listed({ groups: [] }), listed()]);
    await scene.press(scene.button);
    const first = scene.scroll();
    first.scrollTop = 100;
    await scene.press(scene.button);
    expect(scene.panel.hidden).toBe(true);
    await scene.press(scene.button);
    expect(scene.exchanges).toHaveLength(2);
    expect(scene.options()).toHaveLength(2);
    expect(scene.scroll()).not.toBe(first);
    expect(scene.scroll().scrollTop).toBe(0);
    expect(scene.line()).not.toBeNull();
    expect(scene.empty()).toBeNull();
  });

  test("the keyboard opens it too, reading first", async () => {
    const scene = await linkScene([listed()]);
    await scene.key("Enter", scene.button);
    expect(scene.exchanges).toHaveLength(1);
    expect(scene.panel.hidden).toBe(false);
  });

  test("a second press while the read is in flight starts no second read", async () => {
    const read = held(listed());
    const scene = await linkScene([read.reply, listed()]);
    await scene.press(scene.button);
    await scene.press(scene.button);
    expect(scene.exchanges).toHaveLength(1);
    read.release();
    await settle();
    expect(scene.panel.hidden).toBe(false);
  });

  test("a chooser swapped away while its panel was read does not open", async () => {
    const read = held(listed());
    const scene = await linkScene([read.reply]);
    await scene.press(scene.button);
    // A node taken out of the page keeps its document in a browser; the double's forgets it.
    Object.defineProperty(scene.root, "ownerDocument", { value: scene.doc });
    scene.root.remove();
    read.release();
    await settle();
    expect(scene.panel.hidden).toBe(true);
    expect(scene.button.getAttribute("aria-expanded")).toBe("false");
    expect(scene.said).toEqual([]);
  });
});

describe("a read in flight is let go", () => {
  const letGo: Record<string, (scene: Awaited<ReturnType<typeof linkScene>>) => void> = {
    "Escape on the chain": (scene) => scene.doc.fire("keydown", scene.button, { key: "Escape" }),
    "Tab on the chain": (scene) => scene.doc.fire("keydown", scene.button, { key: "Tab" }),
    "a press outside": (scene) =>
      scene.doc.fire("pointerdown", scene.doc.querySelector("form") as El),
    "a press in the field's own input": (scene) => scene.doc.fire("pointerdown", scene.input),
    "the form being saved": (scene) => scene.doc.fire(RECORD_CREATED_EVENT, scene.input),
    "the form being put down": (scene) => scene.doc.fire(CREATE_CANCELLED_EVENT, scene.input),
  };

  for (const [how, act] of Object.entries(letGo)) {
    test(`by ${how}: the panel does not open when it lands, and the next press reads again`, async () => {
      const read = held(listed());
      const scene = await linkScene([read.reply, listed()]);
      await scene.press(scene.button);
      act(scene);
      read.release();
      await settle();
      expect(scene.panel.hidden).toBe(true);
      expect(scene.button.getAttribute("aria-expanded")).toBe("false");
      await scene.press(scene.button);
      expect(scene.exchanges).toHaveLength(2);
      expect(scene.panel.hidden).toBe(false);
    });
  }

  test("pressed again before the read it let go of lands, it opens on that read", async () => {
    const read = held(listed());
    const scene = await linkScene([read.reply]);
    await scene.press(scene.button);
    scene.doc.fire("keydown", scene.button, { key: "Escape" });
    await scene.press(scene.button);
    read.release();
    await settle();
    expect(scene.exchanges).toHaveLength(1);
    expect(scene.panel.hidden).toBe(false);
  });

  test("a read it let go of that fails says nothing: nobody is waiting for it", async () => {
    const read = held(unreachable);
    const scene = await linkScene([read.reply]);
    await scene.press(scene.button);
    scene.doc.fire("keydown", scene.button, { key: "Escape" });
    read.release();
    await settle();
    expect(scene.said).toEqual([]);
  });

  test("but not by a press inside its own panel, nor by another form finishing", async () => {
    const read = held(listed());
    const scene = await linkScene([read.reply], deskWithTemplate([AUTHOR]));
    const other = parseHtml(renderEditForm(bookCapability([TITLE]), { id: "b" }), scene.doc);
    await scene.press(scene.button);
    scene.doc.fire("pointerdown", scene.panel);
    scene.doc.fire(RECORD_CREATED_EVENT, other.querySelector("#edit-books-title") as El);
    read.release();
    await settle();
    expect(scene.panel.hidden).toBe(false);
  });
});

describe("a refusal is said, never shown raw", () => {
  test("a refused read says the notice's sentence and nothing opens", async () => {
    const scene = await linkScene([noticed(STALE, 409)]);
    await scene.press(scene.button);
    expect(scene.said).toEqual([refusal(linkNoticeSentence(STALE))]);
    expect(scene.panel.hidden).toBe(true);
    expect(scene.button.getAttribute("aria-expanded")).toBe("false");
  });

  test.each([
    ["a lost connection", unreachable],
    ["a body cut off", cutOff(200)],
    ["a failure with no notice", failed],
  ])("opening on %s says the chooser could not be read, and nothing opens", async (_, reply) => {
    const scene = await linkScene([reply]);
    await scene.press(scene.button);
    expect(scene.said).toEqual([refusal(CHOOSER_UNREAD)]);
    expect(scene.panel.hidden).toBe(true);
  });

  test("a pick on a lost connection says it cannot tell whether it connected", async () => {
    const scene = await openScene([unreachable]);
    await scene.press(scene.options()[0] as El);
    expect(scene.said).toEqual([refusal(PICK_UNKNOWN)]);
    expect(scene.root.isConnected).toBe(true);
  });

  test("a refused pick with no notice says it was not connected", async () => {
    const scene = await openScene([failed]);
    await scene.press(scene.options()[0] as El);
    expect(scene.said).toEqual([refusal(PICK_UNWRITTEN)]);
  });

  test("a refused pick whose body is cut off says it was not written, and keeps the chain", async () => {
    const scene = await openScene([cutOff(422)]);
    await scene.press(scene.options()[0] as El);
    expect(scene.said).toEqual([refusal(PICK_UNWRITTEN)]);
    expect(scene.root.isConnected).toBe(true);
  });

  test.each([
    [409, STALE],
    [422, REFUSED],
  ] as const)("a pick refused with a %d says the notice, and the chain stays", async (status, notice) => {
    const scene = await openScene([noticed(notice, status)]);
    await scene.press(scene.options()[0] as El);
    expect(scene.said).toEqual([refusal(linkNoticeSentence(notice))]);
    expect(scene.button.isConnected).toBe(true);
    expect(scene.root.isConnected).toBe(true);
    expect(scene.panel.hidden).toBe(true);
  });
});

describe("a refusal is taken back once a retry works", () => {
  test("after a read that lands", async () => {
    const scene = await linkScene([noticed(STALE, 409), listed()]);
    await scene.press(scene.button);
    await scene.press(scene.button);
    expect(scene.said).toEqual([refusal(linkNoticeSentence(STALE)), WITHDRAWN]);
  });

  test("after a write that lands", async () => {
    const page = renderCreateForm(bookCapability([AUTHOR, TITLE]));
    const scene = await linkScene([listed(), listed(), noticed(REFUSED, 422), written], page);
    const title = scene.chooserOf("cap-books-title");
    await scene.key("Enter", title.button);
    await scene.key("Enter", scene.button);
    await scene.key("Enter", scene.button);
    expect(scene.said).toEqual([refusal(linkNoticeSentence(REFUSED))]);
    await scene.key("Enter", title.button);
    expect(scene.exchanges.map((exchange) => exchange.method)).toEqual([
      "GET",
      "GET",
      "POST",
      "POST",
    ]);
    expect(scene.said).toEqual([refusal(linkNoticeSentence(REFUSED)), WITHDRAWN]);
  });

  test("but not when something else was said on the bar since", async () => {
    const scene = await linkScene([noticed(STALE, 409), listed()]);
    await scene.press(scene.button);
    const elsewhere = new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, {
      detail: { sentence: "Something the desk said since." },
    });
    scene.doc.dispatchEvent(elsewhere);
    await scene.press(scene.button);
    expect(scene.panel.hidden).toBe(false);
    expect(scene.said).toEqual([
      refusal(linkNoticeSentence(STALE)),
      { sentence: "Something the desk said since." },
    ]);
  });

  test("nor when the bar's slot was filled some other way since, as an out-of-band swap does", async () => {
    const scene = await linkScene([noticed(STALE, 409), listed()]);
    await scene.press(scene.button);
    scene.notice.textContent = "I deleted Reading Log permanently.";
    await scene.press(scene.button);
    expect(scene.panel.hidden).toBe(false);
    expect(scene.said).toEqual([refusal(linkNoticeSentence(STALE))]);
    expect(scene.notice.textContent).toBe("I deleted Reading Log permanently.");
  });

  test("and nothing is taken back when nothing was refused", async () => {
    const scene = await openScene([written]);
    await scene.press(scene.options()[0] as El);
    expect(scene.said).toEqual([]);
  });
});

describe("a pick writes the relation", () => {
  test("pressing an option posts its press to the field's own address", async () => {
    const scene = await openScene([written]);
    await scene.press(scene.options()[1] as El);
    expect(scene.exchanges[1]).toEqual({
      url: LINK_URL,
      method: "POST",
      body: SHELF.press.toString(),
    });
  });

  test("Enter on the active option posts that one", async () => {
    const scene = await openScene([written]);
    await scene.key("ArrowDown", scene.button);
    await scene.key("Enter", scene.button);
    expect(scene.exchanges[1]?.body).toBe(SHELF.press.toString());
  });
});

describe("what closes it", () => {
  test("a press in the field's own input closes it, and a press in its panel does not", async () => {
    const scene = await openScene();
    scene.doc.fire("pointerdown", scene.options()[0] as El);
    expect(scene.panel.hidden).toBe(false);
    scene.doc.fire("pointerdown", scene.head() as El);
    expect(scene.panel.hidden).toBe(false);
    scene.doc.fire("pointerdown", scene.input);
    expect(scene.panel.hidden).toBe(true);
    expect(scene.button.getAttribute("aria-expanded")).toBe("false");
  });

  test("Escape closes it and gives the button the focus back", async () => {
    const scene = await openScene();
    await scene.key("Escape", scene.button);
    expect(scene.panel.hidden).toBe(true);
    expect(scene.doc.activeElement).toBe(scene.button);
    expect(scene.exchanges).toHaveLength(1);
  });
});
