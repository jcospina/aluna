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
import { mintFileKey } from "./ledger.ts";
import { createLocalObjectStore, type ObjectStore } from "./object-store.ts";
import { openRegularFiles, sampleFile } from "./sample-files.test-support.ts";

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

const staging = () => readdirSync(join(root, ".incoming"));

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
    expect(readdirSync(root).sort()).toEqual([".incoming"]);
  });

  test("leaves another upload's staged file alone when its key is taken", async () => {
    const key = mintFileKey();
    mkdirSync(join(root, ".incoming"), { recursive: true });
    writeFileSync(join(root, ".incoming", key), "another upload");
    await expect(store.put(key, chunksOf(sampleFile("png")))).rejects.toThrow();
    expect(readFileSync(join(root, ".incoming", key), "utf8")).toBe("another upload");
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

describe("the local object store's keys", () => {
  test("deletes a key from staging first and from its place, and a missing key is no failure", async () => {
    const placed = await store.put(mintFileKey(), chunksOf(sampleFile("avif")));
    await placed.place();
    const stagedOnly = await store.put(mintFileKey(), chunksOf(sampleFile("avif")));
    await store.delete(placed.key);
    await store.delete(stagedOnly.key);
    await store.delete(mintFileKey());
    expect(readdirSync(root).sort()).toEqual([".incoming"]);
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
    expect(store.url(key)).toBe(`/files/${key}`);
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
    for (const key of ["../escape", "", ".incoming", "a/b", `${mintFileKey()}/..`]) {
      await expect(store.put(key, chunksOf(sampleFile("png")))).rejects.toThrow();
      await expect(store.get(key)).rejects.toThrow();
      await expect(store.delete(key)).rejects.toThrow();
      expect(() => store.url(key)).toThrow();
    }
    expect(readdirSync(root)).toEqual([]);
  });
});
