import { describe, expect, test } from "bun:test";
import { capabilityActionUrl } from "#shell/core/routes.js";
import { DELETE_FORM_SELECTOR, DELETE_TRIGGER_SELECTOR } from "#shell/records/record-mutations.js";

import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import type { RenderableCapability } from "../../fields/field-renderer.ts";
import { renderRecordViewTemplate } from "../record-view/record-view.ts";
import { COLLECTION_COUNT_LABEL_ATTR, capabilityCountLabelId } from "../region/collection-count.ts";
import { collectionPage, inOrder, named } from "./collection-page.test-support.ts";
import {
  COLLECTION_LAYOUTS,
  type CollectionLayout,
  collectionLayoutClass,
  DEFAULT_COLLECTION_LAYOUT,
  ITEM_PAYLOAD_ATTR,
  ITEM_RECORD_VIEW_ATTR,
  ITEM_TRIGGER_CLASS,
  itemElementIdForTemplate,
  renderCollection,
  renderItemWrapper,
  SEARCH_DEBOUNCE_MS,
  serializeItemPayload,
} from "./list-container.ts";

// The list container and item wrapper are platform chrome, so their escaping, payload and
// accessibility invariants are deterministic tests rather than gate rungs the model can fail.

const SAMPLE: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  noun: "task",
  schema: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      { name: "priority", label: "Priority", type: "number", required: true, lifecycle: "active" },
      { name: "done", label: "Done", type: "boolean", required: true, lifecycle: "active" },
    ],
  },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  actions: ["create", "read", "update", "delete", "search"],
};

// Reverse escapeHtml exactly (&amp; last so "&amp;lt;" round-trips to "&lt;", not "<") —
// stands in for the browser decoding an attribute value before JSON.parse reads it.
function htmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Pull the raw `data-item` attribute value out of a rendered wrapper. */
function payloadAttrOf(wrapper: string): string {
  const match = new RegExp(`${ITEM_PAYLOAD_ATTR}="([^"]*)"`).exec(wrapper);
  if (!match?.[1]) throw new Error(`no ${ITEM_PAYLOAD_ATTR} attribute in wrapper`);
  return match[1];
}

/** Read a wrapper's payload back the way the client will: unescape the attr, JSON.parse. */
function readBackPayload(wrapper: string): unknown {
  return JSON.parse(htmlUnescape(payloadAttrOf(wrapper)));
}

describe("collection layout — closed feed | grid map", () => {
  test("feed and grid map to their token-consuming platform classes", () => {
    expect(collectionLayoutClass("feed")).toBe("capability-records--feed");
    expect(collectionLayoutClass("grid")).toBe("capability-records--grid");
  });

  test("every layout maps to a distinct, capability-records-scoped class", () => {
    const classes = COLLECTION_LAYOUTS.map(collectionLayoutClass);
    for (const cls of classes) expect(cls.startsWith("capability-records--")).toBe(true);
    expect(new Set(classes).size).toBe(COLLECTION_LAYOUTS.length);
  });

  test("an unknown layout is unrepresentable — the total switch fails closed", () => {
    // The type system forbids this; the cast proves the runtime guard also refuses a
    // value smuggled past it, rather than silently returning undefined.
    expect(() => collectionLayoutClass("table" as CollectionLayout)).toThrow(
      /Unhandled collection layout/,
    );
  });

  test("the default layout is feed (PLAN decision 5, until 3.3/01)", () => {
    expect(DEFAULT_COLLECTION_LAYOUT).toBe("feed");
  });
});

describe("collection layout — where the search chrome sits", () => {
  test("the empty state and the search feedback sit below the collection, not directly in it", () => {
    // The search-state rules are written as descendants because of this nesting; a child
    // combinator over it would match nothing.
    const root = parseHtml(renderCollection({ capability: SAMPLE }), new Doc());
    const collection = root.querySelector(".capability-collection");
    expect(collection).not.toBeNull();
    for (const nested of [".capability-empty", ".capability-search__feedback"]) {
      expect(collection?.querySelector(nested), `${nested} is not rendered`).not.toBeNull();
      expect(
        collection?.querySelector(nested)?.parent?.classList.contains("capability-collection"),
        `${nested} is a direct child, so a child combinator would have reached it`,
      ).toBe(false);
    }
  });
});

