// The request a browser sends when it loads a page into a tab, which is the only request the
// desk-load sweep answers to. Not a test file itself, so bun never runs it.

/** A page navigation, with `headers` laid over the Fetch Metadata a browser sends for one. */
export function pageNavigation(headers: Record<string, string> = {}): RequestInit {
  return { headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", ...headers } };
}
