import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRegularFiles, sampleFile } from "../admission/sample-files.test-support.ts";
import { fileUrl } from "../file-url.ts";
import { mintFileKey } from "./ledger.ts";
import { createLocalObjectStore, type ObjectStore } from "./object-store.ts";
import { STAGING_DIRECTORY } from "./object-store-root.ts";

async function* chunksOf(bytes: Uint8Array, size = 1024): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, offset + size);
  }
}

let root: string;
let store: ObjectStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omni-crud-object-store-"));
  store = createLocalObjectStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const staging = () => readdirSync(join(root, STAGING_DIRECTORY));

describe("the local object store's bytes", () => {
  test("streams a put into staging, and only a place puts the bytes where get finds them", async () => {
    const key = mintFileKey();
    const bytes = sampleFile("jpeg", 300_000);
    const staged = await store.put(key, chunksOf(bytes));
    expect(staged).toMatchObject({ key, size: bytes.byteLength });
    expect(staging()).toEqual([key]);
    expect(await store.get(key)).toBeNull();

    expect(await staged.place()).toBe(true);
    expect(staging()).toEqual([]);
    expect(new Uint8Array(readFileSync(join(root, key)))).toEqual(bytes);
    const opened = await store.get(key);
    expect(opened?.size).toBe(bytes.byteLength);
    expect(new Uint8Array(await new Response(opened?.body).arrayBuffer())).toEqual(bytes);
  });

  test("answers a place whose staged bytes a cleanup took first", async () => {
    const staged = await store.put(mintFileKey(), chunksOf(sampleFile("png")));
    await store.delete(staged.key);
    expect(await staged.place()).toBe(false);
    expect(readdirSync(root).sort()).toEqual([STAGING_DIRECTORY]);
  });

  test("leaves another upload's staged file alone when its key is taken", async () => {
    const key = mintFileKey();
    mkdirSync(join(root, STAGING_DIRECTORY), { recursive: true });
    writeFileSync(join(root, STAGING_DIRECTORY, key), "another upload");
    await expect(store.put(key, chunksOf(sampleFile("png")))).rejects.toThrow();
    expect(readFileSync(join(root, STAGING_DIRECTORY, key), "utf8")).toBe("another upload");
  });

  test("errors a body whose file ends before the size it was opened with", async () => {
    const key = mintFileKey();
    await (await store.put(key, chunksOf(sampleFile("jpeg", 600_000)))).place();
    const opened = await store.get(key);
    truncateSync(join(root, key), 1000);
    await expect(new Response(opened?.body).arrayBuffer()).rejects.toThrow("ended after");
  });

  test("removes what a failed put wrote, and hands the failure on", async () => {
    const key = mintFileKey();
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield sampleFile("jpeg", 2048);
      throw new Error("the body stopped");
    }
    await expect(store.put(key, failing())).rejects.toThrow("the body stopped");
    expect(staging()).toEqual([]);
  });

  test("discards staged bytes, and a discard after a place leaves the object alone", async () => {
    const dropped = await store.put(mintFileKey(), chunksOf(sampleFile("png")));
    await dropped.discard();
    await dropped.discard();
    expect(staging()).toEqual([]);

    const kept = await store.put(mintFileKey(), chunksOf(sampleFile("png")));
    await kept.place();
    await kept.discard();
    expect(existsSync(join(root, kept.key))).toBe(true);
  });

  test("keeps streaming an object opened before it was deleted", async () => {
    const key = mintFileKey();
    const bytes = sampleFile("gif89", 600_000);
    await (await store.put(key, chunksOf(bytes))).place();
    const opened = await store.get(key);
    await store.delete(key);
    expect(existsSync(join(root, key))).toBe(false);
    expect(new Uint8Array(await new Response(opened?.body).arrayBuffer())).toEqual(bytes);
    expect(await store.get(key)).toBeNull();
  });

  test("gives its descriptor back when a body ends, is cancelled, or is never read", async () => {
    const key = mintFileKey();
    await (await store.put(key, chunksOf(sampleFile("webp", 2_000_000)))).place();
    const before = openRegularFiles();

    const read = await store.get(key);
    await new Response(read?.body).arrayBuffer();
    expect(openRegularFiles()).toBe(before);

    const cancelled = await store.get(key);
    const reader = cancelled?.body.getReader();
    await reader?.read();
    await reader?.cancel();
    expect(openRegularFiles()).toBe(before);

    const midRead = await store.get(key);
    const midReader = midRead?.body.getReader();
    const inFlight = midReader?.read();
    await midReader?.cancel();
    await inFlight;
    await midRead?.close();
    expect(openRegularFiles()).toBe(before);

    const unread = await store.get(key);
    expect(openRegularFiles()).toBe(before + 1);
    await unread?.close();
    await unread?.close();
    expect(openRegularFiles()).toBe(before);
  });
});

