import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  BUILD_WINDOW_TITLE,
  NAME_THE_WINDOW_EVENT,
  THINKING_WINDOW_TITLE,
} from "#shell/desk-window.js";

// What the window is called, and who gets to say (M5 plan 1): the desk says `Thinking…` at submit,
// the server names the run once resolution settles it, and an activation renames after the tool.

const ROOT = resolve(import.meta.dir, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("what the window is called while a run has it", () => {
  test("a build takes the window over and says so, remembering the name it took", () => {
    // A window titled after the capability that happens to be open is wrong while a build is
    // making something else, so the desk says `Thinking…` and remembers the name it took over.
    expect(THINKING_WINDOW_TITLE).toBe("Thinking…");
    // A noun, not a gerund: the one case with no earlier name to put back and no
    // capability to be named after is a window a run opened and then failed in.
    expect(BUILD_WINDOW_TITLE).toBe("Aluna");
    const source = code("public/desk-window.js");
    expect(source).toContain("const displaced = mounted?.win.title ?? BUILD_WINDOW_TITLE;");
    expect(source).toContain("nameWindow(THINKING_WINDOW_TITLE, displaced);");
    // And a build that does find a window brings it forward rather than leaving its narration
    // behind the developer panel, which below the breakpoint is out of the page (5.6/04).
    expect(source).toMatch(
      /if \(mounted\) raise\(mounted\);\s*else\s*openWindow\(THINKING_WINDOW_TITLE/,
    );
  });

  test("the run names the window, and the desk is what writes it", () => {
    const source = code("public/desk-window.js");
    // The shell forwards; the desk decides. A name it can use is written, and anything else hands
    // the earlier name back, which is how a run that did not activate returns it.
    expect(NAME_THE_WINDOW_EVENT).toBe("aluna:name-the-window");
    expect(read("public/app.js")).toContain(`NAME_THE_WINDOW_EVENT = "${NAME_THE_WINDOW_EVENT}"`);
    expect(read("public/app.js")).toContain(
      'BUILD_WINDOW_TITLE_ATTRIBUTE = "data-build-window-title"',
    );
    expect(read("src/server/http/fragments.ts")).toContain(
      'BUILD_WINDOW_TITLE_ATTRIBUTE = "data-build-window-title"',
    );
    expect(source).toMatch(
      /if \(typeof title === "string" && title !== ""\) nameWindow\(title\);\s*else releaseWindowName\(\);/,
    );
    // An activation is the one ending that does not hand a name back: its capability took the
    // window, and the name is read off the ground so the bar and the logo agree.
    expect(source).toContain("mounted.win.setTitle(logoTitle(logo));");
    expect(source).toMatch(/releaseWindowName\(\) \{[\s\S]{0,240}mounted\.displacedTitle = null;/);
  });
});
