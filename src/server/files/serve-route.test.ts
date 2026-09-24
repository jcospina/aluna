import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedFileLedgerRow } from "../../platform/files/ledger.test-support.ts";
import { FILE_LEDGER_TABLE, type FileLedgerRow, mintFileKey } from "../../platform/files/ledger.ts";
import { openRegularFiles, sampleFile } from "../../platform/files/sample-files.test-support.ts";
import { UNKNOWN_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import { createReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import { answeredReference, PHOTOS, until, useFileRoutes } from "./file-routes.test-support.ts";

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

function expectAbsent(response: Response): void {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("/files/:key", () => {
  test("serves a pending key with its verified type, inert and cached for a year", async () => {
    const bytes = sampleFile("png", 70_000);
    const key = await uploaded(bytes, "tide pool.jpg");
    const response = await files.app().request(`/files/${key}`);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": `inline; filename="tide pool.jpg"; filename*=UTF-8''tide%20pool.jpg`,
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  test("serves an owned key the same way", async () => {
    const key = await uploaded();
    setState(key, "owned", "a-record");
    const response = await files.app().request(`/files/${key}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  test("answers a key awaiting cleanup, or whose bytes are gone, with a 404 nobody caches", async () => {
    const enqueued = await uploaded();
    setState(enqueued, "cleanup_enqueued", null);
    expectAbsent(await files.app().request(`/files/${enqueued}`));

    const vanished = await uploaded();
    rmSync(join(files.root(), vanished));
    expectAbsent(await files.app().request(`/files/${vanished}`));
  });

  test("answers an unknown or malformed key without asking the store", async () => {
    const opened = spyOn(files.store(), "get");
    for (const path of [
      `/files/${mintFileKey()}`,
      "/files/not-a-key",
      `/files/${mintFileKey().toUpperCase()}`,
      "/files/..%2Fdata%2Fomni-crud.db",
      "/files/.incoming",
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
    expectAbsent(await files.app().request(`/files/${orphan}`));

    const key = await uploaded();
    const readGates = createReadGateCoordinator();
    readGates.synchronizeCatalog([PHOTOS]);
    const closing = await readGates.closeAndDrain(PHOTOS);
    expectAbsent(await files.app({ readGates }).request(`/files/${key}`));
    readGates.reopen(closing);
  });

  test("gives the read token back before the body streams", async () => {
    const key = await uploaded(sampleFile("gif89", 3_000_000));
    const readGates = createReadGateCoordinator();
    const response = await files.app({ readGates }).request(`/files/${key}`);
    expect(readGates.snapshot().every((gate) => gate.readerCount === 0)).toBe(true);
    const drained = await readGates.closeAndDrain(PHOTOS, { timeoutMs: 100 });
    expect((await response.arrayBuffer()).byteLength).toBe(3_000_000);
    readGates.reopen(drained);
  });

  test("answers a HEAD with a GET's fields and holds no descriptor after it", async () => {
    const key = await uploaded();
    const before = openRegularFiles();
    const response = await files.app().request(`/files/${key}`, { method: "HEAD" });
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

/** The app behind a real socket for `body`, stopped however it ends. */
async function overSocket(app: ReturnType<typeof files.app>, body: (url: URL) => Promise<void>) {
  const server = Bun.serve({ port: 0, fetch: (request) => app.fetch(request) });
  try {
    await body(server.url);
  } finally {
    server.stop(true);
  }
}

describe("/files/:key on the wire", () => {
  test("sends the whole file", async () => {
    const bytes = sampleFile("jpeg", 3_000_000);
    const key = await uploaded(bytes);
    await overSocket(files.app(), async (url) => {
      const response = await fetch(new URL(`/files/${key}`, url));
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    });
  });

  // A canary: when Bun starts cutting the connection instead, the size check stops being the
  // only guard, and the note in `readBody` can go. Bun prints the body's error itself, natively.
  test("cannot tell a client its file shrank mid-download, as Bun ends an errored body cleanly", async () => {
    const size = 50_000_000;
    const key = await uploaded(sampleFile("jpeg", size));
    await overSocket(files.app(), async (url) => {
      const reader = (await fetch(new URL(`/files/${key}`, url))).body?.getReader();
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
    const key = await uploaded(sampleFile("jpeg", 3_000_000));
    const store = files.store();
    const get = store.get.bind(store);
    spyOn(store, "get").mockImplementation(async (requested) => {
      await Bun.sleep(40);
      return get(requested);
    });
    const before = openRegularFiles();
    await overSocket(files.app(), async (url) => {
      const clients = await Promise.all(
        Array.from({ length: 20 }, async () => {
          const client = await Bun.connect({
            hostname: url.hostname,
            port: Number(url.port),
            socket: { data() {} },
          });
          client.write(`GET /files/${key} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
          return client;
        }),
      );
      await Bun.sleep(10);
      for (const client of clients) client.terminate();
      await until(() => openRegularFiles() <= before);
      await Bun.sleep(100);
      expect(openRegularFiles()).toBe(before);
    });
  });
});

describe("/files/:key and what its row says", () => {
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

  test("serves nothing whose type admission could never have recorded", async () => {
    const opened = spyOn(files.store(), "get");
    for (const mime of ["text/html", "image/svg+xml", "image/jpeg\r\nx-injected: 1"]) {
      expectAbsent(await files.app().request(`/files/${seedRow(mime, sampleFile("svg"))}`));
    }
    expect(opened).not.toHaveBeenCalled();
  });

  test("serves nothing whose bytes no longer match the size admission recorded", async () => {
    const key = await uploaded(sampleFile("png", 70_000));
    truncateSync(join(files.root(), key), 1000);
    const before = openRegularFiles();
    expectAbsent(await files.app().request(`/files/${key}`));
    expect(openRegularFiles()).toBe(before);
  });

  test("never follows a link planted where a key's bytes should be", async () => {
    const key = await uploaded();
    const outside = join(files.root(), "..", "outside.jpg");
    writeFileSync(outside, sampleFile("jpeg", 5000));
    rmSync(join(files.root(), key));
    symlinkSync(outside, join(files.root(), key));
    expectAbsent(await files.app().request(`/files/${key}`));
  });

  test("serves a script behind a JPEG signature as an inert picture", async () => {
    const script = new TextEncoder().encode("<html><script>alert(document.cookie)</script></html>");
    const polyglot = new Uint8Array([...sampleFile("jpeg", 16), ...script]);
    const key = await uploaded(polyglot, "trick.jpg");
    const response = await files.app().request(`/files/${key}`);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "image/jpeg",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    });
  });
});