describe("container scaffolding", () => {
  test("defaults to the feed layout when none is given", () => {
    const { region } = collectionPage(SAMPLE, renderCollection({ capability: SAMPLE }));
    expect(region.classList.contains(collectionLayoutClass(DEFAULT_COLLECTION_LAYOUT))).toBe(true);
  });

  test("honors the grid layout, and only it", () => {
    const { region } = collectionPage(
      SAMPLE,
      renderCollection({ capability: SAMPLE, layout: "grid" }),
    );
    expect(region.classList.contains(collectionLayoutClass("grid"))).toBe(true);
    expect(region.classList.contains(collectionLayoutClass("feed"))).toBe(false);
  });

  test("the create form posts to the capability's create action", () => {
    const { form, region } = collectionPage(SAMPLE);
    expect(form.getAttribute("hx-post")).toBe(capabilityActionUrl(SAMPLE.id, "create"));
    expect(form.getAttribute("data-records-target-id")).toBe(region.id);
  });

  test("the empty state is written around the capability's record noun", () => {
    // "add your first task above", not "add your first Tasks above": the sentence needs the
    // singular thing, which is what `noun` is for.
    const words = collectionPage(SAMPLE).doc.querySelector(".capability-empty")?.textContent ?? "";
    expect(words).toContain(` ${SAMPLE.noun} `);
    expect(words).not.toContain(SAMPLE.label);
  });

  test("a noun with markup in it is words in the sentence, never markup", () => {
    const noun = "<script>x</script>";
    const { doc } = collectionPage(SAMPLE, renderCollection({ capability: { ...SAMPLE, noun } }));
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector(".capability-empty")?.textContent).toContain(noun);
  });

  test("renders accessible search chrome above the records, and its status line below", () => {
    const { doc, region } = collectionPage(SAMPLE);
    const search = doc.querySelector('form[role="search"]') as El;
    const input = search.querySelector('input[type="search"]') as El;
    const feedback = doc.querySelector(".capability-search__feedback") as El;
    const [searchAt, regionAt, feedbackAt] = inOrder(doc, search, region, feedback);
    expect(searchAt).toBeLessThan(regionAt as number);
    // Nothing comes between the count and the first record, and this line is not always
    // silent — it carries the spinner and the no-match sentence — so it reads last.
    expect(feedbackAt).toBeGreaterThan(regionAt as number);
    expect(input.getAttribute("name")).toBe("q");
    expect(input.getAttribute("aria-label")).toBe(`Search ${SAMPLE.label}`);
    expect(input.getAttribute("aria-controls")).toBe(region.id);
    expect(search.getAttribute("data-search-debounce-ms")).toBe(String(SEARCH_DEBOUNCE_MS));
    expect(search.getAttribute("data-read-url")).toBe(capabilityActionUrl(SAMPLE.id, "read"));
    expect(search.getAttribute("data-search-url")).toBe(capabilityActionUrl(SAMPLE.id, "search"));
    expect(named(search, "button", "Clear").hidden).toBe(true);
    expect(search.querySelector("label")).toBeNull();
    expect(feedback.textContent).toBe("");
    expect(feedback.getAttribute("aria-live")).toBe("polite");
  });

  test("defensively omits search chrome for a View that does not declare search", () => {
    const { doc, region } = collectionPage(
      SAMPLE,
      renderCollection({
        capability: { ...SAMPLE, actions: ["create", "read"] },
        loadThroughRead: true,
      }),
    );
    expect(doc.querySelector('[role="search"]')).toBeNull();
    const searchUrl = capabilityActionUrl(SAMPLE.id, "search");
    expect(
      [...doc.descendants()].some((node) => Object.values(node.attributes).includes(searchUrl)),
    ).toBe(false);
    expect(region.getAttribute("hx-get")).toBe(capabilityActionUrl(SAMPLE.id, "read"));
  });

  test("is data-free: an unseeded region is truly empty so the empty-state CSS fires", () => {
    // No whitespace or children inside the region, so `:empty` matches and the empty state shows.
    const { doc, region } = collectionPage(SAMPLE);
    expect(region.children).toHaveLength(0);
    expect(region.textContent).toBe("");
    expect(doc.querySelector(`[${ITEM_PAYLOAD_ATTR}]`)).toBeNull();
  });

  test("seeds the records region with pre-rendered items when given", () => {
    const items = "<article>ITEM_MARKER</article>";
    const { region } = collectionPage(SAMPLE, renderCollection({ capability: SAMPLE, items }));
    expect(region.children.map((child) => child.textContent)).toEqual(["ITEM_MARKER"]);
  });

  test("a hostile capability label stays words in every place it is said", () => {
    // A name may hold a double quote, which is an attribute breakout wherever it goes unescaped.
    const label = 'A" onfocus="x" <b class="z">B</b>';
    const capability = { ...SAMPLE, label };
    const record = { id: "task-1", created_at: "2026-08-27T00:00:00.000Z", title: "t" };
    const templateId = "record-tasks-task-1";
    const html = renderCollection({
      capability,
      items:
        renderItemWrapper("<span>t</span>", record, { templateId }) +
        renderRecordViewTemplate(templateId, capability, record),
    });
    const { doc, newButton } = collectionPage(capability, html);
    const view = (doc.getElementById(templateId) as El).content as El;
    const search = doc.querySelector("input[type=search]") as El;
    const backs = [doc, view].map((root) => root.querySelector("[data-record-form-back]") as El);

    expect(search.getAttribute("placeholder")).toBe(`Search ${label}`);
    expect(search.getAttribute("aria-label")).toBe(`Search ${label}`);
    expect(doc.querySelector("section")?.getAttribute("aria-label")).toBe(label);
    expect(newButton.textContent).toBe(`New ${label}`);
    expect(named(doc, "form", `Add to ${label}`).tag).toBe("form");
    expect(named(view, "form", `Edit ${label}`).tag).toBe("form");
    for (const back of backs) {
      expect(back.getAttribute("aria-label")).toBe(`Back to ${label}`);
      expect(back.textContent).toEndWith(label);
    }
    const everything = [...doc.descendants(), ...view.descendants()];
    expect(
      everything.filter(
        (node) =>
          node.tag === "b" || (node.hasAttribute("class") && node.getAttribute("class") === "z"),
      ),
    ).toEqual([]);
    expect(
      everything
        .flatMap((node) => Object.keys(node.attributes))
        .filter((name) => name.startsWith("on")),
    ).toEqual([]);
  });
});

