import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OPEN_DETAIL_EVENT } from "./detail-modal.ts";
import { capabilityRecordsRegionId, type RenderableCapability } from "./field-renderer.ts";
import {
  COLLECTION_LAYOUTS,
  type CollectionLayout,
  collectionLayoutClass,
  DEFAULT_COLLECTION_LAYOUT,
  ITEM_DETAIL_TEMPLATE_ATTR,
  ITEM_DETAIL_TITLE_ATTR,
  ITEM_PAYLOAD_ATTR,
  ITEM_TRIGGER_CLASS,
  renderCollection,
  renderItemWrapper,
  serializeItemPayload,
} from "./list-container.ts";

// The list scaffolding container + accessible item wrapper (epic 3.2/02) are platform
// chrome — their escaping/payload/accessibility invariants are deterministic platform
// tests, not gate rungs the model can fail (ADR-0005 §4). These pin: the closed
// `feed | grid` layout map (unknown layout is unrepresentable), the container's New X /
// empty state / data-free region, and the wrapper's accessible trigger + escaped
// `data-item` payload (round-trip, hostile values, byte guard).

const SAMPLE: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  schema: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      { name: "priority", label: "Priority", type: "number", required: true, lifecycle: "active" },
      { name: "done", label: "Done", type: "boolean", required: true, lifecycle: "active" },
    ],
  },
  form: { list_inputs: [] },
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
  const css = readFileSync(join(import.meta.dir, "../../public/css/collection.css"), "utf8");

  test("each layout class is defined in collection.css", () => {
    for (const layout of COLLECTION_LAYOUTS) {
      expect(css).toContain(`.${collectionLayoutClass(layout)}`);
    }
  });

  test("the item wrapper and empty state are defined in collection.css", () => {
    expect(css).toContain(`.${ITEM_TRIGGER_CLASS}`);
    expect(css).toContain(".capability-empty");
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

  test('renders a "New X" button that discloses the platform create form', () => {
    expect(feed).toContain("btn--primary");
    expect(feed).toContain("New Tasks");
    // The button toggles the disclosure; the disclosed panel holds the real create form.
    expect(feed).toContain('@click="createOpen = !createOpen"');
    expect(feed).toContain('hx-post="/capability/tasks/create"');
  });

  test("renders the empty state", () => {
    expect(feed).toContain('class="capability-empty"');
  });

  test("closes the create disclosure only when THIS capability reports a created record", () => {
    expect(feed).toContain("@aluna:record-created.window=");
    expect(feed).toContain("$event.detail?.capabilityId === 'tasks'");
  });

  test("is data-free: an unseeded region is truly empty so the empty-state CSS fires", () => {
    // No whitespace/children inside the region → `:empty` matches → empty state shows.
    expect(feed).toContain(
      `id="${capabilityRecordsRegionId("tasks")}" class="capability-records capability-records--feed"></div>`,
    );
    expect(feed).not.toContain(ITEM_PAYLOAD_ATTR);
  });

  test("seeds the records region with pre-rendered items when given", () => {
    const seeded = renderCollection({
      capability: SAMPLE,
      items: "<article>ITEM_MARKER</article>",
    });
    expect(seeded).toContain("ITEM_MARKER");
    expect(seeded).toContain(`class="capability-records capability-records--feed">`);
  });

  test("escapes the capability label in chrome (New X + region aria)", () => {
    const hostile = renderCollection({
      capability: { ...SAMPLE, label: "<img src=x onerror=alert(1)>" },
    });
    expect(hostile).not.toContain("<img src=x");
    expect(hostile).toContain("&lt;img src=x");
  });
});

