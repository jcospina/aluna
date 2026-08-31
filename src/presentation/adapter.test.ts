// Tests for the capability-scoped presentation adapter.
//
// The adapter is a deterministic seam: given a capability and its item
// renderer, `present(record)` is a pure record → safe wrapped item HTML function. These
// tests drive it with a **hand-written** item renderer — the composition input a generated
// renderer replaces — and pin the invariants the model cannot get wrong:
//
//   • COMPOSITION — the trigger `<button>` + escaped `data-item` payload + the
//     click-to-open hook + the record's inert view <template>, in the right order and
//     linked by id.
//   • ENFORCEMENT — the runtime allow-list enforcer runs on EVERY rendered record, so a
//     hostile field value (even one a renderer forgot to escape) cannot escape as
//     executable markup through the adapter. This is the safety half of the contract.
//   • PAYLOAD — raw bytes are neutralized to null (`file` fields are references, ADR-0005 §3).

import { describe, expect, test } from "bun:test";

import { createCapabilityActionRecord } from "../capability-data/index.ts";
import { escapeHtml } from "../web/html.ts";
import {
  createPlatformPresentationAdapter,
  createPresentationAdapter,
  type ItemRenderer,
  type PresentableRecord,
  RECORD_TEMPLATE_ID_PREFIX,
} from "./adapter.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { ITEM_PAYLOAD_ATTR, ITEM_TRIGGER_CLASS } from "./list-container.ts";

// The schema contains one inactive field so the adapter can prove the record's form
// follows active form-field order without leaking stored retired values.
const CAPABILITY: RenderableCapability = {
  id: "reading",
  label: "Reading list",
  noun: "note",
  schema: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      { name: "author", label: "Author", type: "string", required: true, lifecycle: "active" },
      { name: "rating", label: "Rating", type: "number", required: true, lifecycle: "active" },
      { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
      {
        name: "retired_note",
        label: "Retired note",
        type: "string",
        required: true,
        lifecycle: "inactive",
      },
    ],
  },
  form: { list_inputs: [], choice_inputs: [] },
  actions: ["create", "read", "update", "delete", "search"],
  item: { shows: ["title", "author", "created_at"] },
};

/** A conforming hand-written item renderer — primitive vocabulary only, every value escaped. */
const renderReadingItem: ItemRenderer = (record) =>
  `<div class="stack">` +
  `<span class="text-lg truncate">${escapeHtml(String(record.title))}</span>` +
  `<span class="text-sm text-muted">${escapeHtml(String(record.author))}</span>` +
  `</div>`;

function record(overrides: Record<string, unknown> = {}): PresentableRecord {
  return {
    id: "rec-1",
    created_at: "2026-07-09T00:00:00.000Z",
    title: "Piranesi",
    author: "Susanna Clarke",
    rating: 4,
    note: "Tides through endless halls.",
    extra: {},
    retired_note: "still stored",
    ...overrides,
  };
}

// Reverse escapeHtml exactly (&amp; last), standing in for the browser decoding an
// attribute value before JSON.parse reads it — mirrors list-container.test.ts.
function htmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Read a wrapped item's `data-item` payload back the way the client will. */
function readBackPayload(html: string): unknown {
  const match = new RegExp(`${ITEM_PAYLOAD_ATTR}="([^"]*)"`).exec(html);
  if (!match?.[1]) throw new Error(`no ${ITEM_PAYLOAD_ATTR} attribute in output`);
  return JSON.parse(htmlUnescape(match[1]));
}

/** The inert record-view <template> the adapter emits for a record, content only. */
function recordTemplateBody(html: string, templateId: string): string {
  const match = new RegExp(`<template id="${templateId}">([\\s\\S]*?)</template>`).exec(html);
  if (!match) throw new Error(`no <template id="${templateId}"> in output`);
  return match[1] ?? "";
}

// The inner markup the enforcer actually processed — between the wrapper's open tag and
// </button>. The wrapper's own attributes (incl. the escaped data-item payload, where a
// hostile value legitimately survives as inert data) are platform chrome, not part of the
// enforced surface, so a security assertion must look at the inner markup alone. The first
// literal `>` closes the open tag: every `>` inside data-item is escaped to `&gt;`.
function innerMarkupOf(html: string): string {
  const openEnd = html.indexOf(">");
  const close = html.indexOf("</button>");
  return html.slice(openEnd + 1, close);
}

