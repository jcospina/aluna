import { describe, expect, test } from "bun:test";
import {
  countMatches,
  LOGO_ABSENT,
  LOGO_PLACEHOLDER,
  NEVER_RENAMED,
  NOTICE_SLOT,
  SHELL_FIXTURE,
} from "./fragments.test-support.ts";
import {
  BLANK_PROMPT_NOTICE,
  NOT_FOUND_NOTICE,
  PAGE_ASSEMBLY_ANCHORS,
  PROMPT_REFUSAL_ATTRIBUTE,
  renderCapabilityCommitSwap,
  renderPromptNotice,
  renderProvisionalLogo,
  renderProvisionalLogoName,
  renderRehydratedShell,
} from "./fragments.ts";
import { escapeHtml } from "./html.ts";

/** The menu's opening tag, where its role and its hidden state are written. */
function menuTag(html: string): string {
  const marker = html.indexOf("data-logo-menu");
  if (marker === -1) return "";
  return html.slice(html.lastIndexOf("<div", marker), html.indexOf(">", marker));
}

/** How many ways into permanent deletion this markup offers. Exactly one, on the menu. */
function deleteDoorways(html: string): number {
  return countMatches(html, "data-capability-delete");
}

interface OobInspection {
  readonly logoCount: number;
  readonly logoInsideOobCount: number;
  readonly oobCount: number;
  /** Whether the swap addresses the whole slot — the logo, its menu and its editor. */
  readonly oobIsSlotItself: boolean;
  /** Never true. The button inside the slot is not what any swap is addressed at. */
  readonly oobIsLogoItself: boolean;
  readonly oobValue: string | null;
}

