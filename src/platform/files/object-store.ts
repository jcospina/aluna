// The object store (ARCH §6.3, ADR-0009; Module 7 PLAN decisions 13 and 23): where an admitted
// file's bytes live, under opaque keys. S3-shaped, so a cloud adapter (R2, S3, Garage) can take
// the same interface: it would stage locally the same way and upload at `place`.
//
// The local adapter writes staging through a `Bun.file` sink on a descriptor it owns, because
// `Bun.write` never settles on an erroring stream and cannot fsync. A read opens its own descriptor
// at once rather than handing out `Bun.file(path)`, which opens only as the response is sent: after
// the serve route has given back the read token that kept deletion away.

import { constants } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileUrl } from "./file-url.ts";
import { isFileKey } from "./ledger.ts";
import { resolveObjectStoreRoot, STAGING_DIRECTORY } from "./object-store-root.ts";

/** Bytes written to staging and made durable there, waiting on the ledger row that owns them. */
export interface StagedObject {
  readonly key: string;
  readonly size: number;
  /**
   * Moves the bytes to where `get` finds them, durably; only once their ledger row has committed.
   * False when they are no longer in staging: a cleanup took them first.
   */
  place(): Promise<boolean>;
  /** Removes the staged bytes, if they are still there. */
  discard(): Promise<void>;
}

/** An object opened for reading. Its body closes the descriptor when it ends or is cancelled. */
export interface OpenedObject {
  readonly size: number;
  readonly body: ReadableStream<Uint8Array>;
  /** For a body that will never be read. Safe to call at any time, and more than once. */
  close(): Promise<void>;
}

export interface ObjectStore {
  /** Streams `chunks` into staging under `key`. A failure removes what it wrote and rethrows. */
  put(key: string, chunks: AsyncIterable<Uint8Array>): Promise<StagedObject>;
  /** Opens the object now, or answers null when no regular file is there. */
  get(key: string): Promise<OpenedObject | null>;
  /** Removes the object, staged copy first, so a racing `place` cannot leave bytes behind. */
  delete(key: string): Promise<void>;
  /** Always the same-origin address: the page's CSP and the HTML filter refuse any other. */
  url(key: string): string;
  /** Empties staging. Boot calls it, because nothing can be streaming then. */
  clearStaging(): Promise<void>;
}

const READ_CHUNK_BYTES = 256 * 1024;

/** A link planted under the root is not an object, and a pipe must not hold the open. */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** What an open says of a path that holds no object: nothing, a link, or a socket (macOS, Linux). */
const NOT_AN_OBJECT = new Set(["ENOENT", "ELOOP", "EOPNOTSUPP", "ENXIO"]);

type FileHandle = Awaited<ReturnType<typeof open>>;

function requireKey(key: string): string {
  if (!isFileKey(key)) throw new Error(`"${key}" is not an object-store key.`);
  return key;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function fill(handle: FileHandle, chunks: AsyncIterable<Uint8Array>): Promise<number> {
  const sink = Bun.file(handle.fd).writer();
  let size = 0;
  try {
    for await (const chunk of chunks) {
      size += chunk.byteLength;
      sink.write(chunk);
      await sink.flush();
    }
  } catch (error) {
    await Promise.resolve()
      .then(() => sink.end())
      .catch(() => undefined);
    throw error;
  }
  await sink.end();
  await handle.sync();
  return size;
}

/** An existing file at `path` fails the open and is left alone: it is another upload's. */
async function writeStaged(path: string, chunks: AsyncIterable<Uint8Array>): Promise<number> {
  const handle = await open(path, "wx");
  let written = false;
  try {
    const size = await fill(handle, chunks);
    written = true;
    return size;
  } finally {
    await handle.close();
    if (!written) await rm(path, { force: true });
  }
}

/**
 * A read descriptor that closes once, and only after the read in flight settles: Bun 1.3.12's
 * `FileHandle.close` resolves without closing a descriptor a read is still using, so every client
 * that hung up mid-download would leak one.
 */
function readDescriptor(handle: FileHandle) {
  let reading: Promise<unknown> = Promise.resolve();
  let closing: Promise<void> | undefined;
  return {
    read(buffer: Uint8Array, position: number) {
      const read = handle.read(buffer, 0, buffer.byteLength, position);
      reading = read.catch(() => undefined);
      return read;
    },
    close: (): Promise<void> => {
      closing ??= reading.then(() => handle.close());
      return closing;
    },
    closed: () => closing !== undefined,
  };
}

/**
 * Reads `size` bytes one pull at a time, and closes the descriptor however the body ends. A file
 * that ends early errors the body, though Bun 1.3.12 still ends that response on the wire as if
 * whole; the serve route checks the size before it answers, which is as far as it can.
 */
function readBody(
  descriptor: ReturnType<typeof readDescriptor>,
  size: number,
): ReadableStream<Uint8Array> {
  let position = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (descriptor.closed()) return;
        if (position >= size) {
          await descriptor.close();
          return controller.close();
        }
        const buffer = new Uint8Array(Math.min(READ_CHUNK_BYTES, size - position));
        let bytesRead = 0;
        try {
          ({ bytesRead } = await descriptor.read(buffer, position));
          if (bytesRead === 0)
            throw new Error(`The object ended after ${position} of ${size} bytes.`);
        } catch (error) {
          await descriptor.close();
          throw error;
        }
        if (descriptor.closed()) return;
        position += bytesRead;
        controller.enqueue(buffer.subarray(0, bytesRead));
      },
      cancel: () => descriptor.close(),
    },
    { highWaterMark: 0 },
  );
}

async function openObject(path: string): Promise<OpenedObject | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, READ_FLAGS);
  } catch (error) {
    if (NOT_AN_OBJECT.has(errorCode(error) ?? "")) return null;
    throw error;
  }
  const descriptor = readDescriptor(handle);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await descriptor.close();
      return null;
    }
    return { size: stats.size, body: readBody(descriptor, stats.size), close: descriptor.close };
  } catch (error) {
    await descriptor.close();
    throw error;
  }
}

/** The local adapter over `root`, the configured one by default. Nothing touches the disk until used. */
export function createLocalObjectStore(root: string = resolveObjectStoreRoot()): ObjectStore {
  const staging = join(root, STAGING_DIRECTORY);
  const stagedPath = (key: string) => join(staging, requireKey(key));
  const objectPath = (key: string) => join(root, requireKey(key));

  const staged = (key: string, size: number): StagedObject => ({
    key,
    size,
    place: async () => {
      try {
        await rename(stagedPath(key), objectPath(key));
      } catch (error) {
        if (errorCode(error) === "ENOENT") return false;
        throw error;
      }
      await syncDirectory(root);
      return true;
    },
    discard: () => rm(stagedPath(key), { force: true }),
  });

  return {
    async put(key, chunks) {
      const path = stagedPath(key);
      await mkdir(staging, { recursive: true });
      return staged(key, await writeStaged(path, chunks));
    },
    get: async (key) => openObject(objectPath(key)),
    async delete(key) {
      await rm(stagedPath(key), { force: true });
      await rm(objectPath(key), { force: true });
    },
    url: (key) => fileUrl(requireKey(key)),
    async clearStaging() {
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
    },
  };
}
