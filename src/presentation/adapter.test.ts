// Tests for the capability-scoped presentation adapter (Module 3, epic 3.4/01).
//
// The adapter is a deterministic seam (ADR-0005 §4): given a capability and its item
// renderer, `present(record)` is a pure record → safe wrapped item HTML function. These
// tests drive it with a **hand-written** item renderer — the composition input a generated
// renderer replaces in 3.4/02 — and pin the invariants the model cannot get wrong:
//
//   • COMPOSITION — the accessible wrapper + escaped `data-item` payload + click-to-open
//     hooks + the record's inert detail <template>, in the right order and linked by id.
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
  DETAIL_TEMPLATE_ID_PREFIX,
  type ItemRenderer,
  type PresentableRecord,
} from "./adapter.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { ITEM_PAYLOAD_ATTR, ITEM_TRIGGER_CLASS } from "./list-container.ts";

// `detail.shows` is a reordered subset of the schema (drops `author`), so a test can prove
// the adapter routes the capability's detail intent into the record's detail template —
// not just dumps every field.
const CAPABILITY: RenderableCapability = {
  id: "reading",
  label: "Reading list",
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
  form: { list_inputs: [] },
  item: { shows: ["title", "author", "created_at"] },
  detail: { shows: ["title", "rating", "note"] },
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

/** The inert detail <template> the adapter emits for a record, content only. */
function detailTemplateBody(html: string, templateId: string): string {
  const match = new RegExp(`<template id="${templateId}">([\\s\\S]*?)</template>`).exec(html);
  if (!match) throw new Error(`no <template id="${templateId}"> in output`);
  return match[1] ?? "";
}

// The inner markup the enforcer actually processed — between the wrapper's open tag and
// </article>. The wrapper's own attributes (incl. the escaped data-item payload, where a
// hostile value legitimately survives as inert data) are platform chrome, not part of the
// enforced surface, so a security assertion must look at the inner markup alone. The first
// literal `>` closes the open tag: every `>` inside data-item is escaped to `&gt;`.
function innerMarkupOf(html: string): string {
  const openEnd = html.indexOf(">");
  const close = html.indexOf("</article>");
  return html.slice(openEnd + 1, close);
}

describe("createPresentationAdapter — composition", () => {
  test("treats user fields named fields and handle as ordinary capability data", () => {
    const collisionCapability: RenderableCapability = {
      id: "collision",
      label: "Collision",
      schema: {
        fields: [
          { name: "fields", label: "Fields", type: "string", required: true, lifecycle: "active" },
          { name: "handle", label: "Handle", type: "string", required: true, lifecycle: "active" },
        ],
      },
      form: { list_inputs: [] },
      item: { shows: ["fields", "handle"] },
      detail: { shows: ["fields", "handle"] },
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

  test("wraps item markup in the accessible trigger with the escaped payload + click-to-open hooks", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });
    const html = present(record());

    // Synchronous (record → string): the renderer is resolved before the handler runs.
    expect(typeof html).toBe("string");

    // The accessible wrapper chrome (platform-authored, trusted).
    expect(html).toContain(`class="${ITEM_TRIGGER_CLASS}"`);
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-haspopup="dialog"');

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

    // Click-to-open hooks: the record's detail template id + the capability label as title.
    const templateId = `${DETAIL_TEMPLATE_ID_PREFIX}-reading-rec-1`;
    expect(html).toContain(`data-detail-template="${templateId}"`);
    expect(html).toContain('data-detail-title="Reading list"');
    expect(html).toContain(`<template id="${templateId}">`);
  });

  test("emits the item wrapper first, then the record's detail template", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });
    const html = present(record());
    expect(html.indexOf("<article")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("<article")).toBeLessThan(html.indexOf("<template"));
    const collectionItem = html.slice(0, html.indexOf("<template"));
    expect(collectionItem).not.toContain("data-detail-edit");
    expect(collectionItem).not.toContain("data-detail-delete");
  });

  test("keys the detail template to the record id and namespaces it by capability", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });
    const first = present(record({ id: "aaa" }));
    const second = present(record({ id: "bbb" }));

    // Each wrapper's hook matches its own template, and the two records never collide.
    expect(first).toContain('data-detail-template="detail-reading-aaa"');
    expect(first).toContain('<template id="detail-reading-aaa">');
    expect(second).toContain('data-detail-template="detail-reading-bbb"');
    expect(second).not.toContain("detail-reading-aaa");
  });

  test("routes the capability's detail.shows into the record's detail template", () => {
    const present = createPlatformPresentationAdapter({
      capability: CAPABILITY,
      renderItem: renderReadingItem,
    });
    const html = present(record());
    const body = detailTemplateBody(html, "detail-reading-rec-1");
    const readMode = body.slice(0, body.indexOf("data-detail-edit-mode"));

    // detail.shows is [title, rating, note] — the detail body shows those and drops author,
    // even though the active author value remains in the client payload for future edit UI.
    expect(readMode).toContain("Piranesi");
    expect(readMode).toContain("Tides through endless halls.");
    expect(readMode).not.toContain("Susanna Clarke");
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
