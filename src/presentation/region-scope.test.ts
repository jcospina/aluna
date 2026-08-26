import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createRecordsRegionRequestCoordinator } from "#shell/records-region-requests.js";
import {
  CONTENT_REGION_SELECTOR,
  createRegionReleaseRegistry,
  RELEASE_REGION_EVENT,
} from "#shell/region-scope.js";

/**
 * A node small enough to run the release rule in Bun. The rule needs three DOM facts and
 * no more — is this anchor still in the document, does that node hold it, and which
 * content region is it in — so this implements exactly those and the tree operations a
 * test performs on them.
 */
class Node {
  readonly children: Node[] = [];
  parent: Node | null = null;
  /** Only the document root sets this; everything else inherits by being under it. */
  rooted = false;

  constructor(
    readonly name: string,
    readonly region?: string,
  ) {}

  get isConnected(): boolean {
    for (let node: Node | null = this; node; node = node.parent) {
      if (node.rooted) return true;
    }
    return false;
  }

  contains(other: Node): boolean {
    for (let node: Node | null = other; node; node = node.parent) {
      if (node === this) return true;
    }
    return false;
  }

  closest(selector: string): Node | null {
    if (selector !== "[data-content-region]") throw new Error(`Unsupported: ${selector}`);
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

  /** What `innerHTML =` and `replaceChildren()` both are: this content, gone. */
  replaceChildren(...nodes: Node[]): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
}

function document(): Node {
  const root = new Node("body");
  root.rooted = true;
  return root;
}

describe("a content region releases what its content started", () => {
  test("replacing the content releases every fetch, controller and read token it acquired", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    const search = new Node("search form");
    body.append(region);
    region.append(list, search);

    const released: string[] = [];
    registry.register(list, "records read", () => released.push("records read"));
    registry.register(search, "search controller", () => released.push("search controller"));
    expect(registry.size).toBe(2);

    // The region stays; only what it was showing goes.
    region.replaceChildren(new Node("record"));
    registry.sweep();

    expect(released.sort()).toEqual(["records read", "search controller"]);
    expect(registry.size).toBe(0);
  });

  test("removing the region releases the same set", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    body.append(region);
    region.append(list);

    const released: string[] = [];
    registry.register(list, "records read", () => released.push("records read"));
    registry.register(region, "region observer", () => released.push("region observer"));

    region.remove();
    registry.sweep();

    expect(released.sort()).toEqual(["records read", "region observer"]);
    expect(registry.size).toBe(0);
  });

  test("a list → record → back swap releases each view's work as that view goes", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    body.append(region);

    const released: string[] = [];
    const showList = () => {
      const list = new Node("list");
      region.replaceChildren(list);
      registry.register(list, "list read", () => released.push("list read"));
      registry.sweep();
      return list;
    };

    showList();
    expect(released).toEqual([]);

    // Into the record.
    const record = new Node("record");
    region.replaceChildren(record);
    registry.register(record, "record read", () => released.push("record read"));
    registry.sweep();
    expect(released).toEqual(["list read"]);

    // And back. The region never went away, and nothing has leaked across either swap.
    showList();
    expect(released).toEqual(["list read", "record read"]);
    expect(registry.size).toBe(1);

    region.remove();
    registry.sweep();
    expect(released).toEqual(["list read", "record read", "list read"]);
    expect(registry.size).toBe(0);
  });
});

