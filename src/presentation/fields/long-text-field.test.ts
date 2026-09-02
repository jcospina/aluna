// The two behaviours a long-text field asks for, run against the markup the renderer
// actually emits: a box that grows to what was typed and then scrolls, and a counter that
// says what is left of a declared limit.
//
// Both are the client half of one declaration. The limit lives on the field, and the
// server already spent it three times before this script runs — on `maxlength`, on the
// sentence painted under the control, and on the validation that refuses an over-long
// value however it arrived. So the tests that matter are the ones about *agreement*: the
// opening paint has to be the sentence already on screen, and the wording has to be the
// same wording, which is why both implementations are put side by side over a table.
//
// The scene is parsed from `renderCreateForm`/`renderEditForm` output rather than typed
// out here, for the reason the DOM double's own header gives: a hand-assembled fixture
// proves the module against a second author's idea of the markup.

import { describe, expect, test } from "bun:test";
import { installDomGlobals } from "../controls/choice-picker.fixture.test-support.ts";
import { Doc, El, parseHtml } from "../controls/choice-picker.test-support.ts";
import { codeOf, readSource } from "../safety/source.test-support.ts";
import { characterCountSentence as serverSentence } from "./field-chrome.ts";
import { oneField, probeField } from "./field-renderer.test-support.ts";
import { renderCreateForm, renderEditForm } from "./field-renderer.ts";

installDomGlobals();

const LIMIT = 20;

/**
 * One rendered long-text field: declared `long_text`, carrying a limit and a line of
 * guidance. `name` distinguishes two forms in one document — every id the counter is
 * found by is derived from it, so two forms sharing a name share a counter.
 */
function longTextForm(stored?: string, name = "value"): string {
  const capability = oneField(
    probeField("string", { name, label: "Value", required: false, max_length: LIMIT }),
    "repeatable",
    "picker",
    { longText: true, guidance: "Keep it short." },
  );
  return stored === undefined
    ? renderCreateForm(capability)
    : renderEditForm(capability, { id: "probe-1", [name]: stored });
}

const areaOf = (root: El) => root.querySelector("textarea") as El;
const mountedFlag = (root: El) => areaOf(root).getAttribute("data-long-text-mounted");

/** A document holding one rendered form, with the module started over the whole of it. */
async function scene(markup: string) {
  const { startLongTextFields } = await import("#shell/long-text-field.js");
  const doc = new Doc();
  const root = new El("html");
  doc.append(root);
  parseHtml(markup, root);
  startLongTextFields(doc as never);

  const area = areaOf(doc);
  const counter = doc.getElementById(area.getAttribute("data-length-counter") ?? "") as El;
  return {
    doc,
    root,
    area,
    counter,
    form: doc.querySelector("form") as El,
    max: Number(area.getAttribute("data-grow-max")),
    /** What a keystroke is: the value is already changed by the time `input` fires. */
    type: (text: string) => {
      area.value = text;
      doc.fire("input", area);
    },
    isOver: () => counter.classList.contains("is-over"),
  };
}

type Scene = Awaited<ReturnType<typeof scene>>;

/** One macrotask — where the reset's repaint is queued, and no longer than that. */
const tick = () => new Promise((done) => setTimeout(done, 0));

/**
 * A form reset in the browser's order: the event goes out first and the values go back
 * after it, which is the whole reason the repaint waits a turn.
 */
async function resetForm(one: Scene): Promise<void> {
  one.doc.fire("reset", one.form);
  one.form.reset();
  await tick();
}

/* ── the seam ──────────────────────────────────────────────────────────────── */

describe("the shipped page runs the module against what the server writes", () => {
  const MODULE = codeOf("public/long-text-field.js");

  test("the shell loads it and it starts itself", () => {
    expect(readSource("public/index.html")).toContain(
      '<script type="module" src="/static/long-text-field.js"></script>',
    );
    expect(MODULE).toContain('if (typeof document !== "undefined") startLongTextFields(document);');
  });

  test("every hook the module queries by is one the renderer emits", () => {
    const rendered = longTextForm();
    expect(MODULE).toContain("textarea[data-grow]");
    expect(MODULE).toContain("[data-length-limit][data-length-counter]");
    for (const hook of [
      "data-grow",
      'data-grow-max="',
      'data-length-limit="',
      "data-length-counter=",
    ]) {
      expect(rendered).toContain(hook);
    }
    expect(rendered).toContain('class="field__guidance field__guidance--count"');
    // The dataset spellings, which are the same attributes read the other way round.
    for (const key of ["growMax", "lengthLimit", "lengthCounter", "longTextMounted"]) {
      expect(MODULE).toContain(key);
    }
  });
});

