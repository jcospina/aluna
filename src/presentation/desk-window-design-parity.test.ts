import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// One record rule, kept by the two surfaces that keep a window: the product's desk and
// the handbook's demo of it (design D9; PLAN decision 18). The handbook is the authority
// for the rule, so a demo that behaves differently from the page it stands on is the
// drift these assertions exist to catch — asked of both files at once, in one place.

const ROOT = resolve(import.meta.dir, "../..");
const code = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const MODULE = code("public/desk-window.js");

describe("what a remembered box is, asked in one place", () => {
  test("the design page's desk keeps the same record rule the product does", () => {
    // `design/scripts/desk.js` is the other surface that remembers a window, and D9 and
    // decision 18 are written about it too. It used to write the desk-filled box *and*
    // the box to restore to — a second geometry in the one entry, and a remembered width
    // that belonged to whatever screen the window happened to be maximised on.
    const deskScript = code("design/scripts/desk.js");
    expect(deskScript).toMatch(
      /function record\(box\) \{\s*const \{ x, y, w, h \} = box\.restore \?\? box;/,
    );
    expect(deskScript).toContain("this.layout.window === null ? null : record(this.layout.window)");
    expect(deskScript).not.toContain("JSON.stringify(this.layout)");
    // A window nobody has moved has no preference to keep, so the record holds nothing
    // until one is authored and the box is decided against the desk it opens on — the
    // product's `{ box: null }` said in the shape this surface keeps its layout in.
    expect(deskScript).toContain(
      'this.#mount("capability", "", this.layout.window ?? this.#defaultWindow())',
    );
    // And a box the desk chose is not one the user asked for: only a finished gesture
    // and the leaf lamp promote it into the record, the way the product only ever
    // writes from `onEnd`, the maximise lamp and the phone crossing.
    expect(deskScript).toMatch(
      /#author\(entry\) \{\s*if \(entry\.kind === "capability"\) this\.layout\.window = entry\.box;\s*this\.#save\(\);/,
    );
    expect(deskScript).toContain("onEnd: () => this.#author(entry)");
    // And the dismissal rule is the same one: the clay lamp ends the window and the box
    // ends with it, while a close that nobody asked for — a cancelled build taking its
    // window along — leaves the record alone.
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
    expect(MODULE).toContain('WINDOW_STORAGE_KEY = "aluna.desk.window.v1"');
  });
});
