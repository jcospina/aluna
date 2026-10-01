// How the choice-picker double reads a selector: a leaf, so the double and anything else can share
// it without importing the double. Only the syntax the shell's own selectors use is understood.

/** One parsed selector step: a tag, some classes, and attribute tests held and refused. */
export interface Step {
  readonly tag: string | null;
  readonly classes: readonly string[];
  readonly attributes: readonly (readonly [string, string | null])[];
  readonly refused: readonly (readonly [string, string | null])[];
}

const ATTRIBUTE_TEST = /\[([a-zA-Z0-9_-]+)(?:=["']?([^\]"']*)["']?)?\]/g;
const NEGATION = /:not\((\[[^\]]+\])\)/g;
/** An attribute test whose value is quoted, the one place a browser reads a colon as a value's. */
const QUOTED_ATTRIBUTE_TEST = /\[[a-zA-Z0-9_-]+=(["'])[^"']*\1\]/g;

const attributeTests = (part: string) =>
  [...part.matchAll(ATTRIBUTE_TEST)].map(
    (match) => [match[1] as string, match[2] ?? null] as const,
  );

export function parseSelector(selector: string): Step[] {
  // The browser throws a `SyntaxError` for an empty selector; answering "nothing matches" would
  // let a selector constant emptied by mistake pass as a query that simply found nothing.
  if (selector.trim() === "") throw new SyntaxError(`not a selector: "${selector}"`);
  return selector
    .trim()
    .split(/\s+(?![^[]*\])/)
    .map((part) => {
      const held = part.replace(NEGATION, "");
      // Any other pseudo-class is refused rather than ignored: skipping one turned
      // `button:not([disabled])` into `button[disabled]`, the exact inverse. A colon inside an
      // attribute's quoted value, as in `[data-ink-role="well:0"]`, is that value's.
      if (/:/.test(held.replace(QUOTED_ATTRIBUTE_TEST, ""))) {
        throw new Error(`Unsupported selector in the DOM double: ${selector}`);
      }
      // Whatever the steps below do not read — a combinator, a `*`, an escape — is refused too.
      const unread = held
        .replace(/^[a-zA-Z][a-zA-Z0-9-]*/, "")
        .replace(ATTRIBUTE_TEST, "")
        .replace(/[.#][a-zA-Z0-9_-]+/g, "");
      if (unread !== "") throw new Error(`Unsupported selector in the DOM double: ${selector}`);
      return {
        tag: /^[a-zA-Z][a-zA-Z0-9-]*/.exec(held)?.[0] ?? null,
        classes: [...held.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((match) => match[1] as string),
        attributes: [
          ...attributeTests(held),
          ...[...held.matchAll(/#([a-zA-Z0-9_-]+)/g)].map(
            (match) => ["id", match[1] as string] as const,
          ),
        ],
        refused: [...part.matchAll(NEGATION)].flatMap((match) => attributeTests(match[1] ?? "")),
      };
    });
}
