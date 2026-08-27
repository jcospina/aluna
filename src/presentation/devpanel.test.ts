// The developer panel's contents: eight stages, each a code block.
//
// The panel is the one surface in Aluna that shows a payload rather than a sentence,
// and 5.6/04 settles how far the terminal reading goes — a drawn frame, a caption
// naming the stage and the bytes that came down the wire, and the payload in a well,
// tinted with the palette's own anchors. What is pinned here is the part a careful
// reader cannot check by looking: that a key is not tinted as a string, that a payload
// can never become markup, and that `--signal` is not one of the five tints.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  clearStages,
  DEV_STAGES,
  devPanelBody,
  formatPayloadSize,
  RESTING_PAYLOAD,
  writeStage,
} from "#design/devpanel.js";

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const MODULE = read("design/scripts/devpanel.js");
const PANEL_CSS = read("design/styles/components/desk.css");

/* ── the smallest document these four functions need ───────────────────────── */

type Node = FakeElement | string;

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  readonly dataset: Record<string, string> = {};
  readonly children: Node[] = [];
  readonly classes = new Set<string>();

  constructor(readonly tagName: string) {}

  get classList() {
    return {
      add: (name: string) => this.classes.add(name),
      remove: (name: string) => this.classes.delete(name),
      contains: (name: string) => this.classes.has(name),
    };
  }

  append(...nodes: Node[]) {
    for (const node of nodes) {
      if (node instanceof FakeFragment) this.children.push(...node.children);
      else this.children.push(node);
    }
  }

  replaceChildren(...nodes: Node[]) {
    this.children.length = 0;
    this.append(...nodes);
  }

  /** Every element under this one, in document order. */
  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      if (child instanceof FakeElement) out.push(child, ...child.descendants());
    }
    return out;
  }

  /** Only the two selector shapes this module uses: a class, and a class + [data-stage]. */
  matches(selector: string): boolean {
    const stage = /\[data-stage="([^"]+)"\]/.exec(selector);
    if (stage && this.dataset.stage !== stage[1]) return false;
    const className = /^\.([a-zA-Z0-9_-]+)/.exec(selector)?.[1];
    return className === undefined || this.className.split(" ").includes(className);
  }

  querySelector(selector: string): FakeElement | null {
    return this.descendants().find((el) => el.matches(selector)) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((el) => el.matches(selector));
  }

  /** What the payload actually reads as, once every tinted span is flattened. */
  text(): string {
    return this.children
      .map((child) => (child instanceof FakeElement ? child.text() : child))
      .join("")
      .concat(this.children.length === 0 ? this.textContent : "");
  }
}

class FakeFragment extends FakeElement {
  constructor() {
    super("#fragment");
  }
}

/*
 * Installed for the run and taken away after it, never at module scope.
 *
 * Bun loads every test file in a shard into one process before it runs any of them,
 * and each browser module here bootstraps itself behind `typeof document !== "undefined"`.
 * A fake `document` standing at import time answers that question for all of them, and
 * they start against a stand-in built for four functions — which is how a fake in this
 * file broke `logo-attempt.js` in a file that had never heard of it.
 */
const OCCUPIED = ["HTMLElement", "document", "CSS"] as const;
const globals = globalThis as unknown as Record<string, unknown>;
const displaced = new Map<string, unknown>();

beforeAll(() => {
  for (const name of OCCUPIED) displaced.set(name, globals[name]);
  Object.assign(globals, {
    // The module asks `instanceof HTMLElement` before it writes anywhere — the same
    // guard every browser module here uses — so the fake has to answer to that name.
    HTMLElement: FakeElement,
    document: {
      createElement: (tagName: string) => new FakeElement(tagName),
      createDocumentFragment: () => new FakeFragment(),
    },
    CSS: { escape: (value: string) => value },
  });
});

afterAll(() => {
  for (const name of OCCUPIED) {
    if (displaced.get(name) === undefined) delete globals[name];
    else globals[name] = displaced.get(name);
  }
});

