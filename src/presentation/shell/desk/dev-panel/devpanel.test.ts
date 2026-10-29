// The developer panel's contents: eight stages, each a code block.
//
// The panel is the one surface in Aluna that shows a payload rather than a sentence,
// and the terminal reading goes only so far — a drawn frame, a caption
// naming the stage and the bytes that came down the wire, and the payload in a well,
// tinted with the palette's own anchors. What is pinned here is the part a careful
// reader cannot check by looking: that a key is not tinted as a string and that a payload
// can never become markup. `devpanel.policy.ts` holds the sheet to the five tints, and
// `devpanel.reading.test.ts` and `devpanel.selecting.test.ts` run the reader's controls.

import { describe, expect, test } from "bun:test";
import {
  clearStages,
  DEV_STAGES,
  devPanelBody,
  formatPayloadSize,
  RESTING_PAYLOAD,
  writeStage,
} from "#design/desk/devpanel.js";
import { type FakeElement, FakeEvent, FakeText, usePanelDom } from "./devpanel-dom.test-support.ts";
import { at } from "./devpanel-fixture.test-support.ts";

usePanelDom();

const panelBody = () => devPanelBody() as unknown as FakeElement;
const blocks = (panel: FakeElement) => panel.querySelectorAll(".devpanel__block");
const blockFor = (panel: FakeElement, stage: string) =>
  blocks(panel).find((block) => block.dataset.stage === stage) as FakeElement;
const codeIn = (block: FakeElement) => block.querySelector(".devpanel__code") as FakeElement;
const TINT = /^devpanel__(key|string|number|atom|punct)$/;
const tints = (block: FakeElement) =>
  codeIn(block)
    .descendants()
    .filter((el) => TINT.test(el.className))
    .map((span) => [span.className, span.textContent] as const);

/** Every run of text on screen in the well that no tint claimed. */
const untinted = (node: FakeElement): string[] =>
  node.childNodes.flatMap((child) => {
    if (child instanceof FakeText) return [child.data];
    if (TINT.test(child.className) || child.classList.contains("devpanel__unseen")) return [];
    return untinted(child);
  });

describe("the eight stages", () => {
  test("are the stream's own, in the order a build reaches them", () => {
    expect(DEV_STAGES.map((stage) => stage.key)).toEqual([
      "metrics",
      "spec",
      "candidate",
      "migration",
      "behavioral-tests",
      "units",
      "gate",
      "commit",
    ]);
    // Every stage carries the product-voice line for the same moment. It is never printed here,
    // but the two are held together so a stage cannot be added to one and forgotten in the other.
    for (const stage of DEV_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.line.length).toBeGreaterThan(0);
    }
  });

  test("all eight stand from the start, resting rather than absent", () => {
    // The set is the information: a build that never reached the Gate is legible only
    // if the Gate's block is standing there empty.
    const panel = panelBody();
    expect(blocks(panel)).toHaveLength(8);
    // Resting is a mark, not an absence.
    expect(RESTING_PAYLOAD.trim()).not.toBe("");
    for (const block of blocks(panel)) {
      expect(codeIn(block).textContent).toBe(RESTING_PAYLOAD);
      expect(block.classList.contains("is-filled")).toBe(false);
      expect(block.querySelector(".devpanel__stage")).not.toBeNull();
      expect(block.querySelector(".devpanel__size")).not.toBeNull();
      // Asked for by name, so the boundary around a payload is drawn like every other
      // boundary on the desk rather than ruled (`[data-ink]` is in `INK_SELECTOR`).
      expect(block.dataset.ink).toBe("");
    }
  });
});

describe("what a payload is worth saying about itself", () => {
  test("the caption counts bytes on the wire, not characters", () => {
    expect(formatPayloadSize("")).toBe("0 B");
    expect(formatPayloadSize("x".repeat(999))).toBe("999 B");
    expect(formatPayloadSize("x".repeat(1024))).toBe("1.0 kB");
    expect(formatPayloadSize("x".repeat(1024 * 4 + 512))).toBe("4.5 kB");
    // From ten on, a tenth of a kB is noise rather than information.
    expect(formatPayloadSize("x".repeat(1024 * 10))).toBe("10 kB");
    expect(formatPayloadSize("x".repeat(1024 * 24))).toBe("24 kB");
    // A three-byte character is three bytes, because that is what was sent.
    expect(formatPayloadSize("☕")).toBe("3 B");
  });
});

