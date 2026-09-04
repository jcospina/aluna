import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Doc, parseHtml } from "../controls/choice-picker.test-support.ts";
import { capabilityRecordsRegionId, type RenderableCapability } from "../fields/field-renderer.ts";
import { COLLECTION_COUNT_LABEL_ATTR, capabilityCountLabelId } from "./collection-count.ts";
import {
  COLLECTION_LAYOUTS,
  type CollectionLayout,
  collectionLayoutClass,
  DEFAULT_COLLECTION_LAYOUT,
  ITEM_PAYLOAD_ATTR,
  ITEM_RECORD_VIEW_ATTR,
  ITEM_TRIGGER_CLASS,
  renderCollection,
  renderItemWrapper,
  serializeItemPayload,
} from "./list-container.ts";
import { renderRecordViewTemplate } from "./record-view.ts";

// The list scaffolding container + item wrapper are platform chrome — their
// escaping/payload/accessibility invariants are deterministic platform tests, not gate
// rungs the model can fail. These pin: the closed `feed | grid` layout map (unknown
// layout is unrepresentable), the container's New X / empty state / data-free region, and
// the wrapper's record `<button>` + escaped `data-item` payload (round-trip, hostile
// values, byte guard).

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

describe("collection layout — CSS parity", () => {
  // The classes the mapper emits must actually be styled, or a layout renders unstyled.
  const css = readFileSync(join(import.meta.dir, "../../../public/css/collection.css"), "utf8");
  /* Selectors, whatever a formatter did to them: comments gone (a comment quoting a
     selector must not answer for one) and every run of whitespace one space. */
  const flatCss = css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");
  const SEARCH_STATES = ["idle", "loading", "results", "no-matches", "error"] as const;

  test("each layout class is defined in collection.css", () => {
    for (const layout of COLLECTION_LAYOUTS) {
      expect(css).toContain(`.${collectionLayoutClass(layout)}`);
    }
  });

  test("the item wrapper and empty state are defined in collection.css", () => {
    expect(css).toContain(`.${ITEM_TRIGGER_CLASS}`);
    expect(css).toContain(".capability-empty");
    expect(css).toContain(".capability-search__input");
    expect(css).toContain(".capability-collection__new");
    expect(css).toContain("justify-content: space-between");
    expect(css).toContain('[data-search-state="no-matches"]');
    expect(css).toContain('[data-search-state="error"]');
  });

  test("a search in any state suppresses the canonical empty state", () => {
    // "Nothing here yet" is what a capability with no records says. Every state but
    // `idle` is a search in progress or settled, and a filtered collection is not a bare
    // one — so none of them may leave that sentence on screen.
    for (const state of SEARCH_STATES.filter((s) => s !== "idle")) {
      expect(flatCss, `[${state}] leaves the empty state showing`).toContain(
        `.capability-collection[data-search-state="${state}"] .capability-empty`,
      );
    }
  });

  test("collection-wide search feedback suppresses the canonical empty state", () => {
    expect(flatCss).toContain(
      '.capability-collection[data-search-state="no-matches"] .capability-empty',
    );
    expect(flatCss).toContain(
      '.capability-collection[data-search-state="no-matches"] .capability-search__feedback',
    );
  });

  test("every search-state rule actually reaches the chrome it is written about", () => {
    // The rules above once used `>`, and matched nothing at all: the flag is on the
    // collection but the chrome is nested one level down, inside the half of the
    // collection the create form swaps out. Every state rule was inert, which is how a
    // search with no matches came to show its own message *and* "Nothing here yet" — two
    // different facts about two different things, on screen together.
    //
    // Asserting the selector string alone is what let that ship. So the nesting is read
    // out of the parsed render — document order would still pass if the chrome were
    // hoisted out of the list — and the combinator that cannot cross it is refused over a
    // whitespace-flattened, comment-free sheet, because the rule that shipped broken was
    // written across three lines and no single-space scan would have seen it.
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
    for (const state of SEARCH_STATES) {
      expect(flatCss, `a child combinator under [${state}] matches nothing`).not.toContain(
        `.capability-collection[data-search-state="${state}"] >`,
      );
    }
  });
});

