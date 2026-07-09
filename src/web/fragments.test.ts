import { describe, expect, test } from "bun:test";

import { renderDetailModal } from "../presentation/detail-modal.ts";
import { renderCapabilityCommitSwap, renderRehydratedShell } from "./fragments.ts";

// The shell's detail-modal mount placeholder (public/index.html) — where every rendered
// shell mounts the one shared read-only detail modal. Kept in sync with fragments.ts.
const MODAL_PLACEHOLDER = "    <!-- Shared detail modal mounts here. -->";

// A minimal stand-in for the shell file: the anchors the shell composition keys off —
// the toolbar placeholder comment (with its 8-space indent), the detail-modal placeholder,
// and the `class="shell"` root — wrapped in just enough markup to be inspectable.
const SHELL_FIXTURE = [
  '<div class="shell" x-data="shell">',
  '  <nav class="toolbar" id="capability-toolbar">',
  "        <!-- Capability entries render here later. -->",
  "  </nav>",
  '  <div class="intro__output" id="spec-build-output"></div>',
  "</div>",
  MODAL_PLACEHOLDER,
].join("\n");

function countMatches(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

interface OobInspection {
  readonly entryCount: number;
  readonly entryInsideOobCount: number;
  readonly oobCount: number;
  readonly oobIsCapabilityEntry: boolean;
  readonly oobValue: string | null;
}

async function inspectToolbarOob(fragment: string): Promise<OobInspection> {
  const insideOobStack: boolean[] = [];
  let entryCount = 0;
  let entryInsideOobCount = 0;
  let oobCount = 0;
  let oobIsCapabilityEntry = false;
  let oobValue: string | null = null;

  const rewriter = new HTMLRewriter()
    .on("*", {
      element(element) {
        const hasOob = element.getAttribute("hx-swap-oob") !== null;
        const insideOob = hasOob || insideOobStack.includes(true);

        if (hasOob) {
          oobCount += 1;
          oobValue = element.getAttribute("hx-swap-oob");
        }

        if (element.canHaveContent) {
          insideOobStack.push(insideOob);
          element.onEndTag(() => {
            insideOobStack.pop();
          });
        }
      },
    })
    .on("[data-capability-entry]", {
      element(element) {
        entryCount += 1;
        entryInsideOobCount += insideOobStack.includes(true) ? 1 : 0;
        oobIsCapabilityEntry ||= element.getAttribute("hx-swap-oob") !== null;
      },
    });

  await new Response(rewriter.transform(new Response(fragment)).body).text();
  return { entryCount, entryInsideOobCount, oobCount, oobIsCapabilityEntry, oobValue };
}

describe("web fragments", () => {
  test("commit-time toolbar OOB wraps the canonical entry for htmx beforeend insertion", async () => {
    const fragment = renderCapabilityCommitSwap(
      { id: "notes", label: "Notes" },
      '<section class="capability-collection"><div id="notes-records" hx-get="/capability/notes/read"></div></section>',
    );

    expect(await inspectToolbarOob(fragment)).toEqual({
      entryCount: 1,
      entryInsideOobCount: 1,
      oobCount: 1,
      oobIsCapabilityEntry: false,
      oobValue: "beforeend:#capability-toolbar",
    });
    expect(fragment).toContain("data-capability-toolbar-oob");
    expect(fragment).toContain("data-capability-entry");
  });
});

describe("on-load toolbar rehydration", () => {
  test("an empty registry adds no entries and keeps cold-start — but still mounts the modal", () => {
    const html = renderRehydratedShell([], SHELL_FIXTURE);

    // Cold-start means no capabilities, never no modal: the shared detail modal is
    // data-free platform chrome (ADR-0004) and mounts even here, so the FIRST capability a
    // fresh user builds can open it without a page refresh (the commit swap adds content +
    // a toolbar entry, not the modal). Otherwise the page stays cold-start: no toolbar
    // entries, and the shell does not flip into its has-capabilities state.
    expect(html).toContain(renderDetailModal());
    expect(html).not.toContain(MODAL_PLACEHOLDER); // placeholder consumed by the injection
    expect(html).not.toContain("data-capability-entry");
    expect(html).not.toContain("has-capabilities");
  });

  test("registry rows render one canonical entry each and flip has-capabilities", () => {
    const html = renderRehydratedShell(
      [
        { id: "notes", label: "Notes" },
        { id: "recipes", label: "Recipes" },
      ],
      SHELL_FIXTURE,
    );

    // The shell flips into has-capabilities so the sidebar shows.
    expect(html).toContain('class="shell has-capabilities"');

    // One canonical toolbar entry per row — the same renderer the commit-time OOB path
    // uses — each pointing at the cached-view route a click serves.
    expect(countMatches(html, "data-capability-entry")).toBe(2);
    expect(html).toContain('hx-get="/capability/notes"');
    expect(html).toContain('hx-get="/capability/recipes"');
    expect(html).toContain("Notes");
    expect(html).toContain("Recipes");

    // Entries render in the order the registry hands them over (notes before recipes).
    expect(html.indexOf("/capability/notes")).toBeLessThan(html.indexOf("/capability/recipes"));

    // The placeholder anchor stays put — entries are inserted after it, not replacing it.
    expect(html).toContain("<!-- Capability entries render here later. -->");

    // The load path restores chrome only: the content area is never pre-populated with
    // a capability view (a click serves it, ADR-0004).
    expect(html).not.toContain("capability-surface");

    // The one shared detail modal mounts here too, so a rehydrated capability list is
    // clickable-into once the read path emits wrapper items (3.4).
    expect(html).toContain(renderDetailModal());
  });

  test("throws when the shell is missing its toolbar placeholder", () => {
    // The fixture carries the modal placeholder (so modal injection passes) but not the
    // toolbar one, isolating the toolbar-placeholder guard.
    expect(() =>
      renderRehydratedShell(
        [{ id: "notes", label: "Notes" }],
        `<div class="shell"></div>\n${MODAL_PLACEHOLDER}`,
      ),
    ).toThrow(/toolbar placeholder/i);
  });

  test("throws when the shell is missing its detail-modal placeholder", () => {
    // Symmetric fail-fast: a shell that silently dropped the modal (and with it every
    // item's click-to-open) is caught here, not in the UI.
    expect(() =>
      renderRehydratedShell(
        [{ id: "notes", label: "Notes" }],
        '<div class="shell"><!-- Capability entries render here later. --></div>',
      ),
    ).toThrow(/detail-modal placeholder/i);
  });
});