describe("a payload in a code block", () => {
  test("is pretty-printed, tinted by kind, and counted", () => {
    const panel = panelBody();
    const raw =
      '{"label":"Notes","fields":6,"strict":true,"prior":null,"none":{},' +
      '"tags":["a",2,false],"empty":[],"nested":[{"x":-1.5e+3}]}';
    expect(writeStage(panel, "spec", raw)).toBe(true);

    const block = blockFor(panel, "spec");
    expect(block.classList.contains("is-filled")).toBe(true);
    expect(block.querySelector(".devpanel__size")?.textContent).toBe(formatPayloadSize(raw));

    const kinds = Object.fromEntries(tints(block).map(([className, text]) => [text, className]));
    // A key carries the colon that makes it one, so it is never tinted as a string.
    expect(kinds['"label":']).toBe("devpanel__key");
    expect(kinds['"Notes"']).toBe("devpanel__string");
    expect(kinds["6"]).toBe("devpanel__number");
    expect(kinds.true).toBe("devpanel__atom");
    expect(kinds.null).toBe("devpanel__atom");
    expect(kinds["{"]).toBe("devpanel__punct");
    expect(kinds["{}"]).toBe("devpanel__punct");
    expect(kinds["[]"]).toBe("devpanel__punct");

    // Tinting changes how it reads, never what it says: with no string spanning lines, pretty
    // is exactly the two-space indent.
    expect(codeIn(block).textContent).toBe(JSON.stringify(JSON.parse(raw), null, 2));
    expect(codeIn(block).classList.contains("is-tree")).toBe(true);
  });

  test("read raw, is the payload as it arrived, every token tinted by kind", () => {
    const panel = panelBody();
    const raw =
      '{ "a" : -12.5e+10, "b":[true,false,null, 1E-3, 100, 0, 3.14159, 2e5, 90], "c":"x" }';
    writeStage(panel, "spec", raw);
    const block = blockFor(panel, "spec");
    (block.querySelector('[data-devpanel-action="format"]') as FakeElement).dispatchEvent(
      new FakeEvent("click"),
    );

    expect(codeIn(block).textContent).toBe(raw);
    expect(codeIn(block).classList.contains("is-tree")).toBe(false);
    const comma = ["devpanel__punct", ","] as const;
    expect(tints(block)).toEqual([
      ["devpanel__punct", "{"],
      ["devpanel__key", '"a" :'],
      ["devpanel__number", "-12.5e+10"],
      comma,
      ["devpanel__key", '"b":'],
      ["devpanel__punct", "["],
      ["devpanel__atom", "true"],
      comma,
      ["devpanel__atom", "false"],
      comma,
      ["devpanel__atom", "null"],
      comma,
      ["devpanel__number", "1E-3"],
      comma,
      ["devpanel__number", "100"],
      comma,
      ["devpanel__number", "0"],
      comma,
      ["devpanel__number", "3.14159"],
      comma,
      ["devpanel__number", "2e5"],
      comma,
      ["devpanel__number", "90"],
      ["devpanel__punct", "]"],
      ["devpanel__punct", ","],
      ["devpanel__key", '"c":'],
      ["devpanel__string", '"x"'],
      ["devpanel__punct", "}"],
    ]);
  });
});

describe("a string that spans lines, read pretty", () => {
  test("a string that spans lines is set out as those lines, and says how it ends", () => {
    for (const source of ["const a = 1;\n  return a;\n", "SELECT 1\nFROM t"]) {
      const panel = panelBody();
      const raw = JSON.stringify({ units: [{ content: source }] });
      writeStage(panel, "units", raw);
      const code = codeIn(blockFor(panel, "units"));

      // The lines and then the closing quote, so a trailing line break is there to be seen.
      const lines = code.querySelector(".devpanel__lines") as FakeElement;
      expect(lines.textContent).toBe(`${source}"`);
      // A line of the code each, drawn at its own indent; the indent stays in the text, unseen.
      const sourceLines = source.split("\n");
      expect(lines.children.map((row) => row.className)).toEqual(
        sourceLines.map(() => "devpanel__codeline"),
      );
      expect(lines.children.map((row) => row.getAttribute("style"))).toEqual(
        sourceLines.map((line) => {
          const lead = line.length - line.trimStart().length;
          return lead > 0 ? `--devpanel-lead: ${lead}` : null;
        }),
      );
      // It ends on a closing quote tinted as the string it closes, and opens on one too.
      expect(lines.children.at(-1)?.children.at(-1)?.className).toBe("devpanel__string");
      const opening = lines.parent?.parent?.children.find((part) => part.textContent === '"');
      expect(opening?.className).toBe("devpanel__string");
      // Its text is the pretty payload with the string's line breaks real, and nothing added.
      const opened = JSON.stringify(JSON.parse(raw), null, 2).replace(
        JSON.stringify(source),
        `"${source}"`,
      );
      expect(code.textContent).toBe(opened);
    }
  });

  test("a string that spans lines ends its last line with the comma that follows it", () => {
    const panel = panelBody();
    const raw = JSON.stringify({ units: [{ content: "a\nb", durationMs: 4 }] });
    writeStage(panel, "units", raw);
    const code = codeIn(blockFor(panel, "units"));
    const lines = code.querySelector(".devpanel__lines") as FakeElement;
    const shown = lines.children
      .at(-1)
      ?.children.filter((part) => !part.classList.contains("devpanel__unseen"));
    expect(shown?.map((part) => part.textContent)).toEqual(['"', ","]);
    // No row of its own: the line that holds the string has no comma but the one in its code.
    const line = lines.parent?.parent?.parent as FakeElement;
    expect(line.children.filter((part) => part.textContent === ",")).toEqual([]);
    expect(code.textContent).toBe(
      JSON.stringify(JSON.parse(raw), null, 2).replace(JSON.stringify("a\nb"), '"a\nb"'),
    );
    // Folded, the comma is still drawn after what the fold leaves showing.
    const elided = lines.parent?.parent?.children.find((part) =>
      part.classList.contains("devpanel__elided"),
    );
    expect(elided?.dataset.elided).toEndWith('",');
  });
});

