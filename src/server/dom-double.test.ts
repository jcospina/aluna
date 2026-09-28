// The DOM double is what the shell glue's rules are proved against, so a misparse or a missing
// propagation step would pass a rule the browser breaks. These hold it to the browser's answers.

import { describe, expect, test } from "bun:test";
import { DomDocument, El, Template, Text } from "./dom-double.test-support.ts";
import { cssEscape } from "./dom-events.test-support.ts";

function parsed(raw: string): El {
  const template = new Template();
  template.innerHTML = raw;
  return template.content;
}

describe("a template parses markup the way the browser does", () => {
  test("text keeps its whitespace, decoded, in document order", () => {
    const content = parsed("<p>\n  Hi &amp; <b>you</b> there&#39;s \n</p>");
    const [paragraph] = content.children;

    expect(paragraph?.textContent).toBe("\n  Hi & you there's \n");
    expect(paragraph?.childNodes.map((node) => node instanceof Text)).toEqual([true, false, true]);
  });

  test("a comment is no text and no element", () => {
    const content = parsed("<p>a<!-- <b>not</b> words -->b</p><!---->");

    expect(content.textContent).toBe("ab");
    expect(content.querySelector("b")).toBeNull();
  });

  test("attributes are read however they are quoted, or bare", () => {
    const [node] = parsed(
      `<p data-a="one" data-b='two "2"' data-c=three DATA-D hidden></p>`,
    ).children;

    expect(Object.fromEntries(node?.attributes ?? [])).toEqual({
      "data-a": "one",
      "data-b": 'two "2"',
      "data-c": "three",
      "data-d": "",
      hidden: "",
    });
  });

  test("a raw-text element's words never become markup", () => {
    const [area] = parsed("<textarea><p>&lt;kept&gt;</p></textarea>").children;

    expect(area?.children).toEqual([]);
    expect(area?.textContent).toBe("<p><kept></p>");
  });

  test("anything the browser would build differently is refused, not guessed", () => {
    for (const raw of [
      "<p>a<div>b</div></p>",
      "<li>a<li>b</li></li>",
      "<div>a</span>",
      "<div>open",
      "<div/>",
      "<table><tr><td>x</td></tr></table>",
      "<select><div>x</div></select>",
      "<p>&nbsp;</p>",
      "<!DOCTYPE html>",
      "<p>1 < 2</p>",
    ]) {
      expect(() => parsed(raw), raw).toThrow();
    }
  });
});

describe("an event travels the way the browser sends it", () => {
  function tree() {
    const top = new El("body");
    const middle = new El("div");
    const bottom = new El("p");
    top.append(middle);
    middle.append(bottom);
    const heard: string[] = [];
    for (const [name, node] of [
      ["top", top],
      ["middle", middle],
      ["bottom", bottom],
    ] as const) {
      node.addEventListener("ping", () => heard.push(name));
    }
    const document = new DomDocument(top);
    document.addEventListener("ping", () => heard.push("document"));
    return { top, middle, bottom, heard, document };
  }

  test("a bubbling event climbs to the document, and one that does not stays put", () => {
    const climbing = tree();
    climbing.bottom.dispatchEvent(new CustomEvent("ping", { bubbles: true }));
    const staying = tree();
    staying.bottom.dispatchEvent(new CustomEvent("ping"));

    expect(climbing.heard).toEqual(["bottom", "middle", "top", "document"]);
    expect(staying.heard).toEqual(["bottom"]);
  });

  test("stopping it ends the climb where it was stopped, with the target it was sent at", () => {
    const { middle, bottom, heard } = tree();
    const targets: unknown[] = [];
    middle.addEventListener("ping", (event) => {
      targets.push((event as Event).target);
      (event as Event).stopPropagation();
    });

    bottom.dispatchEvent(new CustomEvent("ping", { bubbles: true }));

    expect(heard).toEqual(["bottom", "middle"]);
    expect(targets).toEqual([bottom]);
  });

  test("capture listeners run top-down first, and only bubble listeners hear the climb", () => {
    const { top, bottom, heard, document } = tree();
    document.addEventListener("ping", () => heard.push("document, captured"), { capture: true });
    top.addEventListener("ping", () => heard.push("top, captured"), true);

    bottom.dispatchEvent(new CustomEvent("ping"));

    expect(heard).toEqual(["document, captured", "top, captured", "bottom"]);
  });

  test("a listener asked for once hears once, and a removed one never", () => {
    const { middle, bottom, heard } = tree();
    const again = () => heard.push("removed");
    middle.addEventListener("ping", () => heard.push("once"), { once: true });
    middle.addEventListener("ping", again, { capture: true });
    middle.removeEventListener("ping", again, true);

    bottom.dispatchEvent(new CustomEvent("ping", { bubbles: true }));
    bottom.dispatchEvent(new CustomEvent("ping", { bubbles: true }));

    expect(heard.filter((one) => one === "once" || one === "removed")).toEqual(["once"]);
  });

  test("events the browser never bubbles stay at their target", () => {
    for (const type of ["invalid", "focus", "blur", "load", "scroll", "mouseenter"]) {
      const { bottom, heard } = tree();
      for (const node of [bottom.parent, bottom])
        node?.addEventListener(type, () => heard.push(type));

      bottom.dispatchEvent({ type });

      expect(heard, type).toEqual([type]);
    }
  });
});

describe("focus lands where the browser lets it", () => {
  function page() {
    const body = new El("body");
    const document = new DomDocument(body);
    const field = new El("input");
    body.append(field);
    return { body, document, field };
  }

  test("the body holds focus until something takes it, and again once that leaves", () => {
    const { body, document, field } = page();
    expect(document.activeElement).toBe(body);

    field.focus({ focusVisible: true });
    expect(document.activeElement).toBe(field);
    expect(field.focusOptions).toEqual({ focusVisible: true });

    field.remove();
    expect(document.activeElement).toBe(body);
    expect(field.focused).toBe(false);
  });

  test("one element at a time holds it", () => {
    const { body, document, field } = page();
    const other = new El("button");
    body.append(other);

    field.focus();
    other.focus();

    expect([field.focused, other.focused]).toEqual([false, true]);
    expect(document.activeElement).toBe(other);
  });

  test("a hidden, disabled, undisplayed, unfocusable or detached node refuses it", () => {
    const refusing = [
      new El("input", { hidden: "" }),
      new El("button", { disabled: "" }),
      new El("input", { style: "display: none;" }),
      new El("div"),
    ];
    const { body, document } = page();
    body.append(...refusing);
    for (const node of [...refusing, new El("input")]) {
      node.focus();
      expect(document.activeElement, node.tag).toBe(body);
    }
  });
});

describe("the double refuses what the browser would refuse", () => {
  test("an attribute name the browser would not take throws", () => {
    for (const name of ["", "1a", "a b", "@click"]) {
      expect(() => new El("p").setAttribute(name, "x"), name).toThrow();
    }
  });
});

describe("CSS.escape as the CSSOM specifies it", () => {
  test("a leading digit, a lone hyphen and every non-identifier character are escaped", () => {
    expect(
      ["notes-1", "1a", "-1", "-", "a.b", "a b", "#id", "é_ok", "\u0001x"].map(cssEscape),
    ).toEqual(["notes-1", "\\31 a", "-\\31 ", "\\-", "a\\.b", "a\\ b", "\\#id", "é_ok", "\\1 x"]);
  });
});
