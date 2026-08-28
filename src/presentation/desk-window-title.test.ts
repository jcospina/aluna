import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  BUILD_WINDOW_TITLE,
  NAME_THE_WINDOW_EVENT,
  THINKING_WINDOW_TITLE,
} from "#shell/desk-window.js";

// What the window is called, and who gets to say (M5 plan 1).
//
// The title is information rather than decoration. A window named after the capability
// that happens to be open is actively wrong while a build is making something *else*, and
// a gerund is wrong once the run has stopped — so the name moves through three hands: the
// desk says `Thinking…` at submit, the server names the run the moment resolution settles
// what it is, and an activation renames the window after the capability that took it.
//
// The rules themselves read module state (`mounted`), so what is asserted here is the
// contract across the seam: the words, the event both sides spell, and the branch each
// side takes. What the shell *does* with a name is run against a DOM double in
// `src/app/app.build-ending.test.ts`.

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("what the window is called while a run has it", () => {
  test("a build takes the window over and says so, remembering the name it took", () => {
    // The title is information. A window titled after the capability that happens to be
    // open is actively wrong while a build is making something else, so the desk says
    // `Thinking…` at submit — its own word, before there is anything else to say — and
    // remembers the name it took over, because a run that does not activate owes it back.
    expect(THINKING_WINDOW_TITLE).toBe("Thinking…");
    // A noun, not a gerund: the one case with no earlier name to put back and no
    // capability to be named after is a window a run opened and then failed in.
    expect(BUILD_WINDOW_TITLE).toBe("Aluna");
    const source = code("public/desk-window.js");
    expect(source).toContain("const displaced = mounted?.win.title ?? BUILD_WINDOW_TITLE;");
    expect(source).toContain("nameWindow(THINKING_WINDOW_TITLE, displaced);");
    // And a build that *does* find a window brings it forward rather than leaving its
    // narration behind the developer panel — which below the breakpoint means leaving
    // it out of the page entirely (5.6/04).
    expect(source).toMatch(
      /if \(mounted\) raise\(mounted\);\s*else\s*openWindow\(THINKING_WINDOW_TITLE/,
    );
  });

  test("the run names the window, and the desk is what writes it", () => {
    const source = code("public/desk-window.js");
    // The shell forwards; the desk decides. A name it can use is written; anything else —
    // which is how a run that did not activate says *put back what you were called* —
    // hands the earlier name back.
    expect(NAME_THE_WINDOW_EVENT).toBe("aluna:name-the-window");
    expect(read("public/app.js")).toContain(`NAME_THE_WINDOW_EVENT = "${NAME_THE_WINDOW_EVENT}"`);
    expect(read("public/app.js")).toContain(
      'BUILD_WINDOW_TITLE_ATTRIBUTE = "data-build-window-title"',
    );
    expect(read("src/web/fragments.ts")).toContain(
      'BUILD_WINDOW_TITLE_ATTRIBUTE = "data-build-window-title"',
    );
    expect(source).toMatch(
      /if \(typeof title === "string" && title !== ""\) nameWindow\(title\);\s*else releaseWindowName\(\);/,
    );
    // An activation is the one ending that does not hand a name back: its capability took
    // the window, so the window is called after it — read off the ground, so the title bar
    // and the logo can only ever say the same thing.
    expect(source).toContain("mounted.win.setTitle(logoTitle(logo));");
    expect(source).toMatch(/releaseWindowName\(\) \{[\s\S]{0,240}mounted\.displacedTitle = null;/);
  });
});
