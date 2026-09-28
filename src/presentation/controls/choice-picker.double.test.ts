// The choice-picker double and the Alpine run over it are what the records, fields and controls are
// proved against, so each is held to the browser's answers here: a misparse, a selector read as
// "nothing matched" or a modifier quietly dropped would pass a rule the browser breaks.

import { describe, expect, test } from "bun:test";

import { startAlpine } from "./alpine.test-support.ts";
import { Doc, type El, parseHtml } from "./choice-picker.test-support.ts";

const parsed = (html: string) => parseHtml(html, new Doc());

describe("markup is read the way the browser reads it, or refused", () => {
  test("a comment is neither text nor an element", () => {
    const root = parsed("<p>a<!-- <b>not</b> words -->b</p>");
    expect(root.textContent).toBe("ab");
    expect(root.querySelector("b")).toBeNull();
  });

  test("attributes are read however they are quoted, or bare", () => {
    const [node] = parsed(`<p data-a="one" data-b='two "2"' data-c=three hidden></p>`).children;
    expect(node?.attributes).toEqual({
      "data-a": "one",
      "data-b": 'two "2"',
      "data-c": "three",
      hidden: "",
    });
  });

  test("a close that closes nothing open, or a tag left open, throws", () => {
    for (const html of ["<div>a</span>", "<div>open", "<p>a<div>b</div></p>", "<p>1 < 2</p>"]) {
      expect(() => parsed(html), html).toThrow();
    }
  });
});

describe("the double refuses what the browser refuses", () => {
  test("an empty selector is a syntax error, not a query that found nothing", () => {
    const root = parsed("<p></p>");
    for (const selector of ["", " ", "p,"]) {
      expect(() => root.querySelector(selector), JSON.stringify(selector)).toThrow();
    }
  });

  test("selector syntax the double cannot read is refused rather than skipped", () => {
    const root = parsed("<p><b></b></p>");
    for (const selector of ["p > b", "*", "p + b", "p ~ b"]) {
      expect(() => root.querySelector(selector), selector).toThrow();
    }
  });

  test("an attribute name the browser would not take throws", () => {
    const [node] = parsed("<p></p>").children as El[];
    for (const name of ["", "1a", "a b"]) {
      expect(() => node?.setAttribute(name, "x"), JSON.stringify(name)).toThrow();
    }
  });

  test("an Alpine modifier the double does not model throws when Alpine starts", () => {
    for (const modifier of ["prevent", "stop", "outside", "debounce.500ms", "self"]) {
      const doc = new Doc();
      parseHtml(`<div x-data="{}"><button @click.${modifier}="1"></button></div>`, doc);
      expect(() => startAlpine(doc), modifier).toThrow();
    }
  });
});

describe("Alpine's changes reach the page a microtask later, as they do in a browser", () => {
  const html =
    `<div x-data="{ open: false }">` +
    `<button type="button" x-ref="opener" @click="open = true; $nextTick(() => $refs.field.focus())"></button>` +
    `<input x-ref="field" x-show="open">` +
    `</div>`;

  test("x-show hides at start and shows only once the change is flushed", async () => {
    const doc = parsed(html) as Doc;
    startAlpine(doc);
    const field = doc.querySelector("input") as El;
    expect(field.displayNone).toBe(true);

    doc.fire("click", doc.querySelector("button") as El);
    expect(field.displayNone).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(field.displayNone).toBe(false);
  });

  test("a focus that waits for $nextTick lands; one that does not is refused while hidden", async () => {
    const doc = parsed(html) as Doc;
    startAlpine(doc);
    const field = doc.querySelector("input") as El;
    field.focus();
    expect(doc.activeElement).toBe(doc.body);

    doc.fire("click", doc.querySelector("button") as El);
    expect(doc.activeElement).toBe(doc.body);
    await new Promise((done) => setTimeout(done, 0));
    expect(doc.activeElement).toBe(field);
  });
});
