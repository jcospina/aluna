import { describe, expect, test } from "bun:test";

import { readSource } from "../safety/source.test-support.ts";
import { COLLECTION_LAYOUTS, collectionLayoutClass, ITEM_TRIGGER_CLASS } from "./list-container.ts";

describe("collection layout — CSS parity", () => {
  // The classes the mapper emits must actually be styled, or a layout renders unstyled.
  const css = readSource("public/css/collection.css");
  /* Selectors, whatever a formatter did to them: comments gone (a comment quoting a
     selector must not answer for one) and every run of whitespace one space. */
  const flatCss = css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");
  const SEARCH_STATES = ["idle", "loading", "results", "no-matches", "error"] as const;

  test("each layout class is defined in collection.css", () => {
    for (const layout of COLLECTION_LAYOUTS) {
      expect(css).toContain(`.${collectionLayoutClass(layout)}`);
    }
  });

  test("the item wrapper and empty state are defined in collection.css", () => {
    expect(css).toContain(`.${ITEM_TRIGGER_CLASS}`);
    expect(css).toContain(".capability-empty");
    expect(css).toContain(".capability-search__input");
    expect(css).toContain(".capability-collection__new");
    expect(css).toContain("justify-content: space-between");
    expect(css).toContain('[data-search-state="no-matches"]');
    expect(css).toContain('[data-search-state="error"]');
  });

  test("a search in any state suppresses the canonical empty state", () => {
    // "Nothing here yet" is what a capability with no records says. Every state but `idle` is a
    // search, and a filtered collection is not a bare one, so none may leave that sentence up.
    for (const state of SEARCH_STATES.filter((s) => s !== "idle")) {
      expect(flatCss, `[${state}] leaves the empty state showing`).toContain(
        `.capability-collection[data-search-state="${state}"] .capability-empty`,
      );
    }
  });

  test("collection-wide search feedback suppresses the canonical empty state", () => {
    expect(flatCss).toContain(
      '.capability-collection[data-search-state="no-matches"] .capability-empty',
    );
    expect(flatCss).toContain(
      '.capability-collection[data-search-state="no-matches"] .capability-search__feedback',
    );
  });

  test("no search-state rule reaches the chrome through a child combinator", () => {
    // The rules above once used `>` and matched nothing: the flag is on the collection and the
    // chrome one level down, which `list-container.test.ts` reads off the parsed render.
    for (const state of SEARCH_STATES) {
      expect(flatCss, `a child combinator under [${state}] matches nothing`).not.toContain(
        `.capability-collection[data-search-state="${state}"] >`,
      );
    }
  });
});