describe("container scaffolding", () => {
  const feed = renderCollection({ capability: SAMPLE, layout: "feed" });

  test("defaults to the feed layout when none is given", () => {
    const defaulted = renderCollection({ capability: SAMPLE });
    expect(defaulted).toContain(collectionLayoutClass(DEFAULT_COLLECTION_LAYOUT));
  });

  test("renders the records region with the capability's derived id + layout class", () => {
    expect(feed).toContain(`id="${capabilityRecordsRegionId("tasks")}"`);
    expect(feed).toContain('class="capability-records capability-records--feed"');
  });

  test("honors the grid layout", () => {
    const grid = renderCollection({ capability: SAMPLE, layout: "grid" });
    expect(grid).toContain("capability-records--grid");
    expect(grid).not.toContain("capability-records--feed");
  });

  test('renders a "New X" button that gives the whole window to the create form', () => {
    expect(feed).toContain("btn--primary");
    expect(feed).toContain("New Tasks");
    expect(feed).toContain('hx-post="/capability/tasks/create"');

    // Two views of one surface, not a panel over a list (design D2): the collection
    // and the form are shown by the same flag, and never both at once.
    expect(feed).toContain('class="capability-collection__list" x-show="!createOpen"');
    expect(feed).toContain('x-ref="createPanel" x-show="createOpen"');
    // The records region and the empty state belong to the list view, so the form
    // replaces them rather than pushing them down.
    const listView = feed.slice(
      feed.indexOf('class="capability-collection__list"'),
      feed.indexOf('class="capability-collection__create"'),
    );
    expect(listView).toContain(`id="${capabilityRecordsRegionId("tasks")}"`);
    expect(listView).toContain("capability-empty");
  });

  test("opening the form moves focus into it, because the list is gone", () => {
    // A view swap that leaves focus on a control no longer on screen strands a
    // keyboard user at the top of the desk.
    expect(feed).toContain("createOpen = true");
    // Every field is preceded by its own hidden `__aluna_present` marker, so the
    // first `input` in the form is one that cannot take focus at all. The last two are
    // the drawn choice controls, which are not form elements: a capability whose fields
    // are all picker or segmented matched nothing here and opened onto no focus at all.
    expect(feed).toContain(
      "$refs.createPanel.querySelector('input:not([type=hidden]), textarea, select," +
        " .listbox__button, .segmented button:not([disabled])')?.focus()",
    );
  });

  test("a successful create closes the form and returns focus to its New button", () => {
    // The success path used to close the view and leave focus on a control that had
    // gone, which drops a keyboard user at the top of the desk.
    expect(feed).toContain(
      "@aluna:record-created.window=\"if ($event.detail?.capabilityId === 'tasks') " +
        '{ createOpen = false; $nextTick(() => $refs.createTrigger.focus()) }"',
    );
  });

  test("Cancel is the same exit from the other end, and both return focus to New", () => {
    expect(feed).toContain('x-ref="createTrigger"');
    expect(feed).toContain(
      `@aluna:create-cancelled="createOpen = false; $nextTick(() => $refs.createTrigger.focus())"`,
    );
    expect(feed).toContain("data-create-cancel");
  });

  test("renders the empty state, written around the capability's record noun", () => {
    // "add your first task above", not "add your first Tasks above": the empty-state
    // sentence needs the singular thing, which is what `noun` is for.
    expect(feed).toContain('class="capability-empty"');
    expect(feed).toContain("Nothing here yet — add your first task above.");
  });

  test("a noun with markup in it is escaped into the sentence, never interpolated raw", () => {
    const rendered = renderCollection({
      capability: { ...SAMPLE, noun: "<script>x</script>" },
    });
    expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("add your first &lt;script&gt;x&lt;/script&gt; above.");
  });

  test("renders accessible debounced search chrome above the records region", () => {
    const searchIndex = feed.indexOf('data-capability-search data-search-state="idle"');
    const headerEndIndex = feed.indexOf("</header>");
    const feedbackIndex = feed.indexOf('class="capability-search__feedback"');
    const recordsIndex = feed.indexOf(
      `<div id="${capabilityRecordsRegionId("tasks")}" class="capability-records`,
    );
    expect(searchIndex).toBeGreaterThan(-1);
    expect(searchIndex).toBeLessThan(recordsIndex);
    // Nothing comes between the count and the first record, and this line is not always
    // silent — it carries the spinner and the no-match sentence — so it reads last.
    expect(feedbackIndex).toBeGreaterThan(headerEndIndex);
    expect(feedbackIndex).toBeGreaterThan(recordsIndex);
    expect(feed).toContain('role="search"');
    expect(feed).toContain('type="search" name="q"');
    expect(feed).toContain('aria-label="Search Tasks"');
    expect(feed).toContain('aria-controls="tasks-records"');
    expect(feed).toContain('data-search-debounce-ms="300"');
    expect(feed).toContain('data-read-url="/capability/tasks/read"');
    expect(feed).toContain('data-search-url="/capability/tasks/search"');
    expect(feed).toContain("data-capability-search-clear hidden>Clear</button>");
    expect(feed).toContain("data-capability-search-status></span>");
    expect(feed).not.toContain('<label class="sr-only"');
    expect(feed).not.toContain("I couldn’t find a match. Try another word.");
  });

  test("defensively omits search chrome for a View that does not declare search", () => {
    const withoutSearch = renderCollection({
      capability: { ...SAMPLE, actions: ["create", "read"] },
      loadThroughRead: true,
    });
    expect(withoutSearch).not.toContain("data-capability-search");
    expect(withoutSearch).not.toContain("/capability/tasks/search");
    expect(withoutSearch).toContain('hx-get="/capability/tasks/read"');
  });

  test("closes the create disclosure only when THIS capability reports a created record", () => {
    expect(feed).toContain("@aluna:record-created.window=");
    expect(feed).toContain("$event.detail?.capabilityId === 'tasks'");
  });

  test("is data-free: an unseeded region is truly empty so the empty-state CSS fires", () => {
    // No whitespace/children inside the region → `:empty` matches → empty state shows.
    expect(feed).toContain(
      `id="${capabilityRecordsRegionId("tasks")}" class="capability-records capability-records--feed"` +
        ' aria-describedby="tasks-count" data-content-region="records"></div>',
    );
    expect(feed).not.toContain(ITEM_PAYLOAD_ATTR);
  });

  test("seeds the records region with pre-rendered items when given", () => {
    const seeded = renderCollection({
      capability: SAMPLE,
      items: "<article>ITEM_MARKER</article>",
    });
    expect(seeded).toContain("ITEM_MARKER");
    expect(seeded).toContain(
      'class="capability-records capability-records--feed" aria-describedby="tasks-count" data-content-region="records">',
    );
  });

  test("escapes the capability label in chrome (New X + region aria)", () => {
    const hostile = renderCollection({
      capability: { ...SAMPLE, label: "<img src=x onerror=alert(1)>" },
    });
    expect(hostile).not.toContain("<img src=x");
    expect(hostile).toContain("&lt;img src=x");
  });
});

