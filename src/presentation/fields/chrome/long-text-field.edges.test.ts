// The long-text controls at their edges, run through the real `public/fields/long-text-field.js` on the
// markup the renderer writes: a plain limited input, a box with no limit, a page with no box
// watcher, and what the box watch answers to.

import { describe, expect, test } from "bun:test";

import { regionScopeReport } from "#shell/core/region-scope.js";
import { installDomGlobals } from "../../controls/double/choice-picker.fixture.test-support.ts";
import { Doc, El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import { oneField, probeField } from "../field-renderer.test-support.ts";
import { renderCreateForm } from "../field-renderer.ts";

installDomGlobals();

const MOUNTED = "data-long-text-mounted";

/** A create form for one text field, long or not, limited or not. */
const textForm = ({ longText = true, limit }: { longText?: boolean; limit?: number }) =>
  renderCreateForm(
    oneField(
      probeField("string", {
        required: false,
        ...(limit === undefined ? {} : { max_length: limit }),
      }),
      "repeatable",
      "picker",
      { longText },
    ),
  );

/** One rendered form in `doc`, with the module started over it. */
async function started(markup: string, doc: Doc = new Doc()) {
  const { startLongTextFields } = await import("#shell/fields/long-text-field.js");
  const root = new El("html");
  doc.append(root);
  parseHtml(markup, root);
  startLongTextFields(doc as never);
  const control = root.querySelector("textarea, input:not([type=hidden])") as El;
  return {
    doc,
    root,
    control,
    type: (text: string) => {
      control.value = text;
      doc.fire("input", control);
    },
  };
}

const watches = () => regionScopeReport().filter(({ label }) => label === "long-text layout watch");

describe("which controls grow", () => {
  test("a plain input with a limit counts down and never grows, and is watched by nothing", async () => {
    const before = watches().length;
    const one = await started(textForm({ longText: false, limit: 20 }));
    expect(one.control.tag).toBe("input");
    one.control.scrollHeight = 300;
    one.type("typed");
    expect(one.control.getAttribute("style")).toBeNull();
    expect([one.doc.resizes, watches().length - before]).toEqual([[], 0]);
  });

  test("a growing box with no limit grows without a counter to paint", async () => {
    const one = await started(textForm({ limit: undefined }));
    one.control.scrollHeight = 90;
    expect(() => one.type("typed")).not.toThrow();
    expect(one.control.style.height).toBe("90px");
    expect(watches().some(() => true)).toBe(true);
  });

  test("an arriving input that is neither is left unmounted", async () => {
    const { mountLongTextFields } = await import("#shell/fields/long-text-field.js");
    const plain = parseHtml('<input name="q">', new El("div")).querySelector("input") as El;
    expect(mountLongTextFields(plain as never)).toBe(0);
    expect(plain.hasAttribute(MOUNTED)).toBe(false);
  });

  test("a counter whose limit is zero is a rendering bug that says so", async () => {
    const { mountLongTextFields } = await import("#shell/fields/long-text-field.js");
    const doc = new Doc();
    const held = parseHtml(textForm({ longText: false, limit: 20 }), doc);
    (held.querySelector("[data-length-limit]") as El).setAttribute("data-length-limit", "0");
    expect(() => mountLongTextFields(doc as never)).toThrow(/Length counter/);
  });
});

describe("the box watch", () => {
  test("a page with no box watcher, or no window at all, still grows the box as it is typed in", async () => {
    class Unwatched extends Doc {
      override get defaultView() {
        const { ResizeObserver: _gone, ...rest } = super.defaultView;
        return rest as never;
      }
    }
    class Windowless extends Doc {
      override get defaultView() {
        return null as never;
      }
    }
    for (const doc of [new Unwatched(), new Windowless()]) {
      const one = await started(textForm({ limit: 20 }), doc);
      one.control.scrollHeight = 80;
      one.type("typed");
      expect(one.control.style.height).toBe("80px");
    }
  });

  test("a box that did not change width is not measured again", async () => {
    const one = await started(textForm({ limit: 20 }));
    one.doc.resize(one.control, 600);
    one.control.scrollHeight = 64;
    one.type("one long line");
    one.control.scrollHeight = 128;
    one.doc.resize(one.control, 600);
    expect(one.control.style.height).toBe("64px");
  });
});
