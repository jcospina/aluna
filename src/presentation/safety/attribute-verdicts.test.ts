import { describe, expect, test } from "bun:test";

import {
  type AttributeHost,
  MAX_ATTRIBUTE_REWRITES,
  rewriteAttributes,
} from "./attribute-verdicts.ts";
import { enforceItemMarkup } from "./enforcer.ts";
import { enforceHandlerFragment } from "./fragment-safety.ts";

// lol-html rescans a start tag for every attribute it removes or changes, so both sanitizers cap
// the rewrites one tag can take. The guard is structural, a count of calls, never a stopwatch.

const OVER = MAX_ATTRIBUTE_REWRITES + 1;

function countingHost(attributes: [string, string][]): AttributeHost & { calls: number } {
  const host = {
    attributes,
    calls: 0,
    removeAttribute: () => {
      host.calls += 1;
    },
    setAttribute: () => {
      host.calls += 1;
    },
  };
  return host;
}

const distinct = (count: number): [string, string][] =>
  Array.from({ length: count }, (_, i): [string, string] => [`on${i}`, "x"]);

describe("attribute rewrites are bounded per start tag", () => {
  test("past the bound nothing is rewritten, whether the names are distinct or repeated", () => {
    const repeated = Array.from({ length: OVER }, (): [string, string] => ["title", "x"]);
    for (const attributes of [distinct(OVER), repeated]) {
      const host = countingHost(attributes);
      expect(rewriteAttributes(host, () => null)).toBeUndefined();
      expect(host.calls).toBe(0);
    }
  });

  test("within the bound, each removal is one call", () => {
    const host = countingHost(distinct(MAX_ATTRIBUTE_REWRITES));
    expect(rewriteAttributes(host, () => null)).toBe(MAX_ATTRIBUTE_REWRITES);
    expect(host.calls).toBe(MAX_ATTRIBUTE_REWRITES);
  });

  test("a start tag past the bound goes whole in the item enforcer; its content stays", () => {
    const attributes = distinct(OVER)
      .map(([name]) => `data-${name}=x`)
      .join(" ");
    expect(enforceItemMarkup(`<div><span ${attributes}>t</div><p>x</p>`)).toBe(
      "<div>t</div><p>x</p>",
    );
  });

  test("a start tag past the bound goes whole in a Handler's fragment, and is reported", () => {
    const attributes = distinct(OVER)
      .map(([name]) => `${name}=x`)
      .join(" ");
    expect(enforceHandlerFragment(`<form ${attributes}>t</form>`)).toEqual({
      html: "t",
      neutralized: true,
    });
    // A style that loses its start tag leaves its CSS as text, escaped as text is.
    const once = enforceHandlerFragment(`<style ${attributes}>a < b</style>`).html;
    expect(once).toBe("a &lt; b");
    expect(enforceHandlerFragment(once).html).toBe(once);
  });
});
