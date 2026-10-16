import { randomUUID } from "node:crypto";

/**
 * The element a card's markup is held in, beside the broken-link mark. No HTML element has its
 * name, so no end tag the markup holds, matched or not, can close it.
 */
export const CARD_BODY_TAG = "aluna-card-body";

/**
 * What a record's card stands in: its wrapper, the element its markup is held in, the collection
 * and window around them, and the template htmx parses a swapped list in. An end tag for one, with
 * no start tag in the card's markup, closes the element around the card.
 */
const CONTAINERS = [
  "button",
  "article",
  CARD_BODY_TAG,
  "span",
  "div",
  "section",
  "main",
  "template",
] as const;

/**
 * What a browser carries past a card left open: a formatting element, which it opens again
 * around the next card, and a table, which keeps the card's own end tag from closing it. Nothing
 * else is closed here: an end tag written for an element a browser had already closed some other
 * way would close the element around it, where one for a formatting element or a table with none
 * open is ignored.
 */
const CARRIED = new Set([
  ..."a b big code em font i nobr s small strike strong tt u".split(" "),
  "table",
]);

const FENCE = "data-aluna-fence";

/**
 * A record's markup kept inside its card: an end tag that closes nothing of its own goes, so the
 * markup cannot close the card or the collection around it, and what a browser would carry past
 * the card is closed. Markup with neither is returned as it came, and a second pass changes
 * nothing.
 */
export function containedMarkup(markup: string): string {
  let contained = markup;
  for (const name of CONTAINERS) contained = withoutStrayEndTags(contained, name);
  return closedAtItsEnd(contained);
}

/** The most fences one pass stands: lol-html slows with the depth of what is open. */
const FENCES_PER_PASS = 1024;

/**
 * `markup` without the end tags for `name` that close nothing it opened. lol-html passes such a
 * tag through unseen, so the markup is fenced in one `name` per end tag it leaves unmatched: a
 * stray closes a fence early and goes, and whatever closing tags of ours are left over at the end
 * go with it.
 */
function withoutStrayEndTags(markup: string, name: string): string {
  let current = markup;
  for (let unmatched = unmatchedEndTags(current, name); unmatched > 0; ) {
    const fenced = unfenced(current, name, Math.min(unmatched, FENCES_PER_PASS));
    if (fenced === current) return current;
    current = fenced;
    unmatched = unmatchedEndTags(current, name);
  }
  return current;
}

/**
 * How many `</name` the markup holds that close no `name` it opened, counted high: one inside an
 * attribute or a comment counts too, and only costs a fence.
 */
function unmatchedEndTags(markup: string, name: string): number {
  const written = markup.toLowerCase().split(`</${name}`).length - 1;
  if (written === 0) return 0;
  let matched = 0;
  new HTMLRewriter()
    .on(name, {
      element(element) {
        element.onEndTag((end) => {
          if (end.name.toLowerCase() === name) matched += 1;
        });
      },
    })
    .transform(markup);
  return written - matched;
}

/** One pass of `withoutStrayEndTags`, with `fences` fences. */
function unfenced(markup: string, name: string, fences: number): string {
  const open = `<${name} ${FENCE}>`;
  const close = `</${name}>`;
  const marker = `aluna-fence-${randomUUID()}`;
  let unmarked = fences;
  const fenced = new HTMLRewriter()
    .on(`${name}[${FENCE}]`, {
      element(element) {
        if (unmarked === 0) return;
        unmarked -= 1;
        element.onEndTag((end) => {
          end.before(marker);
          end.remove();
        });
      },
    })
    .transform(`${open.repeat(fences)}${markup}${close.repeat(fences)}`);
  if (!fenced.startsWith(open.repeat(fences))) return markup;
  // Our closing tags come last, each a marker or left as written: measured, not sliced off.
  let end = fenced.length;
  for (let left = fences; left > 0; left -= 1) {
    if (fenced.startsWith(marker, end - marker.length)) end -= marker.length;
    else if (fenced.startsWith(close, end - close.length)) end -= close.length;
    else return markup;
  }
  return fenced.slice(open.length * fences, end).replaceAll(marker, "");
}

/**
 * `markup` with each formatting element and table it opens closed by its own end tag: before the
 * ancestor's end tag that closes it in lol-html's reading, or at the end. Markup left open or
 * misnested closes each formatting element again (`resetLength`), since a browser's adoption
 * agency gives up after eight blocks and keeps a copy to reopen. Well-formed markup comes back as
 * it came.
 */
function closedAtItsEnd(markup: string): string {
  const opened: { tag: string; closed: boolean; carried: boolean }[] = [];
  let misnested = false;
  const closed = new HTMLRewriter()
    .on("*", {
      element(element) {
        const tag = element.tagName.toLowerCase();
        const entry = { tag, closed: false, carried: CARRIED.has(tag) };
        opened.push(entry);
        if (!element.canHaveContent) {
          entry.closed = true;
          return;
        }
        // lol-html runs these innermost first, so end tags written before one ancestor's nest.
        element.onEndTag((end) => {
          entry.closed = true;
          if (end.name.toLowerCase() === tag) return;
          misnested = true;
          if (entry.carried) end.before(`</${tag}>`, { html: true });
        });
      },
    })
    .transform(markup);
  const left = opened.filter((entry) => !entry.closed);
  const whole =
    closed +
    left
      .filter((entry) => entry.carried)
      .reverse()
      .map(endTagOf)
      .join("");
  if (!misnested && left.length === 0) return whole;
  const styles = new Set(
    opened.filter((entry) => entry.carried && entry.tag !== "table").map((entry) => entry.tag),
  );
  const reset = [...styles].map((tag) => `</${tag}>`.repeat(resetLength(opened.length))).join("");
  // A second pass finds the reset already written, so it changes nothing.
  return whole.endsWith(reset) ? whole : whole + reset;
}

function endTagOf(entry: { readonly tag: string }): string {
  return `</${entry.tag}>`;
}

/** End tags enough for one per eight blocks the markup could leave open, and one more; an end
 * tag with nothing to close is ignored. */
function resetLength(elements: number): number {
  return Math.ceil(elements / 8) + 1;
}
