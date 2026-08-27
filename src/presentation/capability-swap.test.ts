import { describe, expect, test } from "bun:test";

import { windowForOpening } from "#shell/desk-window.js";
import { createRegionReleaseRegistry } from "#shell/region-scope.js";
import type { RenderableCapability } from "./field-renderer.ts";
import { renderCollection } from "./list-container.ts";
import { document as desk, Node } from "./region-scope.test-support.ts";
import {
  code,
  codeOf,
  flat,
  readSource,
  shellScripts,
  shippedStylesheets,
} from "./source.test-support.ts";

// Opening a second capability, and what the desk deliberately does *not* build behind it
// (PLAN decision 15; ARCH §6.1 and §8; design D2).
//
// The frame is the one thing a swap may not touch, the content that leaves is the one
// thing a swap must release, and cross-capability staleness gets no machinery at all:
// one window means one visible capability, every open is a fresh read, and a second
// browser tab is an accepted known edge rather than a hole to build a bus for.

const SAMPLE: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  noun: "task",
  schema: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
    ],
  },
  form: { list_inputs: [] },
  actions: ["create", "read", "update", "delete", "search"],
};

/* ── the frame ─────────────────────────────────────────────────────────────── */

/**
 * A window whose geometry and drawn hand cannot be written without saying so. Asking
 * afterwards whether they still hold their values proves nothing once the entry is known
 * to be the same object; refusing the assignment is what makes "the frame does not move"
 * a fact the rule has to earn.
 */
function frame(title: string) {
  const win = {
    title,
    setTitle(next: string) {
      win.title = next;
    },
  };
  const settled = { box: { x: 240, w: 700 }, seed: 4711, region: {} };
  const refuse = (name: string) => () => {
    throw new Error(`an opening wrote \`${name}\`, which is settled at mount`);
  };
  return {
    win,
    openedBy: null as unknown,
    get box() {
      return settled.box;
    },
    set box(_: typeof settled.box) {
      refuse("box")();
    },
    get seed() {
      return settled.seed;
    },
    set seed(_: number) {
      refuse("seed")();
    },
    get region() {
      return settled.region;
    },
    set region(_: object) {
      refuse("region")();
    },
  };
}

describe("opening a second capability swaps the contents, not the frame", () => {
  test("a window already standing is the window the next capability opens into", () => {
    let mounts = 0;
    const mount = () => {
      mounts += 1;
      return frame("Tasks");
    };
    const logo = { name: "the Tasks logo" };

    const first = windowForOpening(null, mount, "Tasks", logo);
    const second = windowForOpening(first, mount, "Journal", { name: "the Journal logo" });

    // One frame, not two, and the same one — its position, its size, the region inside it
    // and the hand it was drawn with are the ones it already had, and the rule would have
    // thrown on its way through if it had reached for any of them.
    expect(mounts).toBe(1);
    expect(second).toBe(first);

    // What does change: the title, because the window now frames something else.
    expect(second.win.title).toBe("Journal");

    // What does not: the first opener owns the way back, so putting the window away
    // still returns focus to the logo that stood it up.
    expect(second.openedBy).toBe(logo);
  });

  test("the opener uses the rule rather than restating it", () => {
    const module = codeOf("public/desk-window.js");
    expect(flat(module)).toContain(
      "mounted = windowForOpening(mounted, () => mount(root, title), title, openedBy);",
    );
    // The seed is rolled where the frame is built and nowhere else, so no swap can
    // re-roll the hand (design D10).
    expect(module.match(/seed: Math\.floor/g)).toHaveLength(1);
  });
});

/* ── what a swap releases ──────────────────────────────────────────────────── */

