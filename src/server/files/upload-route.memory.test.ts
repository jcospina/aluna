// The upload streams (Module 7 PLAN decision 8): a body far larger than anything the process holds
// goes to disk as it arrives. Over a real socket, because a body handed to the app in-process
// never meets Bun's socket buffering, which is where an unread body piles up.

import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { resolveMaxFileBytes } from "../../platform/files/file-cap.ts";
import { SAMPLE_HEADS } from "../../platform/files/sample-files.test-support.ts";
import { answeredReference, PHOTO_UPLOAD_PATH, useFileRoutes } from "./file-routes.test-support.ts";
import { FILE_NAME_HEADER } from "./index.ts";

const files = useFileRoutes();

const FILE_BYTES = 400 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;

/** A JPEG of `total` bytes made only as the sender reads it, so the sender holds one chunk. */
function jpegProducedAsRead(total: number): ReadableStream<Uint8Array> {
  const filler = new Uint8Array(CHUNK_BYTES).fill(0x5a);
  const head = new Uint8Array(CHUNK_BYTES).fill(0x5a);
  head.set(SAMPLE_HEADS.jpeg);
  let sent = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= total) return controller.close();
        controller.enqueue(sent === 0 ? head : filler);
        sent += CHUNK_BYTES;
      },
    },
    { highWaterMark: 0 },
  );
}

test("a 400 MB upload streams to disk without the process ever holding its body", async () => {
  const app = files.app();
  const server = Bun.serve({
    port: 0,
    maxRequestBodySize: resolveMaxFileBytes({}),
    fetch: (request) => app.fetch(request),
  });
  try {
    Bun.gc(true);
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 5);
    const response = await fetch(new URL(PHOTO_UPLOAD_PATH, server.url), {
      method: "POST",
      body: jpegProducedAsRead(FILE_BYTES),
      headers: { [FILE_NAME_HEADER]: "long exposure.jpg", "sec-fetch-site": "same-origin" },
      duplex: "half",
    } as RequestInit);
    clearInterval(sampler);

    expect(response.status).toBe(201);
    const { key, size } = await answeredReference(response);
    expect(size).toBe(FILE_BYTES);
    expect(statSync(join(files.root(), key)).size).toBe(FILE_BYTES);
    expect(peak - baseline).toBeLessThan(FILE_BYTES / 4);
  } finally {
    server.stop(true);
  }
}, 60_000);
