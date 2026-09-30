import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { until } from "../../../platform/async.test-support.ts";
import {
  openRegularFiles,
  sampleFile,
} from "../../../platform/files/admission/sample-files.test-support.ts";
import { fileUrl } from "../../../platform/files/file-url.ts";
import { seedFileLedgerRow } from "../../../platform/files/store/ledger.test-support.ts";
import { IMMUTABLE, NO_STORE } from "../../http/cache-headers.ts";
import { overSocket, PHOTOS, useFileRoutes } from "../file-routes.test-support.ts";
import { MAX_SPAN_BYTES, strongEtag } from "./byte-range.ts";
import { INERT_PLAYER_POLICY } from "./serve-route.ts";

const files = useFileRoutes();

/** A video's row with `bytes` in place, as an upload to a field that takes video leaves it. */
function seedVideo(bytes: Uint8Array): string {
  const key = seedFileLedgerRow(files.conns().readwrite, {
    capabilityId: PHOTOS.capabilityId,
    incarnationId: PHOTOS.incarnationId,
    field: "photo",
    kind: "video",
    mime: "video/mp4",
    size: bytes.byteLength,
    name: "first steps.mp4",
  });
  mkdirSync(files.root(), { recursive: true });
  writeFileSync(join(files.root(), key), bytes);
  return key;
}

const VIDEO = sampleFile("isom", 200_000);

/** How a `<video>` asks: an element load, and the range it wants. */
function ask(key: string, headers: Record<string, string> = {}, method = "GET") {
  const loading = { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "video" };
  return files.app().request(fileUrl(key), { method, headers: { ...loading, ...headers } });
}

/**
 * Descriptors held once the app has answered one request for `key`: the database's own files open
 * on the first read, and a count taken before them would blame the route.
 */
async function settledDescriptors(key: string): Promise<number> {
  await ask(key, {}, "HEAD");
  return openRegularFiles();
}

async function bodyOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