describe("the local object store's staged reads", () => {
  test("reads staged bytes through one descriptor, never past the end, and gives it back", async () => {
    const before = openRegularFiles();
    const bytes = sampleFile("png", 10_000);
    const staged = await store.put(mintFileKey(), chunksOf(bytes));
    expect(await staged.read(0, 8)).toEqual(bytes.subarray(0, 8));
    expect(openRegularFiles()).toBe(before + 1);
    expect(await staged.read(9_990, 2 ** 31)).toEqual(bytes.subarray(9_990));
    expect(await staged.read(2 ** 40, 16)).toEqual(new Uint8Array(0));
    await Promise.all([staged.read(100, 4), staged.read(200, 4)]);
    expect(openRegularFiles()).toBe(before + 1);
    await staged.discard();
    expect(openRegularFiles()).toBe(before);
    await expect(staged.read(0, 8)).rejects.toThrow();
  });

  test("refuses a staged read asked for while the bytes are placed or discarded", async () => {
    const before = openRegularFiles();
    for (const settle of ["place", "discard"] as const) {
      const staged = await store.put(mintFileKey(), chunksOf(sampleFile("png")));
      const inFlight = staged.read(0, 8);
      const settling = staged[settle]();
      const late = expect(staged.read(0, 8)).rejects.toThrow();
      expect(await inFlight).toHaveLength(8);
      await settling;
      await late;
      expect(openRegularFiles(), settle).toBe(before);
    }
  });

  test("gives the staged reader's descriptor back when the bytes are placed", async () => {
    const before = openRegularFiles();
    const staged = await store.put(mintFileKey(), chunksOf(sampleFile("png")));
    await staged.read(0, 8);
    expect(await staged.place()).toBe(true);
    expect(openRegularFiles()).toBe(before);
  });
});

describe("the local object store's spans", () => {
  const bytes = sampleFile("isom", 1_500_000);
  let key: string;
  beforeEach(async () => {
    key = mintFileKey();
    await (await store.put(key, chunksOf(bytes, 64 * 1024))).place();
  });

  const read = async (start: number, length: number) => {
    const opened = await store.get(key, { start, length });
    return {
      size: opened?.size,
      bytes: new Uint8Array(await new Response(opened?.body).arrayBuffer()),
    };
  };

  test("reads only the bytes asked for, and knows the whole object's size", async () => {
    for (const [start, length] of [
      [0, 1],
      [1000, 5000],
      [700_000, 600_000],
      [1_499_999, 1],
      [0, 1_500_000],
      [42, 0],
    ] as const) {
      expect(await read(start, length)).toEqual({
        size: 1_500_000,
        bytes: bytes.subarray(start, start + length),
      });
    }
  });

  test("errors a span that runs past the object's end", async () => {
    const opened = await store.get(key, { start: 1_400_000, length: 200_000 });
    await expect(new Response(opened?.body).arrayBuffer()).rejects.toThrow("ended after");
  });

  test("opens nothing for a span that isn't two whole numbers", async () => {
    const before = openRegularFiles();
    for (const span of [
      { start: -1, length: 10 },
      { start: 0, length: -1 },
      { start: 0.5, length: 10 },
      { start: 0, length: Number.NaN },
      { start: Number.POSITIVE_INFINITY, length: 1 },
    ]) {
      await expect(store.get(key, span)).rejects.toThrow("two whole numbers");
    }
    expect(openRegularFiles()).toBe(before);
  });

  test("keeps streaming a span opened before its object was deleted", async () => {
    const opened = await store.get(key, { start: 300_000, length: 1_000_000 });
    await store.delete(key);
    const streamed = new Uint8Array(await new Response(opened?.body).arrayBuffer());
    expect(streamed).toEqual(bytes.subarray(300_000, 1_300_000));
  });

  test("gives its descriptor back when a span ends or is cancelled", async () => {
    const before = openRegularFiles();
    await read(10, 700_000);
    expect(openRegularFiles()).toBe(before);
    const cancelled = await store.get(key, { start: 10, length: 1_000_000 });
    const reader = cancelled?.body.getReader();
    await reader?.read();
    await reader?.cancel();
    expect(openRegularFiles()).toBe(before);
  });
});

