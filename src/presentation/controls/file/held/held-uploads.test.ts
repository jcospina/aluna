// The bookkeeping of what a form's file controls hold that no save claimed
// (`public/controls/held-uploads.js`), run on its own with the route, the region watch and the
// timer handed in, so each rule is read off what it sends.

import { describe, expect, test } from "bun:test";
import {
  createHeldUploads,
  DISCARD_BATCH_KEYS,
  DISCARD_RETRY_DELAYS_MS,
} from "#shell/controls/held-uploads.js";

type Host = { isConnected: boolean; contains(other: unknown): boolean };

function host(): Host {
  const element: Host = { isConnected: true, contains: (other) => other === element };
  return element;
}

function scope(...hosts: Host[]) {
  return { contains: (other: unknown) => hosts.includes(other as Host) };
}

type Answer = { ok: boolean; status: number };
const ANSWERED: Answer = { ok: true, status: 204 };

/** Everything queued so far, the requests a discard makes included. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A bookkeeping whose sends, watches and scheduled runs the test reads and runs. */
function bookkeeping(send: (keys: string[]) => Promise<Answer> = async () => ANSWERED) {
  const sent: string[][] = [];
  const watches: { anchor: unknown; release: () => void; live: boolean }[] = [];
  const scheduled: { run: () => void; ms: number }[] = [];
  const held = createHeldUploads({
    send: (keys: string[]) => {
      sent.push(keys);
      return send(keys);
    },
    watch: (anchor: unknown, _label: string, release: () => void) => {
      const entry = { anchor, release, live: true };
      watches.push(entry);
      return () => {
        entry.live = false;
      };
    },
    schedule: (run: () => void, ms: number) => void scheduled.push({ run, ms }),
  });
  /** What the page's region release does to every live watch on `anchor`. */
  const release = (anchor: Host) => {
    for (const entry of watches.filter((w) => w.anchor === anchor && w.live)) {
      entry.live = false;
      entry.release();
    }
  };
  const live = () => watches.filter((w) => w.live).length;
  /** Run what is scheduled, answering the delays each waited. */
  const timersRun = () =>
    scheduled.splice(0).map(({ run, ms }) => {
      run();
      return ms;
    });
  return { held, sent, release, live, timersRun };
}

/** Admit `key` to `field` and have the field take it, as an upload that lands does. */
function took(
  book: ReturnType<typeof bookkeeping>,
  field: Host,
  key: string,
  saved: string[] = [],
) {
  book.held.arrived(field as never, key);
  book.held.heard(field as never, [key], saved);
}

describe("a key the form let go of", () => {
  test("goes back at once when another takes its place", async () => {
    const book = bookkeeping();
    const field = host();
    took(book, field, "k1");
    took(book, field, "k2");
    await flush();
    expect(book.sent).toEqual([["k1"]]);
  });

  test("goes back when the form clears it or a list drops it", async () => {
    const book = bookkeeping();
    const field = host();
    took(book, field, "k1");
    book.held.heard(field as never, [], []);
    const list = host();
    book.held.arrived(list as never, "a");
    book.held.arrived(list as never, "b");
    book.held.heard(list as never, ["a", "b"], []);
    book.held.heard(list as never, ["b"], []);
    await flush();
    expect(book.sent).toEqual([["k1", "a"]]);
  });

  test("let go of in one task, goes in one request", async () => {
    const book = bookkeeping();
    const [one, two] = [host(), host()];
    took(book, one, "k1");
    took(book, two, "k2");
    book.held.heard(one as never, [], []);
    book.held.heard(two as never, [], []);
    await flush();
    expect(book.sent).toEqual([["k1", "k2"]]);
  });

  test("that the field never took, because a later pick replaced it first, goes back too", async () => {
    const book = bookkeeping();
    const field = host();
    book.held.arrived(field as never, "late");
    took(book, field, "kept");
    book.timersRun();
    await flush();
    expect(book.sent).toEqual([["late"]]);
    expect(book.held.holdsUpload(scope(field))).toBe(true);
  });

  test("whose request the network or the server fails is sent again after each delay", async () => {
    const failures: (() => Promise<Answer>)[] = [
      async () => {
        throw new TypeError("offline");
      },
      async () => ({ ok: false, status: 500 }),
      async () => ({ ok: false, status: 503 }),
    ];
    const book = bookkeeping(() => (failures.shift() ?? (async () => ANSWERED))());
    const field = host();
    took(book, field, "k1");
    book.held.heard(field as never, [], []);
    const waited: number[] = [];
    for (let round = 0; round <= DISCARD_RETRY_DELAYS_MS.length; round += 1) {
      await flush();
      waited.push(...book.timersRun());
    }
    expect(book.sent).toEqual(
      Array.from({ length: DISCARD_RETRY_DELAYS_MS.length + 1 }, () => ["k1"]),
    );
    expect(waited).toEqual([0, ...DISCARD_RETRY_DELAYS_MS]);
  });

  test("whose request answers with no status at all is sent again", async () => {
    let answers = 0;
    const book = bookkeeping(async () => (answers++ === 0 ? ({} as Answer) : ANSWERED));
    const field = host();
    took(book, field, "k1");
    book.held.heard(field as never, [], []);
    await flush();
    book.timersRun();
    await flush();
    book.timersRun();
    await flush();
    expect(book.sent).toEqual([["k1"], ["k1"]]);
  });

  test("whose request the route refuses is not sent again", async () => {
    const book = bookkeeping(async () => ({ ok: false, status: 400 }));
    const field = host();
    took(book, field, "k1");
    book.held.heard(field as never, [], []);
    await flush();
    expect(book.timersRun()).toEqual([0]);
    await flush();
    expect(book.sent).toEqual([["k1"]]);
  });

  test("let go of in their hundreds, goes in requests the keepalive budget allows", async () => {
    const book = bookkeeping();
    const field = host();
    const keys = Array.from({ length: DISCARD_BATCH_KEYS + 1 }, (_, at) => `k${at}`);
    for (const key of keys) took(book, field, key);
    book.held.heard(field as never, [], []);
    await flush();
    expect(book.sent.map((batch) => batch.length)).toEqual([DISCARD_BATCH_KEYS, 1]);
    expect(book.sent.flat()).toEqual(keys);
  });
});

