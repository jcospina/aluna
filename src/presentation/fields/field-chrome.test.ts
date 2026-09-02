// What the form draws once a field declares long text, a hint, or a length limit — and the
// shell every text control now sits in.
//
// The three read one declaration each and nothing infers anything: a string is single-line
// unless the form named it, a field says nothing unless the form gave it words, and a
// counter exists only where a limit does.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { characterCountSentence } from "./field-chrome.ts";
import { oneField, probeField, SAMPLE } from "./field-renderer.test-support.ts";
import { renderCreateForm, renderEditForm } from "./field-renderer.ts";

const RECORD_ID = { id: "record-1" } as const;

function createFieldHtml(field = probeField("string"), intent = {}): string {
  return renderCreateForm(oneField(field, "repeatable", "picker", intent));
}

function editFieldHtml(value: unknown, field = probeField("string"), intent = {}): string {
  return renderEditForm(oneField(field, "repeatable", "picker", intent), { ...RECORD_ID, value });
}

describe("the shell and the input", () => {
  test("a text control is a shell holding a bare input, never a bare input drawing itself", () => {
    expect(createFieldHtml()).toContain(
      '<span class="field__control"><input class="field__input" id="cap-probe-value"' +
        ' type="text" name="value" aria-describedby="cap-probe-value-guidance" required></span>',
    );
  });

  test("a datetime keeps its seconds in both modes, not only on edit", () => {
    // Canonical datetime storage keeps seconds; without `step="any"` the control rounds to
    // the minute and refuses them. The edit mirror always said so; create did not.
    expect(createFieldHtml(probeField("datetime"))).toContain(
      'type="datetime-local" name="value" step="any"',
    );
  });

  test("every scalar control takes the split, the datetime edit mirror included", () => {
    const editForm = renderEditForm(SAMPLE, {
      id: "record-1",
      title: "T",
      priority: 1,
      done: false,
      due_date: "2026-01-01T00:00:00.000Z",
      note: "n",
    });
    expect(editForm).toContain(
      '<span class="field__control"><input class="field__input" id="edit-tasks-due_date"' +
        ' type="datetime-local"',
    );
    expect(editForm).not.toContain('<input class="field__control"');
  });

  test("the checkbox keeps no shell: the shell is a well, and a checkbox is a mark", () => {
    const html = createFieldHtml(probeField("boolean"));
    expect(html).toContain('<input class="field__checkbox"');
    expect(html).not.toContain('class="field__control"');
  });
});

describe("long text is what the form declared, never what the type implied", () => {
  test("a named string field draws a growing, ungrabbable textarea", () => {
    const html = createFieldHtml(probeField("string"), { longText: true });
    expect(html).toContain('class="field field--long-text"');
    expect(html).toContain(
      '<span class="field__control field__control--area">' +
        '<textarea class="field__textarea" id="cap-probe-value" name="value"' +
        ' rows="3" data-grow data-grow-max="260"' +
        ' aria-describedby="cap-probe-value-guidance" required>\n</textarea>',
    );
  });

  test("an unnamed string field of the same shape still draws a single-line input", () => {
    expect(createFieldHtml()).not.toContain("<textarea");
  });

  test("edit prefills the textarea's content rather than a value attribute, and escapes it", () => {
    const html = editFieldHtml("</textarea><script>x</script>", probeField("string"), {
      longText: true,
    });
    expect(html).toContain("&lt;/textarea&gt;&lt;script&gt;x&lt;/script&gt;</textarea>");
    expect(html).not.toContain("<script>x</script>");
  });

  test("an absent value opens an empty box rather than a muted dash", () => {
    expect(editFieldHtml(null, probeField("string"), { longText: true })).toContain(
      "required>\n</textarea>",
    );
  });

  test("a value starting with a newline survives, because HTML eats one after the tag", () => {
    // The parser drops a single U+000A immediately after `<textarea>`. Without the
    // renderer's own newline this value would reach the control a character short — the
    // counter would disagree with the sentence beside it, and saving any other field would
    // resubmit the shortened text and quietly rewrite the record.
    const html = editFieldHtml("\n\nHello", probeField("string"), { longText: true });
    expect(html).toContain(">\n\n\nHello</textarea>");
  });
});

