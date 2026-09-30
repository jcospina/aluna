import { describe, expect, test } from "bun:test";

import {
  flat,
  readSource,
  shellScripts,
  shippedStylesheets,
} from "../../safety/source.test-support.ts";

// Opening a second capability (PLAN decision 15; ARCH §6.1 and §8; design D2) gets no staleness
// machinery at all. `capability-swap.test.ts` runs the swap; this holds the shell to having none.

describe("the outgoing capability's work is released on the swap", () => {
  test("the hand-off is gone from the shell, not merely unreferenced", () => {
    for (const [name, source] of shellScripts()) {
      expect(source, name).not.toContain("handOff");
    }
  });
});

describe("every open is a fresh read", () => {
  test("the shell stores presentation and never a collection", () => {
    // ARCH §6.1: the shell may remember how things look; it never decides what is true. Exactly
    // two presentation records live in storage, and the desk holds nothing else across a reload.
    const keys = new Set<string>();
    for (const [name, source] of shellScripts()) {
      expect(source, name).not.toContain("sessionStorage");
      for (const match of source.matchAll(/"(aluna\.[a-z0-9.]+)"/g)) keys.add(String(match[1]));
      // Nothing takes a copy of what a region is showing. The one snapshot the shell holds is a
      // record's own inert `<template>`, which stands inside the collection and dies with it.
      expect(source, name).not.toMatch(/=\s*[\w.]+\.innerHTML\b/);
    }
    expect([...keys].sort()).toEqual(["aluna.desk.dev.v1", "aluna.desk.window.v1"]);
  });
});

/** The scripts that read a capability's records, and so are where a poll would live. */
const READERS = new Set([
  "app.js",
  "desk/window/desk-window.js",
  "records/record-mutations.js",
  "records/record-view.js",
  "records/records-refresh.js",
  "records/records-region-requests.js",
  "records/search-chrome.js",
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
      // Comparing one version to another and acting on the difference asks "has this gone out of
      // date?", which nothing on the desk may ask. A comparison to `undefined` checks presence.
      expect(source, name).not.toMatch(/version\s*!==?\s*[\w.]*version\b/);
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
    // What lets search take the region without stripping the View's trigger. Pinned in the
    // vendored build, because it is a property of htmx and not of anything written here.
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