/* ── the box that grows ────────────────────────────────────────────────────── */

describe("the box grows to fit what is typed, and then scrolls", () => {
  test("it opens already sized, with no scrollbar and no grip to drag", async () => {
    const one = await scene(longTextForm("hello"));
    expect(one.area.style.height).toBe(`${one.area.scrollHeight}px`);
    expect(one.area.style.overflowY).toBe("hidden");
  });

  test("it follows the text up to the height it was given, and scrolls past that", async () => {
    const one = await scene(longTextForm());

    one.area.scrollHeight = 96;
    one.type("two lines of it");
    expect(one.area.style.height).toBe("96px");
    expect(one.area.style.overflowY).toBe("hidden");

    one.area.scrollHeight = one.max + 200;
    one.type("a great deal more of it");
    expect(one.area.style.height).toBe(`${one.max}px`);
    expect(one.area.style.overflowY).toBe("auto");
  });

  test("a field with no layout yet is left alone, not measured at zero and pinned there", async () => {
    // The create form is mounted inside a panel that is `display: none` until "New" is
    // pressed, so every measurement it answers is 0. Writing that answer set the height to
    // zero and left it there once the panel opened: a control that looked like an empty
    // single-line input and could not be clicked into. Found in use, on a real capability.
    const one = await scene(longTextForm());
    one.area.scrollHeight = 0;
    one.type("three paragraphs the panel has not shown yet");

    expect(one.area.style.height).toBe("");
    expect(one.area.style.overflowY).toBe("");
  });

  test("and it is measured the moment it gets a box, which is when the panel opens", async () => {
    const one = await scene(longTextForm());
    one.area.scrollHeight = 0;
    one.type("what was typed before anyone could see it");
    expect(one.area.style.height).toBe("");

    // The panel opens: the control has a width for the first time.
    one.area.scrollHeight = 88;
    one.doc.resize(one.area, 420);
    expect(one.area.style.height).toBe("88px");
    expect(one.area.style.overflowY).toBe("hidden");
  });

  // One observer per `textarea[data-grow]`, minted again on every record view and every
  // collection swap, and nothing ever disconnected them — a plain decision-13 violation.
  test("the box watch is released with the control that started it", async () => {
    const { releaseRegionContent } = await import("#shell/region-scope.js");
    const one = await scene(longTextForm());
    one.doc.resize(one.area, 600);
    one.area.scrollHeight = 64;
    one.type("one long line");
    expect(one.area.style.height).toBe("64px");

    releaseRegionContent(one.area as never);

    // The watch is gone, so a later box change reaches nothing.
    one.area.scrollHeight = 200;
    one.doc.resize(one.area, 300);
    expect(one.area.style.height).toBe("64px");
  });

  test("a narrower box re-wraps the text, so the height it needs is measured again", async () => {
    const one = await scene(longTextForm());
    one.doc.resize(one.area, 600);
    one.area.scrollHeight = 64;
    one.type("one long line");
    expect(one.area.style.height).toBe("64px");

    // Half the width, twice the lines — and no keystroke to notice it.
    one.area.scrollHeight = 128;
    one.doc.resize(one.area, 300);
    expect(one.area.style.height).toBe("128px");
  });

  test("and it comes back down when the text goes", async () => {
    // The half that needs the measurement taken at `height: auto`. A box measured while
    // it still holds yesterday's height reports that height, and a field emptied of three
    // paragraphs would stay three paragraphs tall for the rest of the session.
    const one = await scene(longTextForm());
    one.area.scrollHeight = 400;
    one.type("a long paragraph");
    expect(one.area.style.height).toBe(`${one.max}px`);

    one.area.scrollHeight = 72;
    one.type("");
    expect(one.area.style.height).toBe("72px");
    expect(one.area.style.overflowY).toBe("hidden");
  });
});

/* ── the counter ───────────────────────────────────────────────────────────── */

