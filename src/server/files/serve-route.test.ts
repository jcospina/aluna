import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { until } from "../../platform/async.test-support.ts";
import { inlineContentDisposition } from "../../platform/files/file-name.ts";
import { FILE_URL_PREFIX, fileUrl } from "../../platform/files/file-url.ts";
import { seedFileLedgerRow } from "../../platform/files/ledger.test-support.ts";
import { FILE_LEDGER_TABLE, type FileLedgerRow, mintFileKey } from "../../platform/files/ledger.ts";
import type { OpenedObject } from "../../platform/files/object-store.ts";
import { STAGING_DIRECTORY } from "../../platform/files/object-store-root.ts";
import { openRegularFiles, sampleFile } from "../../platform/files/sample-files.test-support.ts";
import { UNKNOWN_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import { createReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import { IMMUTABLE, NO_STORE } from "../http/cache-headers.ts";
import { answeredReference, PHOTOS, useFileRoutes } from "./file-routes.test-support.ts";
import { INERT_IMAGE_POLICY } from "./serve-route.ts";

const files = useFileRoutes();

/** Upload `bytes` through the route and hand back the key it answered with. */
async function uploaded(bytes = sampleFile("jpeg", 5000), name = "harbour.jpg"): Promise<string> {
  const response = await files.upload(bytes, { name });
  expect(response.status).toBe(201);
  return (await answeredReference(response)).key;
}

function setState(key: string, state: FileLedgerRow["state"], recordId: string | null) {
  files
    .conns()
    .readwrite.query(`UPDATE ${FILE_LEDGER_TABLE} SET state = ?, record_id = ? WHERE key = ?`)
    .run(state, recordId, key);
}

/** A row with `bytes` in place, written directly rather than uploaded. */
function seedRow(mime: string, bytes: Uint8Array): string {
  const key = seedFileLedgerRow(files.conns().readwrite, {
    capabilityId: PHOTOS.capabilityId,
    incarnationId: PHOTOS.incarnationId,
    field: "photo",
    mime,
    size: bytes.byteLength,
  });
  mkdirSync(files.root(), { recursive: true });
  writeFileSync(join(files.root(), key), bytes);
  return key;
}

function expectAbsent(response: Response): void {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe(NO_STORE["cache-control"]);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

/** Served as a picture that can do nothing opened as a document, and never sniffed as another type. */
function expectInert(response: Response, mime: string): void {
  expect(response.headers.get("content-security-policy")).toBe(INERT_IMAGE_POLICY);
  expect(response.headers.get("content-type")).toBe(mime);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("/files/:key", () => {
  test("serves a pending key with its verified type, inert and cached for a year", async () => {
    const bytes = sampleFile("png", 70_000);
    const key = await uploaded(bytes, "tide pool.jpg");
    const response = await files.app().request(fileUrl(key));
    expect(response.status).toBe(200);
    expectInert(response, "image/png");
    expect(Object.fromEntries(response.headers)).toMatchObject({
      ...IMMUTABLE,
      "content-disposition": inlineContentDisposition("tide pool.jpg"),
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  test("serves an owned key the same way", async () => {
    const key = await uploaded();
    setState(key, "owned", "a-record");
    const response = await files.app().request(fileUrl(key));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE["cache-control"]);
  });

  test("answers a key awaiting cleanup, or whose bytes are gone, with a 404 nobody caches", async () => {
    const enqueued = await uploaded();
    setState(enqueued, "cleanup_enqueued", null);
    expectAbsent(await files.app().request(fileUrl(enqueued)));

    const vanished = await uploaded();
    rmSync(join(files.root(), vanished));
    expectAbsent(await files.app().request(fileUrl(vanished)));
  });

  test("answers an unknown or malformed key without asking the store", async () => {
    const opened = spyOn(files.store(), "get");
    for (const path of [
      fileUrl(mintFileKey()),
      `${FILE_URL_PREFIX}not-a-key`,
      fileUrl(mintFileKey().toUpperCase()),
      `${FILE_URL_PREFIX}..%2Fdata%2Fomni-crud.db`,
      `${FILE_URL_PREFIX}${STAGING_DIRECTORY}`,
    ]) {
      expectAbsent(await files.app().request(path));
    }
    expect(opened).not.toHaveBeenCalled();
  });

  test("answers a key whose incarnation is no longer active, or is closing, with a 404", async () => {
    const orphan = seedFileLedgerRow(files.conns().readwrite, {
      capabilityId: PHOTOS.capabilityId,
      incarnationId: UNKNOWN_INCARNATION_ID,
      field: "photo",
    });
    expectAbsent(await files.app().request(fileUrl(orphan)));

    const key = await uploaded();
    const readGates = createReadGateCoordinator();
    readGates.synchronizeCatalog([PHOTOS]);
    const closing = await readGates.closeAndDrain(PHOTOS);
    expectAbsent(await files.app({ readGates }).request(fileUrl(key)));
    readGates.reopen(closing);
  });

  test("gives the read token back before the body streams", async () => {
    const key = await uploaded(sampleFile("gif89", 3_000_000));
    const readGates = createReadGateCoordinator();
    const response = await files.app({ readGates }).request(fileUrl(key));
    expect(readGates.snapshot().every((gate) => gate.readerCount === 0)).toBe(true);
    const drained = await readGates.closeAndDrain(PHOTOS, { timeoutMs: 100 });
    expect((await response.arrayBuffer()).byteLength).toBe(3_000_000);
    readGates.reopen(drained);
  });

  test("answers a HEAD with a GET's fields and holds no descriptor after it", async () => {
    const key = await uploaded();
    const before = openRegularFiles();
    const response = await files.app().request(fileUrl(key), { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("5000");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("");
    expect(openRegularFiles()).toBe(before);
  });

  test("gives its descriptor back when a client hangs up mid-download", async () => {
    const key = await uploaded(sampleFile("webp", 20_000_000));
    const app = files.app();
    const server = Bun.serve({ port: 0, fetch: (request) => app.fetch(request) });
    try {
      const before = openRegularFiles();
      const leaving = new AbortController();
      const response = await fetch(`${server.url}files/${key}`, { signal: leaving.signal });
      const reader = response.body?.getReader();
      await reader?.read();
      leaving.abort();
      await until(() => openRegularFiles() <= before);
    } finally {
      server.stop(true);
    }
  });
});

/** The app behind a real socket for `body`, which sees each request's abort signal. */
async function overSocket(
  app: ReturnType<typeof files.app>,
  body: (url: URL, signals: readonly AbortSignal[]) => Promise<void>,
) {
  const signals: AbortSignal[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      signals.push(request.signal);
      return app.fetch(request);
    },
  });
  try {
    await body(server.url, signals);
  } finally {
    server.stop(true);
  }
}

describe("/files/:key on the wire", () => {
  test("sends the whole file", async () => {
    const bytes = sampleFile("jpeg", 3_000_000);
    const key = await uploaded(bytes);
    await overSocket(files.app(), async (url) => {
      const response = await fetch(new URL(fileUrl(key), url));
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    });
  });

  // A canary: when Bun starts cutting the connection instead, the size check stops being the
  // only guard, and the note in `readBody` can go. Bun prints the body's error itself, natively.
  test("cannot tell a client its file shrank mid-download, as Bun ends an errored body cleanly", async () => {
    const size = 50_000_000;
    const key = seedRow("image/jpeg", new Uint8Array(size));
    await overSocket(files.app(), async (url) => {
      const reader = (await fetch(new URL(fileUrl(key), url))).body?.getReader();
      let received = (await reader?.read())?.value?.byteLength ?? 0;
      truncateSync(join(files.root(), key), 1_000_000);
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        received += chunk.value.byteLength;
      }
      expect(received).toBeLessThan(size);
    });
  });

  test("opens nothing that stays open for clients that left before the answer", async () => {
    const clientCount = 20;
    const key = await uploaded(sampleFile("jpeg", 3_000_000));
    const store = files.store();
    const get = store.get.bind(store);
    const opens: Promise<OpenedObject | null>[] = [];
    let letOpen = () => {};
    const held = new Promise<void>((resolve) => {
      letOpen = resolve;
    });
    spyOn(store, "get").mockImplementation((requested) => {
      const opened = held.then(() => get(requested));
      opens.push(opened);
      return opened;
    });
    const before = openRegularFiles();
    await overSocket(files.app(), async (url, signals) => {
      const clients = await Promise.all(
        Array.from({ length: clientCount }, async () => {
          const client = await Bun.connect({
            hostname: url.hostname,
            port: Number(url.port),
            socket: { data() {} },
          });
          client.write(`GET ${fileUrl(key)} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
          return client;
        }),
      );
      await until(() => opens.length === clientCount);
      for (const client of clients) client.terminate();
      await until(() => signals.every((signal) => signal.aborted));
      letOpen();
      const opened = await Promise.allSettled(opens);
      expect(opened.filter((open) => open.status === "fulfilled" && open.value)).toHaveLength(
        clientCount,
      );
      await until(() => openRegularFiles() <= before);
      expect(openRegularFiles()).toBe(before);
    });
  });
});

describe("/files/:key and what its row says", () => {
  test("serves nothing whose type admission could never have recorded", async () => {
    const opened = spyOn(files.store(), "get");
    for (const mime of ["text/html", "image/svg+xml", "image/jpeg\r\nx-injected: 1"]) {
      expectAbsent(await files.app().request(fileUrl(seedRow(mime, sampleFile("svg")))));
    }
    expect(opened).not.toHaveBeenCalled();
  });

  test("serves nothing whose bytes no longer match the size admission recorded", async () => {
    const key = await uploaded(sampleFile("png", 70_000));
    truncateSync(join(files.root(), key), 1000);
    const before = openRegularFiles();
    expectAbsent(await files.app().request(fileUrl(key)));
    expect(openRegularFiles()).toBe(before);
  });

  test("never follows a link planted where a key's bytes should be", async () => {
    const key = await uploaded();
    const outside = join(files.root(), "..", "outside.jpg");
    writeFileSync(outside, sampleFile("jpeg", 5000));
    rmSync(join(files.root(), key));
    symlinkSync(outside, join(files.root(), key));
    expectAbsent(await files.app().request(fileUrl(key)));
  });

  test("serves a script behind a JPEG signature as an inert picture", async () => {
    const script = new TextEncoder().encode("<html><script>alert(document.cookie)</script></html>");
    const polyglot = new Uint8Array([...sampleFile("jpeg", 16), ...script]);
    const key = await uploaded(polyglot, "trick.jpg");
    expectInert(await files.app().request(fileUrl(key)), "image/jpeg");
  });

  test("gives a page's own script nothing to swap, while an element's load still gets the picture", async () => {
    const script = new TextEncoder().encode('<div x-data x-init="alert(1)"></div>');
    const key = await uploaded(new Uint8Array([...sampleFile("jpeg", 16), ...script]), "trick.jpg");
    // The Fetch standard's own mode names, which htmx's XHR sends, not a value this repo chose.
    for (const mode of ["cors", "same-origin"]) {
      for (const method of ["GET", "HEAD"]) {
        const headers = { "sec-fetch-mode": mode, "hx-request": "true" };
        expectAbsent(await files.app().request(fileUrl(key), { method, headers }));
      }
    }
    const opened = { headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } };
    expectInert(await files.app().request(fileUrl(key), opened), "image/jpeg");
    const loaded = { headers: { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" } };
    const picture = await files.app().request(fileUrl(key), loaded);
    expectInert(picture, "image/jpeg");
    expect(picture.headers.get("vary")?.toLowerCase()).toContain("sec-fetch-mode");
  });
});
