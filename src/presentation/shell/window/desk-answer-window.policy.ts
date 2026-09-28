import { describe, expect, test } from "bun:test";
import { ANSWER_BODY_SELECTOR, ANSWER_WINDOW_SELECTOR } from "#shell/desk-answer-window.js";
import { WINDOW_CONTENT_ID, WINDOW_STORAGE_KEY } from "#shell/desk-window.js";
import { codeOf as code, readSource as read, rules } from "../../safety/source.test-support.ts";

// The answer window: the third window, and the second exception to there being one. What its
// module, the shell and the sheet may never reach for; `desk-answer-window.test.ts` runs it.

const ANSWER = code("public/desk-answer-window.js");
const SHELL = read("public/index.html");
const DEFLECTION = code("src/pipeline/build/admission/deflection-pipeline.ts");
const QUESTION = code("src/pipeline/query/question-pipeline.ts");
const SHELL_CSS = rules("public/css/shell.css");

describe("it shows words and nothing else", () => {
  test("no element it builds, attribute it sets or sink it reaches can show markup", () => {
    // Nothing it builds can show an image, embed a page or follow a link, no attribute it sets can
    // point anywhere, and no sink it reaches parses markup.
    const built = [...ANSWER.matchAll(/createElement(?:NS)?\(\s*[^,)]*?["'`]([\w-]+)["'`]\s*\)/g)];
    const showing =
      /^(?:a|img|image|picture|source|video|audio|iframe|object|embed|link|svg|use|frame)$/i;
    expect(built.length).toBeGreaterThan(0);
    expect(built.map(([, tag]) => tag).filter((tag) => showing.test(tag ?? ""))).toEqual([]);
    const named = [...ANSWER.matchAll(/setAttribute(?:NS)?\(\s*[^,)]*?["'`]([\w:-]+)["'`]/g)];
    expect(named.length).toBeGreaterThan(0);
    expect(
      named.map(([, name]) => name).filter((name) => /href|src|data|action/i.test(name ?? "")),
    ).toEqual([]);
    const sinks =
      /\b(?:innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|srcdoc)\b|document\.write\b|\.(?:href|src)\s*=/;
    expect(ANSWER.match(sinks)).toBeNull();
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
        `@media \\(max-width: 720px\\) \\{[^@]*?${literal(ANSWER_WINDOW_SELECTOR)} ${literal(ANSWER_BODY_SELECTOR)}::after \\{[^}]*height: var\\(--prompt-clearance\\);`,
      ),
    );
    // And the class is a hook the stylesheet actually uses, not a name on an element nothing reads.
    expect(SHELL_CSS).toContain(`${ANSWER_WINDOW_SELECTOR} ${ANSWER_BODY_SELECTOR} {`);
  });
});

describe("the seam a classic script reaches the answer window across", () => {
  test("a list in an answer is read as a list rather than run into one line", () => {
    // An answer that is a list runs over lines exactly as she wrote it, so the breaks have to
    // survive to the desk — `textContent` alone would collapse them (PLAN decision 3).
    expect(SHELL_CSS).toMatch(
      new RegExp(
        `${ANSWER_WINDOW_SELECTOR.replaceAll(".", "\\.")} ${ANSWER_BODY_SELECTOR.replaceAll(".", "\\.")} \\{[^}]*white-space: pre-wrap;`,
      ),
    );
  });

  test("one prompt bar and no way to pre-classify a sentence", () => {
    // PLAN decision 1: no mode switch, no slash command, no ask-versus-build control. The composer
    // is where such a control would have to live, and it carries one field and one submit.
    const composer = SHELL.slice(SHELL.indexOf("prompt__composer"));
    const bar = composer.slice(0, composer.indexOf("</form>"));
    for (const control of ["<select", "<option", 'type="radio"', 'type="checkbox"', 'role="tab"']) {
      expect({ control, present: bar.includes(control) }).toEqual({ control, present: false });
    }
    expect(bar.match(/<input\b/g) ?? []).toHaveLength(1);
  });
});
