import { describe, expect, test } from "bun:test";
import { CHECKS, clock, listed, PARTS, READY, STAGES, say } from "#design/narration/voice.js";

/** Every line the window can say, with the holes the narrator fills for it. */
function everyLine(): { line: string; holes: readonly string[] }[] {
  const named = ["thing", "things", "label", "fields"];
  return [
    ...Object.entries(STAGES).flatMap(([stage, { lines }]) =>
      lines.map((line) => ({
        line,
        holes:
          stage === "mend"
            ? [...named, "piece"]
            : stage === "connect"
              ? [...named, "field", "target"]
              : named,
      })),
    ),
    ...Object.values(PARTS).flatMap(({ lines }) => lines.map((line) => ({ line, holes: named }))),
    ...Object.values(CHECKS).flatMap((lines) => lines.map((line) => ({ line, holes: named }))),
    { line: READY, holes: ["time"] },
  ];
}

describe("what a build says while it runs", () => {
  test("every hole a line names is one the narrator fills, so no brace ever shows", () => {
    for (const { line, holes } of everyLine()) {
      const values = Object.fromEntries(holes.map((hole) => [hole, `<${hole}>`]));
      expect(say(line, values), line).not.toMatch(/[{}]/);
    }
  });

  test("a line said before the build has named its thing still reads, with no brace", () => {
    for (const { line, holes } of everyLine()) {
      if (holes.includes("piece") || holes.includes("field") || holes.includes("time")) continue;
      expect(say(line, {}), line).not.toMatch(/[{}]/);
    }
  });

  test("a hole that opens a line still opens a sentence", () => {
    expect(say("{label} rests here.", { label: "recipes" })).toBe("Recipes rests here.");
  });

  test("fields are listed the way a sentence lists them", () => {
    expect(listed([])).toBe("");
    expect(listed(["Recipe"])).toBe("Recipe");
    expect(listed(["Recipe", "Serves"])).toBe("Recipe and Serves");
    expect(listed(["Recipe", "Serves", "Course"])).toBe("Recipe, Serves and Course");
  });

  test("a long list names its first few and counts the rest, never just one more", () => {
    const labels = ["Recipe", "Serves", "Course", "Cuisine", "Time"];
    expect(listed(labels, 5)).toBe("Recipe, Serves, Course, Cuisine and Time");
    expect(listed(labels, 4)).toBe("Recipe, Serves, Course and 2 more");
    expect(listed(labels, 2)).toBe("Recipe and 4 more");
  });

  test("a wait reads the way a clock shows it", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(9_400)).toBe("0:09");
    expect(clock(118_000)).toBe("1:58");
  });
});
