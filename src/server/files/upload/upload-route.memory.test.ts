// The upload streams (Module 7 PLAN decision 8): a body far larger than anything the process holds
// goes to disk as it arrives. Over a real socket, because a body handed to the app in-process
// never meets Bun's socket buffering, which is where an unread body piles up.
//
// Every reading is taken as the client hands over its next chunk. The gap between the bytes sent
// and the bytes in staging is sampled at every chunk, so no timing gap hides a read-ahead, and
// staging may never run ahead of what was sent, or a preallocated file would hide one. After a
// collection at a few set points, the byte buffers JavaScriptCore still holds catch a body read
// in step but kept. RSS catches a copy held in native memory, under a loose ceiling only: the
// allocator keeps freed pages, so it grows by the garbage of a streaming route.

import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FILE_NAME_HEADER } from "#shell/core/shell-dom.js";
import { SAMPLE_HEADS } from "../../../platform/files/admission/sample-files.test-support.ts";
import { resolveMaxFileBytes } from "../../../platform/files/file-cap.ts";
import { STAGING_DIRECTORY } from "../../../platform/files/store/object-store-root.ts";
import { probeBody } from "../../http/writing-route-guard.test-support.ts";
import {
  answeredReference,
  PHOTO_UPLOAD_PATH,
  useFileRoutes,
} from "../file-routes.test-support.ts";

const files = useFileRoutes();

const FILE_BYTES = 400 * 1024 * 1024;
/** Socket and sink buffers between the client and the disk; a held body is the whole file. */
const MAX_IN_FLIGHT_BYTES = 32 * 1024 * 1024;
const MAX_HELD_BUFFER_BYTES = FILE_BYTES / 8;
const MAX_RSS_GROWTH_BYTES = FILE_BYTES / 2;
const MEMORY_CHECKPOINTS = [FILE_BYTES / 4, FILE_BYTES / 2, (FILE_BYTES * 3) / 4];

function stagedBytes(): number {
  const staging = join(files.root(), STAGING_DIRECTORY);
  if (!existsSync(staging)) return 0;
  return readdirSync(staging).reduce((sum, entry) => sum + statSync(join(staging, entry)).size, 0);
}

function collectedMemory(): { readonly buffers: number; readonly rss: number } {
  Bun.gc(true);
  return { buffers: heapStats().extraMemorySize, rss: process.memoryUsage().rss };
}

test("a 400 MB upload streams to disk without the process ever holding its body", async () => {
  const app = files.app();
  const server = Bun.serve({
    port: 0,
    maxRequestBodySize: resolveMaxFileBytes({}),
    fetch: (request) => app.fetch(request),
  });
  try {
    const probe = probeBody(FILE_BYTES, SAMPLE_HEADS.jpeg);
    const source = probe.stream.getReader();
    const checkpoints = [...MEMORY_CHECKPOINTS];
    const baseline = collectedMemory();
    let widestGap = 0;
    let stagedAhead = 0;
    let heldGrowth = 0;
    let rssGrowth = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          const sent = probe.pulledBytes();
          const gap = sent - stagedBytes();
          widestGap = Math.max(widestGap, gap);
          stagedAhead = Math.max(stagedAhead, -gap);
          if (sent >= (checkpoints[0] ?? Infinity)) {
            checkpoints.shift();
            const memory = collectedMemory();
            heldGrowth = Math.max(heldGrowth, memory.buffers - baseline.buffers);
            rssGrowth = Math.max(rssGrowth, memory.rss - baseline.rss);
          }
          const { done, value } = await source.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
      },
      { highWaterMark: 0 },
    );

    const response = await fetch(new URL(PHOTO_UPLOAD_PATH, server.url), {
      method: "POST",
      body,
      headers: { [FILE_NAME_HEADER]: "long exposure.jpg", "sec-fetch-site": "same-origin" },
      duplex: "half",
    } as RequestInit);

    expect(response.status).toBe(201);
    const { key, size } = await answeredReference(response);
    expect(size).toBe(FILE_BYTES);
    expect(statSync(join(files.root(), key)).size).toBe(FILE_BYTES);
    expect(checkpoints).toEqual([]);
    expect(stagedAhead).toBe(0);
    expect(widestGap).toBeLessThan(MAX_IN_FLIGHT_BYTES);
    expect(heldGrowth).toBeLessThan(MAX_HELD_BUFFER_BYTES);
    expect(rssGrowth).toBeLessThan(MAX_RSS_GROWTH_BYTES);
  } finally {
    server.stop(true);
  }
}, 60_000);