describe("guidance sits under the field and survives typing", () => {
  test("it renders as the field's own description and is referenced, not merely printed", () => {
    const html = createFieldHtml(probeField("string"), { guidance: "Two or three sentences." });
    expect(html).toContain('aria-describedby="cap-probe-value-guidance"');
    expect(html).toContain(
      '<p class="field__guidance" id="cap-probe-value-guidance" data-field-guidance>' +
        "Two or three sentences.</p>",
    );
  });

  test("it is escaped, like every other authored string that reaches markup", () => {
    expect(createFieldHtml(probeField("string"), { guidance: 'a "b" & <c>' })).toContain(
      "a &quot;b&quot; &amp; &lt;c&gt;",
    );
  });

  test("a field the form said nothing about still carries the slot, empty and hidden", () => {
    // The slot is not the hint's; it is where the field says one thing about itself at a
    // time, and a validation error is the other thing it says (`public/field-errors.js`).
    // Rendering it always is what lets the client find one element and put one string
    // back — and an empty one is `hidden`, describes nothing, and occupies no line.
    const html = createFieldHtml();
    expect(html).toContain('aria-describedby="cap-probe-value-guidance"');
    expect(html).toContain(
      '<p class="field__guidance" id="cap-probe-value-guidance" data-field-guidance hidden></p>',
    );
  });

  test("a choice field carries it too, referenced off whichever control draws it", () => {
    for (const presentation of ["picker", "radio", "segmented"] as const) {
      const html = renderCreateForm(
        oneField(probeField("choice"), "repeatable", presentation, { guidance: "Pick one." }),
      );
      expect(html).toContain('aria-describedby="cap-probe-value-guidance"');
      expect(html).toContain('id="cap-probe-value-guidance" data-field-guidance>Pick one.</p>');
    }
  });

  test("a repeatable list references its hint from every row, not from nothing", () => {
    // A repeatable list has no single control to hang a description on: what a screen
    // reader reaches is a row's input. A hint referenced by nothing is the visual-only
    // text this module exists not to emit.
    const html = renderCreateForm(
      oneField(probeField("string[]", { required: false }), "repeatable", "picker", {
        guidance: "One per row.",
      }),
    );
    // Both hints, in the same order the comma mode puts them: the platform's line about
    // what a comma means here, then the capability's own.
    expect(html).toContain(
      'aria-label="Value 1" aria-describedby="cap-probe-value-list-hint cap-probe-value-guidance"',
    );
    expect(html).toContain('id="cap-probe-value-guidance" data-field-guidance>One per row.</p>');
    expect(html).toContain("One value to a row. A comma here is data.</p>");
  });

  test("every row of a prefilled repeatable list carries it, so an added row inherits it", () => {
    const html = renderEditForm(
      oneField(probeField("string[]", { required: false }), "repeatable", "picker", {
        guidance: "One per row.",
      }),
      { id: "record-1", value: ["a", "b"] },
    );
    expect([
      ...html.matchAll(/aria-describedby="edit-probe-value-list-hint edit-probe-value-guidance"/g),
    ]).toHaveLength(2);
  });

  test("the list field's separator hint and a declared hint both survive, each with its id", () => {
    const html = renderCreateForm(
      oneField(probeField("string[]"), "comma_separated", "picker", {
        guidance: "Lowercase, please.",
      }),
    );
    expect(html).toContain('aria-describedby="cap-probe-value-list-hint cap-probe-value-guidance"');
    expect(html).toContain("Separate values with commas.</p>");
    expect(html).toContain("Lowercase, please.</p>");
  });
});

describe("one declared limit drives the native stop and the counter", () => {
  const limited = probeField("string", { max_length: 180, required: false });

  test("it writes maxlength and the counter's own wiring from the same number", () => {
    const html = createFieldHtml(limited);
    expect(html).toContain(
      ' maxlength="180" data-length-limit="180" data-length-counter="cap-probe-value-count"',
    );
  });

  test("the counter is painted for the field's opening value, not left blank for a script", () => {
    expect(createFieldHtml(limited)).toContain(
      '<p class="field__guidance field__guidance--count" id="cap-probe-value-count">' +
        "180 characters left</p>",
    );
    expect(editFieldHtml("x".repeat(20), limited)).toContain(
      'id="edit-probe-value-count">160 characters left</p>',
    );
  });

  test("the counter joins the description, beside a declared hint rather than replacing it", () => {
    const html = createFieldHtml(limited, { guidance: "Keep it short." });
    expect(html).toContain('aria-describedby="cap-probe-value-guidance cap-probe-value-count"');
    expect(html).toContain("Keep it short.</p>");
    expect(html).toContain("180 characters left</p>");
  });

  test("a long-text field carries the same limit, on the same one declaration", () => {
    const html = createFieldHtml(limited, { longText: true });
    expect(html).toContain("<textarea");
    expect(html).toContain(' maxlength="180" data-length-limit="180"');
  });

  test("a field with no limit gets no counter and no native stop", () => {
    expect(createFieldHtml()).not.toContain("maxlength");
    expect(createFieldHtml()).not.toContain("field__guidance--count");
  });
});

