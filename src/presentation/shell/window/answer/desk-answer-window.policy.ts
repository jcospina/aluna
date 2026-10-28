import { describe, expect, test } from "bun:test";
import {
  ANSWER_SAID_SELECTOR,
  ANSWER_UTTERANCE_SELECTOR,
  ANSWER_WINDOW_SELECTOR,
} from "#shell/desk/window/desk-answer-window.js";
import { WINDOW_CONTENT_ID, WINDOW_STORAGE_KEY } from "#shell/desk/window/desk-window.js";
import { codeOf as code, readSource as read, rules } from "../../../safety/source.test-support.ts";

// The answer window: the third window, and the second exception to there being one. What its
// module, the shell and the sheet may never reach for; `desk-answer-window.test.ts` runs it.

const ANSWER = code("public/desk/window/desk-answer-window.js");
const RUNS = code("public/desk/window/answer-runs.js");
const BAND = code("public/desk/window/answer-band.js");
/** Every call that puts a node on the page. */
const PLACING =
  /\.(?:replaceChildren|replaceChild|append|prepend|before|after|replaceWith|appendChild|insertBefore|insertAdjacent\w*|moveBefore|insertNode|surroundContents)\??\.?\([^)]*\)?/g;
/** The same files with their comments cut by a real parser, which knows what a string is. */
const parsed = (path: string) => new Bun.Transpiler({ loader: "js" }).transformSync(read(path));
const PARSED_ANSWER = parsed("public/desk/window/desk-answer-window.js");
const PARSED_RUNS = parsed("public/desk/window/answer-runs.js");
const PARSED_BAND = parsed("public/desk/window/answer-band.js");

/** What the answer window may never reach: adopting nodes, navigating, or naming a tag or URL part. */
const REACHES = new RegExp(
  [
    String.raw`\b(?:importNode|adoptNode|cloneNode|Object\.assign|Reflect\.set|location|history)\b`,
    String.raw`\b(?:window\.open|navigation|setAttributeNode\w*|createAttribute\w*|setHTML\w*)\b`,
    String.raw`\b(?:execCommand|Image|Audio|Option)\b|\.(?:bind|call|apply)\(|document\s*\[|\[\s*["'\x60]`,
    String.raw`\.(?:host|hostname|pathname|port|protocol|search|hash|srcset|ping|target|rel)\s*=`,
  ].join("|"),
);

/** Every sink that parses markup or writes a document. */
const SINKS =
  /\b(?:innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|srcdoc)\b|document\.write\b|\.src\s*=/;
const GLUE = code("public/app.js");
const SHELL = read("public/index.html");
const DEFLECTION = code("src/pipeline/build/admission/deflection-pipeline.ts");
const QUESTION = code("src/pipeline/query/question-pipeline.ts");
const SHELL_CSS = rules("public/css/shell.css");

/**
 * What every rule styling her sentence sets `property` to, at any depth and however specific: the
 * rule the words rely on, and any that would override it for some answers or some windows.
 */
function setOnHerWords(property: string): string[] {
  const declared = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "g");
  return [...SHELL_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, head]) => head?.includes(ANSWER_SAID_SELECTOR))
    .flatMap(([, , body]) =>
      [...(body ?? "").matchAll(declared)].map((match) => (match[1] ?? "").trim()),
    );
}

