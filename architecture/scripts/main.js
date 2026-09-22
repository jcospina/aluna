// The architecture page's one entry point.
//
// Same order the design pages boot in: the document's own section windows first, then the
// benches inside them, then the ink — last, once nothing is rearranging the DOM any more.
//
// Each bench is a side-effect module behind its own dynamic import, so a fault in one
// leaves the rest standing and the console names which one went. The drawn line comes
// last for the same reason: loaded statically, a failure anywhere in design/scripts would
// stop every bench before it ran.

const BENCHES = ["sequences", "pickers", "matrix", "gate", "lifetimes", "stores"];

try {
  const { mountWindows } = await import("../../design/scripts/window.js");
  const { wireSectionWindows } = await import("../../design/scripts/sections/section-window.js");
  wireSectionWindows(mountWindows(document));
} catch (error) {
  console.error("The section windows did not mount.", error);
}

for (const bench of BENCHES) {
  try {
    await import(`./${bench}.js`);
  } catch (error) {
    console.error(`The ${bench} bench failed to start.`, error);
  }
}

/*
 * Two levels up, not one: from `/architecture/scripts/` that reaches `/design/`. The Pages
 * build flattens the page onto the site root and rewrites this to one level.
 */
try {
  const { drawAlso, startInk } = await import("../../design/scripts/ink.js");
  drawAlso(
    ".node, .effect, .fields__row, .rung, .lane, .seam__layer, .lifetime, .version, .hue, .aside",
  );
  startInk();
} catch (error) {
  console.error("The drawn line did not start; the page reads on without it.", error);
}
