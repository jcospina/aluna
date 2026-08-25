import { describe, expect, test } from "bun:test";

import { renderDetailModal } from "../presentation/detail-modal.ts";
import {
  BLANK_PROMPT_NOTICE,
  PAGE_ASSEMBLY_ANCHORS,
  renderCapabilityCommitSwap,
  renderCapabilityShell,
  renderPromptNotice,
  renderRehydratedShell,
} from "./fragments.ts";

// The shell's detail-modal mount placeholder (public/index.html) — where every rendered
// shell mounts the one shared read-only detail modal. Kept in sync with fragments.ts.
const MODAL_PLACEHOLDER = "    <!-- Shared detail modal mounts here. -->";

// The shell's capability-entry placeholder comment, with the 8-space indent the injection
// matches on. Kept in sync with fragments.ts.
const TOOLBAR_PLACEHOLDER = "        <!-- Capability entries render here later. -->";

// A minimal stand-in for the shell file: the anchors the shell composition keys off —
// the toolbar placeholder comment (with its 8-space indent), the detail-modal placeholder,
// and the `class="shell"` root — wrapped in just enough markup to be inspectable.
const SHELL_FIXTURE = [
  '<div class="shell" x-data="shell">',
  '  <nav class="toolbar" id="capability-toolbar">',
  TOOLBAR_PLACEHOLDER,
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
          const value = element.getAttribute("hx-swap-oob");
          if (value?.includes("capability-toolbar")) {
            oobCount += 1;
            oobValue = value;
          }
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

describe("prompt notice", () => {
  // This renderer is the *only* place `#prompt-notice` text is escaped, and the text is
  // not always ours: the deflection path puts the provider's `user_facing_label` through
  // it (`src/pipeline/build/deflection.ts`). Without this case, deleting `escapeHtml`
  // from the renderer leaves the whole suite green — every other notice assertion only
  // checks for the id and swap mode.
  test("escapes interpolated text, so provider-authored copy cannot inject markup", () => {
    expect(renderPromptNotice(`<img src=x onerror=alert(1)> "quoted" & 'single'`)).toBe(
      '<div id="prompt-notice" hx-swap-oob="innerHTML">' +
        "&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot; &amp; &#39;single&#39;" +
        "</div>",
    );
  });

  // The blank-prompt line is product voice under an explicit sign-off gate, so
  // it is pinned as a literal here rather than only compared against itself at the route.
  test("carries the signed-off blank-prompt copy verbatim", () => {
    expect(BLANK_PROMPT_NOTICE).toBe("What would you like me to make?");
    expect(renderPromptNotice(BLANK_PROMPT_NOTICE)).toBe(
      '<div id="prompt-notice" hx-swap-oob="innerHTML">What would you like me to make?</div>',
    );
  });
});

describe("web fragments", () => {
  test("commit-time toolbar OOB wraps the canonical entry for htmx beforeend insertion", async () => {
    const fragment = renderCapabilityCommitSwap(
      {
        id: "notes",
        label: "Notes",
        incarnation_id: "11111111-1111-4111-8111-111111111111",
        version: 1,
      },
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
    expect(fragment).toContain('hx-push-url="/capability/notes"');
    expect(fragment).toContain('hx-get="/capability-deletion/notes"');
    expect(fragment).toContain('aria-label="Permanently delete Notes"');
    expect(fragment).toContain('title="Permanently delete"');
    expect(fragment).toContain("data-capability-delete");
    expect(fragment).toContain(
      'data-active-capability-incarnation="11111111-1111-4111-8111-111111111111"',
    );
    expect(fragment).toContain('data-active-capability-version="1"');
    // The commit swap is the collection scaffolding and its toolbar sidecar — nothing else.
    // The content-area evolution control retired with the demo route.
    expect(fragment).toContain('hx-get="/capability/notes/read"');
    expect(fragment).not.toContain("capability-evolution");
    expect(fragment).not.toContain("/demo/evolution/");
  });

  test("evolution replaces a changed label but emits no toolbar sidecar when unchanged", async () => {
    const evolved = {
      id: "notes",
      label: "Journal",
      incarnation_id: "11111111-1111-4111-8111-111111111111",
      version: 2,
    };
    const collection = '<section class="capability-collection"></section>';

    const changed = renderCapabilityCommitSwap(evolved, collection, "Notes");
    expect(await inspectToolbarOob(changed)).toMatchObject({
      entryCount: 1,
      oobCount: 1,
      oobIsCapabilityEntry: true,
      oobValue: "outerHTML:#capability-toolbar-entry-notes",
    });
    expect(changed).not.toContain("beforeend:#capability-toolbar");
    expect(changed).toContain('aria-label="Permanently delete Journal"');
    expect(changed).not.toContain('aria-label="Permanently delete Notes"');

    const unchanged = renderCapabilityCommitSwap(evolved, collection, "Journal");
    expect(await inspectToolbarOob(unchanged)).toMatchObject({ entryCount: 0, oobCount: 0 });
    expect(unchanged).toContain('data-active-capability-id="notes"');
    expect(unchanged).not.toContain("capability-evolution");
  });
});

describe("on-load toolbar rehydration", () => {
  test("an empty registry adds no entries and keeps cold-start — but still mounts the modal", () => {
    const html = renderRehydratedShell([], SHELL_FIXTURE);

    // Cold-start means no capabilities, never no modal: the shared detail modal is
    // data-free platform chrome and mounts even here, so the FIRST capability a
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
    expect(html).toContain('hx-push-url="/capability/notes"');
    expect(html).toContain('hx-get="/capability/recipes"');
    expect(html).toContain('hx-push-url="/capability/recipes"');
    expect(html).toContain('hx-get="/capability-deletion/notes"');
    expect(html).toContain('hx-get="/capability-deletion/recipes"');
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

  // Every page-assembly anchor, removed one at a time from a shell that is otherwise
  // whole, so each case isolates the anchor it names. The removals come from the same
  // `PAGE_ASSEMBLY_ANCHORS` the developer preview forces, so a test and a preview cannot
  // disagree about what "missing" means for an anchor.
  const anchorRaises: Record<string, RegExp> = {
    "the capability-toolbar placeholder": /toolbar placeholder/i,
    "the detail-modal placeholder": /detail-modal placeholder/i,
    "the content target": /content target/i,
    "the shell root": /root anchor/i,
  };

  test("PAGE_ASSEMBLY_ANCHORS names every anchor the assembly replaces", () => {
    expect(PAGE_ASSEMBLY_ANCHORS.map((anchor) => String(anchor.name))).toEqual(
      Object.keys(anchorRaises),
    );
  });

  for (const anchor of PAGE_ASSEMBLY_ANCHORS) {
    test(`throws when the shell is missing ${anchor.name}`, () => {
      // A shell that silently absorbed a missed anchor serves a page that looks assembled
      // and is not: no entries, no modal, no opened capability, or a sidebar the shell
      // never flips open.
      expect(() =>
        renderCapabilityShell(
          { id: "notes", label: "Notes", incarnation_id: "inc-1", version: 1 },
          [{ id: "notes", label: "Notes" }],
          "<section>Notes</section>",
          anchor.remove(SHELL_FIXTURE),
        ),
      ).toThrow(anchorRaises[anchor.name] as RegExp);
    });
  }

  test("cold start holds the shell to the same anchors it will need on the first commit", () => {
    // An empty registry inserts nothing and never flips the shell, so nothing here would
    // have noticed a lost anchor. That made the loudest failure the one a fresh user was
    // least likely to reach: the page would render, and start failing at the first commit.
    for (const anchor of PAGE_ASSEMBLY_ANCHORS) {
      expect(() => renderRehydratedShell([], anchor.remove(SHELL_FIXTURE))).toThrow(
        anchorRaises[anchor.name] as RegExp,
      );
    }
    expect(() => renderRehydratedShell([], SHELL_FIXTURE)).not.toThrow();
  });
});