describe("the outgoing capability's work is released on the swap", () => {
  // That the release rule releases is 5.3/01's own suite (`region-scope.test.ts`). What
  // is this issue's is where it is now reached from, and what it is not allowed to take.

  test("the region outlives the content, so the swap has a frame to land in", () => {
    const registry = createRegionReleaseRegistry();
    const body = desk();
    const region = new Node("the window's content", "the window's content");
    const tasks = new Node("the Tasks collection");
    const tasksRecords = new Node("the Tasks records", "records");
    const tasksSearch = new Node("the Tasks search form");
    body.append(region);
    region.append(tasks);
    tasks.append(tasksSearch, tasksRecords);

    const readToken = new AbortController();
    registry.register(tasksRecords, "records read", () => readToken.abort());
    registry.register(tasksSearch, "search controller", () => undefined);

    // htmx's innerHTML swap announces each node it detaches while that node is still
    // connected, and then puts the next capability in its place.
    registry.releaseUnder(tasks);
    tasks.remove();
    const journal = new Node("the Journal collection");
    region.append(journal);
    registry.sweep();

    expect(readToken.signal.aborted).toBe(true);
    expect(registry.size).toBe(0);
    expect(region.children).toEqual([journal]);
    expect(region.isConnected).toBe(true);
  });

  test("the two readers that used to hand the region off now go through the rule", () => {
    const search = codeOf("public/search-chrome.js");
    const refresh = codeOf("public/records-refresh.js");

    // Search takes the region from the View's own read…
    expect(flat(search)).toContain("cancelExternalRead: () => { releaseRegionContent(region); }");
    // …and the post-mutation re-read takes it from whatever was still filling it, before
    // it claims the region for itself.
    expect(flat(refresh)).toContain(
      "region.dispatchEvent(new CustomEvent(RECORDS_REFRESH_START_EVENT, { bubbles: true })); releaseRegionContent(region);",
    );
    expect(flat(refresh)).toContain(
      "if (domRegion) startRefresh(domRegion, target.query); const claim = claimRefreshRequest(domRegion, claimRequest);",
    );

    // And the hand-off itself is gone from the shell, not merely unreferenced.
    for (const [name, source] of shellScripts()) {
      expect(source, name).not.toContain("handOff");
    }
  });

  test("promoting a build's ending releases what it displaces and keeps what it promotes", () => {
    const registry = createRegionReleaseRegistry();
    const body = desk();
    const region = new Node("the window's content", "the window's content");
    const displaced = new Node("the capability the build displaced");
    const subscriber = new Node("the run's subscriber");
    const restored = new Node("the restored collection");
    const restoredRecords = new Node("the restored records", "records");
    body.append(region);
    region.append(displaced, subscriber);
    subscriber.append(restored);
    restored.append(restoredRecords);

    const released: string[] = [];
    registry.register(displaced, "records read", () => released.push("displaced read"));
    // Where htmx's settle got there before the stream closed, the restored View's read is
    // already in flight. Releasing the region wholesale aborts it and leaves the restored
    // collection empty — which is what a hand-rebuilt second read used to paper over.
    registry.register(restoredRecords, "records read", () => released.push("restored read"));

    const promoted = [...subscriber.children];
    region.append(...promoted);
    for (const node of [...region.children]) {
      if (promoted.includes(node)) continue;
      registry.releaseUnder(node);
      node.remove();
    }
    registry.sweep();

    expect(released).toEqual(["displaced read"]);
    expect(region.children).toEqual([restored]);
    expect(registry.report()).toEqual([{ region: "records", label: "records read" }]);
  });

  test("and the glue follows exactly that rule", () => {
    // The rule above is stated against doubles; this is the glue held to it, statement by
    // statement. It is a source pin because `app.js` is a classic script — it has to run
    // before Alpine starts, so it can import nothing and export nothing, and every rule
    // it owns is pinned this way (`region-scope.test.ts` pins the release vocabulary the
    // same way). Pinned whole rather than by keyword, so inverting the skip, dropping the
    // release or moving it back in front of the promotion each fail here.
    const glue = flat(codeOf("public/app.js"));

    expect(glue).toContain(
      "function releaseDisplacedContent(output, promoted) { for (const node of [...output.childNodes]) { if (promoted.includes(node)) continue; if (node instanceof Element) releaseRegionContent(node); node.remove(); } }",
    );
    expect(glue).toContain(
      "const promoted = terminal.promoteElement ? [terminal.element] : [...terminal.element.childNodes]; output.append(...promoted); releaseDisplacedContent(output, promoted); processPromotedContent(promoted);",
    );
    expect(glue).toContain(
      [
        "function processPromotedContent(promoted) { const htmx = (window).htmx; if (!htmx) return;",
        " for (const node of promoted) { if (!(node instanceof Element)) continue;",
        " if (node.classList.contains(HTMX_REQUEST_CLASS)) continue;",
        // Written in pieces only because a template placeholder inside a string literal
        // is a lint error; this is one statement of the guard, not three.
        " if (node.querySelector(`.$",
        "{HTMX_REQUEST_CLASS}`) !== null) continue; htmx.process(node); } }",
      ].join(""),
    );
    // The mark the guard reads is htmx's own, and the module that owns it spells it the
    // same way; the glue cannot import it, so the two are pinned against each other.
    expect(glue).toContain('const HTMX_REQUEST_CLASS = "htmx-request";');
    expect(flat(codeOf("public/region-scope.js"))).toContain(
      'const HTMX_REQUEST_CLASS = "htmx-request";',
    );
  });
});

/* ── every open is a fresh read ────────────────────────────────────────────── */

