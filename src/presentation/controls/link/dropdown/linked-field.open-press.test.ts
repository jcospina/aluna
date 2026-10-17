// A press on the open icon inside a linked field, run through the shipped
// `public/controls/linked-field.js`: a plain press asks the desk for the record the way a pressed
// name in an answer does, any other press is the browser's, and neither leaves the field changed or
// its list open. The desk's half is `the-open-icon-opens-its-record.desk.test.ts`.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { FIELD_UNLINKED_EVENT } from "#shell/controls/link-control.js";
import { noticeIn } from "#shell/controls/link-notices.js";
import { OPEN_ELSEWHERE, OPEN_UNREAD } from "#shell/controls/open/open-linked-record.js";
import { recordAddress } from "#shell/core/routes.js";
import { RECORD_NOT_THERE } from "#shell/desk/desk-address.js";
import { PROMPT_NOTICE_ID } from "#shell/desk/prompt-bar.js";
import { linkNoticeSentence } from "../../../../lifecycle/link/presentation.ts";
import { READ_UNAVAILABLE_FRAGMENT } from "../../../../runtime/router/index.ts";
import type { El } from "../../double/choice-picker.test-support.ts";
import { failed, held, installLinkGlobals, settle } from "../link-control.test-support.ts";
import {
  dropdownScene,
  editBook,
  linkedBooks,
  NAMES,
  records,
} from "./linked-field.test-support.ts";
import {
  at,
  authors,
  deskAnswering,
  iconOf,
  idOf,
  NOT_LINKED_NOTICE,
  notLinked,
  pointing,
  press,
  pressOn,
  TARGET,
} from "./open-icon.test-support.ts";

installLinkGlobals();

const LE_GUIN = "Ursula K. Le Guin";
const leGuinsBook = () => editBook(LE_GUIN, linkedBooks(), idOf(LE_GUIN));

/** The pick route refusing while a deletion closes a capability, as it answers then. */
const unavailable = () => new Response(READ_UNAVAILABLE_FRAGMENT, { status: 409 });

describe("a plain press", () => {
  test("asks the desk for the record and keeps the browser from following the address", async () => {
    const scene = await dropdownScene([authors()], leGuinsBook());
    for (const outcome of ["opened", "held"]) {
      const asked = deskAnswering(scene, outcome);
      expect(press(scene), outcome).toBe(true);
      expect(asked, outcome).toEqual([{ capability: TARGET, record: idOf(LE_GUIN) }]);
    }
  });

  test("keeps the focus in the field, so leaving it never changes what the press opens", async () => {
    // An optional field whose search was emptied would be emptied by leaving it, and Safari's
    // press on a link moves the focus off the field without giving it to the link.
    const scene = await dropdownScene([authors(), authors()], leGuinsBook());
    const asked = deskAnswering(scene, "held");
    scene.input.focus();
    scene.type("");
    await settle();
    expect(scene.panel.hidden).toBe(false);
    expect(pressOn(scene, "mousedown")).toBe(true);
    expect(scene.panel.hidden).toBe(true);
    expect(scene.input.value).toBe(LE_GUIN);
    pressOn(scene, "click");
    expect(asked).toEqual([{ capability: TARGET, record: idOf(LE_GUIN) }]);
    expect(scene.carrier.value).toBe(LE_GUIN);
  });

  test("with the focus elsewhere keeps its default, so the icon still drags", async () => {
    const scene = await dropdownScene([authors()], leGuinsBook());
    (scene.doc.querySelector('input[name="title"]') as El).focus();
    expect(pressOn(scene, "mousedown")).toBe(false);
  });

  test("on the broken chain keeps the focus in the field too", async () => {
    const scene = await dropdownScene([authors(), authors()], leGuinsBook());
    scene.input.focus();
    scene.type("");
    await settle();
    expect(pressOn(scene, "mousedown", {}, scene.unlink)).toBe(true);
    expect(scene.panel.hidden).toBe(true);
    expect(scene.carrier.value).toBe(LE_GUIN);
  });

  test("from the keyboard asks for the record, the focus staying on the icon", async () => {
    const scene = await dropdownScene([authors()], leGuinsBook());
    const asked = deskAnswering(scene, "held");
    const icon = iconOf(scene) as El;
    icon.focus();
    expect(pressOn(scene, "click")).toBe(true);
    expect(asked).toEqual([{ capability: TARGET, record: idOf(LE_GUIN) }]);
    expect(scene.doc.activeElement).toBe(icon);
  });

  test("with no pointer, as assistive technology sends one, closes a list left open", async () => {
    const scene = await dropdownScene([authors(), authors()], leGuinsBook());
    const asked = deskAnswering(scene, "opened");
    scene.type("oct");
    await settle();
    expect(scene.panel.hidden).toBe(false);
    expect(pressOn(scene, "click")).toBe(true);
    expect(scene.panel.hidden).toBe(true);
    expect(scene.input.value).toBe(LE_GUIN);
    expect(asked).toHaveLength(1);
  });

  test("that no desk answers is the browser's, which follows the address", async () => {
    const scene = await dropdownScene([authors()], leGuinsBook());
    const asked = deskAnswering(scene);
    expect(press(scene)).toBe(false);
    expect(asked).toHaveLength(1);
    // Nor does a desk that cannot carry the address in its history.
    deskAnswering(scene, null);
    expect(press(scene)).toBe(false);
  });

  test("on an icon that opens nothing asks nothing", async () => {
    const scene = await dropdownScene([authors(), authors()], leGuinsBook());
    scene.input.focus();
    scene.type("");
    await settle();
    scene.key("Tab");
    expect(pointing(scene)).toBeNull();
    const asked = deskAnswering(scene, "opened");
    expect(press(scene)).toBe(false);
    expect(asked).toEqual([]);
  });
});