describe("createPresentationAdapter — composition", () => {
  test("treats user fields named fields and handle as ordinary capability data", () => {
    const collisionCapability: RenderableCapability = {
      id: "collision",
      label: "Collision",
      noun: "note",
      schema: {
        fields: [
          { name: "fields", label: "Fields", type: "string", required: true, lifecycle: "active" },
          { name: "handle", label: "Handle", type: "string", required: true, lifecycle: "active" },
        ],
      },
      form: { list_inputs: [], choice_inputs: [] },
      actions: ["create", "read", "update", "delete", "search"],
      item: { shows: ["fields", "handle"] },
    };
    const present = createPresentationAdapter({
      capability: collisionCapability,
      renderItem: (item) =>
        `<span class="text-lg">${escapeHtml(String(item.fields))} / ${escapeHtml(String(item.handle))}</span>`,
    });
    const html = present(
      createCapabilityActionRecord({
        id: "collision-1",
        created_at: "2026-07-15T00:00:00.000Z",
        fields: "ordinary field value",
        handle: "ordinary handle value",
      }),
    );

    expect(html).toContain("ordinary field value / ordinary handle value");
    expect(readBackPayload(html)).toEqual({
      id: "collision-1",
      created_at: "2026-07-15T00:00:00.000Z",
      fields: "ordinary field value",
      handle: "ordinary handle value",
    });
  });

  test("wraps item markup in a record button with the escaped payload + the open hook", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });
    const html = present(record());

    // Synchronous (record → string): the renderer is resolved before the handler runs.
    expect(typeof html).toBe("string");

    // The wrapper chrome (platform-authored, trusted). A record is a real button, so it
    // carries no role, no tabindex and no dialog ARIA.
    expect(html).toContain(`<button type="button"`);
    expect(html).toContain(`class="${ITEM_TRIGGER_CLASS}"`);
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("tabindex=");
    expect(html).not.toContain("aria-haspopup");

    // The renderer's conforming inner markup passes through unchanged.
    expect(html).toContain('<div class="stack">');
    expect(html).toContain('<span class="text-lg truncate">Piranesi</span>');

    // The client receives only the record target, timestamp, and active schema values.
    expect(readBackPayload(html)).toEqual({
      id: "rec-1",
      created_at: "2026-07-09T00:00:00.000Z",
      title: "Piranesi",
      author: "Susanna Clarke",
      rating: 4,
      note: "Tides through endless halls.",
    });

    // The click-to-open hook: the record's view template id.
    const templateId = `${RECORD_TEMPLATE_ID_PREFIX}-reading-rec-1`;
    expect(html).toContain(`data-record-view-template="${templateId}"`);
    expect(html).toContain(`<template id="${templateId}">`);
  });

  test("emits the item wrapper first, then the record's view template", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });
    const html = present(record());
    expect(html.indexOf("<button")).toBe(0);
    expect(html.indexOf("<button")).toBeLessThan(html.indexOf("<template"));
    const collectionItem = html.slice(0, html.indexOf("<template"));
    expect(collectionItem).not.toContain("data-record-back");
    expect(collectionItem).not.toContain("capability-edit-form");
  });

  test("keys the record template to the record id and namespaces it by capability", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });
    const first = present(record({ id: "aaa" }));
    const second = present(record({ id: "bbb" }));

    // Each wrapper's hook matches its own template, and the two records never collide.
    expect(first).toContain('data-record-view-template="record-reading-aaa"');
    expect(first).toContain('<template id="record-reading-aaa">');
    expect(second).toContain('data-record-view-template="record-reading-bbb"');
    expect(second).not.toContain("record-reading-aaa");
  });

  test("routes active schema fields into the record's form in form order", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });
    const html = present(record());
    const body = recordTemplateBody(html, "record-reading-rec-1");

    // The record's form follows active form-field order and excludes only the inactive
    // stored field.
    expect(body).not.toContain("still stored");
    expect(body).toContain('name="title" value="Piranesi"');
    expect(body).toContain('name="author" value="Susanna Clarke"');
    expect(readBackPayload(html)).toMatchObject({ author: "Susanna Clarke" });
  });

  test("passes only item.shows values to the item renderer, including created_at", () => {
    let received: PresentableRecord | undefined;
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: (itemRecord) => {
        received = itemRecord;
        return '<span class="text-lg">Shown</span>';
      },
    });
    present(record());

    expect(received).toEqual({
      title: "Piranesi",
      author: "Susanna Clarke",
      created_at: "2026-07-09T00:00:00.000Z",
    });
    expect(received).not.toHaveProperty("id");
    expect(received).not.toHaveProperty("extra");
    expect(received).not.toHaveProperty("rating");
    expect(received).not.toHaveProperty("retired_note");
  });
});