describe("what the collection states about how many it holds", () => {
  /** The count, and whether it stands between the rail and the first record with nothing between. */
  function countOf(html: string) {
    const { doc, region } = collectionPage(SAMPLE, html);
    const count = doc.querySelector(`[${COLLECTION_COUNT_LABEL_ATTR}]`) as El;
    const siblings = count.parent?.children ?? [];
    const at = siblings.indexOf(count);
    return { count, region, before: siblings[at - 1], after: siblings[at + 1] };
  }

  test("states how many records it holds, under the search rail and above the first item", () => {
    // PLAN decision 32. Nothing stands between the count and either neighbour, which is what lets
    // the CSS give it the same gap above and below.
    const { count, region, before, after } = countOf(renderCollection({ capability: SAMPLE }));
    expect(before?.tag).toBe("header");
    expect(after).toBe(region);
    expect(count.id).toBe(capabilityCountLabelId(SAMPLE.id));
    expect(region.getAttribute("aria-describedby")).toBe(count.id);
  });

  test("a View that does not declare search still states its count", () => {
    const capability = { ...SAMPLE, actions: ["create", "read"] as const };
    const { before, after, region } = countOf(
      renderCollection({ capability, loadThroughRead: true }),
    );
    expect(before?.tag).toBe("header");
    expect(after).toBe(region);
  });

  test("no number is baked into the chrome — not even for a seeded collection", () => {
    const items = "<article>one</article><article>two</article>";
    expect(countOf(renderCollection({ capability: SAMPLE, items })).count.textContent).toBe("");
  });
});

