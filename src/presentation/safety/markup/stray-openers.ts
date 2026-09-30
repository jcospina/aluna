// A `<` the parser read as data must leave as data. Left raw, it waits for a neighbour: remove the
// node between `<` and `!x`, and a browser reads `<!x` as a bogus comment that swallows the next
// `>` — even one inside a quoted attribute — so what came after it goes live unseen. And where
// lol-html and a browser disagree on raw text (a `<style>` after `<svg/>`), a `</style` in a value
// or comment ends it early for the browser. `&lt;` reads as the same character everywhere a `<`
// was data, and never opens markup.

const OPENER = /</g;
/** A `<` that a browser reading markup would take as the start of a tag, end tag or comment. */
const MARKUP_OPENER = /<(?=[A-Za-z!/?]|$)/g;

function escapeOpeners(value: string): string {
  return value.replace(OPENER, "&lt;");
}

/** A text chunk handler: escape every `<` the parser read as text. */
export function escapeTextOpeners(text: HTMLRewriterTypes.Text): void {
  if (text.text.includes("<")) text.replace(escapeOpeners(text.text), { html: true });
}

/** A comment handler for a pass that keeps comments: escape every `<` inside one. */
export function escapeCommentOpeners(comment: HTMLRewriterTypes.Comment): void {
  if (comment.text.includes("<")) comment.text = escapeOpeners(comment.text);
}

/** Escape every `<` in a kept attribute's value; a browser decodes it back to the same value. */
export function escapeValueOpeners(value: string): string {
  return value.includes("<") ? escapeOpeners(value) : value;
}

/** Escape only a `<` that would open markup; `(width < 40rem)` keeps its `<`. */
export function escapeMarkupOpeners(css: string): string {
  return css.replace(MARKUP_OPENER, "&lt;");
}

/**
 * A `<style>` with content. An HTML one is raw text to lol-html and a browser alike; an SVG one is
 * markup, and removing an HTML element SVG content broke out through turns one into the other.
 */
export function isStyleElement(element: HTMLRewriterTypes.Element): boolean {
  return element.tagName.toLowerCase() === "style" && element.canHaveContent;
}

/**
 * Text handling for a pass that keeps `<style>`. In CSS `&lt;` stays four characters, so a style
 * keeps a `<` that opens nothing and loses only one that would, in either namespace. lol-html
 * splits text at every `<`, so each of a style's text nodes is judged whole.
 */
export function styleAwareTextOpeners(): {
  readonly element: (element: HTMLRewriterTypes.Element) => void;
  readonly text: (text: HTMLRewriterTypes.Text) => void;
} {
  let depth = 0;
  let pending = "";
  return {
    element(element) {
      if (!isStyleElement(element)) return;
      depth += 1;
      element.onEndTag(() => {
        depth -= 1;
      });
    },
    text(text) {
      if (depth === 0) return escapeTextOpeners(text);
      pending += text.text;
      if (!text.lastInTextNode) {
        text.remove();
        return;
      }
      text.replace(escapeMarkupOpeners(pending), { html: true });
      pending = "";
    },
  };
}