describe("the counter's words", () => {
  test("one is singular, because a counter that says '1 characters' is wrong wherever drawn", () => {
    expect(characterCountSentence(180, 179)).toBe("1 character left");
    expect(characterCountSentence(180, 178)).toBe("2 characters left");
  });

  test("nothing left is zero, not the over-the-limit wording", () => {
    expect(characterCountSentence(180, 180)).toBe("0 characters left");
  });

  test("past the limit it counts the overrun instead", () => {
    expect(characterCountSentence(180, 181)).toBe("1 over the limit");
    expect(characterCountSentence(180, 200)).toBe("20 over the limit");
  });

  test("it counts UTF-16 code units, the way the native attribute and the server both do", () => {
    // One astral character is one grapheme, two code units — and `maxlength` stops at two.
    expect(characterCountSentence(64, "😀".length)).toBe("62 characters left");
  });
});

// Small caps is a role the design system owns, and the sheet used to copy all five of its
// declarations out under `.field__label` — the same "restate instead of reuse" duplication
// this epic removed for `.field__control`, and the one `choice-control.ts` had already
// avoided by applying the class.
describe("a field label takes the shared caps role rather than restating it", () => {
  test("every label carries it, whatever shape the control is", () => {
    for (const type of ["string", "number", "boolean", "date", "choice"] as const) {
      const html = renderCreateForm(oneField(probeField(type, { required: true })));
      const labels = [...html.matchAll(/class="field__label[^"]*"/g)].map(([match]) => match);

      expect(labels.length, type).toBeGreaterThan(0);
      for (const label of labels) expect(label, type).toContain(" caps");
    }
  });

  test("and the sheet states only what the role does not", () => {
    const rule =
      /\.field__label \{([\s\S]*?)\}/.exec(
        readFileSync(resolve(import.meta.dir, "../../../public/css/fields.css"), "utf8"),
      )?.[1] ?? "";

    expect(rule).toContain("font-family");
    expect(rule).toContain("line-height");
    for (const restated of [
      "font-size",
      "font-weight",
      "text-transform",
      "letter-spacing",
      "color",
    ]) {
      expect(
        rule,
        `.field__label restates \`${restated}\`, which \`.caps\` already says`,
      ).not.toContain(restated);
    }
  });
});

describe("optional is marked and required is not", () => {
  test("an optional field says so inside its own label", () => {
    expect(createFieldHtml(probeField("string", { required: false }))).toContain(
      '<label class="field__label caps" for="cap-probe-value">' +
        'Value <span class="field__optional">optional</span></label>',
    );
  });

  test("a required field says nothing, so the marker stays the exception", () => {
    expect(createFieldHtml()).toContain(
      '<label class="field__label caps" for="cap-probe-value">Value</label>',
    );
  });

  test("a boolean is never marked: a checkbox always yields a value", () => {
    const html = createFieldHtml(probeField("boolean", { required: false }));
    expect(html).not.toContain("field__optional");
  });

  test("a choice and a list field are marked like any other emptyable control", () => {
    expect(renderCreateForm(oneField(probeField("choice", { required: false })))).toContain(
      "field__optional",
    );
    expect(renderCreateForm(oneField(probeField("string[]", { required: false })))).toContain(
      "field__optional",
    );
  });

  test("nothing anywhere renders a record read-only", () => {
    const editForm = renderEditForm(SAMPLE, {
      id: "record-1",
      title: "T",
      priority: 1,
      done: false,
      due_date: "2026-01-01T00:00:00.000Z",
      note: null,
    });
    expect(editForm).not.toContain("readonly");
    expect(editForm).not.toContain("disabled");
    expect(editForm).toContain('name="note" value=""');
  });
});
