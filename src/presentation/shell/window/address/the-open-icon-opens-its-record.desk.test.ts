// The open icon in a linked field, pressed on the desk as the page starts it: its press takes the
// record address's own path, as a name pressed in an answer does. The icon here is the shipped
// `RecordOpener` on a record's form, pointed by hand: the desk's double runs no dropdown, so what
// the icon points at is `linked-field.open.test.ts`, and the list it closes and the read after a
// capability left the desk are `linked-field.open-press.test.ts`.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { OPENER, RecordOpener } from "#shell/controls/open/open-linked-record.js";
import { recordAddress } from "#shell/core/routes.js";
import { backOutOfLeaving, goAheadAndLeave } from "#shell/desk/leaving-a-run.js";
import { UNSAVED_LEAVING_SELECTOR } from "#shell/desk/leaving-unsaved-changes.js";
import { startUnsavedChanges } from "#shell/records/unsaved-changes.js";
import type { El } from "../standing-desk.test-support.ts";
import { deskNodes } from "../viewport-desk.test-support.ts";
import { deskAnswering, restoreDesk, settled } from "./record-address-desk.test-support.ts";

afterEach(restoreDesk);

const SOURCE = randomUUID();
const TARGET = randomUUID();

/** The desk open on a Notes record whose form holds an icon pointed at a record of `capability`. */
async function iconDesk(endings: readonly number[], capability = "recipes") {
  const desk = await deskAnswering(recordAddress("notes", SOURCE), endings);
  const form = () => desk.desk.windows()[0]?.querySelector("form") as El;
  const [anchor] = deskNodes(OPENER) as El[];
  form().append(anchor as El);
  // The desk's double keeps its document on the page rather than on each node.
  Object.defineProperty(anchor, "ownerDocument", { value: desk.desk.doc });
  const gone: string[] = [];
  const answers = {
    pressed: () => {},
    gone: (asked: { capability: string }) => void gone.push(asked.capability),
  };
  const opener = new RecordOpener(anchor as never, new AbortController().signal, answers);
  opener.point({ capability, record: TARGET, name: "Fig jam" });
  const press = async (type: string, more: Record<string, unknown> = {}) => {
    const allowed = anchor?.dispatchEvent({ type, target: anchor, button: 0, ...more });
    await settled();
    return allowed;
  };
  const field = () => desk.desk.windows()[0]?.querySelector('[name="text"]') as El;
  const edit = () => {
    startUnsavedChanges(desk.desk.doc as never);
    const left = field();
    left.dispatchEvent({ type: "focusin", target: left } as never);
    (left as El & { value: string }).value = "Buy plums";
    return left;
  };
  return { ...desk, anchor: anchor as El, gone, press, field, edit };
}

describe("a plain press on the icon", () => {
  test("opens the target's record in the window, retitled for its capability, in one entry", async () => {
    const desk = await iconDesk([200, 200]);
    expect(desk.title()).toBe("Notes");
    expect(await desk.press("click")).toBe(false);
    expect(desk.written()).toEqual([`push ${recordAddress("recipes", TARGET)}`]);
    expect(desk.asked()).toEqual([
      recordAddress("notes", SOURCE),
      recordAddress("recipes", TARGET),
    ]);
    expect(desk.title()).toBe("Recipes");
    expect(desk.desk.windows()[0]?.querySelector("[data-record-view]")).not.toBeNull();
    expect(desk.desk.doc.activeElement).toBe(desk.field());
  });

  test("and Back returns to the record it was pressed on", async () => {
    const desk = await iconDesk([200, 200, 200]);
    await desk.press("click");
    await desk.travelTo(recordAddress("notes", SOURCE));
    expect(desk.asked().at(-1)).toBe(recordAddress("notes", SOURCE));
    expect(desk.title()).toBe("Notes");
  });

  test("over unsaved changes, asks first, and a yes opens the target's record", async () => {
    const desk = await iconDesk([200, 200]);
    desk.edit();
    expect(await desk.press("click")).toBe(false);
    expect(desk.desk.windows()[0]?.querySelector(UNSAVED_LEAVING_SELECTOR)).not.toBeNull();
    expect(desk.written()).toEqual([]);
    goAheadAndLeave(desk.desk.doc as never);
    await settled();
    expect(desk.written()).toEqual([`push ${recordAddress("recipes", TARGET)}`]);
    expect(desk.title()).toBe("Recipes");
  });

  test("over unsaved changes, keeps them when the person stays", async () => {
    const desk = await iconDesk([200]);
    const left = desk.edit();
    await desk.press("click");
    backOutOfLeaving();
    await settled();
    expect(desk.written()).toEqual([]);
    expect(desk.title()).toBe("Notes");
    expect((left as El & { value: string }).value).toBe("Buy plums");
  });

  test("into a capability not on the desk, leaves the desk alone and asks the field why", async () => {
    const desk = await iconDesk([200], "ghosts");
    expect(await desk.press("click")).toBe(false);
    expect(desk.written()).toEqual([]);
    expect(desk.asked()).toEqual([recordAddress("notes", SOURCE)]);
    expect(desk.gone).toEqual(["ghosts"]);
    expect(desk.anchor.hidden).toBe(true);
  });
});

describe("any other press on the icon", () => {
  test("is the browser's own, and the desk is asked nothing", async () => {
    const desk = await iconDesk([200]);
    const held = [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }];
    for (const more of held) {
      expect(await desk.press("click", more), JSON.stringify(more)).toBe(true);
    }
    for (const button of [1, 2]) {
      expect(await desk.press("click", { button }), `button ${button}`).toBe(true);
    }
    expect(desk.written()).toEqual([]);
    expect(desk.asked()).toEqual([recordAddress("notes", SOURCE)]);
  });
});
