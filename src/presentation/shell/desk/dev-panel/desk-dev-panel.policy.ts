import { describe, expect, test } from "bun:test";

import { codeOf as code, readSource as read } from "../../../safety/source.test-support.ts";

// The developer panel's rules over its own source and sheet; `desk-dev-panel.test.ts` and
// `desk-dev-panel.desk.test.ts` run what it does.

const PANEL = code("public/desk/window/desk-dev-panel.js");
const BODY = ["devpanel.js", "devpanel-view.js", "devpanel-gestures.js", "devpanel-select.js"]
  .map((name) => code(`design/scripts/desk/${name}`))
  .join("\n");
const FRAGMENTS = read("src/server/http/fragments/fragments.ts");
const DESK_CSS = read("design/styles/components/desk.css");

describe("the tile is the way in, and it is not a capability", () => {
  test("the server never renders the tile: it is furniture, and nothing about it is registry", () => {
    // That the shipped page carries it, with none of a capability's marks, is run on the served
    // page in `desk-dev-panel.desk.test.ts`.
    expect(FRAGMENTS).not.toContain("data-dev-tile");
  });

  test("its mark is composed against the glass rather than centred in it", () => {
    // The CSS hands it the whole face and the coordinates do the placing.
    expect(DESK_CSS).toMatch(/\.logo-tile--dev svg \{[^}]*width: 100%;/);
    expect(DESK_CSS).not.toMatch(/\.logo-tile--dev svg \{[^}]*place-self: center;/);
  });
});

describe("read-only means read-only", () => {
  test("nothing in the panel mutates canonical state", () => {
    // The strongest form available: this file has never heard of a record, a schema or
    // a capability's state, so there is no path from it to any of them.
    for (const canonical of ["fetch(", "XMLHttpRequest", "hx-post", "hx-delete", '"POST"']) {
      expect(PANEL, `the panel reaches for \`${canonical}\``).not.toContain(canonical);
    }
    // Whole words, so the panel's own `recordStage` — which files a payload it was
    // handed — is not mistaken for knowing what a capability's record is.
    for (const noun of ["capability", "records", "schema", "registry", "incarnation"]) {
      expect(PANEL, `the panel knows what a \`${noun}\` is`).not.toMatch(
        new RegExp(`\\b${noun}\\b`, "i"),
      );
    }
  });

  test("the panel is never in the address", () => {
    // `/capability/:id` names a capability and nothing else (ADR-0010). The panel is furniture,
    // so it has no address to be in and closing it pushes nothing.
    for (const address of ["pushState", "replaceState", "location", "history"]) {
      expect(PANEL, `the panel writes \`${address}\``).not.toContain(address);
    }
  });

  test("its controls change how a payload reads, and reach nothing past the panel", () => {
    // Each readout carries the reader's controls over it — fold, pretty or raw, copy — and the
    // clipboard is the one thing outside the panel they write to. Two windows is still not a
    // layout worth managing, so the window adds nothing to press beyond its frame's two lamps.
    for (const reach of [
      "fetch(",
      "XMLHttpRequest",
      "hx-",
      '"POST"',
      "dispatchEvent(",
      "Storage",
    ]) {
      expect(BODY, `a reader's control reaches for \`${reach}\``).not.toContain(reach);
    }
    expect(PANEL).not.toContain('createElement("button")');
    expect(PANEL).not.toContain("btn--");
  });
});

describe("the seam a classic script reaches the panel across", () => {
  test("no listener names the retired preview target", () => {
    // The listeners used to name a `<pre>` in the shell; now each names one of the eight stages.
    expect(FRAGMENTS).not.toContain("data-preview-target");
  });

  test("the tile stands last however the logos arrive", () => {
    // Every logo arriving after first paint is appended to the end of the layer out of band,
    // which left the developer tile stranded mid-grid until the next reload.
    // Where a late logo lands is `fragments.test.ts`'s ("beforeend:#capability-logos").
    expect(DESK_CSS).toMatch(/\.logo--dev \{\s*order: 1;/);
  });
});
