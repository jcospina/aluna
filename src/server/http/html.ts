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