describe("what the collection states about how many it holds", () => {
  const feed = renderCollection({ capability: SAMPLE, layout: "feed" });

  test("states how many records it holds, under the search rail and above the first item", () => {
    // PLAN decision 32. Platform chrome between the search rail and the records region —
    // and empty in the container, because the number arrives with the records themselves
    // rather than being baked into a View that outlives them.
    const headerEndIndex = feed.indexOf("</header>");
    const countIndex = feed.indexOf(`${COLLECTION_COUNT_LABEL_ATTR}></p>`);
    const recordsIndex = feed.indexOf(
      `<div id="${capabilityRecordsRegionId("tasks")}" class="capability-records`,
    );
    // Nothing stands between the count and either neighbour, which is what lets the CSS
    // give it the same gap above and below.
    expect(countIndex).toBeGreaterThan(headerEndIndex);
    expect(countIndex).toBeLessThan(recordsIndex);
    const countStart = feed.indexOf('<p class="capability-count');
    expect(feed.slice(headerEndIndex + "</header>".length, countStart)).toBe("");
    expect(feed).toContain(
      `<p class="capability-count caps" id="${capabilityCountLabelId("tasks")}"`,
    );
  });

  test("a View that does not declare search still states its count", () => {
    const withoutSearch = renderCollection({
      capability: { ...SAMPLE, actions: ["create", "read"] },
      loadThroughRead: true,
    });
    const countIndex = withoutSearch.indexOf(`${COLLECTION_COUNT_LABEL_ATTR}></p>`);
    const recordsIndex = withoutSearch.indexOf(
      `<div id="${capabilityRecordsRegionId("tasks")}" class="capability-records`,
    );
    expect(countIndex).toBeGreaterThan(withoutSearch.indexOf("</header>"));
    expect(countIndex).toBeLessThan(recordsIndex);
  });

  test("no number is baked into the chrome — not even for a seeded collection", () => {
    const seeded = renderCollection({
      capability: SAMPLE,
      items: "<article>one</article><article>two</article>",
    });
    expect(seeded).toContain(`${COLLECTION_COUNT_LABEL_ATTR}></p>`);
  });
});

