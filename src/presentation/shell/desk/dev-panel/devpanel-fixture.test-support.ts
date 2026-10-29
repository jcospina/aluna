// Payloads and handles for the developer panel's tests, on the double in
// `devpanel-dom.test-support.ts`. Not a test file, so bun never runs it.

import { devPanelBody, writeStage } from "#design/desk/devpanel.js";
import { type FakeElement, FakeEvent } from "./devpanel-dom.test-support.ts";

/** A unit's source as a units payload carries it: code, in a JSON string. */
export const SOURCE =
  'import { list } from "./list";\nexport function read() {\n  return list();\n}\n';
export const unitsWith = (content: string) =>
  JSON.stringify({ status: "complete", units: [{ filename: "read.ts", content }] });
export const UNITS = unitsWith(SOURCE);
/** A fold's path, as the tree keeps it: a step per key or index, each key JSON-quoted. */
export const at = (...steps: (string | number)[]) =>
  steps.map((step) => `/${typeof step === "number" ? step : JSON.stringify(step)}`).join("");
/** Where that source sits in the pretty tree. */
export const CONTENT = at("units", 0, "content");

/** A fresh panel with one stage filed, and the handles a test reaches it by. */
export function panelWith(stage: string, raw: string) {
  const panel = devPanelBody() as unknown as FakeElement;
  writeStage(panel, stage, raw);
  const blockOf = (key: string) =>
    panel.querySelector(`.devpanel__block[data-stage="${key}"]`) as FakeElement;
  const block = blockOf(stage);
  const pre = block.querySelector(".devpanel__pre") as FakeElement;
  // A well with room in it, in a panel that shows all of it, so a press lands on its text.
  panel.box = { left: 0, top: 0, width: 2000, height: 2000 };
  pre.box = { left: 0, top: 0, width: 400, height: 300 };
  const code = block.querySelector(".devpanel__code") as FakeElement;
  const control = (action: string, on = block) =>
    on.querySelector(`[data-devpanel-action="${action}"]`) as FakeElement;
  const node = (path: string) =>
    code.querySelector(`[data-path="${path.replaceAll('"', '\\"')}"]`) as FakeElement;
  const twist = (path: string) => node(path).querySelector(".devpanel__twist") as FakeElement;
  const press = (target: FakeElement) => target.dispatchEvent(new FakeEvent("click"));
  const folded = (path: string) => node(path).classList.contains("is-folded");
  const write = (next: string) => writeStage(panel, stage, next);
  return { panel, blockOf, block, pre, code, control, node, twist, press, folded, write };
}

/** A key pressed on an element, as the panel hears it bubble up. */
export function keyOn(target: FakeElement, key: string, modifiers: Partial<FakeEvent> = {}) {
  const event = new FakeEvent("keydown", { key, ...modifiers });
  target.dispatchEvent(event);
  return event;
}

/**
 * What a pretty well reads as: the two-space indent, with each string that spans lines given its
 * real line breaks between its quotes.
 */
export function opened(value: unknown): string {
  let text = JSON.stringify(value, null, 2);
  const strings = (each: unknown): string[] =>
    typeof each === "string"
      ? [each]
      : each !== null && typeof each === "object"
        ? Object.values(each).flatMap(strings)
        : [];
  for (const one of strings(value).filter((each) => each.includes("\n"))) {
    text = text.replace(JSON.stringify(one), `"${one}"`);
  }
  return text;
}
