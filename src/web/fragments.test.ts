import { describe, expect, test } from "bun:test";

import {
  BLANK_PROMPT_NOTICE,
  BUILDING_WINDOW_TITLE,
  PAGE_ASSEMBLY_ANCHORS,
  renderBuildWindowTitle,
  renderCapabilityCommitSwap,
  renderCapabilityLogo,
  renderPromptNotice,
  renderProvisionalLogo,
  renderProvisionalLogoName,
  renderRehydratedShell,
} from "./fragments.ts";
import { escapeHtml } from "./html.ts";

// A capability born without artwork — the state every one of these fixtures is in, and
// the state the desk's load-triggered attempt is armed by.
const LOGO_ABSENT = { status: "absent", attempts: 0 } as const;

/** The platform-owned half every logo fixture below carries unchanged. */
const NEVER_RENAMED = { version: 1, display_label_override: null } as const;

// The shell's logo placeholder comment, with the 10-space indent the injection matches
// on. Kept in sync with fragments.ts.
const LOGO_PLACEHOLDER = "          <!-- Capability logos render here. -->";

// A minimal stand-in for the shell file: the one anchor the shell composition keys off —
// the logo-layer placeholder comment, with its 10-space indent — wrapped in just enough
// markup to be inspectable. Neither the window layer nor the record holds an anchor: the
// window is created by the client and a record opens by a view swap inside it, so nothing
// else is composed into the page.
const SHELL_FIXTURE = [
  '<div class="shell" x-data="shell">',
  '  <div class="desk__logos" id="capability-logos">',
  LOGO_PLACEHOLDER,
  "  </div>",
  '  <div class="desk__windows"></div>',
  "</div>",
].join("\n");

