import { describe, expect, test } from "bun:test";

import { renderDetailModal } from "../presentation/detail-modal.ts";
import {
  BLANK_PROMPT_NOTICE,
  PAGE_ASSEMBLY_ANCHORS,
  renderCapabilityCommitSwap,
  renderCapabilityShell,
  renderPromptNotice,
  renderProvisionalLogo,
  renderRehydratedShell,
} from "./fragments.ts";

// The shell's detail-modal mount placeholder (public/index.html) — where every rendered
// shell mounts the one shared read-only detail modal. Kept in sync with fragments.ts.
const MODAL_PLACEHOLDER = "    <!-- Shared detail modal mounts here. -->";

// The shell's logo placeholder comment, with the 10-space indent the injection matches
// on. Kept in sync with fragments.ts.
const LOGO_PLACEHOLDER = "          <!-- Capability logos render here. -->";

// A minimal stand-in for the shell file: the anchors the shell composition keys off —
// the logo-layer placeholder comment (with its 10-space indent), the detail-modal
// placeholder, and the content target — wrapped in just enough markup to be inspectable.
const SHELL_FIXTURE = [
  '<div class="shell" x-data="shell">',
  '  <div class="desk__logos" id="capability-logos">',
  LOGO_PLACEHOLDER,
  "  </div>",
  '  <div class="intro__output" id="spec-build-output"></div>',
  "</div>",
  MODAL_PLACEHOLDER,
].join("\n");