describe("/files/:key and a Range", () => {
  test("says every answer takes byte ranges, and validates the file by its key", async () => {
    const key = seedVideo(VIDEO);
    const response = await ask(key);
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toBe(strongEtag(key));
    expect(response.headers.get("content-security-policy")).toBe(INERT_PLAYER_POLICY);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(await bodyOf(response)).toEqual(VIDEO);
  });

  test("answers one range with the bytes it names, an inclusive Content-Range and a year's cache", async () => {
    const key = seedVideo(VIDEO);
    for (const [range, start, end] of [
      ["bytes=0-1", 0, 1],
      ["bytes=1000-65535", 1000, 65_535],
      ["bytes=150000-", 150_000, 199_999],
      ["bytes=-4096", 195_904, 199_999],
      ["bytes=199999-400000", 199_999, 199_999],
    ] as const) {
      const response = await ask(key, { range });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end}/200000`);
      expect(Object.fromEntries(response.headers)).toMatchObject({
        ...IMMUTABLE,
        "accept-ranges": "bytes",
        etag: strongEtag(key),
        "content-type": "video/mp4",
        "content-security-policy": INERT_PLAYER_POLICY,
      });
      expect(await bodyOf(response)).toEqual(VIDEO.subarray(start, end + 1));
    }
  });

  test("answers a range past the end with a 416 nobody caches, and holds nothing after it", async () => {
    const key = seedVideo(VIDEO);
    const before = await settledDescriptors(key);
    for (const range of ["bytes=200000-", "bytes=500000-600000", "bytes=-0"]) {
      const response = await ask(key, { range });
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */200000");
      expect(response.headers.get("cache-control")).toBe(NO_STORE["cache-control"]);
      expect(response.headers.get("vary")?.toLowerCase()).toContain("sec-fetch-dest");
      expect(await response.text()).toBe("");
    }
    expect(openRegularFiles()).toBe(before);
  });

  test("tells a range past the end of a file it can't serve only that the file is absent", async () => {
    const gone = seedVideo(VIDEO);
    rmSync(join(files.root(), gone));
    expect((await ask(gone, { range: "bytes=900000-" })).status).toBe(404);
    const shrunk = seedVideo(VIDEO);
    truncateSync(join(files.root(), shrunk), 1000);
    expect((await ask(shrunk, { range: "bytes=900000-" })).status).toBe(404);
  });

  test("answers a list of ranges, or one it can't read, with the whole file", async () => {
    const key = seedVideo(VIDEO);
    for (const range of ["bytes=0-10,20-30", "bytes=0-10, 900000-", "bytes=10-5", "pages=1-2"]) {
      const response = await ask(key, { range });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-range")).toBeNull();
      expect(await bodyOf(response)).toEqual(VIDEO);
    }
  });

  test("honours a range only while If-Range names this file's strong validator", async () => {
    const key = seedVideo(VIDEO);
    const held = await ask(key, { range: "bytes=10-19", "if-range": strongEtag(key) });
    expect(held.status).toBe(206);
    expect(await bodyOf(held)).toEqual(VIDEO.subarray(10, 20));
    for (const ifRange of [`W/${strongEtag(key)}`, '"another"', "Mon, 28 Sep 2026 10:00:00 GMT"]) {
      const whole = await ask(key, { range: "bytes=10-19", "if-range": ifRange });
      expect(whole.status).toBe(200);
      expect(await bodyOf(whole)).toEqual(VIDEO);
    }
  });

  test("answers a HEAD with the whole file's fields, whatever Range it names", async () => {
    const key = seedVideo(VIDEO);
    const before = await settledDescriptors(key);
    for (const range of ["bytes=100-199", "bytes=900000-", undefined]) {
      const response = await ask(key, range ? { range } : {}, "HEAD");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-range")).toBeNull();
      expect(response.headers.get("content-length")).toBe(String(VIDEO.byteLength));
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("etag")).toBe(strongEtag(key));
      expect(await response.text()).toBe("");
    }
    expect(openRegularFiles()).toBe(before);
  });

  test("answers as absent when a span's read fails, rather than sending part of it as whole", async () => {
    const key = seedVideo(VIDEO);
    spyOn(files.store(), "get").mockImplementation(async () => ({
      size: VIDEO.byteLength,
      body: new ReadableStream<Uint8Array>({
        pull: (controller) => controller.error(new Error("disk")),
      }),
      close: async () => {},
    }));
    const response = await ask(key, { range: "bytes=0-99" });
    expect(response.status).toBe(404);
  });

  test("serves no range of bytes that no longer match their row", async () => {
    const key = seedVideo(VIDEO);
    const before = await settledDescriptors(key);
    truncateSync(join(files.root(), key), 150_000);
    const response = await ask(key, { range: "bytes=0-99" });
    expect(response.status).toBe(404);
    expect(openRegularFiles()).toBe(before);
  });
});

describe("/files/:key and who asks for a range", () => {
  test("gives a page's own script no range of a file either", async () => {
    const key = seedVideo(VIDEO);
    for (const dest of ["empty", ""]) {
      const headers = { range: "bytes=0-99", "sec-fetch-mode": "cors", "sec-fetch-dest": dest };
      expect((await ask(key, headers)).status).toBe(404);
    }
  });

  // A browser that holds a player's copy asks again conditionally when a script's request misses
  // it on Vary; a 304 there would hand that copy to the script, so the refusal comes first.
  test("refuses a script's conditional request for a file before it could answer unchanged", async () => {
    const key = seedVideo(VIDEO);
    for (const range of [undefined, "bytes=0-99"]) {
      const headers = {
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "if-none-match": strongEtag(key),
        ...(range ? { range, "if-range": strongEtag(key) } : {}),
      };
      expect((await ask(key, headers)).status).toBe(404);
    }
  });

  // The Fetch standard's own names: a browser's page for a video opened in a tab of its own asks
  // for it in cors mode, as a video, which no script's fetch can claim to be.
  test("serves a player that asks in cors mode, as a browser's own video page does", async () => {
    const key = seedVideo(VIDEO);
    for (const mode of ["cors", "same-origin"]) {
      for (const dest of ["video", "audio"]) {
        const headers = { range: "bytes=0-99", "sec-fetch-mode": mode, "sec-fetch-dest": dest };
        const response = await ask(key, headers);
        expect(response.status).toBe(206);
        expect(response.headers.get("content-security-policy")).toBe(INERT_PLAYER_POLICY);
        // A cached copy a player was given must never answer a script's cors-mode fetch.
        expect(response.headers.get("vary")?.toLowerCase()).toBe("sec-fetch-mode, sec-fetch-dest");
      }
    }
  });
});

describe("/files/:key's ranges on the wire", () => {
  const LONG = sampleFile("isom", 40_000_000);

  test("sends the span a range names, and nothing more", async () => {
    const key = seedVideo(LONG);
    await overSocket(files.app(), async (url) => {
      const response = await fetch(new URL(fileUrl(key), url), {
        headers: { range: "bytes=1000000-3999999" },
      });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 1000000-3999999/40000000");
      expect(await bodyOf(response)).toEqual(LONG.subarray(1_000_000, 4_000_000));
    });
  });

  /** The head of the answer to `range`, as it arrives on a raw socket. */
  async function rawHead(url: URL, key: string, range: string): Promise<string> {
    let received = "";
    const { promise, resolve } = Promise.withResolvers<string>();
    const socket = await Bun.connect({
      hostname: url.hostname,
      port: Number(url.port),
      socket: {
        data(_socket, data) {
          received += new TextDecoder().decode(data);
          const end = received.indexOf("\r\n\r\n");
          if (end >= 0) resolve(received.slice(0, end).toLowerCase());
        },
      },
    });
    socket.write(`GET ${fileUrl(key)} HTTP/1.1\r\nHost: localhost\r\nRange: ${range}\r\n\r\n`);
    const head = await promise;
    socket.terminate();
    return head;
  }

  test("sends each span with its length, and at most a capped span, which a player asks past", async () => {
    const key = seedVideo(LONG);
    await overSocket(files.app(), async (url) => {
      const probe = await rawHead(url, key, "bytes=0-1");
      expect(probe).toContain("content-length: 2");
      expect(probe).not.toContain("transfer-encoding");
      const open = await rawHead(url, key, "bytes=0-");
      expect(open).toContain(`content-range: bytes 0-${MAX_SPAN_BYTES - 1}/40000000`);
      expect(open).toContain(`content-length: ${MAX_SPAN_BYTES}`);
      const response = await fetch(new URL(fileUrl(key), url), {
        headers: { range: "bytes=10000000-" },
      });
      expect(await bodyOf(response)).toEqual(
        LONG.subarray(10_000_000, 10_000_000 + MAX_SPAN_BYTES),
      );
    });
  });

  /** Read `key` over the socket, unlinking its bytes once the first chunk is in. */
  async function readUnlinkingPartway(url: URL, key: string, range?: string) {
    const headers: Record<string, string> = range ? { range } : {};
    const reader = (await fetch(new URL(fileUrl(key), url), { headers })).body?.getReader();
    const chunks: Uint8Array[] = [];
    let chunk = await reader?.read();
    rmSync(join(files.root(), key));
    while (chunk && !chunk.done) {
      chunks.push(chunk.value);
      chunk = await reader?.read();
    }
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
  }

  test("keeps streaming a long video whose bytes are unlinked partway through", async () => {
    const whole = seedVideo(LONG);
    const ranged = seedVideo(LONG);
    await overSocket(files.app(), async (url) => {
      expect(await readUnlinkingPartway(url, whole)).toEqual(LONG);
      expect(await readUnlinkingPartway(url, ranged, "bytes=5000000-")).toEqual(
        LONG.subarray(5_000_000, 5_000_000 + MAX_SPAN_BYTES),
      );
    });
  });

  test("gives its descriptor back when a client hangs up in the middle of a range", async () => {
    const key = seedVideo(LONG);
    const before = await settledDescriptors(key);
    await overSocket(files.app(), async (url) => {
      const leaving = new AbortController();
      const response = await fetch(new URL(fileUrl(key), url), {
        headers: { range: "bytes=100-" },
        signal: leaving.signal,
      });
      expect(response.status).toBe(206);
      await response.body?.getReader().read();
      leaving.abort();
      await until(() => openRegularFiles() <= before);
    });
  });
});
