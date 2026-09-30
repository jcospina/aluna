const CDATA_OPENER = "<![CDATA[";

/**
 * Escape every CDATA opener before lol-html reads the markup. After a self-closed `<svg/>` or
 * `<math/>` lol-html still believes it is in foreign content and passes a CDATA section through as
 * text, while a browser, which knows it left, reads a bogus comment that ends at the first `>`:
 * markup hidden after that went live, Alpine directives included. Escaped, both read text.
 */
export function escapeCdataOpeners(markup: string): string {
  return markup.replaceAll(CDATA_OPENER, "&lt;![CDATA[");
}