describe("it shows words, and names it links itself", () => {
  test("no element it builds, attribute it sets or sink it reaches can show markup", () => {
    // Nothing it or its band builds can show an image or embed a page, no attribute either sets
    // can point anywhere, and no sink either reaches parses markup. The one link is below.
    for (const [source, links] of [
      [ANSWER, ["a"]],
      [BAND, []],
    ] as const) {
      const built = [
        ...source.matchAll(/createElement(?:NS)?\(\s*[^,)]*?["'`]([\w-]+)["'`]\s*\)/g),
      ];
      const showing =
        /^(?:a|img|image|picture|source|video|audio|iframe|object|embed|link|svg|use|frame)$/i;
      expect(built.length).toBeGreaterThan(0);
      expect(built.map(([, tag]) => tag).filter((tag) => showing.test(tag ?? ""))).toEqual([
        ...links,
      ]);
      const named = [...source.matchAll(/setAttribute(?:NS)?\(\s*[^,)]*?["'`]([\w:-]+)["'`]/g)];
      expect(named.length).toBeGreaterThan(0);
      expect(
        named
          .map(([, name]) => name)
          .filter((name) => /href|src|data|action|^on/i.test(name ?? "")),
      ).toEqual([]);
      expect(source.match(SINKS)).toBeNull();
    }
  });

  test("one anchor, its address spelled by `recordAddress` and never read back", () => {
    // ADR-0010: the window never takes an `href` from the wire, nor reads one off its own link.
    expect(ANSWER.match(/createElement\(\s*["'`]a["'`]\s*\)/g)).toHaveLength(1);
    expect(ANSWER.match(/\.href\b/g)).toEqual([".href"]);
    expect(ANSWER).toMatch(/\.href = recordAddress\(run\.capability, run\.record\);/);
    expect(ANSWER).toContain("if (!isAnswerName(run)) return wordsOf(run);");
    expect(ANSWER).not.toMatch(/["'`]href["'`]/);
    expect(ANSWER).toMatch(
      /import \{[^}]*\brecordAddress\b[^}]*\} from "\.\.\/\.\.\/core\/routes\.js"/,
    );
  });

  test("no element or attribute is named by anything but a literal", () => {
    // A tag or attribute held in a variable is one the sweeps above cannot read.
    for (const source of [ANSWER, BAND]) {
      for (const call of ["createElement", "createElementNS", "setAttribute", "setAttributeNS"]) {
        const calls = source.match(new RegExp(`\\b${call}\\(`, "g")) ?? [];
        const literal = source.match(new RegExp(`\\b${call}\\(\\s*["'\`]`, "g")) ?? [];
        expect({ call, named: literal.length }).toEqual({ call, named: calls.length });
      }
    }
  });

  test("nothing the wire sent is put on the page, and nothing here navigates", () => {
    // The saying arrives parsed and inert; adopting any of it would make it live. Its child nodes
    // are read, only by `answerRuns`, and so is whether it carries the ending's mark. What it puts
    // on the page is listed, call by call: what the runs drew, and the window's own parts.
    for (const source of [ANSWER, PARSED_ANSWER]) expect(source.match(REACHES)).toBeNull();
    expect(ANSWER.match(/\bsaid\b[^\n]*/g)).toEqual([
      "said =  (event).detail?.said;",
      "said?.childNodes;",
      "said?.getAttribute?.(ANSWER_ENDING_ATTRIBUTE),",
    ]);
    expect(ANSWER.match(PLACING)).toEqual([
      ".append(...runs.map(drawn)",
      ".replaceChildren(gone)",
      ".replaceChildren(spoken)",
      ".replaceWith?.(name)",
      ".append(leaving, body)",
      ".append(looking.band, line, looking.rule)",
      ".append(utterance)",
      ".append(content)",
      ".append(el)",
    ]);
  });

  test("the band builds its own few parts and is handed nothing to show", () => {
    // It is told a step happened and nothing about it: no words, no runs, no markup. What it
    // builds is a word of its own, its squares and its rule, and nothing it builds can show more.
    const built = [...BAND.matchAll(/createElement\(\s*["'`]([\w-]+)["'`]\s*\)/g)];
    expect(built.map(([, tag]) => tag)).toEqual(["div", "span", "span", "div", "span"]);
    expect(BAND.match(/\bcreateElement\w*\(/g)).toHaveLength(built.length);
    expect(BAND.match(/setAttribute\w*\(\s*["'`]([\w:-]+)["'`]/g)).toEqual([
      'setAttribute("aria-hidden"',
      'setAttribute("aria-hidden"',
    ]);
    for (const source of [BAND, PARSED_BAND]) {
      expect(source.match(SINKS)).toBeNull();
      expect(source.match(REACHES)).toBeNull();
    }
    expect(BAND.match(/\b(?:said|runs?|saying|innerText|textContent)\b/g)).toEqual(["textContent"]);
    expect(BAND.match(PLACING)).toEqual([
      ".append(word, dots)",
      ".replaceWith(next.band)",
      ".replaceWith(next.rule)",
      ".append(square)",
    ]);
  });

  test("a string cannot hide code from the sweeps", () => {
    // The sweeps read the source with its comments cut out by pattern; a string holding a comment
    // marker could open one around live code. The parser's own cut must find nothing more.
    for (const source of [PARSED_ANSWER, PARSED_RUNS, PARSED_BAND]) {
      expect(source.match(SINKS)).toBeNull();
      expect(source.match(/\.href\b/g) ?? []).toEqual(source === PARSED_ANSWER ? [".href"] : []);
    }
    expect(PARSED_BAND.match(PLACING)).toHaveLength(BAND.match(PLACING)?.length ?? 0);
  });

  test("the reader keeps no markup and builds nothing", () => {
    // It reads an inert parse the glue made; what it hands on is words and ids, never an address.
    const sinks =
      /\b(?:innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|srcdoc|createElement\w*|setAttribute\w*|append\w*|replaceChildren)\b|document\.write\b|\.(?:href|src)\b/;
    expect(RUNS.match(sinks)).toBeNull();
    expect(RUNS.match(/["'`]href["'`]/g)).toEqual(['"href"']);
    expect(RUNS).toContain('getAttribute?.("href")');
  });

  test("the glue hands the saying on parsed rather than flattened to its text", () => {
    const glue = GLUE.slice(GLUE.indexOf("function sayInTheAnswerWindowFrom"));
    const body = glue.slice(0, glue.indexOf("\n}\n"));
    expect(body).toContain("{ detail: { said } }");
    expect(body).not.toContain("textContent");
  });
});

describe("it displaces nothing", () => {
  test("it never reaches for the capability window's own open, name or put-away", () => {
    // The whole point of the third window: opening an answer must not put away, displace,
    // re-title or restore the window the user was already looking at.
    for (const name of [
      "openWindow",
      "putAway",
      "dismissWindow",
      "nameWindow",
      "releaseWindowName",
      "putAwayUnfilled",
    ]) {
      expect(ANSWER, `the answer window calls \`${name}\``).not.toContain(name);
    }
    // Nor for the developer panel's.
    expect(ANSWER).not.toContain("openPanel");
    expect(ANSWER).not.toContain("closePanel");
    // And it never writes into the capability window's content region.
    expect(ANSWER).not.toContain(WINDOW_CONTENT_ID);
  });

  test("a question gives the borrowed frame back rather than restoring over it", () => {
    // A restoration would put the canonical collection back over a record the user had open. The
    // route is run in `app.resolver-pipeline.test.ts` ("a question opens the answer window…"),
    // and the glue's half in "an opening on the stream opens the window…". What is swept here is
    // that the question path cannot reach for one, and a deflection no longer knows what one is.
    expect(QUESTION).not.toContain("renderRestorationFragment");
    expect(QUESTION).not.toContain("restoration");
    expect(DEFLECTION).not.toContain("question");
  });
});

describe("nothing writes down where it is, or that it was", () => {
  test("no store, no key, no record", () => {
    for (const name of [
      "localStorage",
      "localStore",
      "savePresentation",
      "loadPresentation",
      "forgetPresentation",
      "forgetOnDismissal",
      "sessionStorage",
      WINDOW_STORAGE_KEY,
    ]) {
      expect(ANSWER, `the answer window reaches for \`${name}\``).not.toContain(name);
    }
    // That it opens on the box this desk computes, and writes nothing whatever it lives through,
    // is run end to end in `answer-window-remembers-nothing.test.ts`.
  });

  test("nothing on the desk names it — no logo, no tile, no address", () => {
    // Comments stripped: the shell describes the window in prose, and prose is not a tile.
    const markup = SHELL.replace(/<!--[\s\S]*?-->/g, "");
    expect(markup).not.toContain("data-answer");
    expect(markup).not.toContain("answer-tile");
    for (const name of ["pushAddress", "replaceAddress", "capabilityAddress", "deskHistory"]) {
      expect(ANSWER, `the answer window writes the address through \`${name}\``).not.toContain(
        name,
      );
    }
  });
});

describe("it obeys the desk", () => {
  test("the clearance is read from the token layer rather than restated", () => {
    // The floor itself is run above ("its first box stops on the prompt bar's floor").
    expect(ANSWER).not.toMatch(/4\.875rem|78px/);
  });

  test("a long answer's tail is not left under the prompt bar on a phone", () => {
    // The geometry that stops a window above the bar is overridden below the breakpoint, so the
    // strip is reserved as content — the same rule the capability window's region keeps.
    const literal = (selector: string) => selector.replaceAll(".", "\\.");
    expect(SHELL_CSS).toMatch(
      new RegExp(
        `@media \\(max-width: 720px\\) \\{[^@]*?${literal(ANSWER_WINDOW_SELECTOR)} ${literal(ANSWER_UTTERANCE_SELECTOR)}::after \\{[^}]*height: var\\(--prompt-clearance\\);`,
      ),
    );
    // And the class is a hook the stylesheet actually uses, not a name on an element nothing reads.
    expect(SHELL_CSS).toContain(`${ANSWER_WINDOW_SELECTOR} ${ANSWER_UTTERANCE_SELECTOR} {`);
  });
});

describe("the seam a classic script reaches the answer window across", () => {
  test("each line of an answer reads in its own direction", () => {
    // An Arabic answer reads right to left, and an English list under a Hebrew first word does
    // not: the direction is per line, so it is never set on the whole box. It is set on the box
    // holding the words, because `unicode-bidi` is not inherited; a sentence leaving is that box.
    expect(setOnHerWords("unicode-bidi")).toEqual(["plaintext"]);
    expect(setOnHerWords("text-align")).toEqual(["start"]);
    expect(ANSWER).not.toMatch(/["'`]dir["'`]/);
  });

  test("a list in an answer is read as a list rather than run into one line", () => {
    // An answer that is a list runs over lines exactly as she wrote it, so the breaks have to
    // survive to the desk — `textContent` alone would collapse them.
    expect(setOnHerWords("white-space")).toEqual(["pre-wrap"]);
  });

  test("one prompt bar and no way to pre-classify a sentence", () => {
    // No mode switch, no slash command, no ask-versus-build control. The composer
    // is where such a control would have to live, and it carries one field and one submit.
    const composer = SHELL.slice(SHELL.indexOf("prompt__composer"));
    const bar = composer.slice(0, composer.indexOf("</form>"));
    for (const control of ["<select", "<option", 'type="radio"', 'type="checkbox"', 'role="tab"']) {
      expect({ control, present: bar.includes(control) }).toEqual({ control, present: false });
    }
    expect(bar.match(/<input\b/g) ?? []).toHaveLength(1);
  });
});
