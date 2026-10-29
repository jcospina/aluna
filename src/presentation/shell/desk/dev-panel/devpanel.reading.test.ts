// How a reader reads a stage's payload in the developer panel: pretty or raw, folded or open,
// rewritten live in place, and walked with the keyboard. `devpanel.selecting.test.ts` runs
// copying and selecting.

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { clearStages } from "#design/desk/devpanel.js";
import { FakeElement, FakeEvent, fakeDocument, usePanelDom } from "./devpanel-dom.test-support.ts";
import {
  at,
  CONTENT,
  keyOn,
  opened,
  panelWith,
  SOURCE,
  UNITS,
  unitsWith,
} from "./devpanel-fixture.test-support.ts";

usePanelDom();

describe("a payload read pretty or raw", () => {
  test("pretty sets code out as its lines, and raw is the payload byte for byte", () => {
    const { code, control, press } = panelWith("units", UNITS);
    expect(code.querySelector(".devpanel__lines")?.textContent).toBe(`${SOURCE}"`);
    expect(code.textContent).toBe(opened(JSON.parse(UNITS)));

    press(control("format"));
    expect(code.textContent).toBe(UNITS);
    expect(control("format").getAttribute("aria-pressed")).toBe("false");

    press(control("format"));
    expect(code.textContent).toBe(opened(JSON.parse(UNITS)));
    expect(control("format").getAttribute("aria-pressed")).toBe("true");
  });

  test("the choice of reading is offered whenever the payload is JSON, and only then", () => {
    const sql = "CREATE TABLE notes (id TEXT);";
    const { code, control, write } = panelWith("migration", sql);
    expect(control("format").hasAttribute("hidden")).toBe(true);
    write(JSON.stringify({ sql }));
    expect(control("format").hasAttribute("hidden")).toBe(false);
    expect(code.classList.contains("is-tree")).toBe(true);

    // The same stage going back to plain text is shown as itself, not as the JSON before it.
    write(sql);
    expect(code.textContent).toBe(sql);
    expect(code.classList.contains("is-tree")).toBe(false);
    expect(control("format").hasAttribute("hidden")).toBe(true);
  });

  test("a payload with nothing to fold is shown pretty with no folds at all", () => {
    for (const raw of ["42", '"done"', "[]", "{}", "null"]) {
      const { code } = panelWith("commit", raw);
      expect(code.textContent, raw).toBe(raw);
      expect(code.querySelectorAll(".devpanel__twist"), raw).toEqual([]);
      expect(code.classList.contains("is-tree"), raw).toBe(true);
    }
  });

  test("the reader's choice of reading outlasts a new build, and their folds do not", () => {
    const { panel, code, control, twist, press, folded, write } = panelWith("units", UNITS);
    press(twist(at("units")));
    expect(folded(at("units"))).toBe(true);
    press(control("format"));

    clearStages(panel);
    write(UNITS);
    expect(code.textContent).toBe(UNITS);

    press(control("format"));
    expect(folded(at("units"))).toBe(false);
  });
});

