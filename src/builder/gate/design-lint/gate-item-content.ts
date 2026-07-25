// Project safe item markup onto the content a user can perceive. Design lint compares this
// projection across controlled record probes so layout classes/styles alone cannot pretend
// that a renderer communicates record data.

const CONTENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "datetime",
  "label",
  "poster",
  "src",
  "srcset",
  "title",
  "value",
]);

/** Return an opaque, stable signature of perceivable text, media, and accessible content. */
export function observableItemRecordContent(markup: string): string {
  const attributes: string[] = [];
  let text = "";
  new HTMLRewriter()
    .on("*", {
      element(element): void {
        for (const [name, value] of element.attributes) {
          const lower = name.toLowerCase();
          if (CONTENT_ATTRIBUTES.has(lower) && value.trim()) {
            attributes.push(`${element.tagName.toLowerCase()}:${lower}=${value.trim()}`);
          }
        }
      },
      text(chunk): void {
        text += chunk.text;
      },
    })
    .transform(markup);
  const visibleText = text.replace(/\s+/g, " ").trim();
  return visibleText.length === 0 && attributes.length === 0
    ? ""
    : JSON.stringify({ text: visibleText, attributes });
}
