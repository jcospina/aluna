// The open icon's scene, on top of a linked field's: authors whose ids an address can carry, where
// the icon points, and a stand-in desk answering a press. Not a test file.

import { randomUUID } from "node:crypto";
import { openRecordName } from "#design/controls/open-record.js";
import { recordAddress } from "#shell/core/routes.js";
import { OPEN_THE_RECORD_EVENT } from "#shell/desk/desk-address.js";
import { FIELD_NOT_LINKED_CODE } from "../../../../lifecycle/link/presentation.ts";
import { notesRow } from "../../../../runtime/router/dispatch/router.test-support.ts";
import type { El } from "../../double/choice-picker.test-support.ts";
import { noticed } from "../link-control.test-support.ts";
import { AUTHOR_TO_NAME, type dropdownScene, NAMES, records } from "./linked-field.test-support.ts";

/** Every author's id, as the store writes one. */
const IDS = NAMES.map(() => randomUUID());
export const idOf = (name: string) => IDS[NAMES.indexOf(name)] ?? "";

/** The pick route's answer, every author under the id `idOf` gives it. */
export const authors = (names: readonly string[] = NAMES) =>
  records(names, (index) => IDS[NAMES.indexOf(names[index] ?? "")] ?? randomUUID());

export const TARGET = AUTHOR_TO_NAME.to.capability;

/** A field whose link is gone, as the pick route says it, and the refusal that carries it. */
export const NOT_LINKED_NOTICE = {
  code: FIELD_NOT_LINKED_CODE,
  source: { row: notesRow(), field: "text" },
} as const;
export const notLinked = noticed(NOT_LINKED_NOTICE, 422);

export type Scene = Awaited<ReturnType<typeof dropdownScene>>;

export const iconOf = (scene: Scene) => scene.doc.querySelector(".linked-field__open") as El | null;

/** Where the icon points and what it is called, or null while it shows nothing. */
export function pointing(scene: Scene) {
  const icon = iconOf(scene);
  if (icon === null || icon.hidden) return null;
  return { href: icon.getAttribute("href"), name: icon.getAttribute("aria-label") };
}

/** The icon pointed at the author `name`. */
export const at = (name: string) => ({
  href: recordAddress(TARGET, idOf(name)),
  name: openRecordName(name),
});

/** A desk answering every record asked of it with `outcome`, and what it was asked. */
export function deskAnswering(scene: Scene, outcome?: string | null) {
  const asked: unknown[] = [];
  scene.doc.addEventListener(OPEN_THE_RECORD_EVENT, (event: unknown) => {
    const { detail } = event as { detail: Record<string, unknown> };
    asked.push({ capability: detail.capability, record: detail.record });
    if (outcome !== undefined) detail.outcome = outcome;
  });
  return asked;
}

/** A press on `on`, the icon unless named, by the main button and whatever `more` holds. */
export function pressOn(scene: Scene, type: string, more: Record<string, unknown> = {}, on?: El) {
  return scene.doc.fire(type, on ?? (iconOf(scene) as El), { button: 0, ...more }).prevented;
}

/** A whole press on the icon, as a pointer makes one: down, then the click. */
export function press(scene: Scene, more: Record<string, unknown> = {}) {
  pressOn(scene, "mousedown", more);
  return pressOn(scene, "click", more);
}