// The serving mode: the records region lazy-loads live records through
// the capability's `read` action so the platform View stays data-free.
describe("container scaffolding — serving mode (loadThroughRead)", () => {
  const serving = renderCollection({ capability: SAMPLE, loadThroughRead: true });

  test("wires the records region to load through the read action on load", () => {
    expect(serving).toContain(
      `<div id="${capabilityRecordsRegionId("tasks")}" class="capability-records capability-records--feed"` +
        ' aria-describedby="tasks-count" data-content-region="records"' +
        ' hx-get="/capability/tasks/read" hx-trigger="load" hx-swap="innerHTML"></div>',
    );
  });

  test("keeps the region truly empty — data-free chrome, empty state fires until read fills it", () => {
    // The region carries the read wiring but no child, so `:empty` still matches and no
    // user record is baked into the chrome; htmx fills it after this scaffolding renders.
    expect(serving).toContain('hx-swap="innerHTML"></div>');
    expect(serving).not.toContain(ITEM_PAYLOAD_ATTR);
    expect(serving).toContain('class="capability-empty"');
  });

  test("ignores seeded items when loading through read — the two modes are mutually exclusive", () => {
    const both = renderCollection({
      capability: SAMPLE,
      loadThroughRead: true,
      items: "<article>SHOULD_NOT_APPEAR</article>",
    });
    expect(both).not.toContain("SHOULD_NOT_APPEAR");
    expect(both).toContain('hx-get="/capability/tasks/read"');
  });

  test("still renders the create disclosure and its post-mutation refresh form", () => {
    expect(serving).toContain("New Tasks");
    expect(serving).toContain('hx-post="/capability/tasks/create"');
    expect(serving).toContain('hx-swap="none"');
    expect(serving).toContain(`data-records-target-id="${capabilityRecordsRegionId("tasks")}"`);
  });
});

describe("item wrapper — the record button", () => {
  const wrapper = renderItemWrapper('<div class="stack">inner</div>', { title: "Buy oat milk" });

  test("a frame with nothing to open is a card, not a control", () => {
    // Opening one is the only thing a record does, so a wrapper with no record surface
    // behind it must not take focus and then do nothing.
    expect(wrapper).toContain("<article");
    expect(wrapper).toContain(`class="${ITEM_TRIGGER_CLASS}"`);
    expect(wrapper).not.toContain("<button");
    expect(wrapper).not.toContain("role=");
    expect(wrapper).not.toContain("tabindex=");
  });

  test("a record that opens is a real button, with no role, tabindex or dialog ARIA", () => {
    const record = renderItemWrapper(
      '<div class="stack">inner</div>',
      { title: "Buy oat milk" },
      {
        templateId: "record-tasks-7",
      },
    );
    expect(record).toContain('<button type="button"');
    expect(record).toContain(`class="${ITEM_TRIGGER_CLASS}"`);
    expect(record).not.toContain("role=");
    expect(record).not.toContain("tabindex=");
    expect(record).not.toContain("aria-haspopup");
  });

  test("frames the inner markup verbatim — it does not re-sanitize its trusted input", () => {
    expect(wrapper).toContain('<div class="stack">inner</div>');
  });

  test("carries the caller-supplied client projection as a data-item payload", () => {
    expect(readBackPayload(wrapper)).toEqual({ title: "Buy oat milk" });
  });
});