async function inspectLogoOob(fragment: string): Promise<OobInspection> {
  const insideOobStack: boolean[] = [];
  let logoCount = 0;
  let logoInsideOobCount = 0;
  let oobCount = 0;
  let oobIsSlotItself = false;
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
    .on("[data-logo-slot]", {
      element(element) {
        oobIsSlotItself ||= element.getAttribute("hx-swap-oob") !== null;
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
  return { logoCount, logoInsideOobCount, oobCount, oobIsSlotItself, oobIsLogoItself, oobValue };
}

describe("prompt notice", () => {
  // This renderer is the *only* place `#prompt-notice` text is escaped, and the text is
  // not always ours: the deflection path puts the provider's `user_facing_label` through
  // it (`src/pipeline/build/admission/deflection.ts`). Without this case, deleting `escapeHtml`
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
        logo: { status: "absent", attempts: 0 },
        display_label_override: null,
      },
      '<section class="capability-collection"><div id="notes-records" hx-get="/capability/notes/read"></div></section>',
    );

    expect(await inspectLogoOob(fragment)).toEqual({
      logoCount: 1,
      logoInsideOobCount: 1,
      oobCount: 1,
      oobIsSlotItself: false,
      oobIsLogoItself: false,
      oobValue: "beforeend:#capability-logos",
    });
    expect(fragment).toContain("data-capability-logo-oob");
    expect(fragment).toContain('id="capability-logo-notes"');
    // The address is the desk's to write. htmx would push on every press, the open
    // logo's included, and snapshot the body under the address it left (design D14).
    expect(fragment).not.toContain('hx-push-url="');
    expect(fragment).toContain('aria-label="Open Notes"');
    // The placeholder tile, and it keeps working: this one is armed, so its own logo
    // request is in flight and the artwork is on its way to this very element. The
    // provisional tile comes down in the same beat, and the ground never goes still.
    expect(fragment).toContain('class="logo-tile logo-tile--pending logo-tile--working"');
    // Deletion's doorway is the logo's context menu and nothing else — never a second
    // control riding on the tile, and never anything in the window's chrome (design D3).
    expect(fragment).toContain('role="menu"');
    expect(fragment).toContain('hx-get="/capability-deletion/notes"');
    expect(deleteDoorways(fragment)).toBe(1);
    expect(menuTag(fragment)).toContain("hidden");
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
      subject: "an open notebook",
      ground: "grass_green",
      companion: "coral_orange",
      noun: "note",
      incarnation_id: "11111111-1111-4111-8111-111111111111",
      version: 2,
      logo: { status: "absent", attempts: 0 } as const,
      display_label_override: null,
    };
    const collection = '<section class="capability-collection"></section>';

    const changed = renderCapabilityCommitSwap(evolved, collection, "Notes");
    // The swap is addressed at the slot, so a re-rendered logo brings its menu and its
    // editor with it rather than replacing a button and leaving the old two beside it.
    expect(await inspectLogoOob(changed)).toMatchObject({
      logoCount: 1,
      oobCount: 1,
      oobIsSlotItself: true,
      oobIsLogoItself: false,
      oobValue: "outerHTML:#capability-logo-notes",
    });
    expect(changed).not.toContain("beforeend:#capability-logos");
    // The logo reads the capability's label live, which is what makes 5.9's rename free.
    expect(changed).toContain('aria-label="Open Journal"');
    expect(changed).not.toContain('aria-label="Open Notes"');

    // And it comes back even when the name did not move. The slot carries the version a
    // rename is bound to, so a desk left holding the old one refuses every rename of this
    // capability until the page is reloaded (5.9/01).
    const unchanged = renderCapabilityCommitSwap(evolved, collection, "Journal");
    expect(await inspectLogoOob(unchanged)).toMatchObject({ logoCount: 1, oobCount: 1 });
    expect(unchanged).toContain('name="version" value="2"');
    expect(unchanged).toContain('data-active-capability-id="notes"');
    expect(unchanged).not.toContain("capability-evolution");
  });

  test("the provisional tile is keyed by the build id and stands nameless", async () => {
    const fragment = renderProvisionalLogo("build-7");

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
    // Nameless. Admission has no name to write, and a stand-in on the desk is a word
    // nobody chose — so the label is empty and waits for the spec to author one.
    expect(fragment).toContain('<span class="logo-label" id="provisional-logo-label-build-7">');
    expect(fragment).not.toContain("Something new");
    // But it still answers to something. The accessible name is the two referenced spans,
    // one of them hidden, so it reads "being made" now and "<name> being made" later.
    expect(fragment).toContain(
      'aria-labelledby="provisional-logo-label-build-7 provisional-logo-status-build-7"',
    );
    expect(fragment).toContain(
      '<span id="provisional-logo-status-build-7" hidden>being made</span>',
    );
    expect(fragment).not.toContain("aria-label=");
  });

  test("the spec's name is written into the label alone, never over the tile", () => {
    const swap = renderProvisionalLogoName("build-7", "Recipes");
    expect(swap).toBe(
      '<span class="logo-label" id="provisional-logo-label-build-7" hx-swap-oob="outerHTML">Recipes</span>',
    );
    // Replacing the button would restart the crawl mid-cycle, which is the one thing the
    // animation must never do.
    expect(swap).not.toContain("<button");
    expect(swap).not.toContain("logo-tile");
  });

  test("the provisional tile escapes the build id, and the name escapes the label", () => {
    expect(renderProvisionalLogo('b"1')).toContain('data-provisional-logo="b&quot;1"');
    const named = renderProvisionalLogoName("build-7", "<img src=x onerror=alert(1)> \"R\" & 'r'");
    expect(named).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(named).not.toContain("<img");
  });
});