describe("a key a save took", () => {
  test("is forgotten when an edit keeps it, and never sent after", async () => {
    const book = bookkeeping();
    const field = host();
    took(book, field, "k1");
    book.held.heard(field as never, ["k1"], ["k1"]);
    book.held.heard(field as never, [], ["k1"]);
    book.held.heard(field as never, [], []);
    book.timersRun();
    await flush();
    expect(book.sent).toEqual([]);
    expect(book.held.holdsUpload(scope(field))).toBe(false);
    expect(book.live()).toBe(0);
  });

  test("is forgotten for every control in a form whose create committed", async () => {
    const book = bookkeeping();
    const [inside, outside] = [host(), host()];
    took(book, inside, "mine");
    took(book, outside, "theirs");
    book.held.claimed(scope(inside));
    book.held.heard(inside as never, [], []);
    book.held.heard(outside as never, [], []);
    await flush();
    expect(book.sent).toEqual([["theirs"]]);
  });
});

describe("a committed create", () => {
  test("does not take a key still arriving, which its form never sent", async () => {
    const book = bookkeeping();
    const field = host();
    book.held.arrived(field as never, "late");
    book.held.claimed(scope(field));
    book.timersRun();
    await flush();
    expect(book.sent).toEqual([["late"]]);
  });
});

describe("a form leaving the page", () => {
  test("gives back what its controls held once they are off the page, not while they stand", async () => {
    const book = bookkeeping();
    const field = host();
    took(book, field, "k1");
    book.held.arrived(field as never, "k2");

    book.release(field);
    await flush();
    expect(book.sent).toEqual([]);
    expect(book.live()).toBe(1);

    field.isConnected = false;
    book.release(field);
    book.timersRun();
    await flush();
    expect(book.sent).toEqual([["k1", "k2"]]);
    expect(book.held.holdsUpload(scope(field))).toBe(false);
    expect(book.live()).toBe(0);
  });

  test("with nothing held left to give, watches nothing", () => {
    const book = bookkeeping();
    const field = host();
    took(book, field, "k1");
    expect(book.live()).toBe(1);
    book.held.heard(field as never, ["k1"], ["k1"]);
    expect(book.live()).toBe(0);
  });
});

describe("whether a form holds an upload", () => {
  test("counts a file still travelling, a key arriving and a key held, in that form only", () => {
    const book = bookkeeping();
    const [field, other] = [host(), host()];
    const form = scope(field);
    expect(book.held.holdsUpload(form)).toBe(false);

    const landed = book.held.travelling(field as never);
    expect(book.held.holdsUpload(form)).toBe(true);
    expect(book.held.holdsUpload(scope(other))).toBe(false);
    book.held.arrived(field as never, "k1");
    landed();
    expect(book.held.holdsUpload(form)).toBe(true);
    book.held.heard(field as never, ["k1"], []);
    expect(book.held.holdsUpload(form)).toBe(true);
    book.held.heard(field as never, [], []);
    expect(book.held.holdsUpload(form)).toBe(false);
  });
});
