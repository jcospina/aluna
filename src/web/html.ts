// HTML-safety primitive shared by the route layer's fragment renderers.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape interpolated text before it is placed into HTML. Used wherever
 * provider-authored or user-derived text rides inside an HTML fragment (the SSE
 * `fragment` events, the build-subscriber markup). Streamed plain-text narration is
 * safe by construction on the client and is not escaped here.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}