describe("the folds of a payload read pretty", () => {
  test("every fold says how much it would hide", () => {
    const panel = panelBody();
    const raw = JSON.stringify({
      one: { a: 1 },
      two: [1, 2],
      solo: [1],
      text: "a\nb\n",
      more: "a\nb\nc",
      single: "a\n",
    });
    writeStage(panel, "spec", raw);
    const code = codeIn(blockFor(panel, "spec"));
    // A node's own count is its direct child; any deeper one belongs to a node inside it.
    const said = (path: string) => {
      const node = code.querySelector(`[data-path="${path.replaceAll('"', '\\"')}"]`);
      const elided = node?.children.find((part) => part.classList.contains("devpanel__elided"));
      const [, count = "", word = ""] = /(\d+) ([a-z]+)/.exec(elided?.dataset.elided ?? "") ?? [];
      return { count: Number(count), word };
    };

    const counts = {
      "": 6,
      [at("one")]: 1,
      [at("two")]: 2,
      [at("solo")]: 1,
      [at("text")]: 2,
      [at("more")]: 3,
      [at("single")]: 1,
    };
    for (const [path, count] of Object.entries(counts)) {
      expect(said(path).count, path).toBe(count);
      expect(said(path).word, path).not.toBe("");
    }
    // One of a thing is said as itself, and more than one as its plural.
    for (const [one, many] of [
      [at("one"), ""],
      [at("solo"), at("two")],
      [at("single"), at("text")],
    ] as const) {
      expect(said(many).word).toStartWith(said(one).word);
      expect(said(many).word).not.toBe(said(one).word);
    }
    expect(said(at("one")).word).not.toBe(said(at("solo")).word);
    expect(said(at("solo")).word).not.toBe(said(at("single")).word);
  });

  test("every fold is a labelled button, and only one of a well's folds takes Tab", () => {
    const panel = panelBody();
    writeStage(panel, "spec", JSON.stringify({ list: [{ a: [1] }], text: "a\nb", "": [2] }));
    const twists = codeIn(blockFor(panel, "spec")).querySelectorAll(".devpanel__twist");
    expect(twists.length).toBe(6);
    for (const twist of twists) {
      expect(twist.tagName).toBe("BUTTON");
      expect(twist.getAttribute("type")).toBe("button");
      expect(twist.getAttribute("aria-label")?.trim()).not.toBe("");
      expect(twist.getAttribute("aria-expanded")).toBe("true");
    }
    // The root fold is named for its stage, every other for its key or its place in a list.
    expect(twists.map((twist) => twist.getAttribute("aria-label"))).toEqual([
      blockFor(panel, "spec").querySelector(".devpanel__stage")?.textContent ?? "",
      "list",
      "[0]",
      "a",
      "text",
      '""',
    ]);
    expect(twists.map((twist) => twist.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
      "-1",
      "-1",
      "-1",
    ]);
  });
});

