// A recorder's WebM, finished (`design/scripts/lib/webm.js`), read back by a reader of the test's
// own: the length a player shows, the index it seeks by, and the same frames at the same times.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { finishWebm } from "#design/lib/webm.js";

const recorded = (name: string) =>
  new Uint8Array(
    readFileSync(resolve(import.meta.dir, "../../../platform/files/recordings", name)),
  );

type Node = { id: number; start: number; data: number; end: number };

const MASTERS = new Set([
  0x18538067, 0x114d9b74, 0x4dbb, 0x1549a966, 0x1654ae6b, 0xae, 0x1f43b675, 0x1c53bb6b, 0xbb, 0xb7,
]);
const TOP = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1254c367]);

function vint(bytes: Uint8Array, at: number, keepMarker: boolean) {
  const first = bytes[at] ?? 0;
  const length = Math.clz32(first) - 23;
  let value = keepMarker ? first : first & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + (bytes[at + i] ?? 0);
    unknown &&= bytes[at + i] === 0xff;
  }
  return { value, length, unknown: !keepMarker && unknown };
}

/** The element at `at`: a size-less one ends where its parent does. */
function nodeAt(bytes: Uint8Array, at: number, to: number) {
  const id = vint(bytes, at, true);
  const size = vint(bytes, at + id.length, false);
  const data = at + id.length + size.length;
  return {
    id: id.value,
    start: at,
    data,
    end: size.unknown ? to : data + size.value,
    sizeless: size.unknown,
  };
}

/** Every element under `from..to`, depth first. A cluster with no size ends at its next peer. */
function walk(bytes: Uint8Array, from = 0, to = bytes.length, sizeless = false): Node[] {
  const out: Node[] = [];
  let at = from;
  while (at < to) {
    const { sizeless: open, ...node } = nodeAt(bytes, at, to);
    if (sizeless && TOP.has(node.id)) break;
    out.push(node);
    const inner = open && node.id === 0x1f43b675;
    const children = MASTERS.has(node.id) ? walk(bytes, node.data, node.end, inner) : [];
    out.push(...children);
    at = inner ? (children.at(-1)?.end ?? node.data) : node.end;
  }
  return out;
}

const uint = (bytes: Uint8Array, n: Node) =>
  [...bytes.subarray(n.data, n.end)].reduce((sum, byte) => sum * 256 + byte, 0);

/** Every block, with the time it plays at and the frames it carries. */
function blocks(bytes: Uint8Array) {
  const found: { at: number; flags: number; frames: string }[] = [];
  let base = 0;
  for (const n of walk(bytes)) {
    if (n.id === 0xe7) base = uint(bytes, n);
    if (n.id !== 0xa3) continue;
    const track = vint(bytes, n.data, false).length;
    const view = new DataView(bytes.buffer, bytes.byteOffset + n.data + track, 3);
    found.push({
      at: base + view.getInt16(0),
      flags: view.getUint8(2),
      frames: Buffer.from(bytes.subarray(n.data + track + 3, n.end)).toString("hex"),
    });
  }
  return found;
}

const durationIn = (bytes: Uint8Array) => {
  const node = walk(bytes).find((n) => n.id === 0x4489);
  return node ? new DataView(bytes.buffer, bytes.byteOffset + node.data, 8).getFloat64(0) : null;
};