describe("every open is a fresh read", () => {
  test("a committed collection is served with no records in it", () => {
    // The chrome is data-free and its region loads through the capability's own `read`
    // Handler, so opening a capability cannot show a collection anyone cached — even
    // where the caller has records to hand.
    const collection = renderCollection({
      capability: SAMPLE,
      loadThroughRead: true,
      items: "<article>a record somebody already had</article>",
    });

    expect(collection).toContain('hx-get="/capability/tasks/read" hx-trigger="load"');
    expect(collection).toMatch(/data-content-region="records"[^>]*><\/div>/);
    expect(collection).not.toContain("a record somebody already had");
  });

  test("the shell stores presentation and never a collection", () => {
    // ARCH §6.1: the shell may remember how things look; it never decides what is true.
    // Exactly two presentation records live in storage, one per allowed window, and the
    // desk holds nothing else across a reload for a swap to put back.
    const keys = new Set<string>();
    for (const [name, source] of shellScripts()) {
      expect(source, name).not.toContain("sessionStorage");
      for (const match of source.matchAll(/"(aluna\.[a-z0-9.]+)"/g)) keys.add(String(match[1]));
      // Nothing takes a copy of what a region is showing. The one snapshot the shell
      // holds is a record's own inert `<template>`, which stands inside the collection
      // and dies with it.
      expect(source, name).not.toMatch(/=\s*[\w.]+\.innerHTML\b/);
    }
    expect([...keys].sort()).toEqual(["aluna.desk.dev.v1", "aluna.desk.window.v1"]);
  });

  test("the record view and the logo both ask the server again", () => {
    // Back out of a record, and a press on a logo, are the same fresh
    // `GET /capability/:id` aimed at the same region — never a restored snapshot.
    expect(readSource("public/record-view.js")).toMatch(
      /\.ajax\("GET", `\/capability\/\$\{capabilityId}`/,
    );
    expect(readSource("public/desk-window.js")).toMatch(/\.ajax\?\.\("GET", pathname/);
    expect(readSource("src/web/fragments.ts")).toMatch(/hx-get="\$\{url}"/);
  });
});

/* ── and no machinery behind it ────────────────────────────────────────────── */

/** The scripts that read a capability's records, and so are where a poll would live. */
const READERS = new Set([
  "app.js",
  "desk-window.js",
  "record-mutations.js",
  "record-view.js",
  "records-refresh.js",
  "records-region-requests.js",
  "search-chrome.js",
]);

describe("no invalidation bus, version stamp or refresh control exists anywhere", () => {
  test("no shell script opens a channel, and no reader polls", () => {
    for (const [name, source] of shellScripts()) {
      expect(source, name).not.toContain("BroadcastChannel");
      expect(source, name).not.toContain("SharedWorker");
      expect(source, name).not.toContain("postMessage");
      expect(source, name).not.toMatch(/addEventListener\(\s*"storage"/);
      if (READERS.has(name)) expect(source, name).not.toContain("setInterval");
    }
  });

  test("nothing anywhere decides that what is on screen has gone stale", () => {
    for (const [name, source] of shellScripts()) {
      expect(source, name).not.toMatch(/stale|invalidat/i);
    }
  });

  test("the version a surface carries is identity, never a staleness stamp", () => {
    for (const [name, source] of shellScripts()) {
      // Comparing one version to another and acting on the *difference* is the question
      // "has this gone out of date?", which nothing on the desk may ask. (A version
      // compared to `undefined` is a presence check, and is not that question.)
      expect(source, name).not.toMatch(/version\s*!==?\s*[\w.]*version\b/);
    }
    // The one reader of a surface's version is the deterministic-duplicate no-op, which
    // asks whether the View standing there *is* the View a build would restore.
    expect(flat(codeOf("public/app.js"))).toContain("current.version === restored.version");
  });

  test("no capability surface offers a refresh control", () => {
    const surfaces = [
      renderCollection({ capability: SAMPLE, loadThroughRead: true }),
      renderCollection({ capability: SAMPLE, items: "<article>a record</article>" }),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toMatch(/>\s*(Refresh|Reload|Sync)\b/);
      expect(surface).not.toMatch(/aria-label="[^"]*(refresh|reload)/i);
    }
  });

  test("the desk chrome offers no refresh lamp", () => {
    // The window's two lamps are maximise and put away (design D3); nothing in the
    // shipped chrome or in any stylesheet either project ships adds a third that re-reads.
    expect(readSource("public/index.html").toLowerCase()).not.toContain("refresh");
    for (const [path, sheet] of shippedStylesheets()) {
      expect(sheet.toLowerCase(), path).not.toContain("refresh");
    }
  });

  test("a `load` trigger arms once per element, so no read re-fires behind the desk", () => {
    // What lets search take the region without stripping the View's trigger, and what
    // makes processing promoted content one read rather than two. Pinned in the vendored
    // build, because it is a property of htmx and not of anything written here.
    const htmx = readSource("public/vendor/htmx.min.js");
    expect(htmx).toContain('!t.firstInitCompleted&&e.trigger==="load"');
    expect(htmx).toContain('if(e!=="firstInitCompleted")delete t[e]');
  });

  test("the architecture says the edge is accepted rather than engineered away", () => {
    const architecture = flat(readSource("docs/architecture.md"));
    expect(architecture).toContain("Cross-capability reads need no invalidation channel.");
    expect(architecture).toContain(
      "an accepted edge rather than a reason to build a bus, a version stamp, or the refresh control the window deliberately does not have",
    );
  });
});

/* ── the helper the negative assertions above rest on ──────────────────────── */

describe("stripping a file's prose", () => {
  test("takes whole comments and leaves a URL inside a string alone", () => {
    expect(code('const a = 1; // gone\n  // gone too\nconst b = "https://kept/";')).toBe(
      'const a = 1; // gone\n\nconst b = "https://kept/";',
    );
    expect(code("/** gone\n * gone\n */\nconst c = 2;")).toBe("\nconst c = 2;");
  });
});