// Nothing in the collection destroys a record (PLAN decision 22). A delete starts by
// opening the record, so the only destructive control anywhere is in the record's own
// surface — never on a row of the list, and never in the collection's chrome.
describe("the collection — no per-row delete", () => {
  // Built the way the adapter builds it (src/presentation/records/adapter.ts): each item is
  // emitted beside the inert `<template>` carrying that record's view, so the fixture is
  // the markup the criterion is actually about.
  const RECORD = { id: "task-7", created_at: "2026-08-27T00:00:00.000Z", title: "Buy oat milk" };
  const templateId = "record-tasks-task-7";
  const items =
    renderItemWrapper('<div class="stack">inner</div>', RECORD, { templateId }) +
    renderRecordViewTemplate(templateId, SAMPLE, RECORD);
  const collection = renderCollection({ capability: SAMPLE, items });
  // What the user can actually reach: a `<template>`'s content is inert until cloned, so
  // the record's own surface is not part of the collection on screen.
  const reachable = collection.replace(/<template[\s\S]*?<\/template>/g, "");

  test("nothing reachable in the collection offers a delete", () => {
    expect(reachable).not.toContain("data-record-delete");
    expect(reachable).not.toContain("capability-record-delete");
    expect(reachable).not.toContain("/delete");
    expect(reachable).not.toContain("btn--danger");
  });

  test("the delete the collection carries is inert until the record is opened", () => {
    // It travels with the record so opening one needs no round trip; until then it is
    // template content, which is not rendered, not scripted and not clickable.
    expect(collection).toContain("capability-record-delete");
    expect(collection.indexOf("capability-record-delete")).toBeGreaterThan(
      collection.indexOf("<template"),
    );
  });

  test("opening the record is still the only thing a row does", () => {
    const row = renderItemWrapper("<span>inner</span>", RECORD, { templateId });
    expect(row).toContain(ITEM_RECORD_VIEW_ATTR);
    expect(row).not.toContain("data-record-delete");
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

// The click-to-open wiring: the wrapper carries the hook the record swap reads to open
// one record. Optional so the frame-only shape (the stand-in demo) still renders without
// it, and so a capability that cannot be updated carries no open hook at all.
describe("item wrapper — the record-view open hook", () => {
  const wrapper = renderItemWrapper(
    "<span>x</span>",
    { title: "Buy oat milk" },
    { templateId: "record-tasks-7" },
  );

  test("carries the record-view template id the click controller opens with", () => {
    expect(wrapper).toContain(`${ITEM_RECORD_VIEW_ATTR}="record-tasks-7"`);
    expect(wrapper).toContain('id="record-tasks-7-item"');
  });

  test("still carries the record payload alongside the open hook", () => {
    expect(readBackPayload(wrapper)).toEqual({ title: "Buy oat milk" });
  });

  test("omits the open hook when no ref is given (frame-only, the 3.2/02 shape)", () => {
    const frameOnly = renderItemWrapper("<span>x</span>", { title: "x" });
    expect(frameOnly).not.toContain(ITEM_RECORD_VIEW_ATTR);
  });

  test("escapes a hostile template id so it cannot break out of its attribute", () => {
    const hostile = renderItemWrapper("<span>x</span>", {}, { templateId: 't"><script>' });
    expect(hostile).not.toContain('"><script>');
    expect(hostile).toContain("&quot;&gt;&lt;script&gt;");
  });
});

// No DOM in Bun, so the swap mechanics live in a browser file this test can only read. It
// pins that the client agrees with the server on the trigger class and the open hook
// (attr ↔ dataset), and that it does no key handling of its own — a real button already
// activates on Enter and Space.
describe("record swap — controller contract parity (server ⇄ client)", () => {
  const controller = readFileSync(join(import.meta.dir, "../../../public/record-view.js"), "utf8");

  // `data-record-view-template` → `recordViewTemplate`: the DOM's dataset camel-casing, so
  // the server attribute name and the client dataset access agree by construction.
  function datasetKeyOf(attr: string): string {
    return attr
      .replace(/^data-/, "")
      .replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
  }

  test("selects the platform item trigger the wrapper renders", () => {
    expect(controller).toContain(`.${ITEM_TRIGGER_CLASS}`);
  });

  test("reads the same open hook the wrapper writes (attr ↔ dataset agree)", () => {
    expect(controller).toContain(`dataset.${datasetKeyOf(ITEM_RECORD_VIEW_ATTR)}`);
  });

  test("hand-writes no key handling: the record is already a button", () => {
    expect(controller).toContain('addEventListener("click"');
    expect(controller).not.toContain('addEventListener("keydown"');
    expect(controller).not.toContain('"Enter"');
  });
});

// The create view is the record form's other entrance, so it arrives under the same bar.
describe("container scaffolding — the create view is the record form's other entrance", () => {
  const feed = renderCollection({ capability: SAMPLE, layout: "feed" });

  test("the form arrives under the same back control a record's does", () => {
    // One surface, two ways in: "in a window it always arrives under a back control,
    // reached either from a record or from New record" (design/index.html).
    expect(feed).toContain('class="capability-record-view__bar"');
    expect(feed).toContain('aria-label="Back to Tasks"');
    expect(feed).toContain(
      `@click="createOpen = false; $nextTick(() => $refs.createTrigger.focus())"`,
    );
  });

  test("the bar comes above the form it introduces", () => {
    expect(feed.indexOf("capability-record-view__bar")).toBeLessThan(
      feed.indexOf("capability-create-form"),
    );
  });
});