// The serving mode: the records region lazy-loads live records through
// the capability's `read` action so the platform View stays data-free.
describe("container scaffolding — serving mode (loadThroughRead)", () => {
  const serving = () =>
    collectionPage(SAMPLE, renderCollection({ capability: SAMPLE, loadThroughRead: true }));

  test("wires the records region to load through the read action on load, and stays empty", () => {
    // The region carries the read wiring but no child, so `:empty` still matches and no user
    // record is baked into the chrome; htmx fills it after this scaffolding renders.
    const { doc, region } = serving();
    expect(region.getAttribute("hx-get")).toBe(capabilityActionUrl(SAMPLE.id, "read"));
    expect(region.getAttribute("hx-trigger")).toBe("load");
    expect(region.getAttribute("hx-swap")).toBe("innerHTML");
    expect(region.children).toHaveLength(0);
    expect(doc.querySelector(`[${ITEM_PAYLOAD_ATTR}]`)).toBeNull();
    expect(doc.querySelector(".capability-empty")).not.toBeNull();
  });

  test("ignores seeded items when loading through read — the two modes are mutually exclusive", () => {
    const both = renderCollection({
      capability: SAMPLE,
      loadThroughRead: true,
      items: "<article>SHOULD_NOT_APPEAR</article>",
    });
    expect(both).not.toContain("SHOULD_NOT_APPEAR");
    expect(collectionPage(SAMPLE, both).region.getAttribute("hx-get")).toBe(
      capabilityActionUrl(SAMPLE.id, "read"),
    );
  });

  test("still renders the create disclosure and its post-mutation refresh form", () => {
    const { form, region } = serving();
    expect(form.getAttribute("hx-post")).toBe(capabilityActionUrl(SAMPLE.id, "create"));
    expect(form.getAttribute("hx-swap")).toBe("none");
    expect(form.getAttribute("data-records-target-id")).toBe(region.id);
  });
});