// The serving mode (epic 3.2/03): the records region lazy-loads live records through
// the capability's `read` action so the platform View stays data-free (ADR-0004).
describe("container scaffolding — serving mode (loadThroughRead)", () => {
  const serving = renderCollection({ capability: SAMPLE, loadThroughRead: true });

  test("wires the records region to load through the read action on load", () => {
    expect(serving).toContain(
      `<div id="${capabilityRecordsRegionId("tasks")}" class="capability-records capability-records--feed"` +
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

  test("still renders the create disclosure and its form (the create path is untouched)", () => {
    expect(serving).toContain("New Tasks");
    expect(serving).toContain('hx-post="/capability/tasks/create"');
    expect(serving).toContain(`hx-target="#${capabilityRecordsRegionId("tasks")}"`);
  });
});

describe("item wrapper — accessible trigger", () => {
  const wrapper = renderItemWrapper('<div class="stack">inner</div>', { title: "Buy oat milk" });

  test("is a keyboard-focusable button that announces it opens a dialog", () => {
    expect(wrapper).toContain(`class="${ITEM_TRIGGER_CLASS}"`);
    expect(wrapper).toContain('role="button"');
    expect(wrapper).toContain('tabindex="0"');
    expect(wrapper).toContain('aria-haspopup="dialog"');
  });

  test("frames the inner markup verbatim — it does not re-sanitize its trusted input", () => {
    expect(wrapper).toContain('<div class="stack">inner</div>');
  });

  test("carries the caller-supplied client projection as a data-item payload", () => {
    expect(readBackPayload(wrapper)).toEqual({ title: "Buy oat milk" });
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

// The click-to-open wiring (3.3/02): the wrapper carries the two hooks the shared modal's
// click controller reads to open one record's detail. Optional so the frame-only shape (the
// 3.2/02 stand-in demo) still renders without them; the real read path always passes them.
describe("item wrapper — detail open ref (click-to-open hooks)", () => {
  const wrapper = renderItemWrapper(
    "<span>x</span>",
    { title: "Buy oat milk" },
    { templateId: "detail-tasks-7", title: "Tasks" },
  );

  test("carries the detail template id + title the click controller opens with", () => {
    expect(wrapper).toContain(`${ITEM_DETAIL_TEMPLATE_ATTR}="detail-tasks-7"`);
    expect(wrapper).toContain(`${ITEM_DETAIL_TITLE_ATTR}="Tasks"`);
  });

  test("still carries the record payload alongside the detail hooks", () => {
    expect(readBackPayload(wrapper)).toEqual({ title: "Buy oat milk" });
  });

  test("omits the detail hooks when no ref is given (frame-only, the 3.2/02 shape)", () => {
    const frameOnly = renderItemWrapper("<span>x</span>", { title: "x" });
    expect(frameOnly).not.toContain(ITEM_DETAIL_TEMPLATE_ATTR);
    expect(frameOnly).not.toContain(ITEM_DETAIL_TITLE_ATTR);
  });

  test("escapes a hostile title and template id so neither breaks out of its attribute", () => {
    const hostile = renderItemWrapper(
      "<span>x</span>",
      {},
      { templateId: 't"><script>', title: '"><img src=x onerror=alert(1)>' },
    );
    expect(hostile).not.toContain('"><script>');
    expect(hostile).not.toContain('"><img');
    expect(hostile).toContain("&quot;&gt;&lt;script&gt;");
    expect(hostile).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });
});

// No DOM in Bun, so the click-to-open mechanics live in a browser file this test can only
// read. It pins that the client agrees with the server on the trigger class + the detail
// hooks (attr ↔ dataset) + the shared open event, and that it activates like a real button
// (click + Enter + Space) — the item-side analogue of the modal's controller-parity test.
describe("item click-to-open — controller contract parity (server ⇄ client)", () => {
  const controller = readFileSync(join(import.meta.dir, "../../public/item-detail.js"), "utf8");

  // `data-detail-template` → `detailTemplate`: the DOM's dataset camel-casing, so the
  // server attribute name and the client dataset access are proven to agree by construction.
  function datasetKeyOf(attr: string): string {
    return attr
      .replace(/^data-/, "")
      .replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
  }

  test("selects the platform item trigger the wrapper renders", () => {
    expect(controller).toContain(`.${ITEM_TRIGGER_CLASS}`);
  });

  test("reads the same detail hooks the wrapper writes (attr ↔ dataset agree)", () => {
    expect(controller).toContain(`dataset.${datasetKeyOf(ITEM_DETAIL_TEMPLATE_ATTR)}`);
    expect(controller).toContain(`dataset.${datasetKeyOf(ITEM_DETAIL_TITLE_ATTR)}`);
  });

  test("dispatches the shared open event the modal controller listens for", () => {
    expect(controller).toContain(`"${OPEN_DETAIL_EVENT}"`);
  });

  test("activates on click and on keyboard (Enter + Space), like a real button", () => {
    expect(controller).toContain('addEventListener("click"');
    expect(controller).toContain('addEventListener("keydown"');
    expect(controller).toContain('"Enter"');
    expect(controller).toContain('" "');
    expect(controller).toContain("preventDefault");
  });
});
