// The desk double is what every window, lamp and gesture is proved against, so it is held to the
// browser's answers here: a property kept apart from its attribute, a listener that cannot be taken
// off, or a box watch that hears every resize would each pass a rule the browser breaks.

import { afterEach, describe, expect, test } from "bun:test";

import { El, type StandingDesk, standingDesk } from "./standing-desk.test-support.ts";
import { type ViewportDesk, viewportDesk } from "./viewport-desk.test-support.ts";

let desk: StandingDesk | undefined;
let screen: ViewportDesk | undefined;
afterEach(() => {
  desk?.restore();
  screen?.restore();
  desk = undefined;
  screen = undefined;
});

describe("a property is its attribute, read another way", () => {
  test("dataset, className, title, hidden and disabled all read and write the attributes", () => {
    const node = new El("button");
    node.dataset.lampLabel = "Put away";
    node.setAttribute("data-action", "putaway");
    node.className = "lamp";
    node.hidden = true;
    node.disabled = true;

    expect(node.getAttribute("data-lamp-label")).toBe("Put away");
    expect(node.dataset.action).toBe("putaway");
    expect(node.getAttribute("class")).toBe("lamp");
    expect([node.hasAttribute("hidden"), node.hasAttribute("disabled")]).toEqual([true, true]);
    expect(node.matches('[data-action="putaway"]')).toBe(true);

    node.removeAttribute("disabled");
    expect(node.disabled).toBe(false);
  });

  test("innerHTML builds the children it names, and reading it writes them back out", () => {
    const node = new El("div");
    node.innerHTML = `<p class="a">one &amp; <b>two</b></p>`;

    expect(node.querySelector("b")?.textContent).toBe("two");
    expect(node.textContent).toBe("one & two");
    expect(node.innerHTML).toBe(`<p class="a">one &amp; <b>two</b></p>`);
    expect(() => {
      node.innerHTML = "<div>unclosed";
    }).toThrow();
  });

  test("an attribute name the browser would not take throws", () => {
    for (const name of ["", "1a", "a b"]) {
      expect(() => new El("p").setAttribute(name, ""), JSON.stringify(name)).toThrow();
    }
  });
});

describe("events and focus on a standing desk", () => {
  test("a listener taken off hears nothing, and capture runs before the target", () => {
    desk = standingDesk();
    const heard: string[] = [];
    const later = () => heard.push("removed");
    desk.doc.addEventListener("ping", () => heard.push("document, captured"), { capture: true });
    desk.doc.addEventListener("ping", () => heard.push("document"));
    desk.bar.addEventListener("ping", later);
    desk.bar.removeEventListener("ping", later);

    desk.bar.dispatchEvent(new CustomEvent("ping"));
    desk.bar.dispatchEvent(new CustomEvent("ping", { bubbles: true }));

    expect(heard).toEqual(["document, captured", "document, captured", "document"]);
  });

  test("focus falls back to the page when what held it leaves, and refuses a hidden node", () => {
    desk = standingDesk();
    const field = desk.bar.querySelector("input") as El;
    field.focus();
    expect(desk.doc.activeElement).toBe(field);

    desk.bar.remove();
    expect(desk.doc.activeElement).toBe(desk.root);
    expect(field.focused).toBe(false);

    const hidden = new El("button");
    hidden.hidden = true;
    desk.root.append(hidden);
    hidden.focus();
    expect(desk.doc.activeElement).toBe(desk.root);
  });
});

describe("a box watch hears only the box it watches", () => {
  test("laying the desk out tells a watch on the layer, and no other", async () => {
    screen = await viewportDesk();
    const heard: string[] = [];
    const Watch = (
      globalThis as unknown as {
        ResizeObserver: new (run: () => void) => { observe(target: unknown): void };
      }
    ).ResizeObserver;
    new Watch(() => heard.push("layer")).observe(screen.desk.layer);
    new Watch(() => heard.push("body")).observe(screen.desk.root);

    screen.layOut();

    expect(heard).toEqual(["layer"]);
  });
});