describe("folds", () => {
  test("a fold hides what it holds but not its text, and holds across a live rewrite", () => {
    const { code, node, twist, press, folded, write } = panelWith("units", UNITS);
    const whole = code.textContent;

    press(twist(CONTENT));
    expect(folded(CONTENT)).toBe(true);
    expect(twist(CONTENT).getAttribute("aria-expanded")).toBe("false");
    expect(code.textContent).toBe(whole);

    write(unitsWith(`${SOURCE}// and one more line\n`));
    expect(folded(CONTENT)).toBe(true);

    // The count a fold leaves behind is the bigger thing to hit, and it opens the fold too.
    press(node(CONTENT).querySelector(".devpanel__elided") as FakeElement);
    expect(folded(CONTENT)).toBe(false);
    expect(twist(CONTENT).getAttribute("aria-expanded")).toBe("true");
    // Opened is remembered as well as closed.
    write(UNITS);
    expect(folded(CONTENT)).toBe(false);
  });

  test("the fold just pressed is the one Tab comes back to", () => {
    const { code, twist, press } = panelWith("units", UNITS);
    press(twist(at("units", 0)));
    const roving = code.querySelectorAll('.devpanel__twist[tabindex="0"]');
    expect(roving).toEqual([twist(at("units", 0))]);
  });

  test("the stage's caption folds its whole block", () => {
    const { pre, block, control, press } = panelWith("spec", '{"a":1}');
    const caption = block.querySelector(".devpanel__stage") as FakeElement;

    press(caption);
    expect(pre.hasAttribute("hidden")).toBe(true);
    expect(control("fold").getAttribute("aria-expanded")).toBe("false");

    press(caption);
    expect(pre.hasAttribute("hidden")).toBe(false);
    expect(control("fold").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("a live rewrite", () => {
  test("changes what changed and keeps every fold that is still there", () => {
    const { code, twist, write } = panelWith("units", UNITS);
    const kept = [twist(""), twist(at("units")), twist(at("units", 0)), twist(CONTENT)];
    twist(at("units", 0)).focus();
    let moved = 0;
    code.addEventListener("focusin", () => moved++);
    code.addEventListener("focusout", () => moved++);

    // A fold being pressed or holding focus is the same button after the rewrite as before it.
    const grown = JSON.parse(unitsWith(`${SOURCE}// and one more line\n`));
    write(JSON.stringify(grown));
    const now = [twist(""), twist(at("units")), twist(at("units", 0)), twist(CONTENT)];
    for (const [index, fold] of now.entries()) expect(fold).toBe(kept[index] as FakeElement);
    expect(moved).toBe(0);
    expect(fakeDocument.activeElement).toBe(kept[2] as FakeElement);
    expect(code.textContent).toBe(opened(grown));

    // A unit added is drawn and the first is left alone; then one taken away is gone.
    const two = { ...grown, units: [...grown.units, { filename: "list.ts", content: "x\ny" }] };
    write(JSON.stringify(two));
    expect(code.textContent).toBe(opened(two));
    expect(twist(at("units", 0))).toBe(kept[2] as FakeElement);
    write(JSON.stringify(grown));
    expect(code.textContent).toBe(opened(grown));

    // A fold whose value stops being foldable gives way to the value.
    const settled = { status: "complete", units: 0 };
    write(JSON.stringify(settled));
    expect(code.textContent).toBe(opened(settled));
    expect(code.querySelectorAll(".devpanel__twist")).toEqual([twist("")]);
  });

  test("brings a kept fold's count up to date, and leaves unchanged text as it was", () => {
    const { node, twist, press, write } = panelWith("units", UNITS);
    press(twist(at("units")));
    const kept = twist(at("units"));
    const key = (node(at("units", 0)).querySelector(".devpanel__key") as FakeElement).childNodes[0];
    const count = () =>
      /(\d+)/.exec(
        node(at("units")).children.find((part) => part.classList.contains("devpanel__elided"))
          ?.dataset.elided ?? "",
      )?.[1];
    expect(count()).toBe("1");

    const units = JSON.parse(UNITS).units;
    write(JSON.stringify({ status: "complete", units: [...units, { filename: "b.ts" }] }));
    expect(count()).toBe("2");
    expect(twist(at("units"))).toBe(kept);
    expect(
      (node(at("units", 0)).querySelector(".devpanel__key") as FakeElement).childNodes[0],
    ).toBe(key);
  });
});

describe("a live rewrite of any payload", () => {
  test("ends where a fresh drawing of the last payload would, whatever came before it", () => {
    const text = fc.oneof(
      fc.string(),
      fc.constantFrom("a\nb", "a\nb\n", "  x\n    y", "", "/", '"', "__proto__"),
      fc.constantFrom("a\nb", "  x\n    y\n", "a\n    in\nz", "a\nout\nz"),
    );
    const json = fc.letrec((tie) => ({
      value: fc.oneof(
        { depthSize: "small" },
        text,
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.array(tie("value"), { maxLength: 4 }),
        fc.dictionary(fc.constantFrom("a", "b", "", "/", "units", "0"), tie("value"), {
          maxKeys: 4,
        }),
      ),
    })).value;
    /** Everything a well shows: its text, and every element's kind and attributes but its Tab stop. */
    const shape = (el: FakeElement): string =>
      `<${el.tagName}${el
        .getAttributeNames()
        .filter((name) => name !== "tabindex")
        .map((name) => ` ${name}=${el.getAttribute(name)}`)
        .join("")}>${el.childNodes
        .map((child) => (child instanceof FakeElement ? shape(child) : child.textContent))
        .join("")}`;
    const drawn = (raw: string) => {
      const { code } = panelWith("spec", raw);
      return { text: code.textContent, shape: shape(code) };
    };
    const endsFresh = (payloads: unknown[]) => {
      const raws = payloads.map((payload) => JSON.stringify(payload));
      const { code, write } = panelWith("spec", raws[0] as string);
      for (const raw of raws.slice(1)) write(raw);
      const fresh = drawn(raws.at(-1) as string);
      expect(code.textContent).toBe(fresh.text);
      expect(shape(code)).toBe(fresh.shape);
    };
    fc.assert(fc.property(fc.array(json, { minLength: 2, maxLength: 4 }), endsFresh), {
      numRuns: 200,
    });
    // The same payload again with its keys in another order at every level, as a unit's are
    // when it lands: what the well drew before must not stand in for what it must now draw.
    const reordered = (value: unknown, seed: number): unknown => {
      if (Array.isArray(value)) return value.map((member) => reordered(member, seed));
      if (value === null || typeof value !== "object") return value;
      const entries = Object.entries(value).map(([key, member]) => [key, reordered(member, seed)]);
      const turned = entries
        .slice(seed % (entries.length || 1))
        .concat(entries.slice(0, seed % (entries.length || 1)));
      return Object.fromEntries(turned.reverse());
    };
    fc.assert(
      fc.property(json, fc.nat(5), (payload, seed) =>
        endsFresh([payload, reordered(payload, seed)]),
      ),
      { numRuns: 300 },
    );
  });
});

describe("a live rewrite of a unit's source", () => {
  test("draws a line of code at the indent it has now, not the one it had", () => {
    const { node, write } = panelWith("units", unitsWith("a\n    indented\nz"));
    write(unitsWith("a\nnot indented\nz"));
    const rows = node(CONTENT).querySelectorAll(".devpanel__codeline");
    expect(rows.map((row) => row.getAttribute("style"))).toEqual([null, null, null]);
  });

  test("leaves a unit's unchanged source as it stands, and redraws one that changed", () => {
    const { code, control, press, write } = panelWith("units", UNITS);
    const two = (first: string, second: string) =>
      JSON.stringify({ units: [{ content: first }, { content: second }] });
    write(two(SOURCE, "a\nb"));
    const linesOf = (index: number) =>
      code
        .querySelector(`[data-path="${at("units", index, "content").replaceAll('"', '\\"')}"]`)
        ?.querySelector(".devpanel__lines") as FakeElement;
    const kept = linesOf(0).children;

    write(two(SOURCE, "a\nb\nc"));
    expect(linesOf(0).children).toStrictEqual(kept);
    expect(linesOf(0).textContent).toBe(`${SOURCE}"`);
    expect(linesOf(1).textContent).toBe('a\nb\nc"');
    expect(code.textContent).toBe(opened({ units: [{ content: SOURCE }, { content: "a\nb\nc" }] }));

    // Read raw and back, the well is drawn afresh and whole.
    press(control("format"));
    press(control("format"));
    expect(linesOf(0).textContent).toBe(`${SOURCE}"`);
    expect(linesOf(0).children[0]).not.toBe(kept[0]);
  });

  test("builds nothing for source that has not changed", () => {
    const long = Array.from({ length: 200 }, (_, line) => `const line${line} = ${line};`).join(
      "\n",
    );
    const { write } = panelWith("units", unitsWith(long));
    const made = fakeDocument.created;
    write(JSON.stringify({ status: "running", units: [{ filename: "read.ts", content: long }] }));
    expect(fakeDocument.created - made).toBeLessThan(50);
  });

  test("keeps a fold that moved, and puts focus back on it", () => {
    const { twist, write } = panelWith("spec", JSON.stringify({ a: { x: 1 }, b: { y: 1 } }));
    const kept = twist(at("b"));
    kept.focus();
    fakeDocument.scrolledToFocus = true;
    write(JSON.stringify({ b: { y: 1 }, a: { x: 1 } }));
    expect(twist(at("b"))).toBe(kept);
    expect(fakeDocument.activeElement).toBe(kept);
    expect(fakeDocument.scrolledToFocus).toBe(false);
  });

  test("redraws nothing after a key that came or went, however many lines follow it", () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, { v: i }]));
    const { twist, write } = panelWith("spec", JSON.stringify({ first: 1, ...many }));
    const folds = () => Object.keys(many).map((key) => twist(at(key)));
    const before = folds();
    write(JSON.stringify({ renamed: 1, ...many }));
    expect(folds()).toStrictEqual(before);
    for (const [index, fold] of folds().entries()) expect(fold).toBe(before[index] as FakeElement);
  });

  test("keeps a fold when keys arrive before it, as a unit's do when it lands", () => {
    const { twist, press, write } = panelWith("units", UNITS);
    const kept = twist(CONTENT);
    const [unit] = JSON.parse(UNITS).units;
    const landed = {
      filename: unit.filename,
      durationMs: 1200,
      usage: { tokens: 9 },
      content: SOURCE,
    };
    write(JSON.stringify({ status: "complete", units: [landed] }));
    expect(twist(CONTENT)).toBe(kept);
    press(kept);
    expect(twist(CONTENT).getAttribute("aria-expanded")).toBe("false");
  });

  test("never hands one key's fold to another", () => {
    const { twist, node, write } = panelWith(
      "spec",
      JSON.stringify({ a: { x: 1 }, b: { y: 1 }, c: { z: 1 } }),
    );
    const b = twist(at("b"));
    write(JSON.stringify({ a: { x: 1 }, c: { z: 1 } }));
    expect(twist(at("c"))).not.toBe(b);
    expect(node(at("b"))).toBeNull();

    // A key whose value stops being foldable keeps no fold.
    write(JSON.stringify({ a: 5, c: { z: 1 } }));
    expect(node(at("a"))).toBeNull();
  });

  test("hands focus back to the well when the fold that held it goes", () => {
    const { pre, control, twist, press } = panelWith("units", UNITS);
    twist(at("units")).focus();
    press(control("format"));
    expect(fakeDocument.activeElement).toBe(pre);
  });

  test("keeps the reader's place, and takes focus only from itself", () => {
    const { code, control, twist, write } = panelWith("units", UNITS);
    keyOn(twist(""), "ArrowDown");
    // The fold the reader moved to is removed by the rewrite, so the place falls back.
    write(JSON.stringify({ status: "complete" }));
    expect(code.querySelectorAll('.devpanel__twist[tabindex="0"]')).toEqual([twist("")]);

    write(UNITS);
    keyOn(twist(""), "ArrowDown");
    fakeDocument.scrolledToFocus = true;
    write(JSON.stringify({ status: "running", units: [] }));
    write(UNITS);
    // Put back on the fold that came back, without scrolling the well to it.
    expect(fakeDocument.scrolledToFocus).toBe(false);

    control("copy").focus();
    write(unitsWith(`${SOURCE}// and one more line\n`));
    expect(fakeDocument.activeElement).toBe(control("copy"));
  });
});

describe("the keyboard among the folds", () => {
  test("the arrows walk the folds that are showing, as a tree takes them", () => {
    const { code, twist, folded } = panelWith("units", UNITS);
    const roving = () => code.querySelectorAll('.devpanel__twist[tabindex="0"]');
    // Every other fold is out of the Tab order, not merely without a place in it.
    const strays = () =>
      code
        .querySelectorAll(".devpanel__twist")
        .filter((each) => !["0", "-1"].includes(each.getAttribute("tabindex") ?? ""));
    // Tab reaches one fold per well, not every one of them.
    expect(roving()).toEqual([twist("")]);

    keyOn(twist(""), "ArrowDown");
    expect(fakeDocument.activeElement).toBe(twist(at("units")));
    expect(roving()).toEqual([twist(at("units"))]);

    keyOn(twist(at("units")), "ArrowLeft");
    expect(folded(at("units"))).toBe(true);
    keyOn(twist(at("units")), "ArrowDown");
    expect(fakeDocument.activeElement).toBe(twist(at("units")));
    keyOn(twist(at("units")), "ArrowLeft");
    expect(fakeDocument.activeElement).toBe(twist(""));
    keyOn(twist(""), "End");
    expect(fakeDocument.activeElement).toBe(twist(at("units")));

    keyOn(twist(at("units")), "ArrowRight");
    expect(folded(at("units"))).toBe(false);
    keyOn(twist(at("units")), "ArrowRight");
    expect(fakeDocument.activeElement).toBe(twist(at("units", 0)));
    keyOn(twist(at("units", 0)), "End");
    expect(fakeDocument.activeElement).toBe(twist(CONTENT));
    keyOn(twist(CONTENT), "ArrowUp");
    expect(fakeDocument.activeElement).toBe(twist(at("units", 0)));
    keyOn(twist(at("units", 0)), "Home");
    expect(fakeDocument.activeElement).toBe(twist(""));
    expect(strays()).toEqual([]);

    twist(CONTENT).dispatchEvent(new FakeEvent("focusin"));
    expect(roving()).toEqual([twist(CONTENT)]);
    code.dispatchEvent(new FakeEvent("focusin"));
    expect(roving()).toEqual([twist(CONTENT)]);
  });

  test("right on an open fold steps only into its own folds", () => {
    const { twist } = panelWith("spec", JSON.stringify({ a: { b: 1 }, c: { d: 2 } }));
    twist(at("a")).focus();
    keyOn(twist(at("a")), "ArrowRight");
    expect(fakeDocument.activeElement).toBe(twist(at("a")));
  });

  test("the arrows are the folds' alone, and every other key is left to the page", () => {
    const { code, twist, folded } = panelWith("units", UNITS);
    // An arrow taken for the folds must not scroll the well as well.
    expect(keyOn(twist(""), "ArrowDown").defaultPrevented).toBe(true);
    // Tab leaves the well, and Enter and Space press the fold as any button is pressed.
    for (const key of ["Tab", "Enter", " "]) {
      expect(keyOn(twist(at("units")), key).defaultPrevented, key).toBe(false);
    }
    expect(keyOn(code, "ArrowDown").defaultPrevented).toBe(false);
    // With a modifier an arrow is the browser's or the system's: back, top, bottom, select.
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
      const event = keyOn(twist(at("units")), "ArrowLeft", { [modifier]: true });
      expect(event.defaultPrevented, modifier).toBe(false);
      expect(folded(at("units")), modifier).toBe(false);
    }

    // The root has nothing around it to climb to.
    keyOn(twist(""), "ArrowLeft");
    expect(folded("")).toBe(true);
    twist("").focus();
    expect(keyOn(twist(""), "ArrowLeft").defaultPrevented).toBe(true);
    expect(fakeDocument.activeElement).toBe(twist(""));
  });
});