describe("any other press", () => {
  test("held, is the browser's own and asks nothing, and still closes the list", async () => {
    const scene = await dropdownScene([authors(), authors()], leGuinsBook());
    const asked = deskAnswering(scene, "opened");
    for (const more of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      scene.type("oct");
      await settle();
      expect(scene.panel.hidden, JSON.stringify(more)).toBe(false);
      pressOn(scene, "mousedown", more);
      expect(scene.panel.hidden, JSON.stringify(more)).toBe(true);
      expect(pressOn(scene, "click", more), JSON.stringify(more)).toBe(false);
    }
    expect(asked).toEqual([]);
  });

  test("by the middle button is the browser's own, and still closes the list", async () => {
    const scene = await dropdownScene([authors(), authors()], leGuinsBook());
    const asked = deskAnswering(scene, "opened");
    scene.input.focus();
    scene.type("oct");
    await settle();
    // A middle press keeps its default, which opens the address in a new tab.
    expect(pressOn(scene, "mousedown", { button: 1 })).toBe(false);
    expect(scene.panel.hidden).toBe(true);
    for (const button of [1, 2]) {
      expect(pressOn(scene, "click", { button }), `button ${button}`).toBe(false);
    }
    expect(asked).toEqual([]);
  });
});

describe("a press into a capability the desk has no window for", () => {
  test("whose link is gone reads the field's list again, then says what the list said", async () => {
    const scene = await dropdownScene([authors(), notLinked], leGuinsBook());
    deskAnswering(scene, "gone");
    (iconOf(scene) as El).focus();
    expect(press(scene)).toBe(true);
    expect(scene.doc.activeElement).toBe(scene.input);
    // Hidden while the list is read, so a second press cannot ask again meanwhile.
    expect(pointing(scene)).toBeNull();
    await settle();
    expect(scene.asked).toHaveLength(2);
    const sentence = linkNoticeSentence(NOT_LINKED_NOTICE as never);
    expect(sentence).not.toBe("");
    expect(scene.said).toEqual([{ sentence, refused: true }]);
    expect(iconOf(scene)).toBeNull();
    expect(scene.doc.querySelector('input[name="author"]')?.value).toBe(LE_GUIN);
  });

  test("that this desk was drawn before says a new tab opens it, and the icon comes back", async () => {
    // A capability built in another tab is on no desk drawn before it, and its field still links it.
    const scene = await dropdownScene([authors(), authors(), authors()], leGuinsBook());
    const asked = deskAnswering(scene, "gone");
    expect(press(scene)).toBe(true);
    await settle();
    expect(asked).toEqual([{ capability: TARGET, record: idOf(LE_GUIN) }]);
    expect(scene.said).toEqual([{ sentence: OPEN_ELSEWHERE, refused: true }]);
    expect(OPEN_ELSEWHERE).not.toBe("");
    expect(pointing(scene)).toEqual(at(LE_GUIN));
    // A read is no new tab, so the next one leaves the sentence standing.
    (scene.doc.getElementById(PROMPT_NOTICE_ID) as El).textContent = OPEN_ELSEWHERE;
    scene.key("ArrowDown");
    await settle();
    expect(scene.said).toHaveLength(1);
  });

  test("tells by the list, not by a pick made while it is read, and holds the icon till then", async () => {
    const slow = held(authors());
    const scene = await dropdownScene([authors(), slow.reply], leGuinsBook());
    const asked = deskAnswering(scene, "gone");
    press(scene);
    scene.type("brandon");
    await settle();
    scene.key("Enter");
    expect(scene.carrier.value).toBe("Brandon Sanderson");
    expect(pointing(scene)).toBeNull();
    expect(press(scene)).toBe(false);
    slow.release();
    await settle();
    expect(asked).toHaveLength(1);
    expect(scene.said).toEqual([{ sentence: OPEN_ELSEWHERE, refused: true }]);
    expect(pointing(scene)).toEqual(at("Brandon Sanderson"));
  });

  test("whose record the list no longer holds says it is not there", async () => {
    const others = NAMES.filter((name) => name !== LE_GUIN);
    const scene = await dropdownScene([authors(), authors(others)], leGuinsBook());
    deskAnswering(scene, "gone");
    press(scene);
    await settle();
    expect(scene.said).toEqual([{ sentence: RECORD_NOT_THERE, refused: true }]);
    expect(pointing(scene)).toBeNull();
    expect(scene.line.hidden).toBe(false);
  });

  test("whose name another record now holds says the one pressed is not there", async () => {
    // Deleted, and a record of the same name made since: the text names the new one.
    const scene = await dropdownScene(
      [authors(), records(NAMES, () => randomUUID())],
      editBook(LE_GUIN, linkedBooks()),
    );
    deskAnswering(scene, "gone");
    press(scene);
    await settle();
    expect(scene.said).toEqual([{ sentence: RECORD_NOT_THERE, refused: true }]);
    expect(pointing(scene)?.href).not.toBe(at(LE_GUIN).href);
  });
});

