import { describe, expect, test } from "bun:test";
import { codeOf as code } from "../safety/source.test-support.ts";

// Leaving a live build or evolution warns first, and confirming ends it once (PLAN decision 17).
// `leaving-a-run.test.ts` proves the ending; this holds the module to having only the one.

const MODULE = code("public/leaving-a-run.js");

describe("the one way a run ends", () => {
  test("the story is never detached in silence, and the cancel is reached one way", () => {
    // `remove` is `removeChild` and runs no cleanup, so the SSE extension would hold an open
    // `EventSource` and `htmx:sseClose` would never reach the document.
    expect(MODULE).not.toMatch(/\.remove\(\)/);
    // One cancel route, reached one way. A second `fetch` here would be a second way a
    // run ends, which is the whole thing this module exists to prevent.
    expect(MODULE.match(/fetch\(/g)).toHaveLength(1);
    expect(MODULE.match(/buildCancelUrl\(/g)).toHaveLength(1);
    // Putting the window away ends its run through this module, never a cancel of its own.
    const desk = code("public/desk-window.js");
    expect(desk).not.toContain("cancelBuildIn");
    expect(desk).not.toContain("fetch(");
  });

  test("no draft persistence and no dirty-form tracker came with it", () => {
    // 5.6/03's contract is explicit: search, record subviews and half-typed forms are DOM-only
    // and die with the window. The question is scoped to a running build or an evolution.
    for (const path of ["public/leaving-a-run.js", "public/desk-address.js"]) {
      const source = code(path);
      for (const store of ["localStorage", "sessionStorage", "beforeunload", "onbeforeunload"]) {
        expect(source, `${path} must not reach for ${store}`).not.toContain(store);
      }
    }
  });
});
