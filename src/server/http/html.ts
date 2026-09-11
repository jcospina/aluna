// HTML-safety primitive shared by the route layer's fragment renderers.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape interpolated text before it is placed into HTML: provider-authored or user-derived text
 * inside a fragment. Streamed plain-text narration is safe on the client and is not escaped here.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/* Both derived from the table above rather than restated beside it: a sixth entity added there
 * would otherwise leave this reading its own text back wrong, and silently. */
const HTML_UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(HTML_ESCAPES).map(([character, entity]) => [entity, character]),
);
const HTML_ENTITIES = new RegExp(Object.values(HTML_ESCAPES).join("|"), "g");

/** The inverse of {@link escapeHtml}: a fragment's text as the person who reads it sees it. */
export function unescapeHtml(value: string): string {
  return value.replace(HTML_ENTITIES, (entity) => HTML_UNESCAPES[entity] ?? entity);
}