describe("a payload that is not JSON, or is hostile, or long", () => {
  test("that is not JSON lands as it arrived, untinted, with no other reading to offer", () => {
    // A stage that one day sends a stack trace or a bare line of SQL still has
    // somewhere to land, and is shown as what it is rather than dressed as JSON.
    const panel = panelBody();
    expect(writeStage(panel, "migration", "CREATE TABLE notes (id TEXT PRIMARY KEY);")).toBe(true);
    const block = blockFor(panel, "migration");
    expect(codeIn(block).textContent).toBe("CREATE TABLE notes (id TEXT PRIMARY KEY);");
    expect(tints(block)).toHaveLength(0);
    expect(block.querySelector('[data-devpanel-action="format"]')?.hasAttribute("hidden")).toBe(
      true,
    );
  });

  test("can never become markup", () => {
    // A payload is data from a build. It is written as text nodes, so a capability
    // label a model authored cannot close the block and open something else.
    const panel = panelBody();
    writeStage(panel, "commit", JSON.stringify({ label: "<img src=x onerror=alert(1)>" }));
    const block = blockFor(panel, "commit");
    expect(codeIn(block).textContent).toContain("<img src=x onerror=alert(1)>");
  });

  test("is tinted end to end however long it is, in either reading", () => {
    // A character budget once stopped the colour partway through: the metrics payload's third
    // `gateRungs` sat at 19,949, fifty before the cap.
    const panel = panelBody();
    const wide = JSON.stringify({
      rungs: Array.from({ length: 900 }, (_, i) => ({
        rung: `rung-number-${i}`,
        status: "passed",
        durationMs: i,
      })),
    });
    writeStage(panel, "gate", wide);
    const block = blockFor(panel, "gate");
    const format = block.querySelector('[data-devpanel-action="format"]') as FakeElement;

    for (const reading of ["pretty", "raw"]) {
      expect(tints(block).length, reading).toBeGreaterThan(2_000);
      // Nothing rode through as plain text but the whitespace between tokens.
      expect(untinted(codeIn(block)).join("").trim(), reading).toBe("");
      format.dispatchEvent(new FakeEvent("click"));
    }
  });

  test("a payload too deep or too strange to draw as a tree still shows, read raw", () => {
    const panel = panelBody();
    // Deeper than the stack a tree is drawn with, though not too deep to parse.
    const deep = `${"[".repeat(50_000)}${"]".repeat(50_000)}`;
    expect(writeStage(panel, "gate", deep)).toBe(true);
    expect(codeIn(blockFor(panel, "gate")).textContent).toBe(deep);
    // A key no URI could carry is still a key.
    const strange = '{"\\ud800":1}';
    expect(writeStage(panel, "spec", strange)).toBe(true);
    expect(codeIn(blockFor(panel, "spec")).textContent).toBe(
      JSON.stringify(JSON.parse(strange), null, 2),
    );
  });

  test("nested past what a page can lay out, is read raw; up to it, as a tree", () => {
    const nested = (depth: number) => `${"[".repeat(depth)}${"]".repeat(depth)}`;
    const panel = panelBody();
    writeStage(panel, "gate", nested(100));
    expect(codeIn(blockFor(panel, "gate")).classList.contains("is-tree")).toBe(true);
    writeStage(panel, "gate", nested(101));
    expect(codeIn(blockFor(panel, "gate")).classList.contains("is-tree")).toBe(false);
    expect(codeIn(blockFor(panel, "gate")).textContent).toBe(nested(101));
  });

  test("read raw, hands the page one node however many tokens it holds", () => {
    const panel = panelBody();
    writeStage(panel, "gate", JSON.stringify({ rungs: Array.from({ length: 50 }, (_, i) => i) }));
    const block = blockFor(panel, "gate");
    (block.querySelector('[data-devpanel-action="format"]') as FakeElement).dispatchEvent(
      new FakeEvent("click"),
    );
    expect(codeIn(block).childNodes).toHaveLength(1);
  });

  test("filed under a stage the panel does not carry changes nothing", () => {
    const panel = panelBody();
    expect(writeStage(panel, "not-a-stage", "{}")).toBe(false);
    for (const block of blocks(panel)) {
      expect(codeIn(block).textContent).toBe(RESTING_PAYLOAD);
    }
  });
});

describe("a new build starts from an empty panel", () => {
  test("clearing returns every block to resting and drops every count", () => {
    const panel = panelBody();
    writeStage(panel, "spec", '{"a":1}');
    writeStage(panel, "gate", '{"b":2}');

    clearStages(panel);

    for (const block of blocks(panel)) {
      expect(codeIn(block).textContent).toBe(RESTING_PAYLOAD);
      expect(block.classList.contains("is-filled")).toBe(false);
      expect(block.querySelector(".devpanel__size")?.textContent).toBe("");
    }
  });
});
