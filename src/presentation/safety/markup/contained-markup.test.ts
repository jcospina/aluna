import { describe, expect, test } from "bun:test";

import { containedMarkup as contained } from "./contained-markup.ts";

// A card's markup stays inside its card: an end tag it never opened goes, every element it opens
// is closed by its own end tag, and markup already whole is returned as it came.

describe("an end tag the markup never opened", () => {
  test.each([
    [
      "the span a marked card's markup stands in",
      "<p>Dune</p></span><p>more</p>",
      "<p>Dune</p><p>more</p>",
    ],
    ["the card's own button", "x</button>y", "xy"],
    ["an article card", "</article>tail", "tail"],
    ["the collection around the card", "<div>a</div></div><q>b</q>", "<div>a</div><q>b</q>"],
    ["the template htmx parses a list in", "a</template>b", "ab"],
    ["the element a marked card's markup is held in", "a</aluna-card-body>b", "ab"],
    ["however many there are", "<span>a</span></span></span>c", "<span>a</span>c"],
    ["whatever its case or spacing", "<SPAN>a</SPAN></Span >z", "<SPAN>a</SPAN>z"],
  ])("closing %s goes", (_, markup, kept) => {
    expect(contained(markup)).toBe(kept);
  });

  test("goes in time a field full of them allows", () => {
    const started = performance.now();
    expect(contained(`<p>a</p>${"</span>".repeat(50_000)}`)).toBe("<p>a</p>");
    expect(contained("<span>a</span>".repeat(50_000))).toBe("<span>a</span>".repeat(50_000));
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("an element the markup leaves open", () => {
  test.each([
    [
      "a style a browser would reopen around the next card",
      "<p>Dune</p><s hidden>",
      "<p>Dune</p><s hidden></s></s></s>",
    ],
    [
      "a table, whose end no card's own end tag reaches",
      "<table><tr><td>d",
      "<table><tr><td>d</table>",
    ],
    [
      "a style an ancestor's end tag reaches only in lol-html's reading",
      "<span><ul><b>Dune</span>",
      "<span><ul><b>Dune</b></span></b></b>",
    ],
  ])("%s is closed by its own end tag", (_, markup, kept) => {
    expect(contained(markup)).toBe(kept);
  });

  test.each([
    ["a paragraph, which an end tag with none open would draw empty", "<p>a<p>b"],
    ["an element a heading's end tag closes in a browser", "<h3><article>Title</h2>x</h3>"],
    ["a span a block closes in a browser by closing its paragraph", "<p><span>a<div>b</div>c</p>"],
    ["a list item another closes", "<ul><li><div>a<li>b</ul>"],
  ])("but not %s: a card's own end tag closes it", (_, markup) => {
    expect(contained(markup)).toBe(markup);
  });
});

describe("a formatting element in markup left open or misnested", () => {
  test("is closed again once for every eight elements the markup holds, and once more", () => {
    const once = contained(`<i>${"<div>".repeat(20)}Dune`);
    expect(once.endsWith(`</i>${"</i>".repeat(Math.ceil(21 / 8) + 1)}`)).toBe(true);
    expect(contained("<i><div>x</i>y")).toBe("<i><div>x</i>y</i></i>");
  });

  test("but not in markup that closes everything it opens, in order", () => {
    expect(contained("<i>a</i><b><q>b</q></b>")).toBe("<i>a</i><b><q>b</q></b>");
  });
});

describe("markup that is already whole", () => {
  test.each([
    ["balanced", '<div class="stack"><span>Kindred</span></div>'],
    ["quoting an end tag in an attribute", '<q title="</span>">t</q>'],
    ["holding void elements", '<img src="x" alt="a"><br>text'],
    ["holding no element at all", "plain text"],
  ])("%s, is returned as it came", (_, markup) => {
    expect(contained(markup)).toBe(markup);
  });

  test("and a second pass changes nothing", () => {
    for (const markup of ["x</button>y</div>", "<span><b>x</span>", "<ul><li>a<li>b", "<i>open"]) {
      const once = contained(markup);
      expect(contained(once)).toBe(once);
    }
  });
});
