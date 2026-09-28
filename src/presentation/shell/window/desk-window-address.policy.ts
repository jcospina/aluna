import { describe, expect, test } from "bun:test";
import { codeOf as code, readSource as read, under } from "../../safety/source.test-support.ts";

// The address, and the whole of what it may say: `/capability/:id` and nothing below it. A search
// term, an open record and a draft die with the tab (design D14; PLAN decision 6; ARCH §6.1).

const MODULE = code("public/desk-window.js");
/** The address and the history it is written into, lifted out of the module above. */
const ADDRESS = code("public/desk-address.js");
const PANEL = code("public/desk-dev-panel.js");

describe("who moves the address", () => {
  test("history is written in one place, and only ever with an address", () => {
    // Two verbs, one call each, in the module that owns the address, so nothing below capability
    // identity has anywhere to be written. (`app.js` still applies `HX-Replace-Url`.)
    expect(ADDRESS.match(/history\.pushState/g)).toHaveLength(1);
    expect(ADDRESS.match(/history\.replaceState/g)).toHaveLength(1);
    expect(MODULE).not.toContain("history.pushState");
    expect(MODULE).not.toContain("history.replaceState");
    expect(MODULE).not.toContain("window.history");
    expect(ADDRESS).not.toContain("window.history");
  });

  test("nothing below capability identity is written down anywhere", () => {
    // The two storage keys and the Builder's restoration descriptor are, beside the address, the
    // places something could survive the tab, and none may carry a search term or a draft.
    // Two records, one per allowed window, and no third (design D9). Read off every key the whole
    // shell names, so a third key added anywhere in `public/` is what fails this.
    const shellKeys = new Set(
      under("public", "*.js")
        .flatMap((path) => [...code(path).matchAll(/"aluna\.desk\.[^"]+"/g)])
        .map((match) => match[0]),
    );
    expect([...shellKeys].sort()).toEqual(['"aluna.desk.dev.v1"', '"aluna.desk.window.v1"']);

    // And no write names a key inline: every one goes through `savePresentation`, which
    // is handed one of the two constants above.
    expect(MODULE + PANEL).not.toMatch(/setItem\(\s*"/);
    const descriptor = read("src/pipeline/jobs/restoration.ts");
    expect(descriptor).toContain("readonly capabilityId: string;");
    expect(descriptor).toContain("readonly incarnationId: string;");
    for (const below of ["search", "record", "draft", "query"]) {
      expect(descriptor).not.toContain(`readonly ${below}`);
    }
  });
});
