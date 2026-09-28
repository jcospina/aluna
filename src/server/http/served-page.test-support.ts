// A served page read the way a browser reads it rather than as a string: attribute order, quoting
// and whitespace are the parser's business, so a reformatted page asserts the same as before.

import { unescapeHtml } from "./html.ts";

/** One element of a served page, in document order. */
export interface ServedElement {
  readonly tag: string;
  readonly attributes: ReadonlyMap<string, string>;
  /** Every word inside it, its descendants' included, whitespace collapsed. */
  readonly text: string;
  /** The ids of the elements it stands inside, outermost first. */
  readonly within: readonly string[];
  /** How many elements it stands inside: its descendants are the run after it that stand deeper. */
  readonly depth: number;
}

/** Every element `html` holds, with its attributes decoded and its text gathered. */
export async function elementsOf(html: string): Promise<readonly ServedElement[]> {
  const found: Array<{
    tag: string;
    attributes: Map<string, string>;
    words: string[];
    within: string[];
    depth: number;
  }> = [];
  const open: Array<(typeof found)[number]> = [];
  await new HTMLRewriter()
    .on("*", {
      element(element) {
        const entry = {
          tag: element.tagName,
          attributes: new Map(
            [...element.attributes].map(([name, value]) => [name, unescapeHtml(value)]),
          ),
          words: [],
          within: open
            .map((parent) => parent.attributes.get("id"))
            .filter((id) => id !== undefined),
          depth: open.length,
        };
        found.push(entry);
        if (!element.canHaveContent) return;
        open.push(entry);
        element.onEndTag(() => {
          open.pop();
        });
      },
      text(chunk) {
        for (const entry of open) entry.words.push(chunk.text);
      },
    })
    .transform(new Response(html))
    .text();
  return found.map(({ tag, attributes, words, within, depth }) => ({
    tag,
    attributes,
    text: unescapeHtml(words.join("")).replaceAll(/\s+/g, " ").trim(),
    within,
    depth,
  }));
}

/** Every element inside `element`, which has to be one of `elements`, in document order. */
export function descendantsOf(
  elements: readonly ServedElement[],
  element: ServedElement,
): readonly ServedElement[] {
  const at = elements.indexOf(element);
  if (at < 0) throw new Error("not an element of this page");
  const after = elements.slice(at + 1);
  const end = after.findIndex((next) => next.depth <= element.depth);
  return end < 0 ? after : after.slice(0, end);
}

/** The one element carrying this id, or a failure naming the id when there is none or several. */
export function byId(elements: readonly ServedElement[], id: string): ServedElement {
  const matches = elements.filter((element) => element.attributes.get("id") === id);
  if (matches.length !== 1) throw new Error(`expected one #${id}, found ${matches.length}`);
  return matches[0] as ServedElement;
}

/** One script the page loads: where from, and whether the browser runs it as a module. */
export interface ServedScript {
  readonly src: string;
  readonly type: string | undefined;
}

/** Every script the page loads, in the order the browser meets them. */
export function scriptsOf(elements: readonly ServedElement[]): readonly ServedScript[] {
  return elements
    .filter((element) => element.tag === "script" && element.attributes.has("src"))
    .map((element) => ({
      src: element.attributes.get("src") as string,
      type: element.attributes.get("type"),
    }));
}

/** The `src` of every script the page loads, in the order the browser meets them. */
export function scriptSources(elements: readonly ServedElement[]): readonly string[] {
  return scriptsOf(elements).map(({ src }) => src);
}

/** The `src` of every script the browser runs as a module: a classic tag cannot `import`. */
export function moduleSources(elements: readonly ServedElement[]): readonly string[] {
  return scriptsOf(elements)
    .filter(({ type }) => type === "module")
    .map(({ src }) => src);
}
