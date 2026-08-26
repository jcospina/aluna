# Aluna Desktop design pages

Three HTML pages showing the design for Aluna Desktop. Open them in a browser and
click around. This is the reference for how the surface looks and behaves, and it
is the product requirement for Module 5, the desk — the decisions live here rather
than in a prose spec somewhere else.

These are not production pages and nothing here talks to the app server. There's
no build step and no dependencies: plain ES modules and plain CSS, loaded
directly by the browser.

## The pages

**`index.html`, the desk.** A working window manager on the wallpaper: click a
logo to open a capability, click another to swap what's inside the same window,
click a record to open it, drag the window, resize it, maximise it, put it away.
There is one window and it is the content area; the developer panel is the one
exception and opens from its own tile. Growing a capability from the prompt bar
streams narration into the window and puts a working tile on the ground — cancel
and it gives back what it took. The window's box and the panel's survive a
reload. Below the desk are sections covering the window chrome, the line
treatment, the palette, the type, the capability patterns, the locked decisions
D1–D14, and what's still open. Each of those sections is itself drawn as a
window, using the same code as the desk.

**`controls.html`, the controls.** Every form control a generated capability can
use, in each of its states: buttons, text fields, dates, numbers, search,
checkboxes, radios, segmented buttons, a textarea that grows as you type, and a
custom listbox for enums.

**`logo.html`, the logo contract.** How a capability's logo is made: the request
sent once, as the last step of a build that has already cleared its gate, the
prompt with its two slots, the tile the shell applies, and how the name is
written under it. If something about a logo is settled, it is settled here. The
four specimens on the page are real generations made to it.

All three pages are live. Type in the fields, open the listboxes, drag the
window. The capabilities on the desk are fixtures, not real generated units, and
a build is a timer rather than a model.

## Running it

The pages use ES modules, so they need a server; `file://` won't work.

```bash
bunx --bun serve design -l 4173
```

Then open <http://localhost:4173>. Any static server will do. Don't serve this
from the app's dev server on `:3030`; they're unrelated.

## Checking it

```bash
bun run lint && bun run typecheck
```

Everything in `scripts/` uses `// @ts-check` with JSDoc types, and
`tsconfig.browser.json` type-checks it against the DOM lib at the repo's usual
strictness.

## What's in here

```
design/
  index.html              the desk page
  controls.html           the controls page
  logo.html               the logo contract
  design-system.md        the names and rules, read before building any UI
  assets/fonts/           Fraunces and Outfit, variable woff2, both OFL
  assets/logos/           the four specimens logo.html stands on
  assets/wallpaper/       the desk background, 2560×1440 webp
  styles/
    index.css             imports the rest; order matters
    tokens.css            colours, line weight, shadows, type scale, spacing
    base.css              reset, @font-face, base type styles
    layout.css            menubar, page column, grids
    components/
      window.css          window frame and title bar
      controls.css        the button base, search, chips, segmented, range
      form-controls.css   the full control set
      collection.css      the collection, and the record view it swaps to
      desk.css            desk, logos, prompt bar, mobile layout
      doc.css             styles for these pages only, not the product
      logo-contract.css   the logo tile and label, as the contract defines them
      ink.css             must load last; wires up the drawn borders
    layout-kit.css        the classes generated capability markup speaks;
                          loads after the components, before ink.css
  scripts/
    main.js               sets up index.html
    controls-main.js      sets up controls.html
    logo-main.js          sets up logo.html
    listbox.js            the custom dropdown, replacing <select>
    spec.js               the settled numbers, and the three hands
    drawn-line.js         generates a hand-drawn path for any box
    ink.js                finds elements needing a drawn border, mounts them
    window-frame.js       generates the window path: frame plus title rule
    window.js             the window component
    desk.js               the window manager: one window, plus the panel
    desk-geometry.js      where a window is allowed to be, and the phone breakpoint
    patterns.js           the collection and the record form it swaps to
    prompt-bar.js         the floating prompt bar
    wallpaper.js          the desk background
    lib/random.js         seeded random numbers and value noise
    lib/geometry.js       path sampling, displacement, splines
    data/capabilities.js  fake capabilities for the desk
    sections/             the interactive demos embedded in the pages
```

## How capability logos get made

**`logo.html` is the contract.** Read it there, not here: the request, the
prompt, the tile and the label are all on that page, and this file is not a
second copy of them.

The short version: a hosted service (Recraft, `recraftv3_vector`) is called once
per capability, as the last step of a build that has already cleared its gate, so
no failed build ever pays for artwork. Aluna supplies a subject and two
colours and nothing else; the shell applies the corner, the shadow, the size and
the name. Until the artwork lands the tile is a placeholder, which is also what
marks the ground while the build runs. Local models are a prompt-refinement rig
only. They are far too slow to sit in the capability-creation path, and Aluna
never calls one.

How that was arrived at is on the same page, under **how it was settled**: the
two reference generations, the eight that chose the style, the label comparison
over the wallpaper's three grounds, and every defect that came back against the
prompt. The generations themselves are gone; the four that shipped are in
`assets/logos/`.

## Where the design came from

Two artifacts, kept because they live outside the repo. Everything they settled
is already in the pages, so there's no need to read them.

- Design: <https://claude.ai/code/artifact/986df2a4-436a-4606-b131-c83e7645c3f1>
- Plates I and II, and the settled specification:
  <https://claude.ai/code/artifact/d27f5e90-4bc2-42f9-b8fa-1046d7840fd7>
  (earlier versions are in its version history)