describe("the counter says what is left", () => {
  test("the opening paint is the sentence the server had already written", async () => {
    // Not merely *a* correct sentence: the same one, unchanged. A mount that recomputed
    // something else would swap the words under a reader on the first keystroke.
    const markup = longTextForm("hello");
    const rendered = parseHtml(markup, new El("div"));
    const painted = (rendered.querySelector(".field__guidance--count") as El).textContent;
    expect(painted).toBe("15 characters left");

    const one = await scene(markup);
    expect(one.counter.textContent).toBe(painted);
    expect(one.isOver()).toBe(false);
  });

  test("a value opening with a newline reaches the control whole, and counts whole", async () => {
    // HTML drops one U+000A right after `<textarea>`, so the renderer writes one of its
    // own. Without it the control would hold a character less than the sentence beside it
    // was written for — and saving an unrelated field would resubmit the shortened text.
    const stored = "\n\nHello";
    const one = await scene(longTextForm(stored));
    expect(one.area.value).toBe(stored);
    expect(one.counter.textContent).toBe(`${LIMIT - stored.length} characters left`);
  });

  test("typing counts down, and one left is one character", async () => {
    const one = await scene(longTextForm());
    expect(one.counter.textContent).toBe("20 characters left");

    one.type("x".repeat(7));
    expect(one.counter.textContent).toBe("13 characters left");

    one.type("x".repeat(LIMIT - 1));
    expect(one.counter.textContent).toBe("1 character left");
  });

  test("past the limit it says how far past, and says so in a class as well", async () => {
    // `maxlength` stops the typing, but nothing stops a value that arrived any other way:
    // a record stored before the limit was declared opens over it.
    const one = await scene(longTextForm());
    one.type("x".repeat(LIMIT + 3));
    expect(one.counter.textContent).toBe("3 over the limit");
    expect(one.isOver()).toBe(true);

    one.type("x".repeat(LIMIT));
    expect(one.counter.textContent).toBe("0 characters left");
    expect(one.isOver()).toBe(false);
  });
});

/* ── putting the form back ─────────────────────────────────────────────────── */

describe("a reset repaints both, a turn after the event that announces it", () => {
  test("the box and the count go back to the value the record holds", async () => {
    const one = await scene(longTextForm("hello"));
    one.area.scrollHeight = 400;
    one.type("x".repeat(LIMIT + 10));
    expect(one.counter.textContent).toBe("10 over the limit");
    expect(one.area.style.height).toBe(`${one.max}px`);

    one.area.scrollHeight = 84;
    await resetForm(one);

    // The event fires before the values are restored, so a repaint that did not wait a
    // turn would describe the text that was just discarded.
    expect(one.area.value).toBe("hello");
    expect(one.counter.textContent).toBe("15 characters left");
    expect(one.isOver()).toBe(false);
    expect(one.area.style.height).toBe("84px");
  });

  test("a cancelled create goes back to empty, not to what was typed", async () => {
    const one = await scene(longTextForm());
    one.type("x".repeat(LIMIT + 1));
    expect(one.isOver()).toBe(true);

    await resetForm(one);

    expect(one.area.value).toBe("");
    expect(one.counter.textContent).toBe("20 characters left");
    expect(one.isOver()).toBe(false);
  });
});

/* ── mounting ──────────────────────────────────────────────────────────────── */

