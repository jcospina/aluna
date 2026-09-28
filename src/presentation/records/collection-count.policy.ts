import { describe, expect, test } from "bun:test";
import { readSource } from "../safety/source.test-support.ts";

describe("CSS parity", () => {
  const css = readSource("public/css/collection.css").replace(/\/\*[\s\S]*?\*\//g, "");

  /** The declarations of the rule whose selector list is exactly `selector`. */
  function body(selector: string): string {
    const rule = css.split("}").find((block) => block.split("{")[0]?.trim() === selector);
    return rule?.split("{")[1]?.trim() ?? "";
  }

  test("the count label owns its own box rather than the paragraph margin", () => {
    expect(body(".capability-count")).toContain("margin: 0");
  });

  test("an empty count takes no room, so a bare collection states its emptiness once", () => {
    expect(body(".capability-count:empty")).toContain("display: none");
  });
});
