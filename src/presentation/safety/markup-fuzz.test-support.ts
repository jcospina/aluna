import { FRAGMENT_REMOVED_ELEMENTS } from "./fragment-safety.ts";
import { escapeMarkupOpeners, isStyleElement } from "./stray-openers.ts";
import { closeTrailingTag } from "./trailing-tag.ts";

// A seeded, deterministic fuzz for both sanitizers. Its alphabet is the parser-differential
// pieces: a removable node beside a lone `<`, comment and CDATA openers, raw-text elements after
// a self-closed `<svg/>`, quotes, the attributes that would run or reach out if they escaped, and
// the elements that open a document of their own or rewrite an attribute after it was judged.

const ALPHABET = [
  "<",
  ">",
  "!",
  "?",
  "-",
  "=",
  "/",
  "/=",
  " ",
  '"',
  "'",
  "t",
  "&lt;",
  "<!",
  "</",
  "<!---->",
  "<a></a>",
  "<script></script>",
  "[CDATA[",
  "<![CDATA[",
  "]]>",
  " x-data",
  " x-init='alert(1)'",
  " onerror=alert(1)",
  ' hx-swap-oob="true"',
  '<span title="',
  "<div",
  "</div>",
  "<p>",
  "<img src=x",
  "<a href=",
  "javascript:alert(1)",
  "<svg/>",
  "<svg>",
  "<math/>",
  "<svg><p>",
  "<style>",
  "</style>",
  "<textarea>",
  "</textarea>",
  "<title>",
  "<noscript>",
  "<style>@media (width < 40rem) {",
  '<iframe srcdoc="',
  "<object data=x>",
  "<embed src=x>",
  "<frameset><frame src=x>",
  "<fencedframe>",
  "<base href=//evil.example/>",
  "<meta http-equiv=refresh content=0;url=//evil.example/>",
  "<link rel=stylesheet href=//evil.example/x.css>",
  "<svg><a xlink:href=javascript:alert(1)>",
  "<animate attributeName=href values=javascript:alert(1)>",
  "<set attributeName=href to=javascript:alert(1)>",
  " srcdoc=x",
  " data-hx-swap-oob=true",
  " hx-select-oob=#desk",
  " data-hx-on:click=alert(1)",
  " hx-on::load=alert(1)",
  " hx-vars=a:alert(1)",
  " hx-vals='js:{a:alert(1)}'",
  ' hx-trigger="click[alert(1)]"',
  " hx-ext=sse",
  " data-sse-connect=/build/job-1/stream",
  " ws-send",
  " id=capability-logos hx-preserve",
  " data-hx-push-url=/capability/other",
];

/** `count` markup strings drawn from the alphabet by a mulberry32 stream seeded with `seed`. */
export function fuzzMarkup(seed: number, count: number): string[] {
  let state = seed;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (): string => ALPHABET[Math.floor(next() * ALPHABET.length)] ?? "";
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + Math.floor(next() * 20) }, pick).join(""),
  );
}

const LIVE_ATTRIBUTE =
  /^=|^(data-)?(on|x-|@|:|hx-on|hx-vars$|hx-swap-oob$|hx-select-oob$|hx-preserve$|hx-push-url$|hx-replace-url$|hx-ext$|sse-|ws-|srcdoc$|xlink:srcdoc$)/;

/** An attribute whose value runs: a script URL, an htmx `js:` value or trigger filter. */
function runsValue(lower: string, value: string): boolean {
  if (/(^|:)(href|action|formaction)$/.test(lower)) return /javascript:/i.test(value);
  if (/^(data-)?hx-trigger$/.test(lower)) return value.includes("[");
  return /^(data-)?hx-(vals|headers|request)$/.test(lower) && /^\s*(js|javascript):/i.test(value);
}

/**
 * What a re-parse of sanitized markup finds that it must not: a `<` read as data, in text, a
 * comment or (when `values`) an attribute value; an element or attribute that runs or reaches
 * out; a tag left open. In a `<style>` only a `<` that would open markup counts.
 */
export function leftoverOpeners(markup: string, values: boolean): string[] {
  const found: string[] = [];
  const style = { depth: 0, text: "" };
  new HTMLRewriter()
    .on("*", {
      element(element) {
        const tag = element.tagName.toLowerCase();
        if (FRAGMENT_REMOVED_ELEMENTS.has(tag)) found.push(`element ${tag}`);
        found.push(...attributeLeftovers(element, values));
        if (!isStyleElement(element)) return;
        style.depth += 1;
        element.onEndTag(() => {
          style.depth -= 1;
        });
      },
    })
    .onDocument({
      text(text) {
        if (style.depth === 0) {
          if (text.text.includes("<")) found.push("< in text");
          return;
        }
        style.text += text.text;
        if (!text.lastInTextNode) return;
        if (escapeMarkupOpeners(style.text) !== style.text) found.push("markup opener in style");
        style.text = "";
      },
      comments(comment) {
        if (comment.text.includes("<")) found.push("< in comment");
      },
    })
    .transform(markup);
  if (closeTrailingTag(markup) !== markup) found.push("open trailing tag");
  return found;
}

function attributeLeftovers(element: HTMLRewriterTypes.Element, values: boolean): string[] {
  return [...element.attributes].flatMap(([name, value]) => {
    const lower = name.toLowerCase();
    return [
      ...(LIVE_ATTRIBUTE.test(lower) ? [`attribute ${name}`] : []),
      ...(runsValue(lower, value) ? [`code in ${name}`] : []),
      ...(values && value.includes("<") ? [`< in ${name}`] : []),
    ];
  });
}