const blocks = (panel: FakeElement) => panel.querySelectorAll(".devpanel__block");
const blockFor = (panel: FakeElement, stage: string) =>
  blocks(panel).find((block) => block.dataset.stage === stage) as FakeElement;
const codeIn = (block: FakeElement) => block.querySelector(".devpanel__code") as FakeElement;
const tints = (block: FakeElement) =>
  codeIn(block)
    .children.filter((child): child is FakeElement => child instanceof FakeElement)
    .map((span) => [span.className, span.textContent] as const);

describe("the eight stages", () => {
  test("are the stream's own, in the order they arrive", () => {
    expect(DEV_STAGES.map((stage) => stage.key)).toEqual([
      "metrics",
      "spec",
      "candidate",
      "behavioral-tests",
      "migration",
      "units",
      "gate",
      "commit",
    ]);
    // Every stage carries the product-voice line for the same moment. It is never
    // printed here — the panel stands outside that voice — but the two readings are
    // held together so a stage cannot be added to one and forgotten in the other.
    for (const stage of DEV_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.line.length).toBeGreaterThan(0);
    }
  });

  test("all eight stand from the start, resting rather than absent", () => {
    // The set is the information: a build that never reached the Gate is legible only
    // if the Gate's block is standing there empty.
    const panel = devPanelBody();
    expect(blocks(panel)).toHaveLength(8);
    for (const block of blocks(panel)) {
      expect(codeIn(block).textContent).toBe(RESTING_PAYLOAD);
      expect(block.classes.has("is-filled")).toBe(false);
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
    // Past ten, a tenth of a kB is noise rather than information.
    expect(formatPayloadSize("x".repeat(1024 * 24))).toBe("24 kB");
    // A three-byte character is three bytes, because that is what was sent.
    expect(formatPayloadSize("☕")).toBe("3 B");
  });
});

describe("a payload in a code block", () => {
  test("is pretty-printed, tinted by kind, and counted", () => {
    const panel = devPanelBody();
    const raw = '{"label":"Notes","fields":6,"strict":true,"prior":null}';
    expect(writeStage(panel, "spec", raw)).toBe(true);

    const block = blockFor(panel, "spec");
    expect(block.classes.has("is-filled")).toBe(true);
    expect(block.querySelector(".devpanel__size")?.textContent).toBe(formatPayloadSize(raw));

    const kinds = Object.fromEntries(
      tints(block).map(([className, text]) => [text.trim(), className]),
    );
    // A key carries the colon that makes it one, so it is never tinted as a string —
    // which is the whole reason the pattern claims the colon rather than the string
    // stopping at the closing quote.
    expect(kinds['"label":']).toBe("devpanel__key");
    expect(kinds['"Notes"']).toBe("devpanel__string");
    expect(kinds["6"]).toBe("devpanel__number");
    expect(kinds.true).toBe("devpanel__atom");
    expect(kinds.null).toBe("devpanel__atom");
    expect(kinds["{"]).toBe("devpanel__punct");

    // Tinting changes how it reads, never what it says.
    expect(JSON.parse(codeIn(block).text())).toEqual(JSON.parse(raw));
    expect(codeIn(block).text()).toContain("\n  ");
  });

  test("that is not JSON lands as it arrived, untinted", () => {
    // A stage that one day sends a stack trace or a bare line of SQL still has
    // somewhere to land, and is shown as what it is rather than dressed as JSON.
    const panel = devPanelBody();
    expect(writeStage(panel, "migration", "CREATE TABLE notes (id TEXT PRIMARY KEY);")).toBe(true);
    const block = blockFor(panel, "migration");
    expect(codeIn(block).textContent).toBe("CREATE TABLE notes (id TEXT PRIMARY KEY);");
    expect(tints(block)).toHaveLength(0);
  });

  test("can never become markup", () => {
    // A payload is data from a build. It is written as text nodes, so a capability
    // label a model authored cannot close the block and open something else.
    const panel = devPanelBody();
    writeStage(panel, "commit", JSON.stringify({ label: "<img src=x onerror=alert(1)>" }));
    const block = blockFor(panel, "commit");
    expect(codeIn(block).text()).toContain("<img src=x onerror=alert(1)>");
    expect(MODULE).not.toContain("innerHTML");
    expect(MODULE).not.toContain("insertAdjacentHTML");
  });

  test("is tinted end to end however long it is", () => {
    // A character budget used to stop the colour partway through, which showed up on
    // the real metrics payload: its third `gateRungs` sits at character 19,949, fifty
    // characters before the cap, so the panel went monochrome for the last quarter of
    // the one thing it exists to show. Measured, the budget was answering a cost that
    // is not there — 27,000 characters tint in 15ms — so it is gone.
    const panel = devPanelBody();
    const wide = JSON.stringify({
      rungs: Array.from({ length: 900 }, (_, i) => ({
        rung: `rung-number-${i}`,
        status: "passed",
        durationMs: i,
      })),
    });
    // Pretty-printed — which is what is actually tinted — this clears the old cap.
    expect(JSON.stringify(JSON.parse(wide), null, 2).length).toBeGreaterThan(20_000);
    writeStage(panel, "gate", wide);

    const block = blockFor(panel, "gate");
    expect(codeIn(block).text()).toBe(JSON.stringify(JSON.parse(wide), null, 2));
    // The last token is tinted, not just the first — which is the whole of the bug.
    const spans = tints(block);
    expect(spans.length).toBeGreaterThan(2_000);
    expect(spans.at(-1)?.[0]).toMatch(/^devpanel__(key|string|number|atom|punct)$/);
    // And nothing rode through as one plain tail.
    const plainTail = codeIn(block).children.at(-1);
    expect(typeof plainTail === "string" ? plainTail.trim() : "").toBe("");
  });

  test("filed under a stage the panel does not carry changes nothing", () => {
    const panel = devPanelBody();
    expect(writeStage(panel, "not-a-stage", "{}")).toBe(false);
    for (const block of blocks(panel)) {
      expect(codeIn(block).textContent).toBe(RESTING_PAYLOAD);
    }
  });
});

