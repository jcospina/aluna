import { describe, expect, test } from "bun:test";
import { PHONE } from "#design/desk/desk-geometry.js";
import { readSource as read, rules, under } from "../../../safety/source.test-support.ts";

// Below the breakpoint the window is the screen (PLAN decisions 47 and 48; design D9), held where
// it is declared: the query the script reads, the rules it leans on, and the two widths sheets
// may break on. `desk-window-phone.test.ts` runs what the script does when told.

describe("below the breakpoint the window is the screen, and the script is told so", () => {
  test("the breakpoint the script reads is the one the stylesheet breaks on", () => {
    expect(rules("design/styles/components/desk.css")).toContain(`@media ${PHONE}`);
  });
});

describe("what a window may do below the breakpoint", () => {
  test("the title bar claims a touch only while it is draggable", () => {
    // Left on a phone, the browser hands every touch starting on the title bar to a drag that
    // stands itself down, so the rule lives on the class the script takes off there.
    const draggable = /\.window__bar--draggable\s*\{([^}]*)\}/.exec(
      rules("design/styles/components/desk.css"),
    )?.[1];
    expect(draggable, "no `.window__bar--draggable` rule").toBeDefined();
    expect(draggable).toMatch(/touch-action:\s*none/);
  });

  test("a hidden lamp stays hidden: `.lamp` declares no `display` of its own", () => {
    expect(rules("design/styles/components/window.css")).not.toMatch(/\.lamp\s*\{[^}]*display:/);
  });

  test("the corner grip is not reachable by pointer on a phone either", () => {
    expect(rules("design/styles/components/desk.css")).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.window__grip \{\s*display: none;/,
    );
  });
});

describe("the desk breaks at 720px and forms at 620px", () => {
  /** Every stylesheet the product's own page loads, read off disk rather than listed. */
  const SHEETS = under("public/css", "**/*.css").sort();

  test("the sweep looks at every sheet the shell imports, not a list that can go stale", () => {
    // A literal list is a sweep that stops sweeping the day someone adds a file.
    const entry = read("public/css/app.css");
    for (const sheet of SHEETS) {
      if (sheet === "public/css/app.css") continue;
      expect(entry, `${sheet} is not imported by app.css`).toContain(
        `"${sheet.replace("public/css/", "")}"`,
      );
    }
    expect(SHEETS.length).toBeGreaterThan(8);
  });

  test("every media query on the shipped surface is one of those two numbers", () => {
    // The built app's 768 and 480 were derived for the sidebar-and-modal layout being deleted, as
    // was the 639.98 beside them. Two numbers now, both the design's.
    for (const path of SHEETS) {
      for (const [, width] of rules(path).matchAll(
        /@media[^{]*?(?:max|min)-width:\s*([\d.]+)px/g,
      )) {
        expect([path, width]).toEqual([path, expect.stringMatching(/^(720|620)$/)]);
      }
    }
  });

  test("the design's own two are the same two, and its other queries never reach the desk", () => {
    expect(rules("design/styles/components/desk.css")).toContain("@media (max-width: 720px)");
    expect(rules("design/styles/components/controls/form-controls.css")).toContain(
      "@media (max-width: 620px)",
    );

    // `layout.css` and `doc.css` ship with the token layer and carry 900px and 760px, which is
    // the handbook's own document furniture and not a third breakpoint on the desk.
    const shell = read("public/index.html") + read("src/server/http/fragments/fragments.ts");
    for (const selector of ["cols", "numbers", "gallery"]) {
      expect(shell, `the shell renders \`.${selector}\``).not.toMatch(
        new RegExp(`class="[^"]*\\b${selector}\\b`),
      );
    }
  });

  test("the surfaces that carried a retired breakpoint now carry a live one", () => {
    // Named individually, because a sweep dropping a rule would satisfy the query test above.
    // Below the breakpoint the window is the screen, so the one behind is taken out of the page.
    expect(rules("design/styles/components/desk.css")).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.window--desk\.is-unfocused \{\s*display: none;/,
    );
    // The modal's own three width rules left with the modal. A record fills the window it opened
    // in, so no shipped sheet sizes a record against the screen.
    for (const path of SHEETS) {
      for (const [query] of rules(path).matchAll(/@media[^{]*\{[^@]*?\}/gs)) {
        expect(query, `${path} sizes the record against the viewport`).not.toContain(
          "capability-record-view",
        );
      }
    }
  });

  test("what is inside the window asks the window, not the screen behind it", () => {
    // The window is resized to any width on a viewport of any width, so a rule inside it that
    // asks the viewport is asking the wrong box: a 276px window on 1920px kept the 1920px layout.
    expect(rules("public/css/shell.css")).toMatch(
      /\.desk-window__region \{[^}]*container: window \/ inline-size/,
    );
    expect(rules("public/css/collection.css")).toMatch(
      /@container window \(max-width: 620px\) \{\s*\.capability-collection__header \{/,
    );
    expect(rules("public/css/deletion.css")).toMatch(
      /@container window \(max-width: 620px\) \{\s*\.capability-deletion \{/,
    );
  });

  test("only what the viewport really decides is left on a viewport query", () => {
    // What is left on a viewport query is genuinely the screen's: the phone form and the
    // panel that floats over the whole page.
    const inWindow = ["capability-collection__header", "capability-deletion"];
    for (const path of SHEETS) {
      for (const [query] of rules(path).matchAll(/@media[^{]*\{[^@]*?\}/gs)) {
        for (const selector of inWindow) {
          expect(query, `${path} still asks the viewport about .${selector}`).not.toContain(
            selector,
          );
        }
      }
    }
  });

  test("the phone still gets the prompt bar's strip reserved under the window's list", () => {
    // Below the breakpoint the stylesheet places the window and the geometry that stops
    // one above the bar is overridden, so the strip is reserved again as content.
    expect(rules("public/css/shell.css")).toMatch(
      /@media \(max-width: 720px\) \{\s*\.desk-window__region::after \{[^}]*height: var\(--prompt-clearance\);/,
    );
  });
});