describe("a recorder's WebM, finished", () => {
  for (const name of ["chrome-152.webm", "firefox-156.webm"]) {
    test(`${name} keeps every frame at its time, now as a keyframe`, () => {
      const raw = recorded(name);
      const finished = finishWebm(raw);
      const before = blocks(raw);
      const after = blocks(finished.bytes);
      expect(after.map(({ at, frames }) => ({ at, frames }))).toEqual(
        before.map(({ at, frames }) => ({ at, frames })),
      );
      expect(after.every((b) => (b.flags & 0x80) === 0x80)).toBe(true);
    });

    test(`${name} states its length, from the last block's start to one block past it`, () => {
      const raw = recorded(name);
      const finished = finishWebm(raw);
      expect(durationIn(raw) ?? 0).toBe(0);
      const times = blocks(raw).map((b) => b.at);
      const [last = 0, before = 0] = times.slice(-2).reverse();
      const ms = last + (last - before);
      expect(durationIn(finished.bytes)).toBe(ms);
      expect(finished.seconds).toBe(ms / 1000);
    });

    test(`${name} has a SeekHead that finds Info, Tracks and Cues, and Cues that find each cluster`, () => {
      const { bytes } = finishWebm(recorded(name));
      const nodes = walk(bytes);
      const segment = nodes.find((n) => n.id === 0x18538067);
      if (!segment) throw new Error("no Segment");
      expect(segment.end).toBe(bytes.length);
      const at = (position: number) => vint(bytes, segment.data + position, true).value;
      const seeks = nodes.filter((n) => n.id === 0x53ab);
      const positions = nodes.filter((n) => n.id === 0x53ac);
      expect(seeks.map((n) => uint(bytes, n))).toEqual([0x1549a966, 0x1654ae6b, 0x1c53bb6b]);
      for (const [n, seek] of seeks.entries()) {
        const position = positions[n];
        if (position) expect(at(uint(bytes, position))).toBe(uint(bytes, seek));
      }
      const clusters = nodes.filter((n) => n.id === 0x1f43b675);
      const cueTimes = nodes.filter((n) => n.id === 0xb3).map((n) => uint(bytes, n));
      const cuePlaces = nodes.filter((n) => n.id === 0xf1).map((n) => uint(bytes, n));
      expect(cuePlaces).toEqual(clusters.map((c) => c.start - segment.data));
      const clusterTimes = clusters.map((c) => {
        const time = walk(bytes, c.data, c.end).find((n) => n.id === 0xe7);
        return time ? uint(bytes, time) : -1;
      });
      expect(cueTimes).toEqual(clusterTimes);
    });

    test(`finishing ${name} twice changes nothing the second time`, () => {
      const once = finishWebm(recorded(name));
      const twice = finishWebm(once.bytes);
      expect(twice.seconds).toBe(once.seconds);
      expect(Buffer.from(twice.bytes).equals(Buffer.from(once.bytes))).toBe(true);
    });
  }

  test("splits a long recording into clusters no block's 16-bit offset can overflow", () => {
    const { bytes } = finishWebm(longRecording(40_000));
    const clusters = walk(bytes).filter((n) => n.id === 0x1f43b675);
    const sourceClusters = walk(longRecording(40_000)).filter((n) => n.id === 0x1f43b675);
    expect(clusters.length).toBeGreaterThan(sourceClusters.length);
    const offsets = clusters.flatMap((c) =>
      walk(bytes, c.data, c.end)
        .filter((n) => n.id === 0xa3)
        .map((n) => new DataView(bytes.buffer, bytes.byteOffset + n.data + 1, 2).getInt16(0)),
    );
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(0x7fff);
    expect(blocks(bytes).map((b) => b.at)).toEqual(blocks(longRecording(40_000)).map((b) => b.at));
  });

  test("leaves anything it can't read as it was, with no length to report", () => {
    for (const bytes of [
      new Uint8Array(0),
      recorded("chrome-152.m4a"),
      recorded("firefox-156.ogg"),
      recorded("firefox-156.webm").subarray(0, 200),
    ]) {
      const finished = finishWebm(bytes);
      expect(finished.seconds).toBeNull();
      expect(finished.bytes).toBe(bytes);
    }
  });
});