describe("a new build starts from an empty panel", () => {
  test("clearing returns every block to resting and drops every count", () => {
    const panel = devPanelBody();
    writeStage(panel, "spec", '{"a":1}');
    writeStage(panel, "gate", '{"b":2}');

    clearStages(panel);

    for (const block of blocks(panel)) {
      expect(codeIn(block).textContent).toBe(RESTING_PAYLOAD);
      expect(block.classes.has("is-filled")).toBe(false);
      expect(block.querySelector(".devpanel__size")?.textContent).toBe("");
    }
  });
});

describe("the terminal reading stops where the design settles it", () => {
  test("the five tints are the palette's own anchors, and never the alert colour", () => {
    // `--signal` is the one red and it is reserved for alerts. A payload reporting a
    // failed Gate is still a reading rather than an alarm. The five are picked for a
    // dark well, which is the one ground in Aluna that is not the meadow.
    const panel = /\.devpanel__(key|string|number|atom|punct) \{\s*color: (var\(--[a-z0-9-]+\));/g;
    const used = [...PANEL_CSS.matchAll(panel)].map((match) => match[2]);
    expect(used).toHaveLength(5);
    expect(used).not.toContain("var(--signal)");
    expect(new Set(used).size).toBe(5);

    // The one monospace face in Aluna, and it belongs to this surface alone — and the
    // one well filled with `--ink`, which is lines and type everywhere else.
    expect(PANEL_CSS).toMatch(/\.devpanel__pre \{[^}]*font-family: var\(--font-mono\);/);
    expect(PANEL_CSS).toMatch(/\.devpanel__pre \{[^}]*background: var\(--ink\);/);
    // `code` in prose is an inline chip; a payload is not prose, and the chip left in
    // place paints a pale box behind every line of the well.
    expect(PANEL_CSS).toMatch(/\.devpanel__code \{[^}]*background: none;/);
  });

  test("no gutter, no prompt mark and no clock — those describe a session, not a build", () => {
    for (const absent of ["timestamp", "elapsed", "Date.now", "gutter", "lineNumber"]) {
      expect(MODULE, `\`${absent}\` is a session's furniture`).not.toContain(absent);
    }
  });
});