function countMatches(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The logo's own `<button>` — the one that opens the capability — and nothing around it. */
function logoButton(html: string): string {
  const opened = html.indexOf("<button");
  return opened === -1 ? "" : html.slice(opened, html.indexOf("</button>", opened));
}

/** Just that button's opening tag, where the one verb a press carries has to be. */
function logoButtonTag(html: string): string {
  const button = logoButton(html);
  return button.slice(0, button.indexOf(">"));
}

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

describe("the tile inside a logo", () => {
  const row = {
    id: "notes",
    label: "Notes",
    incarnation_id: "11111111-1111-4111-8111-111111111111",
    logo: LOGO_ABSENT,
    ...NEVER_RENAMED,
  } as const;
  const attemptUrl = "/capability/notes/11111111-1111-4111-8111-111111111111/logo-attempt";
  const artworkUrl = "/capability/notes/11111111-1111-4111-8111-111111111111/logo.svg";

  test("an absent tile arms one incarnation-bound attempt", () => {
    const html = renderCapabilityLogo(row);

    expect(html).toContain(`hx-post="${attemptUrl}"`);
    expect(html).toContain('hx-trigger="load"');
    expect(html).toContain('hx-target="#capability-logo-notes"');
    expect(html).toContain('hx-swap="outerHTML"');
    // And it works while it waits: the attempt it just armed answers with this very
    // element, so a picture really is on its way here.
    expect(html).toContain("logo-tile--working");
    // But it does not probe the artwork route. The immutable response exists only in
    // `present`, and a placeholder asking for it would collect a 404 for a picture that
    // has not been drawn yet (ADR-0007, decision 34).
    expect(html).not.toContain(artworkUrl);
  });

  // htmx honours one verb per element, and `hx-get` wins. Putting the POST on the button
  // beside the click's `hx-get` would silently fire the GET and never claim anything.
  test("the attempt is on the tile, never on the button that opens the capability", () => {
    const html = renderCapabilityLogo(row);

    expect(logoButtonTag(html)).toContain('hx-get="/capability/notes"');
    expect(logoButtonTag(html)).not.toContain("hx-post");
    expect(logoButtonTag(html)).not.toContain("hx-trigger");
  });

  test("a tile answering an attempt is inert even while it is still absent", () => {
    const html = renderCapabilityLogo(row, { armLogoAttempt: false });

    expect(html).toContain("logo-tile--pending");
    expect(html).not.toContain("logo-attempt");
    expect(html).not.toContain(artworkUrl);
    expect(html).not.toContain("hx-trigger");
    // And it rests. Nothing is on its way to an unarmed tile, and a tile still working
    // would promise an arrival that is not coming.
    expect(html).not.toContain("logo-tile--working");
  });

  // `generating` is a picture being drawn, not a picture arriving late, and `abandoned`
  // is the permanent placeholder. Neither may claim, and neither animates.
  test.each(["generating", "abandoned"] as const)("a %s tile claims nothing", (status) => {
    const html = renderCapabilityLogo({ ...row, logo: { status, attempts: 1 } });

    // The plain placeholder and nothing else: no request of any kind on the tile, and no
    // artwork address for bytes that are not there. Read off the button rather than the
    // whole slot — the rename form beside it posts, and always has.
    expect(html).toContain('<span class="logo-tile logo-tile--pending"></span>');
    expect(logoButton(html)).not.toContain("hx-post");
    expect(html).not.toContain("logo.svg");
  });

  test("a present tile is the artwork, addressed by incarnation, and arms nothing", () => {
    const html = renderCapabilityLogo({ ...row, logo: { status: "present", attempts: 1 } });

    expect(html).toContain(`background-image: url('${artworkUrl}')`);
    expect(html).not.toContain("logo-tile--pending");
    expect(html).not.toContain("logo-attempt");
  });

  test("a rebuilt capability's tile addresses its own lifetime, not the previous one", () => {
    const rebuilt = renderCapabilityLogo({
      ...row,
      incarnation_id: "22222222-2222-4222-8222-222222222222",
      logo: { status: "present", attempts: 1 },
      display_label_override: null,
    });

    expect(rebuilt).toContain("/capability/notes/22222222-2222-4222-8222-222222222222/logo.svg");
    expect(rebuilt).not.toContain("11111111-1111-4111-8111-111111111111");
  });
});

describe("which renders may arm an attempt", () => {
  const row = {
    id: "notes",
    label: "Notes",
    incarnation_id: "11111111-1111-4111-8111-111111111111",
    logo: LOGO_ABSENT,
    ...NEVER_RENAMED,
  } as const;
  const collection = '<section class="capability-collection"></section>';

  test("a newly activated capability's tile arms one", () => {
    const fragment = renderCapabilityCommitSwap(row, collection);

    expect(fragment).toContain("logo-attempt");
    expect(fragment).toContain('hx-trigger="load"');
  });

  // Evolution never enters the logo path. A rename re-renders the tile, and a still
  // faceless capability would otherwise get a free extra attempt for every rename.
  test("an evolution that moves the label re-renders the tile inert", () => {
    const renamed = renderCapabilityCommitSwap(
      { ...row, label: "Journal", version: 2 },
      collection,
      "Notes",
    );

    expect(renamed).toContain("outerHTML:#capability-logo-notes");
    expect(renamed).toContain('aria-label="Open Journal"');
    expect(renamed).not.toContain("logo-attempt");
    expect(renamed).not.toContain("hx-trigger");
  });

  test("an evolution that keeps the label still re-renders the slot, inert", () => {
    const unchanged = renderCapabilityCommitSwap({ ...row, version: 2 }, collection, "Notes");

    // The name is the same and the version is not, and the version is what a rename binds
    // to — so the slot comes back carrying the new one, without arming anything.
    expect(unchanged).toContain("data-capability-logo");
    expect(unchanged).toContain('name="version" value="2"');
    expect(unchanged).not.toContain("logo-attempt");
  });

  test("a fresh desk render arms one per faceless capability and no more", () => {
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
          logo: { status: "present", attempts: 1 },
          ...NEVER_RENAMED,
        },
        {
          id: "trips",
          label: "Trips",
          incarnation_id: "inc-3",
          logo: { status: "abandoned", attempts: 3 },
          ...NEVER_RENAMED,
        },
      ],
      SHELL_FIXTURE,
    );

    expect((html.match(/hx-post="[^"]*logo-attempt"/g) ?? []).length).toBe(1);
    expect(html).toContain("/capability/notes/inc-1/logo-attempt");
    expect(html).toContain("/capability/recipes/inc-2/logo.svg");
  });
});

describe("renderBuildWindowTitle", () => {
  test("is a name and nothing else — it lands nowhere and adds no event name", () => {
    expect(renderBuildWindowTitle(BUILDING_WINDOW_TITLE)).toBe(
      '<div data-build-window-title="Building…"></div>',
    );
    // No out-of-band target: the desk owns the window, so this is told rather than
    // placed. It rides `fragment` the way the provisional tile does (ADR-0002).
    expect(renderBuildWindowTitle("x")).not.toContain("hx-swap-oob");
  });

  test("escapes a capability's own label", () => {
    expect(renderBuildWindowTitle('Ben & Jerry\'s "list"')).toBe(
      '<div data-build-window-title="Ben &amp; Jerry&#39;s &quot;list&quot;"></div>',
    );
  });
});