describe("Info's checksum", () => {
  test("is left out, since the Duration written into Info would make it wrong", () => {
    const chrome = recorded("chrome-152.webm");
    const info = walk(chrome).find((n) => n.id === 0x1549a966);
    if (!info) throw new Error("no Info");
    const length = info.end - info.data + 6;
    const withCrc = splice(chrome, info.start + 4, info.data - info.start - 4, [
      0x80 | length,
      0xbf,
      0x84,
      0,
      0,
      0,
      0,
    ]);
    const { bytes, seconds } = finishWebm(withCrc);
    expect(seconds).not.toBeNull();
    expect(walk(bytes).some((n) => n.id === 0xbf)).toBe(false);
  });
});

describe("a broken recording", () => {
  test("is left as it was rather than written into one a strict reader refuses", () => {
    const chrome = recorded("chrome-152.webm");
    const nodes = walk(chrome);
    const at = (id: number) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) throw new Error(`no ${id.toString(16)}`);
      return node;
    };
    const [, second, third] = nodes.filter((n) => n.id === 0xa3);
    if (!second || !third) throw new Error("too few blocks");
    const block = at(0xa3);
    const timecode = at(0xe7);
    const broken = {
      "a block too short for its header": splice(chrome, block.start, 0, [0xa3, 0x82, 0x81, 0x00]),
      "a Timecode wider than any clock": splice(
        chrome,
        timecode.start,
        timecode.end - timecode.start,
        [0xe7, 0x40, 130, ...new Array(130).fill(0xff)],
      ),
      "a child whose size runs past its parent": patched(chrome, at(0x4d80).start + 2, 0x15),
      "a Segment inside a Cluster": splice(chrome, block.start, 0, [
        0x18,
        0x53,
        0x80,
        0x67,
        0x01,
        ...new Array(7).fill(0xff),
      ]),
      "a block that starts before the one before it": patched(
        patched(chrome, third.data + 1, 0),
        third.data + 2,
        1,
      ),
      "a track that isn't sound": patched(chrome, at(0x83).data, 1),
    };
    for (const [what, bytes] of Object.entries(broken)) {
      const finished = finishWebm(bytes);
      expect(finished.seconds, what).toBeNull();
      expect(finished.bytes, what).toBe(bytes);
    }
    expect(second.start).toBeLessThan(third.start);
  });
});

const splice = (bytes: Uint8Array, at: number, remove: number, insert: number[]) =>
  new Uint8Array([...bytes.subarray(0, at), ...insert, ...bytes.subarray(at + remove)]);

function patched(bytes: Uint8Array, at: number, value: number): Uint8Array {
  const copy = bytes.slice();
  copy[at] = value;
  return copy;
}

/**
 * A recording of `ms` milliseconds in 20 ms blocks, in clusters with no size spanning 30 s each, as
 * a recorder that never cut a cluster would write it: the header and Tracks of Firefox's own.
 */
function longRecording(ms: number): Uint8Array {
  const firefox = recorded("firefox-156.webm");
  const nodes = walk(firefox);
  const tracks = nodes.find((n) => n.id === 0x1654ae6b);
  const info = nodes.find((n) => n.id === 0x1549a966);
  const segment = nodes.find((n) => n.id === 0x18538067);
  if (!tracks || !info || !segment) throw new Error("the Firefox recording lost its head");
  const parts: number[] = [
    ...firefox.subarray(0, segment.data),
    ...firefox.subarray(info.start, info.end),
  ];
  parts.push(...firefox.subarray(tracks.start, tracks.end));
  for (let cluster = 0; cluster < ms; cluster += 30_000) {
    parts.push(0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
    parts.push(
      0xe7,
      0x84,
      (cluster >>> 24) & 0xff,
      (cluster >>> 16) & 0xff,
      (cluster >>> 8) & 0xff,
      cluster & 0xff,
    );
    for (let at = cluster; at < Math.min(ms, cluster + 30_000); at += 20) {
      const rel = at - cluster;
      parts.push(0xa3, 0x87, 0x82, (rel >> 8) & 0xff, rel & 0xff, 0x00, 0xfc, at & 0xff, 0x01);
    }
  }
  return new Uint8Array(parts);
}