describe("on-load logo rehydration", () => {
  test("an empty registry stands no logos on the desk", () => {
    const html = renderRehydratedShell([], SHELL_FIXTURE);

    // The page a fresh user loads is a wallpaper and a prompt bar, with nothing gating
    // it — the `has-capabilities` state went with the rail it flipped.
    expect(html).not.toContain("data-capability-logo");
    expect(html).not.toContain("has-capabilities");
    // The empty layer itself stays: it is where the first commit's sidecar lands.
    expect(html).toContain('id="capability-logos"');
  });

  test("a label carrying a `$` substitution pattern is spliced in literally", () => {
    // `$&`, `` $` `` and `$'` are replacement *patterns* when the second argument of
    // `String.replace` is a string, and labels are model-authored. `` $` `` substitutes
    // everything before the match — the whole document head — into the `aria-label` it
    // lands in, whose quotes and `>` then break out of the attribute and re-emit the
    // shell's own `<script>` tags into the body. Escaping manufactures the hazard rather
    // than avoiding it: `escapeHtml` turns a label's `'` into `&#39;`, so `$'` becomes `$&`.
    const plain = renderRehydratedShell(
      [
        {
          id: "notes",
          label: "Plain",
          incarnation_id: "inc-1",
          logo: LOGO_ABSENT,
          ...NEVER_RENAMED,
        },
      ],
      SHELL_FIXTURE,
    );

    for (const label of ["Cost $` log", "Cheap $' finds", "A $& b"]) {
      const html = renderRehydratedShell(
        [{ id: "notes", label, incarnation_id: "inc-1", logo: LOGO_ABSENT, ...NEVER_RENAMED }],
        SHELL_FIXTURE,
      );

      // Nothing from the surrounding document was spliced in: one logo, and the shell's
      // own structure is emitted exactly as often as it is for an ordinary label.
      expect(countMatches(html, "data-capability-logo"), label).toBe(1);
      expect(countMatches(html, "<script"), label).toBe(countMatches(plain, "<script"));
      expect(countMatches(html, 'id="capability-logos"'), label).toBe(1);
      expect(html, label).toContain(escapeHtml(label));
    }
  });

  test("registry rows render one canonical logo each, and nothing is gated", () => {
    const html = renderRehydratedShell(
      [
        {
          id: "notes",
          label: "Notes",
          incarnation_id: "inc-1",
          logo: LOGO_ABSENT,
          ...NEVER_RENAMED,
        },
        {
          id: "recipes",
          label: "Recipes",
          incarnation_id: "inc-2",
          logo: LOGO_ABSENT,
          ...NEVER_RENAMED,
        },
      ],
      SHELL_FIXTURE,
    );

    // Nothing flips. A desk with logos and a desk without one differ only by the logos.
    expect(html).not.toContain("has-capabilities");

    // One canonical logo per row — the same renderer the commit-time OOB path uses —
    // each pointing at the cached-view route a click serves.
    expect(countMatches(html, "data-capability-logo")).toBe(2);
    expect(html).toContain('hx-get="/capability/notes"');
    expect(html).toContain('hx-get="/capability/recipes"');
    // No `hx-push-url` on a logo: `public/desk-window.js` pushes the address itself, so
    // a press on the logo already open adds no second entry (design D14).
    expect(html).not.toContain('hx-push-url="');
    expect(html).toContain("Notes");
    expect(html).toContain("Recipes");

    // A real `<button>`, which is what lets the logo take the menu key without any
    // hand-written key handling, and what carries the live label a rename changes.
    expect(countMatches(html, "<button")).toBeGreaterThanOrEqual(2);
    expect(countMatches(html, "data-logo-slot")).toBe(2);
    // One menu per logo, each holding exactly its two items and nothing else.
    expect(countMatches(html, 'role="menu"')).toBe(2);
    expect(countMatches(html, 'role="menuitem"')).toBe(4);
    expect(html).toContain('<span class="logo-label" data-logo-label>Notes</span>');

    // Logos render in the order the registry hands them over (notes before recipes).
    expect(html.indexOf("/capability/notes")).toBeLessThan(html.indexOf("/capability/recipes"));

    // The placeholder anchor stays put — logos are inserted after it, not replacing it.
    expect(html).toContain(LOGO_PLACEHOLDER.trim());

    // The load path restores the desk only: no capability view is ever composed into the
    // page (a click serves it into the window the client opens, ADR-0004).
    expect(html).not.toContain("capability-surface");
  });

  // Every page-assembly anchor, removed one at a time from a shell that is otherwise
  // whole, so each case isolates the anchor it names. The removals come from the same
  // `PAGE_ASSEMBLY_ANCHORS` the developer preview forces, so a test and a preview cannot
  // disagree about what "missing" means for an anchor.
  const anchorRaises: Record<string, RegExp> = {
    "the logo-layer placeholder": /logo-layer placeholder/i,
    "the prompt bar's notice slot": /notice slot/i,
  };

  test("PAGE_ASSEMBLY_ANCHORS names every anchor the assembly replaces", () => {
    expect(PAGE_ASSEMBLY_ANCHORS.map((anchor) => String(anchor.name))).toEqual(
      Object.keys(anchorRaises),
    );
  });

  for (const anchor of PAGE_ASSEMBLY_ANCHORS) {
    test(`throws when the shell is missing ${anchor.name}`, () => {
      // A shell that silently absorbed a missed anchor serves a page that looks assembled
      // and is not: a desk with no logos on it.
      expect(() =>
        renderRehydratedShell(
          [
            {
              id: "notes",
              label: "Notes",
              incarnation_id: "inc-1",
              logo: LOGO_ABSENT,
              ...NEVER_RENAMED,
            },
          ],
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

describe("the sentence a page load arrives already having", () => {
  test("a load with nothing to say leaves the notice slot exactly as the shell ships it", () => {
    expect(renderRehydratedShell([], SHELL_FIXTURE)).toContain(NOTICE_SLOT);
  });

  test("a link to a capability that is not there loads the desk with its sentence spoken", () => {
    // The bare desk plus one sentence in the slot the prompt bar already has: no window is
    // composed in for the address that named nothing, and no second notice element appears
    // anywhere on the page (PLAN decision 21).
    const html = renderRehydratedShell([], SHELL_FIXTURE, NOT_FOUND_NOTICE);

    expect(html).toContain(
      `<div id="prompt-notice" class="prompt__notice" aria-live="polite">${NOT_FOUND_NOTICE}</div>`,
    );
    expect(countMatches(html, 'id="prompt-notice"')).toBe(1);
    // An answer, never a refusal: the 400ms cue fires on `htmx:oobAfterSwap`, which a page
    // load never dispatches, so a marker here would be a claim the bar could not honour.
    expect(html).not.toContain(PROMPT_REFUSAL_ATTRIBUTE);
  });

  test("an attribute added to the shell's slot is kept, and does not break the seeding", () => {
    // The mistake `METRICS_SEED_TARGET` already paid for once (`src/server/http/cached-view.ts`):
    // an exact tag copy turns a harmless attribute on a real, styled, scripted element
    // into a page that will not assemble — and this element is the one in the shell most
    // likely to gain one.
    const shell = SHELL_FIXTURE.replace(
      'id="prompt-notice"',
      'id="prompt-notice" data-testid="notice"',
    );

    const html = renderRehydratedShell([], shell, NOT_FOUND_NOTICE);

    expect(html).toContain('data-testid="notice"');
    expect(html).toContain(`aria-live="polite">${NOT_FOUND_NOTICE}</div>`);
    expect(() => renderRehydratedShell([], shell)).not.toThrow();
  });

  test("the seeded sentence is escaped, and its `$` patterns are spliced in literally", () => {
    // The same hazard the logo injection guards: `$&`, `` $` `` and `$'` are substitution
    // patterns in a replacement *string*, and escaping manufactures them — `escapeHtml`
    // turns `'` into `&#39;`, so `$'` becomes `$&`. Nothing model-authored reaches here
    // today, and the guard is what keeps that from being the only reason it is safe.
    const html = renderRehydratedShell([], SHELL_FIXTURE, '$` $& $\' <b>x</b> "q"');

    expect(html).toContain("$` $&amp; $&#39; &lt;b&gt;x&lt;/b&gt; &quot;q&quot;</div>");
    expect(html).not.toContain("<b>x</b>");
    expect(countMatches(html, 'id="capability-logos"')).toBe(1);
  });

  test("a desk with logos on it speaks the sentence too", () => {
    // The address that named nothing is still a whole desk: every sibling logo stands on
    // it, and the sentence says why the one the link named is not among them.
    const html = renderRehydratedShell(
      [
        {
          id: "notes",
          label: "Notes",
          incarnation_id: "inc-1",
          logo: LOGO_ABSENT,
          ...NEVER_RENAMED,
        },
      ],
      SHELL_FIXTURE,
      NOT_FOUND_NOTICE,
    );

    expect(html).toContain(`aria-live="polite">${NOT_FOUND_NOTICE}</div>`);
    expect(html).toContain('data-capability-id="notes"');
  });
});
