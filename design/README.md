# Aluna design system

Three live HTML pages: the design system for Aluna. Open them in a browser and click
around. Each component is shown working, with pickers that walk it to the states you
can't reach by hand.

These are not production pages and nothing here talks to the app server. There's
no build step and no dependencies: plain ES modules and plain CSS, loaded
directly by the browser. The stylesheets in `styles/` are the ones the app ships.

## The pages

**`index.html`, the desk and its foundations.** A working window manager on the
wallpaper: open a capability, swap it, open a record, drag, resize, maximise, put
it away, grow one from the prompt bar. Below it: the window, the drawn line, the
palette, type, spacing, focus and motion, and the capability patterns. The
capabilities on the desk are fixtures, and a build is a timer.

**`controls.html`, the controls.** Every form control a generated capability can
use: buttons, text fields, long text, lists, enums, choices, files and the voice
recorder, linked fields, and a record assembled from them.

**`logo.html`, the logo.** A capability's logo: the tile and its numbers, the hue
families and their shades, the label over each of the wallpaper's grounds, and the
placeholder that stands in until the artwork lands.

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
  index.html              the desk and its foundations
  controls.html           the controls
  logo.html               the logo
  design-system.md        the names and rules, read before building any UI
  assets/fonts/           Fraunces and Outfit, variable woff2, both OFL
  assets/logos/           the four specimens logo.html stands on
  assets/media/           the sample files the file controls are shown holding
  assets/wallpaper/       the desk background, 2560×1440 webp
  styles/
    index.css             imports the rest; order matters
    tokens.css            colours, line weight, shadows, type scale, spacing
    base.css              reset, @font-face, base type styles
    layout.css            menubar, page column, grids
    doc.css               styles for these pages only, not the product
    layout-kit.css        the classes generated capability markup speaks;
                          loads after the components, before ink.css
    components/
      window.css          window frame and title bar
      collection.css      the collection, and the record view it swaps to
      desk.css            desk, logos, prompt bar, mobile layout
      logo-contract.css   the logo tile and label, as the contract defines them
      ink.css             must load last; wires up the drawn borders
      controls/
        controls.css        the button base, search, chips, segmented, range
        form-controls.css   the rules every field shares, buttons and form rows
        long-text-field.css the textarea a long-text field grows in
        choice-field.css    the drawn listbox, the native select, radio and checkbox
        linked-field.css    the Link control, a linked field and the broken-link mark
        list-field.css      the repeatable rows a string[] field is typed into
        file-field.css      the file field, its list and its player
        file-recorder.css   the voice recorder a sound field's row becomes
  scripts/
    pages/                one bootstrap per page: main.js, controls-main.js, logo-main.js
    ink/                  the drawn line: spec.js (the line's numbers, and the three
                          hands), drawn-line.js (a hand-drawn path for any box) and
                          ink.js (finds elements needing a drawn border, mounts them)
    window/               window.js, the window component; window-frame.js, its path;
                          window-gestures.js and window-press.js, drag, resize, maximise
                          and the pointer that owns one
    desk/                 desk.js, the window manager, with desk-geometry.js, desk-logo.js,
                          devpanel.js, patterns.js, prompt-bar.js and wallpaper.js
    controls/             listbox.js, the custom dropdown replacing <select>;
                          listbox-search.js, the search typed into a picker or a linked
                          field, which the desk's picker shares; list-rows.js, the
                          repeatable rows a string[] field is typed into; and
                          open-record.js, the open icon inside a linked field
    files/                the file field, its list, its player and the voice recorder
    sections/             the interactive specimens embedded in the pages, the state
                          picker that switches them, and the benches that stand in
                          for the upload route and the microphone
    lib/                  seeded random numbers, path geometry, WebM finishing
    data/                 capabilities.js, fake capabilities for the desk; logo-shades.js,
                          the logo hue families the logo page shows
```
