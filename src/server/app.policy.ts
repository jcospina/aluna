import { describe, expect, test } from "bun:test";
import { WINDOW_CONTENT_ID } from "#shell/core/shell-dom.js";
import { codeOf, readSource, under } from "../presentation/safety/source.test-support.ts";

// The shell's files as they ship: the names, routes and rules retired from the page, the glue and
// the stream's sheet stay retired. `app.test.ts` runs the page and the routes.

describe("GET / (shell)", () => {
  test("the old greeting, the rail's readouts and the modal are gone from the page", () => {
    const html = readSource("public/index.html");
    expect(html).not.toContain("@htmx:sseOpen.window");
    expect(html).not.toContain("@htmx:sseClose.window");
    expect(html).not.toContain("@htmx:sseError.window");
    expect(html).not.toContain('class="devbar"');
    expect(html).not.toContain('id="spec-metrics-preview"');
    expect(html).not.toContain('id="spec-gate-preview"');
    expect(html).not.toContain("panel-toggle");
    expect(html).not.toContain("Meet Aluna");
    expect(html).not.toContain('id="intro-trigger"');
    expect(html).not.toContain('id="intro-output"');
    expect(html).not.toContain("detail-modal");
  });
});

describe("GET / (shell) — browser glue", () => {
  test("the glue's retired names and routes stay retired", () => {
    const js = readSource("public/app.js");
    const html = readSource("public/index.html");

    // The window has no refresh verb, so the glue has no hand-rebuilt read: the restoration's own
    // View read is kept alive by promoting before releasing (PLAN decision 15; ARCH §8).
    expect(js).not.toContain("reloadRestoredRecords");
    expect(js).not.toContain('.ajax("GET"');
    expect(js).not.toContain('removeAttribute("hx-trigger")');
    // The address is the desk's to write: the glue reports what happened and never pushes.
    expect(js).not.toContain("history.pushState");
    expect(js).not.toContain("dataset.previewTarget");
    // The repeated-value rows are a module of their own now (public/controls/list-field.js), so
    // the glue neither owns them nor knows they exist.
    expect(js).not.toContain("collapseListFieldRows");
    expect(js).not.toContain("data-list-field");
    // Recovering a severed capability deletion is its own module (`public/desk/logos/capability-deletion.js`)
    // and took its half of `htmx:configRequest` with it; the glue captures only a prompt's.
    expect(js).not.toContain("focusCapabilityDeletion");
    expect(js).not.toContain("[data-capability-deletion-focus]");
    expect(js).not.toContain("restore_surface");
    // The rail and the gate it hid behind are gone from the page and from the glue.
    expect(js).not.toContain("hasCapabilities");
    expect(html).not.toContain("has-capabilities");
    expect(html).not.toContain('id="capability-toolbar"');
    expect(html).toContain('id="capability-logos"');
    expect(js).not.toContain("new EventSource");
    expect(js).not.toContain('fetch("/prompt"');
    expect(js).not.toContain('addEventListener("submit"');
  });
});

test("keeps a pending stream dormant until foreground narration begins", () => {
  const css = readSource("public/css/demo.css");

  expect(css).toMatch(/\.build-stream\s*\{[^}]*display:\s*none/s);
  expect(css).toContain(".build-stream__narration:not(:empty)");
  const hidden = [...css.matchAll(/#([\w-]+):has\(> \.build-stream/g)].map(([, id]) => id);
  expect(hidden.length).toBeGreaterThan(0);
  expect(new Set(hidden)).toEqual(new Set([WINDOW_CONTENT_ID]));

  // The shell's own content area is gone with the window: a window that holds nothing does not
  // exist, so every rule that kept a surface quiet until it did is retired rather than ported.
  expect(css).not.toContain(".content__active");
  expect(css).not.toContain(".intro__output");
  expect(css).not.toMatch(/:has\([^)]*:has\(/);
});

test("the deletion's retired neutral marker is styled nowhere", () => {
  // Recovering a severed deletion is `public/desk/logos/capability-deletion.js`'s, run in
  // `app.shell-glue.test.ts`; the stylesheet keeps no hook for the marker it replaced.
  expect(readSource("public/css/demo.css")).not.toContain("data-capability-deletion-neutral");
});

test("the vendored SSE extension is the htmx SSE extension", () => {
  // It registers itself on htmx at load; `app.test.ts` proves the page serves it byte for byte.
  expect(readSource("public/vendor/htmx-ext-sse.min.js")).toContain('defineExtension("sse"');
});

test("the server names the window's content region through the one constant", () => {
  // `public/core/shell-dom.js` owns the id; a copy spelled out in a renderer drifts the day it moves.
  const copies = under("src", "**/*.ts")
    .filter((path) => !/\.(?:test|policy)\.ts$|\.test-support\.ts$/.test(path))
    .filter((path) => codeOf(path).includes(WINDOW_CONTENT_ID));
  expect(copies).toEqual([]);
});