describe("the local object store's keys", () => {
  test("a delete in a store nothing was ever written to is no failure", async () => {
    const empty = createLocalObjectStore(join(root, "never-written"));
    await empty.delete(mintFileKey());
    expect(existsSync(join(root, "never-written"))).toBe(false);
  });

  test("deletes a key from staging first and from its place, and a missing key is no failure", async () => {
    const placed = await store.put(mintFileKey(), chunksOf(sampleFile("avif")));
    await placed.place();
    const stagedOnly = await store.put(mintFileKey(), chunksOf(sampleFile("avif")));
    await store.delete(placed.key);
    await store.delete(stagedOnly.key);
    await store.delete(mintFileKey());
    expect(readdirSync(root).sort()).toEqual([STAGING_DIRECTORY]);
    expect(staging()).toEqual([]);
  });

  test("answers a missing file, a directory, a planted link or a pipe under a key as gone", async () => {
    const outside = join(root, "..", `outside-${mintFileKey()}`);
    writeFileSync(outside, "not the store's");
    const [missing, directory, link, pipe] = [0, 1, 2, 3].map(() => mintFileKey());
    mkdirSync(join(root, directory ?? ""), { recursive: true });
    symlinkSync(outside, join(root, link ?? ""));
    Bun.spawnSync(["mkfifo", join(root, pipe ?? "")]);
    const before = openRegularFiles();
    try {
      for (const key of [missing, directory, link, pipe])
        expect(await store.get(key ?? "")).toBeNull();
      expect(openRegularFiles()).toBe(before);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  test("answers a socket planted under a key as gone", async () => {
    // Its own short root: a socket's path has a length limit the scratch root's could pass.
    const shortRoot = mkdtempSync(join(tmpdir(), "s-"));
    const key = mintFileKey();
    const listener = Bun.listen({ unix: join(shortRoot, key), socket: { data() {} } });
    try {
      expect(await createLocalObjectStore(shortRoot).get(key)).toBeNull();
    } finally {
      listener.stop(true);
      rmSync(shortRoot, { recursive: true, force: true });
    }
  });

  test("addresses every object at the same origin", () => {
    const key = mintFileKey();
    expect(store.url(key)).toBe(fileUrl(key));
  });

  test("empties staging and keeps what was placed", async () => {
    const placed = await store.put(mintFileKey(), chunksOf(sampleFile("jpeg")));
    await placed.place();
    await store.put(mintFileKey(), chunksOf(sampleFile("jpeg")));
    await store.put(mintFileKey(), chunksOf(sampleFile("jpeg")));
    expect(staging()).toHaveLength(2);
    await store.clearStaging();
    expect(staging()).toEqual([]);
    expect(existsSync(join(root, placed.key))).toBe(true);
  });

  test("refuses anything that is not a key it mints, before touching the disk", async () => {
    for (const key of ["../escape", "", STAGING_DIRECTORY, "a/b", `${mintFileKey()}/..`]) {
      await expect(store.put(key, chunksOf(sampleFile("png")))).rejects.toThrow();
      await expect(store.get(key)).rejects.toThrow();
      await expect(store.delete(key)).rejects.toThrow();
      expect(() => store.url(key)).toThrow();
    }
    expect(readdirSync(root)).toEqual([]);
  });
});
