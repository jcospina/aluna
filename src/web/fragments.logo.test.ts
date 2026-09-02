// The logo's own fragments: the tile inside it, which renders may arm a paid attempt, and
// the request ownership a press takes over the window's one content region. Split out of
// `fragments.test.ts`, which had grown past what one file should hold.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LOGO_ABSENT,
  logoButton,
  logoButtonTag,
  NEVER_RENAMED,
  SHELL_FIXTURE,
} from "./fragments.test-support.ts";
import {
  BUILDING_WINDOW_TITLE,
  DESK_LOGO_LAYER_ELEMENT_ID,
  renderBuildWindowTitle,
  renderCapabilityCommitSwap,
  renderCapabilityLogo,
  renderRehydratedShell,
  WINDOW_CONTENT_ELEMENT_ID,
} from "./fragments.ts";

// A capability born without artwork — the state every one of these fixtures is in, and
// the state the desk's load-triggered attempt is armed by.

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

  // Two presses in one tick used to leave two requests running against the one content
  // region with no ownership between them. If the first answered last, the window showed A
  // while the bar said B — and the swap's own `HX-Replace-Url` then replaced the address
  // with A, discarding the entry the person pushed for B.
  test("a logo press owns the window's content region", () => {
    const html = renderCapabilityLogo(row);

    expect(html).toContain(`hx-target="#${WINDOW_CONTENT_ELEMENT_ID}"`);
    expect(html).toContain(`hx-sync="#${WINDOW_CONTENT_ELEMENT_ID}:replace"`);
  });

  test("the deletion doorway takes the same ownership", () => {
    const html = renderCapabilityLogo(row);
    const menu = html.slice(html.indexOf("data-capability-delete"));

    expect(menu).toContain(`hx-sync="#${WINDOW_CONTENT_ELEMENT_ID}:replace"`);
  });

  test("the region a press owns is the one the shell's window creates", () => {
    const windowModule = readFileSync(
      resolve(import.meta.dir, "../../public/desk-window.js"),
      "utf8",
    );

    expect(windowModule).toContain(`WINDOW_CONTENT_ID = "${WINDOW_CONTENT_ELEMENT_ID}"`);
  });

  test("an absent tile arms one incarnation-bound attempt", () => {
    const html = renderCapabilityLogo(row);

    expect(html).toContain(`hx-post="${attemptUrl}"`);
    expect(html).toContain('hx-trigger="load"');
    expect(html).toContain('hx-target="#capability-logo-notes"');
    expect(html).toContain('hx-swap="outerHTML"');
    // One at a time across the whole desk. N faceless tiles all arm on `load`, and N
    // simultaneous 90-second provider calls earn a provider-side 429 that releases each
    // claim with its attempt already spent — the 3-attempt budget destroyed from inside.
    expect(html).toContain(`hx-sync="#${DESK_LOGO_LAYER_ELEMENT_ID}:queue all"`);
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