describe("createPresentationAdapter — enforcement on every rendered record", () => {
  // A renderer that emits every hostile category: a fabricated class, a script, an event
  // handler, a javascript: URL, an off-token style, plus one conforming class + on-token
  // style so we can prove the enforcer discriminates rather than blanket-strips.
  const hostileRenderer: ItemRenderer = (record) =>
    `<div class="stack fabricated-danger">` +
    `<a href="javascript:steal()" onclick="pwn()">` +
    `<script>evil()</script>` +
    `<b class="text-lg" style="color:red;padding:var(--space-2)">${escapeHtml(String(record.title))}</b>` +
    `</a>` +
    `<img src="x" onerror="alert(1)">` +
    `</div>`;

  test("neutralizes hostile markup a renderer emits, keeping only the allow-listed surface", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: hostileRenderer,
    });
    const html = present(record());

    // Executable / fabricated surface is gone.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onclick=");
    expect(html).not.toContain("onerror=");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("fabricated-danger");
    // Off-token style dropped; on-token style kept — proof it is the real enforcer.
    expect(html).not.toContain("color:red");
    expect(html).toContain("padding:var(--space-2)");
    // Allow-listed classes and the record's text survive.
    expect(html).toContain('class="stack"');
    expect(html).toContain("Piranesi");
    // The wrapper chrome itself is untouched (the enforcer runs on inner markup, not it).
    expect(html).toContain(`class="${ITEM_TRIGGER_CLASS}"`);
    expect(html).toContain(`${ITEM_PAYLOAD_ATTR}=`);
  });

  test("a hostile field value a renderer forgot to escape cannot escape as executable markup", () => {
    // A generation slip: the renderer interpolates a field value WITHOUT escaping it.
    const unescapedRenderer: ItemRenderer = (record) =>
      `<div class="stack"><span class="text-lg">${String(record.title)}</span></div>`;
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: unescapedRenderer,
    });

    const hostileTitle = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
    const html = present(record({ title: hostileTitle }));
    const inner = innerMarkupOf(html);

    // The rendered inner markup has no executable surface: the <script> is gone (with its
    // content) and no element carries an event handler. A sanitized <img src=x> may survive —
    // the allow-listed media frame with its handler stripped, inert, not executable.
    expect(inner).not.toMatch(/<script/i);
    expect(inner).not.toMatch(/on\w+=/i);
    // The raw value survives only as inert data in the escaped payload — never live markup.
    expect(readBackPayload(html)).toMatchObject({ title: hostileTitle });
  });

  test("a hostile field value cannot execute in the record's view template either", () => {
    // The sibling test above covers the list half. The record's inert view <template>
    // is the other half of what a hostile record reaches: it is cloned into the window
    // on open, so an unescaped value there would execute at that moment instead.
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });

    const hostileTitle = "<script>alert(1)</script><img src=x onerror=alert(2)>";
    const html = present(record({ title: hostileTitle }));
    const body = recordTemplateBody(html, `${RECORD_TEMPLATE_ID_PREFIX}-reading-rec-1`);

    // `title` is the first active schema field, so the hostile value seeds its input as
    // inert escaped text. Assert on the element openings, which are what would execute:
    // the `onerror=alert(2)` characters legitimately survive as text inside the escaped
    // `&lt;img …&gt;`.
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/<img/i);
  });
});

describe("createPresentationAdapter — payload byte safety", () => {
  test("neutralizes raw bytes in a record to null rather than serializing them", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });
    const html = present(record({ note: new Uint8Array([1, 2, 3]) }));
    expect(readBackPayload(html)).toMatchObject({ note: null });
  });
});