describe("item wrapper — the record button", () => {
  /** The wrapper `renderItemWrapper` writes, parsed. */
  const wrapperOf = (...args: Parameters<typeof renderItemWrapper>) =>
    parseHtml(renderItemWrapper(...args), new Doc()).children[0] as El;

  test("a frame with nothing to open is a card, not a control", () => {
    // Opening one is the only thing a record does, so a wrapper with no record surface
    // behind it must not take focus and then do nothing.
    const card = wrapperOf('<div class="stack">inner</div>', { title: "Buy oat milk" });
    expect(card.tag).toBe("article");
    expect(card.classList.contains(ITEM_TRIGGER_CLASS)).toBe(true);
    expect(card.querySelector("button")).toBeNull();
    expect(card.hasAttribute("role")).toBe(false);
    expect(card.hasAttribute("tabindex")).toBe(false);
  });

  test("a record that opens is a real button, with no role, tabindex or dialog ARIA", () => {
    const record = wrapperOf(
      '<div class="stack">inner</div>',
      { title: "Buy oat milk" },
      { templateId: "record-tasks-7" },
    );
    expect(record.tag).toBe("button");
    expect(record.getAttribute("type")).toBe("button");
    expect(record.classList.contains(ITEM_TRIGGER_CLASS)).toBe(true);
    for (const attribute of ["role", "tabindex", "aria-haspopup"]) {
      expect(record.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  test("frames the inner markup verbatim — it does not re-sanitize its trusted input", () => {
    expect(renderItemWrapper('<div class="stack">inner</div>', {})).toContain(
      '<div class="stack">inner</div>',
    );
  });

  test("carries the caller-supplied client projection as a data-item payload", () => {
    expect(readBackPayload(renderItemWrapper("<span>x</span>", { title: "Buy oat milk" }))).toEqual(
      { title: "Buy oat milk" },
    );
  });

  test("carries the record-view template id the click controller opens with", () => {
    const record = wrapperOf("<span>x</span>", {}, { templateId: "record-tasks-7" });
    expect(record.getAttribute(ITEM_RECORD_VIEW_ATTR)).toBe("record-tasks-7");
    expect(record.id).toBe(itemElementIdForTemplate("record-tasks-7"));
  });

  test("omits the open hook when no ref is given (frame-only, the 3.2/02 shape)", () => {
    expect(wrapperOf("<span>x</span>", { title: "x" }).hasAttribute(ITEM_RECORD_VIEW_ATTR)).toBe(
      false,
    );
  });

  test("a hostile template id stays the attribute's value and opens no element", () => {
    const templateId = 't"><script>';
    const root = parseHtml(renderItemWrapper("<span>x</span>", {}, { templateId }), new Doc());
    expect(root.querySelector("script")).toBeNull();
    expect(root.children[0]?.getAttribute(ITEM_RECORD_VIEW_ATTR)).toBe(templateId);
  });
});

describe("item wrapper — payload escaping + safety invariants", () => {
  test("a hostile record value cannot break out of the attribute or the element", () => {
    const record = { title: '"><script>alert(1)</script>', note: "a & b < c" };
    const wrapper = renderItemWrapper("<span>x</span>", record);

    // The raw breakout sequence never appears; the payload is fully entity-escaped.
    expect(wrapper).not.toContain('"><script>');
    expect(wrapper).not.toContain("<script>alert(1)</script>");
    expect(payloadAttrOf(wrapper)).toContain("&lt;script&gt;");
    // …and it still round-trips to the exact original record.
    expect(readBackPayload(wrapper)).toEqual(record);
  });

  test("round-trips assorted primitive values (number, boolean, null, unicode)", () => {
    const record = { n: 42.5, ok: true, missing: null, name: "café — déjà" };
    const wrapper = renderItemWrapper("<span>x</span>", record);
    expect(readBackPayload(wrapper)).toEqual(record);
  });

  test("never serializes raw bytes — a file field is a reference, never bytes", () => {
    const payload = serializeItemPayload({ blob: new Uint8Array([1, 2, 3]), name: "photo.png" });
    expect(payload).toBe('{"blob":null,"name":"photo.png"}');
    expect(payload).not.toContain("1,2,3");
  });

  test("serializes a file-reference object intact (the shape a file field really holds)", () => {
    const ref = { key: "abc123", mime: "image/png", size: 2048, name: "photo.png" };
    const wrapper = renderItemWrapper("<span>x</span>", { photo: ref });
    expect(readBackPayload(wrapper)).toEqual({ photo: ref });
  });
});

// Nothing in the collection destroys a record (PLAN decision 22). A delete starts by opening the
// record, so the only destructive control is in the record's own surface.
describe("the collection — no per-row delete", () => {
  // Built the way the adapter builds it: each item is emitted beside the inert `<template>`
  // carrying that record's view, so the fixture is the markup the criterion is about.
  const RECORD = { id: "task-7", created_at: "2026-08-27T00:00:00.000Z", title: "Buy oat milk" };
  const templateId = "record-tasks-task-7";
  const items =
    renderItemWrapper('<div class="stack">inner</div>', RECORD, { templateId }) +
    renderRecordViewTemplate(templateId, SAMPLE, RECORD);
  const deleteUrl = capabilityActionUrl(SAMPLE.id, "delete");
  const posts = (root: El) =>
    root.querySelectorAll("[hx-post]").map((n) => n.getAttribute("hx-post"));

  test("nothing reachable in the collection offers a delete", () => {
    // A `<template>`'s content is inert until cloned, so the record's own surface is not part of
    // the collection on screen. Each hook is proved present there, so its absence here means it.
    const { doc } = collectionPage(SAMPLE, renderCollection({ capability: SAMPLE, items }));
    const view = (doc.getElementById(templateId) as El).content as El;
    const destructive = [DELETE_TRIGGER_SELECTOR, DELETE_FORM_SELECTOR, ".btn--danger"];
    const saysDelete = (root: El) =>
      root
        .querySelectorAll("button")
        .filter((b) => /delete/i.test(b.getAttribute("aria-label") ?? b.textContent));
    expect(destructive.map((hook) => view.querySelector(hook) !== null)).toEqual([
      true,
      true,
      true,
    ]);
    expect(saysDelete(view)).not.toEqual([]);
    expect(destructive.map((hook) => doc.querySelector(hook))).toEqual([null, null, null]);
    expect(saysDelete(doc)).toEqual([]);
    expect(posts(doc)).not.toContain(deleteUrl);
    expect(doc.getElementById(itemElementIdForTemplate(templateId))?.tag).toBe("button");
  });

  test("the delete the collection carries travels inert, inside the record's template", () => {
    const { doc } = collectionPage(SAMPLE, renderCollection({ capability: SAMPLE, items }));
    const template = doc.getElementById(templateId) as El;
    expect(template.tag).toBe("template");
    expect(posts(template.content as El)).toContain(deleteUrl);
  });
});