describe("while the field reads why a press went nowhere", () => {
  test("a field drawn plain meanwhile says the record is not there", async () => {
    // Unlinked from another copy of the field while the list was out.
    const slow = held(authors());
    const scene = await dropdownScene([authors(), slow.reply], leGuinsBook());
    deskAnswering(scene, "gone");
    press(scene);
    scene.doc.fire(FIELD_UNLINKED_EVENT, scene.root);
    slow.release();
    await settle();
    expect(scene.doc.querySelector("[data-linked-field]")).toBeNull();
    expect(scene.said).toEqual([{ sentence: RECORD_NOT_THERE, refused: true }]);
  });

  test("from a form that left the page while the list was read says nothing", async () => {
    // A read that fails, since the double cannot draw a list into a form off the page.
    const scene = await dropdownScene([authors(), failed], leGuinsBook());
    deskAnswering(scene, "gone");
    press(scene);
    (scene.root.closest("form") as El).remove();
    await settle();
    expect(scene.said).toEqual([]);
  });

  test("says what a later read takes back, once the bar still shows it", async () => {
    const scene = await dropdownScene([authors(), failed, authors()], leGuinsBook());
    deskAnswering(scene, "gone");
    press(scene);
    await settle();
    // The bar shows what it was told, as the prompt bar does.
    (scene.doc.getElementById(PROMPT_NOTICE_ID) as El).textContent = OPEN_UNREAD;
    scene.key("ArrowDown");
    await settle();
    expect(scene.said).toEqual([{ sentence: OPEN_UNREAD, refused: true }, { sentence: "" }]);
  });

  test("whose field's list cannot be read says so, and the icon comes back", async () => {
    const scene = await dropdownScene([authors(), failed], leGuinsBook());
    const asked = deskAnswering(scene, "gone");
    press(scene);
    await settle();
    expect(scene.said).toEqual([{ sentence: OPEN_UNREAD, refused: true }]);
    expect(OPEN_UNREAD).not.toBe("");
    expect(asked).toHaveLength(1);
    expect(pointing(scene)).toEqual(at(LE_GUIN));
  });

  test("whose list is refused says the refusal's own words, which a later read takes back", async () => {
    const scene = await dropdownScene([authors(), unavailable, authors()], leGuinsBook());
    deskAnswering(scene, "gone");
    press(scene);
    await settle();
    const sentence = noticeIn(scene.doc as never, READ_UNAVAILABLE_FRAGMENT).sentence;
    expect(sentence).not.toBe("");
    expect(scene.said).toEqual([{ sentence, refused: true }]);
    (scene.doc.getElementById(PROMPT_NOTICE_ID) as El).textContent = sentence;
    scene.key("ArrowDown");
    await settle();
    expect(scene.said).toEqual([{ sentence, refused: true }, { sentence: "" }]);
  });

  test("never passes on a refusal from a read before the press", async () => {
    const scene = await dropdownScene([authors(), unavailable, failed], leGuinsBook());
    scene.key("ArrowDown");
    await settle();
    scene.key("Escape");
    expect(scene.said).toEqual([]);
    deskAnswering(scene, "gone");
    press(scene);
    await settle();
    expect(scene.said).toEqual([{ sentence: OPEN_UNREAD, refused: true }]);
  });

  test("that the field now links elsewhere says the record is not there, its icon pointing anew", async () => {
    // Unlinked and linked to another capability from another tab, since this form was drawn.
    const elsewhere = async (exchange: Parameters<ReturnType<typeof authors>>[0]) => {
      const list = (await (await authors()(exchange)).json()) as Record<string, unknown>;
      return Response.json({ ...list, target: "writers" });
    };
    const scene = await dropdownScene([authors(), elsewhere], leGuinsBook());
    deskAnswering(scene, "gone");
    press(scene);
    await settle();
    expect(scene.said).toEqual([{ sentence: RECORD_NOT_THERE, refused: true }]);
    expect(pointing(scene)?.href).toBe(recordAddress("writers", idOf(LE_GUIN)));
  });

  test("moves the focus into the field when nothing held it, and leaves it where the person put it", async () => {
    const lost = await dropdownScene([authors(), notLinked], leGuinsBook());
    deskAnswering(lost, "gone");
    press(lost);
    expect(lost.doc.activeElement).toBe(lost.input);

    const kept = await dropdownScene([authors(), notLinked], leGuinsBook());
    deskAnswering(kept, "gone");
    const title = kept.doc.querySelector('input[name="title"]') as El;
    title.focus();
    press(kept);
    expect(kept.doc.activeElement).toBe(title);
  });

  test("on a field drawn plain again asks nothing, the icon let go with the rest of it", async () => {
    const scene = await dropdownScene([authors(), notLinked], leGuinsBook());
    const icon = iconOf(scene) as El;
    const asked = deskAnswering(scene, "opened");
    scene.key("ArrowDown");
    await settle();
    expect(iconOf(scene)).toBeNull();
    scene.input.focus();
    expect(pressOn(scene, "mousedown", {}, icon)).toBe(false);
    scene.doc.fire("click", icon, { button: 0 });
    expect(asked).toEqual([]);
  });
});
