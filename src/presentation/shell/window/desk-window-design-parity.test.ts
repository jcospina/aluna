import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// One record rule, kept by the two surfaces that keep a window: the product's desk and the
// handbook's demo of it (design D9; PLAN decision 18). Asked of both files at once.

const ROOT = resolve(import.meta.dir, "../../../..");
const code = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/** Where a window is remembered — its own module since M5 plan 1. */
const STORE = code("public/desk-window-store.js");

describe("what a remembered box is, asked in one place", () => {
  test("the design page's desk keeps the same record rule the product does", () => {
    // `design/scripts/desk.js` is the other surface that remembers a window. It used to write the
    // desk-filled box and the box to restore to: a second geometry in the one entry.
    const deskScript = code("design/scripts/desk.js");
    expect(deskScript).toMatch(
      /function record\(box\) \{\s*const \{ x, y, w, h \} = box\.restore \?\? box;/,
    );
    expect(deskScript).toContain("this.layout.window === null ? null : record(this.layout.window)");
    expect(deskScript).not.toContain("JSON.stringify(this.layout)");
    // A window nobody has moved has no preference to keep, so the record holds nothing until one
    // is authored: the product's `{ box: null }`, in the shape this surface keeps its layout in.
    expect(deskScript).toContain(
      'this.#mount("capability", "", this.layout.window ?? this.#defaultWindow())',
    );
    // And a box the desk chose is not one the user asked for: only a finished gesture and the leaf
    // lamp promote it, the way the product writes from `onEnd`, the lamp and the phone crossing.
    expect(deskScript).toMatch(
      /#author\(entry\) \{\s*if \(entry\.kind === "capability"\) this\.layout\.window = entry\.box;\s*this\.#save\(\);/,
    );
    expect(deskScript).toContain("onEnd: () => this.#author(entry)");
    // And the dismissal rule is the same: the clay lamp ends the window and the box ends with it,
    // while a close nobody asked for, such as a cancelled build, leaves the record alone.
    expect(deskScript).toMatch(
      /dismiss\(\) \{[\s\S]*?this\.layout\.window = null;\s*this\.#save\(\);/,
    );
    expect(deskScript).toMatch(/action === "putaway"\)[\s\S]{0,120}else this\.dismiss\(\);/);
    const close = /\n {2}close\(\) \{([\s\S]*?)\n {2}\}/.exec(deskScript)?.[1] ?? "";
    expect(close, "no `close`").not.toBe("");
    expect(close).not.toContain("#save");
    // The record carries no box to give back, so the mount is where that comes from.
    expect(deskScript).toMatch(/setMaximised\(el, box, maximised\);\s*this\.#refit\(/);
    // And its key is its own: the handbook is served from the product's origin, so an
    // unqualified `aluna.desk.*` would sit beside the product's two looking like a third.
    expect(deskScript).toContain('STORAGE_KEY = "aluna.design.desk.layout.v2"');
    expect(STORE).toContain('WINDOW_STORAGE_KEY = "aluna.desk.window.v1"');
  });
});