describe("how a control gets its script", () => {
  test("a control is mounted once, however many arrivals report it", async () => {
    const { mountLongTextFields } = await import("#shell/long-text-field.js");
    const one = await scene(longTextForm());
    expect(mountedFlag(one.root)).toBe("true");
    expect(mountLongTextFields(one.doc as never)).toBe(0);
  });

  test("the watch asks for the one thing that reports an arrival", async () => {
    // A watch configured for anything but childList over the subtree hears nothing, and
    // hearing arrivals is the whole of how a swapped-in form gets mounted at all.
    const one = await scene(longTextForm());
    expect(one.doc.watches).toEqual([
      { target: one.doc, options: { childList: true, subtree: true } },
    ]);
  });

  test("a form that lands long after the page does is mounted too", async () => {
    // htmx lands one, `record-view.js` clones one out of a template, three modules assign
    // `innerHTML`. None of them announce the same thing, and two announce nothing.
    const one = await scene(longTextForm());
    const arriving = parseHtml(longTextForm("hello", "late"), new El("div"));
    one.root.append(arriving);

    const late = areaOf(arriving);
    expect(mountedFlag(arriving)).toBe("true");
    const counter = one.doc.getElementById(late.getAttribute("data-length-counter") ?? "") as El;
    expect(counter.textContent).toBe("15 characters left");

    late.value = "";
    one.doc.fire("input", late);
    expect(counter.textContent).toBe("20 characters left");
  });

  test("the control that arrives is mounted even when it arrives alone", async () => {
    const { mountLongTextFields } = await import("#shell/long-text-field.js");
    const one = await scene(longTextForm());
    const arriving = parseHtml(longTextForm(undefined, "alone"), new El("div"));
    one.root.append(arriving);
    const alone = areaOf(arriving);
    alone.removeAttribute("data-long-text-mounted");

    expect(mountLongTextFields(alone as never)).toBe(1);
    expect(alone.getAttribute("data-long-text-mounted")).toBe("true");
  });

  test("a control naming a counter that is not there refuses, and stays unmounted", async () => {
    // A control that looks right and describes nothing is worse than one that says so:
    // the refusal is loud, and the flag goes on *after* the mount, so the control is
    // offered a script again rather than being marked done on its way out.
    const one = await scene(longTextForm());
    const broken = parseHtml(longTextForm(undefined, "broken"), new El("div"));
    broken.querySelector(".field__guidance--count")?.remove();

    expect(() => one.root.append(broken)).toThrow('Length counter "cap-probe-broken-count"');
    expect(mountedFlag(broken)).toBe(null);
  });

  test("a refusal at load still leaves every later form a script", async () => {
    // The opening scan is where a bad control is most likely to be, and its throw goes all
    // the way out. If the watch were installed after that scan rather than before it, the
    // page would lose its observer at load and every form htmx landed afterwards would
    // stand there dead for the rest of the session.
    const { startLongTextFields } = await import("#shell/long-text-field.js");
    const doc = new Doc();
    const root = new El("html");
    doc.append(root);
    const broken = parseHtml(longTextForm(undefined, "broken"), new El("div"));
    broken.querySelector(".field__guidance--count")?.remove();
    root.append(broken);

    expect(() => startLongTextFields(doc as never)).toThrow("Length counter");

    const sound = parseHtml(longTextForm("hello", "sound"), new El("div"));
    root.append(sound);
    expect(mountedFlag(sound)).toBe("true");
  });

  test("one refusal does not cost the form that landed beside it", async () => {
    const one = await scene(longTextForm());
    const broken = parseHtml(longTextForm(undefined, "broken"), new El("div"));
    broken.querySelector(".field__guidance--count")?.remove();
    const sound = parseHtml(longTextForm("hello", "sound"), new El("div"));

    expect(() => one.root.append(broken, sound)).toThrow("Length counter");

    expect(mountedFlag(sound)).toBe("true");
    expect(mountedFlag(broken)).toBe(null);
    const counter = one.doc.getElementById("edit-probe-sound-count") as El;
    areaOf(sound).value = "hello there";
    one.doc.fire("input", areaOf(sound));
    expect(counter.textContent).toBe("9 characters left");
  });
});

/* ── the sentence, written twice ───────────────────────────────────────────── */

describe("the server's first paint and the client's next one", () => {
  /** Every shape the sentence has: empty, part-used, exactly full, one either side, well over. */
  const COUNTS = [
    [LIMIT, 0, "20 characters left"],
    [LIMIT, 7, "13 characters left"],
    [LIMIT, LIMIT - 1, "1 character left"],
    [LIMIT, LIMIT, "0 characters left"],
    [LIMIT, LIMIT + 1, "1 over the limit"],
    [LIMIT, LIMIT + 25, "25 over the limit"],
  ] as const;

  test("both write the identical string, and the string is the one on screen", async () => {
    const { characterCountSentence: clientSentence } = await import("#shell/long-text-field.js");
    for (const [limit, used, sentence] of COUNTS) {
      const where = `${used} of ${limit}`;
      expect(serverSentence(limit, used), where).toBe(sentence);
      expect(clientSentence(limit, used), where).toBe(sentence);
    }
  });
});
