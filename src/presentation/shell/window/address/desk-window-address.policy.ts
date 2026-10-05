import { describe, expect, test } from "bun:test";
import {
  codeOf as code,
  flat,
  readSource as read,
  under,
} from "../../../safety/source.test-support.ts";

// The address, and the whole of what it may say: `/capability/:id` and, below it, a record id and
// nothing else. A search term and a draft die with the tab (design D14; ADR-0010).

const MODULE = code("public/desk/window/desk-window.js");
/** The address and the history it is written into, lifted out of the module above. */
const ADDRESS = code("public/desk/desk-address.js");
const PANEL = code("public/desk/window/desk-dev-panel.js");
/** Where a card press opens a record and the record view's ways out leave it. */
const RECORD_VIEW = code("public/records/record-view.js");

/** Every script the shell ships, its vendored libraries aside. */
const SHELL = under("public", "**/*.js").filter((path) => !path.includes("/vendor/"));

describe("who moves the address", () => {
  test("history is written in one place, and only ever with an address", () => {
    // Two verbs, one call each, in the module that owns the address, so nothing but an address has
    // anywhere to be written. `app.js` puts a neutral restoration back on `/` and the logo's
    // deletion applies `HX-Replace-Url`, both keeping the entry's own state.
    expect(ADDRESS.match(/history\.pushState/g)).toHaveLength(1);
    expect(ADDRESS.match(/history\.replaceState/g)).toHaveLength(1);
    expect(MODULE).not.toContain("history.pushState");
    expect(MODULE).not.toContain("history.replaceState");
    expect(MODULE).not.toContain("window.history");
    expect(ADDRESS).not.toContain("window.history");
    const writers = (verb: RegExp) => SHELL.filter((path) => verb.test(code(path)));
    expect(writers(/history\.pushState/)).toEqual(["public/desk/desk-address.js"]);
    expect(writers(/history\.(go|back|forward)\b/)).toEqual(["public/desk/desk-address.js"]);
    expect(writers(/history\.replaceState\(/).sort()).toEqual([
      "public/app.js",
      "public/desk/desk-address.js",
      "public/desk/logos/capability-deletion.js",
    ]);
  });

  test("a press writes the record's address, spelled by the one function that spells it", () => {
    // The record view reaches history only through the address module, and what it pushes is a
    // capability and a record id: the search the collection stood under is not passed.
    expect(RECORD_VIEW).not.toContain("history.");
    expect(RECORD_VIEW.match(/pushAddress\(/g)).toHaveLength(1);
    expect(RECORD_VIEW).toMatch(/pushAddress\(recordAddress\(/);
  });

  test("below capability identity, a record id and nothing else: no search term, no draft", () => {
    // The two storage keys and the Builder's restoration descriptor are, beside the address, the
    // places something could survive the tab, and none may carry a search term or a draft.
    // Two records, one per allowed window, and no third (design D9). Read off every key the whole
    // shell names, so a third key added anywhere in `public/` is what fails this.
    const shellKeys = new Set(
      under("public", "**/*.js")
        .flatMap((path) => [...code(path).matchAll(/"aluna\.desk\.[^"]+"/g)])
        .map((match) => match[0]),
    );
    expect([...shellKeys].sort()).toEqual(['"aluna.desk.dev.v1"', '"aluna.desk.window.v1"']);

    // An entry carries the desk's mark and its place in the run, and nothing else: what the entry
    // before names is kept in the page, never written down with the record's address.
    expect(ADDRESS.match(/history\.(push|replace)State\(entryState\(\), "", next\)/g)).toHaveLength(
      2,
    );
    expect(flat(ADDRESS)).toContain(
      "function entryState() { return { ...DESK_HISTORY_STATE, index: addressIndex }; }",
    );

    // And no write names a key inline: every one goes through `savePresentation`, which
    // is handed one of the two constants above.
    expect(MODULE + PANEL).not.toMatch(/setItem\(\s*"/);

    // The descriptor stays capability-only, even now the address names a record: a build that
    // displaced one gives back the collection (PLAN decision 44).
    const descriptor = read("src/pipeline/jobs/restoration.ts");
    expect(descriptor).toContain("readonly capabilityId: string;");
    expect(descriptor).toContain("readonly incarnationId: string;");
    for (const below of ["search", "record", "draft", "query"]) {
      expect(descriptor).not.toContain(`readonly ${below}`);
    }
  });
});
