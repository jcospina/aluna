import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claimRecordExit, releaseRecordExit, swapInRecordView } from "#shell/record-view.js";
import { createRegionReleaseRegistry } from "#shell/region-scope.js";
import type { RenderableCapability } from "./field-renderer.ts";
import { itemElementIdForTemplate } from "./list-container.ts";
import {
  RECORD_BACK_ATTR,
  RECORD_VIEW_ATTR,
  renderRecordView,
  renderRecordViewTemplate,
} from "./record-view.ts";

// The record's own view is platform chrome: a back control above the record's form, and
// nothing else. These pin what the design settled — a record opens in edit mode, there is
// no read view of one anywhere, an absent value is an empty input rather than a muted em
// dash, and nothing about this surface is a dialog.

const CAPABILITY: RenderableCapability = {
  id: "notes",
  label: "Notes",
  noun: "note",
  schema: {
    fields: [
      { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
      { name: "due_on", label: "Due on", type: "date", required: false, lifecycle: "active" },
      {
        name: "retired",
        label: "Retired",
        type: "string",
        required: true,
        lifecycle: "inactive",
      },
    ],
  },
  form: { list_inputs: [] },
  actions: ["create", "read", "update", "delete", "search"],
};

const RECORD = {
  id: "note-1",
  created_at: "2026-08-27T00:00:00.000Z",
  text: "Buy oat milk",
  due_on: null,
  retired: "server only",
};

const TEMPLATE_ID = "record-notes-note-1";

describe("the record view — back control above the form", () => {
  const view = renderRecordView(CAPABILITY, RECORD, TEMPLATE_ID);

  test("marks itself as the record view and names the item it came from", () => {
    expect(view).toContain(`<div class="capability-record-view" ${RECORD_VIEW_ATTR}`);
    expect(view).toContain(`data-item-target-id="${itemElementIdForTemplate(TEMPLATE_ID)}"`);
  });

  test("the back control is a button naming the capability it goes back to", () => {
    expect(view).toContain('<button type="button" class="capability-record-view__back"');
    expect(view).toContain(RECORD_BACK_ATTR);
    expect(view).toContain('aria-label="Back to Notes"');
    expect(view).toContain("<span>Notes</span>");
    // The accessible name contains the visible label, so speaking the control and
    // reading it agree (WCAG 2.5.3).
    expect(view).toContain('aria-hidden="true"');
  });

  test("back comes above the form, not beside its actions", () => {
    expect(view.indexOf("capability-record-view__bar")).toBeLessThan(
      view.indexOf("capability-edit-form"),
    );
  });

  test("nothing here is a dialog", () => {
    expect(view).not.toContain("<dialog");
    expect(view).not.toContain("aria-haspopup");
    expect(view).not.toContain("aria-modal");
    expect(view).not.toContain("inert");
  });
});

describe("the record view — a record opens in edit mode", () => {
  const view = renderRecordView(CAPABILITY, RECORD, TEMPLATE_ID);

  test("what opens is the form, prefilled and wired to update", () => {
    expect(view).toContain('class="capability-edit-form"');
    expect(view).toContain('hx-post="/capability/notes/update"');
    expect(view).toContain('name="text" value="Buy oat milk"');
  });

  test("an absent value is an empty input, never a muted em dash", () => {
    expect(view).toContain('name="due_on" value=""');
    expect(view).not.toContain("—");
    expect(view).not.toContain("detail-field");
    expect(view).not.toContain("detail-fields");
  });

  test("inactive stored values never reach the surface", () => {
    expect(view).not.toContain("server only");
    expect(view).not.toContain("Retired");
  });

  test("a capability that cannot be updated has no record surface at all", () => {
    // There is no read view to fall back on, so rendering an inert form would be a
    // surface that does nothing.
    const readOnly = { ...CAPABILITY, actions: ["create", "read"] as const };
    expect(renderRecordView(readOnly, RECORD, TEMPLATE_ID)).toBe("");
    expect(renderRecordViewTemplate(TEMPLATE_ID, readOnly, RECORD)).toBe("");
  });
});

describe("the record view — the inert template it travels in", () => {
  test("wraps the view in a template keyed by the id the item points at", () => {
    const html = renderRecordViewTemplate(TEMPLATE_ID, CAPABILITY, RECORD);
    expect(html.startsWith(`<template id="${TEMPLATE_ID}">`)).toBe(true);
    expect(html.endsWith("</template>")).toBe(true);
    expect(html).toContain(renderRecordView(CAPABILITY, RECORD, TEMPLATE_ID));
  });

  test("escapes a hostile template id so it cannot break out of the attribute", () => {
    const html = renderRecordViewTemplate('t"><script>', CAPABILITY, RECORD);
    expect(html).not.toContain('"><script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  test("a hostile record value stays inert escaped text inside the form", () => {
    const hostile = renderRecordView(
      CAPABILITY,
      { ...RECORD, text: "<script>alert(1)</script>" },
      TEMPLATE_ID,
    );
    expect(hostile).not.toMatch(/<script/i);
    expect(hostile).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

// No DOM in Bun, so the swap mechanics live in a browser file this test can only read.
// It pins that the client leaves by the same two controls the server renders, and that
// leaving is a fresh read of the collection rather than a restored snapshot.
describe("the record swap — the way out (server ⇄ client)", () => {
  const controller = readFileSync(join(import.meta.dir, "../../public/record-view.js"), "utf8");

  test("both exits the server renders lead out of the record", () => {
    expect(controller).toContain(RECORD_BACK_ATTR);
    expect(controller).toContain("data-record-cancel");
    expect(controller).toContain(RECORD_VIEW_ATTR);
  });

  test("leaving asks for the collection again — the fresh read, not a snapshot", () => {
    expect(controller).toContain('.ajax("GET", `/capability/');
    expect(controller).toContain("capabilityId");
    expect(controller).toContain('swap: "innerHTML"');
  });

  test("a committed update leaves the same way pressing back does", () => {
    const mutations = readFileSync(
      join(import.meta.dir, "../../public/record-mutations.js"),
      "utf8",
    );
    expect(controller).toContain("export function leaveRecordView");
    expect(mutations).toContain('import { leaveRecordView } from "./record-view.js"');
    expect(mutations).toContain("leaveRecordView(view)");
  });
});

// The swap's own rules, run in Bun against structural doubles. The release rule is
// deliberately structural (`public/region-scope.js`) so the thing the acceptance criterion
// names — what a swap releases — can be executed rather than grepped for.
describe("the record swap — what a swap releases, and in what order", () => {
  /** The three DOM facts the release rule needs, and no more. */
  class Node {
    readonly children: Node[] = [];
    parent: Node | null = null;
    rooted = false;
    constructor(
      readonly name: string,
      readonly region?: string,
    ) {}
    get isConnected(): boolean {
      for (let node: Node | null = this; node; node = node.parent) if (node.rooted) return true;
      return false;
    }
    contains(other: Node): boolean {
      for (let node: Node | null = other; node; node = node.parent) if (node === this) return true;
      return false;
    }
    closest(): Node | null {
      for (let node: Node | null = this; node; node = node.parent) {
        if (node.region !== undefined) return node;
      }
      return null;
    }
    getAttribute(name: string): string | null {
      return name === "data-content-region" ? (this.region ?? null) : null;
    }
    append(...nodes: Node[]): void {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    }
  }

  /** The window's content region holding a capability's collection, as the swap finds it. */
  function collectionTree() {
    const window = new Node("window", "the window's content");
    window.rooted = true;
    const collection = new Node("collection");
    const searchForm = new Node("search form");
    const records = new Node("records", "records");
    collection.append(searchForm, records);
    window.append(collection);
    return { window, collection, searchForm, records };
  }

  test("releasing the collection releases the search controller and the records read", () => {
    // Both are anchored to their own node — the controller to the search form, the read
    // to the records region — and both sit under the collection the record replaces.
    const { collection, searchForm, records } = collectionTree();
    const registry = createRegionReleaseRegistry();
    const ran: string[] = [];
    registry.register(searchForm as never, "search controller", () => ran.push("search"));
    registry.register(records as never, "records read", () => ran.push("read"));

    registry.releaseUnder(collection as never);

    expect(ran.sort()).toEqual(["read", "search"]);
    expect(registry.size).toBe(0);
  });

  test("a record that cannot open releases nothing — the collection stays as it was", () => {
    const { collection, searchForm } = collectionTree();
    const registry = createRegionReleaseRegistry();
    registry.register(searchForm as never, "search controller", () => {
      throw new Error("released a collection that was never replaced");
    });

    const released: unknown[] = [];
    const swapped = swapInRecordView({
      outgoing: collection,
      incoming: null,
      release: (node) => released.push(node),
      replace: () => {
        throw new Error("replaced the collection with nothing");
      },
      process: () => undefined,
    });

    expect(swapped).toBe(false);
    expect(released).toEqual([]);
    expect(registry.size).toBe(1);
  });

  test("the outgoing content is released before it is replaced, and processed after", () => {
    const { collection } = collectionTree();
    const view = new Node("record view");
    const order: string[] = [];

    const swapped = swapInRecordView({
      outgoing: collection,
      incoming: view,
      release: () => order.push("release"),
      replace: () => order.push("replace"),
      process: () => order.push("process"),
    });

    expect(swapped).toBe(true);
    // Release must run while the content is still connected: that is the only moment an
    // htmx request under it can still be aborted, which is what frees the read token.
    expect(order).toEqual(["release", "replace", "process"]);
  });
});

describe("the record swap — one exit at a time", () => {
  function view() {
    const attributes = new Map<string, string>();
    return {
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    };
  }

  test("a second press while the collection is on its way is refused", () => {
    const record = view();
    expect(claimRecordExit(record)).toBe(true);
    expect(claimRecordExit(record)).toBe(false);
  });

  test("the claim comes back when the request ends, however it ended", () => {
    const record = view();
    claimRecordExit(record);
    releaseRecordExit(record);
    expect(claimRecordExit(record)).toBe(true);
  });
});