describe("the release rule holds at its edges", () => {
  test("the pre-detach release and the observer's sweep cannot run one entry twice", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    body.append(region);
    region.append(list);

    let releases = 0;
    registry.register(list, "records read", () => {
      releases += 1;
    });

    // htmx announces the node while it is still connected — the only moment its request
    // can be aborted — and the observer reports the same removal afterwards.
    registry.releaseUnder(region);
    region.replaceChildren();
    registry.sweep();

    expect(releases).toBe(1);
  });

  test("work that finishes on its own terms leaves the scope without being released", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    body.append(region);
    region.append(list);

    let released = false;
    const deregister = registry.register(list, "records read", () => {
      released = true;
    });
    deregister();

    region.replaceChildren();
    registry.sweep();

    expect(released).toBe(false);
    expect(registry.size).toBe(0);
  });

  test("work registered before its content is on the page survives until it arrives", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("content", "content area");
    const list = new Node("list");
    body.append(region);

    let released = false;
    registry.register(list, "records read", () => {
      released = true;
    });

    // Two sweeps happen before the content is inserted; neither may take it away.
    registry.sweep();
    registry.sweep();
    expect(released).toBe(false);

    region.append(list);
    registry.sweep();
    expect(released).toBe(false);

    list.remove();
    registry.sweep();
    expect(released).toBe(true);
  });

  test("the live scope names the region each piece of work belongs to", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const content = new Node("content", "content area");
    const records = new Node("records", "records");
    const search = new Node("search form");
    body.append(content);
    content.append(search, records);

    registry.register(records, "records read", () => undefined);
    registry.register(search, "search controller", () => undefined);

    expect(registry.report()).toEqual([
      { region: "records", label: "records read" },
      { region: "content area", label: "search controller" },
    ]);
  });
});

describe("a records region's request is the scope entry", () => {
  test("releasing the region aborts the in-flight claim, so no response lands on a detached node", () => {
    const registry = createRegionReleaseRegistry();
    const body = document();
    const region = new Node("records", "records");
    body.append(region);

    const core = createRecordsRegionRequestCoordinator();
    const claim = core.claim();
    const deregister = registry.register(region, "records read", claim.abort);

    expect(claim.isCurrent()).toBe(true);
    expect(claim.signal.aborted).toBe(false);

    region.remove();
    registry.sweep();

    // The abort is the release: the fetch stops, and the server sees the disconnect that
    // frees its read token.
    expect(claim.signal.aborted).toBe(true);
    expect(claim.isCurrent()).toBe(false);
    deregister();
  });
});

// `app.js` is a classic script — it cannot import the module — so the one thing that
// keeps the shell's own replacements inside the rule is that both sides spell the release
// event the same way. Pin it, the way the item controller's open event is pinned.
describe("the shell's classic-script glue speaks the release vocabulary", () => {
  const glue = readFileSync(join(import.meta.dir, "../../public/app.js"), "utf8");
  const shell = readFileSync(join(import.meta.dir, "../../public/index.html"), "utf8");

  test("dispatches the exact event the region scope listens for", () => {
    expect(glue).toContain(`"${RELEASE_REGION_EVENT}"`);
  });

  test("releases the content area before each of its wholesale replacements", () => {
    // The two places app.js replaces the window's content itself, rather than
    // leaving it to htmx: promoting a terminal build presentation, and re-answering a
    // severed deletion confirmation.
    expect(glue.match(/releaseRegionContent\(output\);/g)).toHaveLength(2);
  });

  test("the window marks the one region, and the shell starts the system", () => {
    // The shell marks nothing: the region lives inside the window, which the client
    // creates and destroys. That is what makes putting the window away the only way a
    // region disappears, and why no window-scoped teardown exists beside this rule.
    expect(shell).not.toContain("data-content-region");
    expect(shell).toContain('<script type="module" src="/static/region-scope.js"></script>');
    expect(shell).toContain('<script type="module" src="/static/desk-window.js"></script>');

    const windowModule = readFileSync(join(import.meta.dir, "../../public/desk-window.js"), "utf8");
    expect(windowModule).toContain("region.dataset.contentRegion = WINDOW_CONTENT_REGION");
    // Put-away is the release plus the removal, and never a hook of its own.
    expect(windowModule).toContain(`new CustomEvent(RELEASE_REGION_EVENT`);

    // The marker the module looks for and the marker the window writes are the same one.
    expect(CONTENT_REGION_SELECTOR).toBe("[data-content-region]");
  });
});