function countMatches(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

interface OobInspection {
  readonly logoCount: number;
  readonly logoInsideOobCount: number;
  readonly oobCount: number;
  readonly oobIsLogoItself: boolean;
  readonly oobValue: string | null;
}

async function inspectLogoOob(fragment: string): Promise<OobInspection> {
  const insideOobStack: boolean[] = [];
  let logoCount = 0;
  let logoInsideOobCount = 0;
  let oobCount = 0;
  let oobIsLogoItself = false;
  let oobValue: string | null = null;

  const rewriter = new HTMLRewriter()
    .on("*", {
      element(element) {
        const hasOob = element.getAttribute("hx-swap-oob") !== null;
        const insideOob = hasOob || insideOobStack.includes(true);

        if (hasOob) {
          const value = element.getAttribute("hx-swap-oob");
          if (value?.includes("capability-logo")) {
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
    .on("[data-capability-logo]", {
      element(element) {
        logoCount += 1;
        logoInsideOobCount += insideOobStack.includes(true) ? 1 : 0;
        oobIsLogoItself ||= element.getAttribute("hx-swap-oob") !== null;
      },
    });

  await new Response(rewriter.transform(new Response(fragment)).body).text();
  return { logoCount, logoInsideOobCount, oobCount, oobIsLogoItself, oobValue };
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
  test("commit-time logo OOB wraps the canonical logo for htmx beforeend insertion", async () => {
    const fragment = renderCapabilityCommitSwap(
      {
        id: "notes",
        label: "Notes",
        incarnation_id: "11111111-1111-4111-8111-111111111111",
        version: 1,
      },
      '<section class="capability-collection"><div id="notes-records" hx-get="/capability/notes/read"></div></section>',
    );

    expect(await inspectLogoOob(fragment)).toEqual({
      logoCount: 1,
      logoInsideOobCount: 1,
      oobCount: 1,
      oobIsLogoItself: false,
      oobValue: "beforeend:#capability-logos",
    });
    expect(fragment).toContain("data-capability-logo-oob");
    expect(fragment).toContain('id="capability-logo-notes"');
    expect(fragment).toContain('hx-push-url="/capability/notes"');
    expect(fragment).toContain('aria-label="Open Notes"');
    // Until 5.5 draws it, every logo wears the designed placeholder tile — and it rests:
    // an activated capability is finished and usable, not still being made.
    expect(fragment).toContain('class="logo-tile logo-tile--pending"');
    expect(fragment).not.toContain("logo-tile--working");
    // Deletion's doorway is the logo's context menu (5.9/02), not a second control
    // riding on the tile.
    expect(fragment).not.toContain("data-capability-delete");
    expect(fragment).not.toContain("/capability-deletion/notes");
    expect(fragment).toContain(
      'data-active-capability-incarnation="11111111-1111-4111-8111-111111111111"',
    );
    expect(fragment).toContain('data-active-capability-version="1"');
    // The commit swap is the collection scaffolding and its desk sidecar — nothing else.
    // The content-area evolution control retired with the demo route.
    expect(fragment).toContain('hx-get="/capability/notes/read"');
    expect(fragment).not.toContain("capability-evolution");
    expect(fragment).not.toContain("/demo/evolution/");
  });

  test("evolution replaces a changed label but emits no desk sidecar when unchanged", async () => {
    const evolved = {
      id: "notes",
      label: "Journal",
      incarnation_id: "11111111-1111-4111-8111-111111111111",
      version: 2,
    };
    const collection = '<section class="capability-collection"></section>';

    const changed = renderCapabilityCommitSwap(evolved, collection, "Notes");
    expect(await inspectLogoOob(changed)).toMatchObject({
      logoCount: 1,
      oobCount: 1,
      oobIsLogoItself: true,
      oobValue: "outerHTML:#capability-logo-notes",
    });
    expect(changed).not.toContain("beforeend:#capability-logos");
    // The logo reads the capability's label live, which is what makes 5.9's rename free.
    expect(changed).toContain('aria-label="Open Journal"');
    expect(changed).not.toContain('aria-label="Open Notes"');

    const unchanged = renderCapabilityCommitSwap(evolved, collection, "Journal");
    expect(await inspectLogoOob(unchanged)).toMatchObject({ logoCount: 0, oobCount: 0 });
    expect(unchanged).toContain('data-active-capability-id="notes"');
    expect(unchanged).not.toContain("capability-evolution");
  });

  test("the provisional tile is keyed by the build id and says it is being made", async () => {
    const fragment = renderProvisionalLogo("build-7", "Recipes");

    // It stands on the same desk as everything else, out of band, and carries no
    // capability identity at all — there is none yet.
    expect(await inspectLogoOob(fragment)).toMatchObject({
      logoCount: 0,
      oobCount: 1,
      oobValue: "beforeend:#capability-logos",
    });
    expect(fragment).toContain('data-provisional-logo="build-7"');
    expect(fragment).not.toContain("data-capability-id");
    expect(fragment).not.toContain("hx-get");
    // Working while the build runs: the ambient half of the signal, visible from
    // anywhere on the desk while the window carries the narration.
    expect(fragment).toContain('class="logo-tile logo-tile--pending logo-tile--working"');
    expect(fragment).toContain("Recipes");
    expect(fragment).toContain("— being made");
  });

  test("the provisional tile escapes the label and the build id it is given", () => {
    const fragment = renderProvisionalLogo('b"1', "<img src=x onerror=alert(1)> \"R\" & 'r'");
    expect(fragment).toContain('data-provisional-logo="b&quot;1"');
    expect(fragment).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(fragment).not.toContain("<img");
  });
});

describe("on-load logo rehydration", () => {
  test("an empty registry stands no logos on the desk — but still mounts the modal", () => {
    const html = renderRehydratedShell([], SHELL_FIXTURE);

    // An empty desk means no capabilities, never no modal: the shared detail modal is
    // data-free platform chrome and mounts even here, so the FIRST capability a fresh
    // user builds can open it without a page refresh (the commit swap adds content + a
    // logo, not the modal). Otherwise the page is a wallpaper and a prompt bar, with
    // nothing gating it — the `has-capabilities` state went with the rail it flipped.
    expect(html).toContain(renderDetailModal());
    expect(html).not.toContain(MODAL_PLACEHOLDER); // placeholder consumed by the injection
    expect(html).not.toContain("data-capability-logo");
    expect(html).not.toContain("has-capabilities");
    // The empty layer itself stays: it is where the first commit's sidecar lands.
    expect(html).toContain('id="capability-logos"');
  });

  test("registry rows render one canonical logo each, and nothing is gated", () => {
    const html = renderRehydratedShell(
      [
        { id: "notes", label: "Notes" },
        { id: "recipes", label: "Recipes" },
      ],
      SHELL_FIXTURE,
    );

    // Nothing flips. A desk with logos and a desk without one differ only by the logos.
    expect(html).not.toContain("has-capabilities");

    // One canonical logo per row — the same renderer the commit-time OOB path uses —
    // each pointing at the cached-view route a click serves.
    expect(countMatches(html, "data-capability-logo")).toBe(2);
    expect(html).toContain('hx-get="/capability/notes"');
    expect(html).toContain('hx-push-url="/capability/notes"');
    expect(html).toContain('hx-get="/capability/recipes"');
    expect(html).toContain('hx-push-url="/capability/recipes"');
    expect(html).toContain("Notes");
    expect(html).toContain("Recipes");

    // A real `<button>`, which is what lets 5.9 open a context menu from the keyboard
    // without hand-written key handling, and what carries the live label a rename changes.
    expect(html.match(/<button\s+type="button"/g)).toHaveLength(2);
    expect(html).toContain('<span class="logo-label">Notes</span>');

    // Logos render in the order the registry hands them over (notes before recipes).
    expect(html.indexOf("/capability/notes")).toBeLessThan(html.indexOf("/capability/recipes"));

    // The placeholder anchor stays put — logos are inserted after it, not replacing it.
    expect(html).toContain(LOGO_PLACEHOLDER.trim());

    // The load path restores the desk only: the content area is never pre-populated with
    // a capability view (a click serves it, ADR-0004).
    expect(html).not.toContain("capability-surface");

    // The one shared detail modal mounts here too, so a rehydrated desk is
    // clickable-into once the read path emits wrapper items (3.4).
    expect(html).toContain(renderDetailModal());
  });

  // Every page-assembly anchor, removed one at a time from a shell that is otherwise
  // whole, so each case isolates the anchor it names. The removals come from the same
  // `PAGE_ASSEMBLY_ANCHORS` the developer preview forces, so a test and a preview cannot
  // disagree about what "missing" means for an anchor.
  const anchorRaises: Record<string, RegExp> = {
    "the logo-layer placeholder": /logo-layer placeholder/i,
    "the detail-modal placeholder": /detail-modal placeholder/i,
    "the content target": /content target/i,
  };

  test("PAGE_ASSEMBLY_ANCHORS names every anchor the assembly replaces", () => {
    expect(PAGE_ASSEMBLY_ANCHORS.map((anchor) => String(anchor.name))).toEqual(
      Object.keys(anchorRaises),
    );
  });

  for (const anchor of PAGE_ASSEMBLY_ANCHORS) {
    test(`throws when the shell is missing ${anchor.name}`, () => {
      // A shell that silently absorbed a missed anchor serves a page that looks assembled
      // and is not: no logos, no modal, or no opened capability.
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

  test("an empty desk holds the shell to the same anchors it will need on the first commit", () => {
    // An empty registry inserts nothing, so nothing here would have noticed a lost
    // anchor. That made the loudest failure the one a fresh user was least likely to
    // reach: the page would render, and start failing at the first commit.
    for (const anchor of PAGE_ASSEMBLY_ANCHORS) {
      expect(() => renderRehydratedShell([], anchor.remove(SHELL_FIXTURE))).toThrow(
        anchorRaises[anchor.name] as RegExp,
      );
    }
    expect(() => renderRehydratedShell([], SHELL_FIXTURE)).not.toThrow();
  });
});
