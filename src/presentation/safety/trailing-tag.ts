/** Ends every tag state: either quote closes a value, the other lands in a name, `>` closes. */
const CLOSER = `"'">`;
const PROBE_TEXT = "x";

/**
 * Close a tag the markup leaves open at its end. lol-html passes such a tag through raw, unseen by
 * any handler, and the markup a record is wrapped in closes it for a browser: the attributes the
 * enforcer never judged go live. Closed here, the handlers judge it.
 */
export function closeTrailingTag(markup: string): string {
  const seen: { node: string; last: string | null } = { node: "", last: null };
  new HTMLRewriter()
    .onDocument({
      text(text) {
        seen.node += text.text;
        if (!text.lastInTextNode) return;
        seen.last = seen.node;
        seen.node = "";
      },
      comments() {
        seen.last = null;
      },
    })
    .transform(`${markup}${CLOSER}${PROBE_TEXT}`);
  // Read as data, the closer joins the probe's text node; only a closed tag leaves it alone.
  return seen.last === PROBE_TEXT ? `${markup}${CLOSER}` : markup;
}
