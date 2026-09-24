import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { readFileLedgerRow } from "../../platform/files/ledger.ts";
import type { ObjectStore } from "../../platform/files/object-store.ts";
import { ADD_FILE_AGAIN_SENTENCE } from "../../platform/files/refusal-copy.ts";
import { sampleFile } from "../../platform/files/sample-files.test-support.ts";
import { REGISTRY_TABLE } from "../../platform/persistence/table-names.ts";
import { SECOND_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import * as registryStore from "../../registry/store/store.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../runtime/concurrency/mutation-coordinator.ts";
import { createReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import {
  heldBody,
  PHOTO_UPLOAD_PATH,
  PHOTOS,
  until,
  uploadInit,
  useFileRoutes,
} from "./file-routes.test-support.ts";

const files = useFileRoutes();

type FileHandle = Awaited<ReturnType<typeof open>>;

function readersOnPhotos(readGates: ReturnType<typeof createReadGateCoordinator>): number {
  return (
    readGates.snapshot().find((gate) => gate.incarnationId === PHOTOS.incarnationId)?.readerCount ??
    0
  );
}

/** A coordinator a build is holding, and the way to let it go. */
async function runningBuild() {
  const mutationCoordinator = createMutationCoordinator();
  const lease = await mutationCoordinator.acquireBuild(mutationCoordinator.reserveBuild());
  return { mutationCoordinator, finish: () => mutationCoordinator.release(lease) };
}

const queuedPlatformWrites = (coordinator: MutationCoordinator) =>
  coordinator.snapshot().queuedTickets.filter((ticket) => ticket.kind === "platform").length;

describe("an upload while a build runs", () => {
  test("is not refused, reads its whole body, and waits for its row holding no read token", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const readGates = createReadGateCoordinator();
    const bytes = sampleFile("jpeg", 300_000);
    const answer = files.upload(bytes, {}, { mutationCoordinator, readGates });

    await until(() => queuedPlatformWrites(mutationCoordinator) === 1);
    const [staged] = files.staged();
    expect(statSync(join(files.root(), ".incoming", staged ?? "")).size).toBe(bytes.byteLength);
    expect(files.ledgerRows()).toEqual([]);
    expect(readersOnPhotos(readGates)).toBe(0);

    finish();
    const response = await answer;
    expect(response.status).toBe(201);
    expect(files.ledgerRows()).toEqual([expect.objectContaining({ state: "pending" })]);
  });

  test("whose incarnation is gone when its write comes round is refused and leaves nothing", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const answer = files.upload(sampleFile("png"), { name: "a.png" }, { mutationCoordinator });
    await until(() => queuedPlatformWrites(mutationCoordinator) === 1);
    files
      .conns()
      .readwrite.query(`UPDATE ${REGISTRY_TABLE} SET incarnation_id = ? WHERE id = ?`)
      .run(SECOND_INCARNATION_ID, PHOTOS.capabilityId);

    finish();
    const response = await answer;
    expect(response.status).toBe(404);
    expect(files.staged()).toEqual([]);
    expect(files.stored()).toEqual([]);
    expect(files.ledgerRows()).toEqual([]);
  });

  test("that is abandoned while it waits gives up its place and leaves nothing", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const leaving = new AbortController();
    const answer = files.upload(
      sampleFile("gif89"),
      { name: "a.gif", signal: leaving.signal },
      { mutationCoordinator },
    );
    await until(() => queuedPlatformWrites(mutationCoordinator) === 1);
    const errors = await logged(async () => {
      leaving.abort();
      expect((await answer).status).toBe(400);
    });
    expect(errors).toEqual([]);
    expect(queuedPlatformWrites(mutationCoordinator)).toBe(0);
    finish();
    expect(files.staged()).toEqual([]);
    expect(files.ledgerRows()).toEqual([]);
  });
});

/** Runs `body` with `console.error` captured, and hands back what it logged. */
async function logged(body: () => Promise<void>): Promise<unknown[][]> {
  const errors = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await body();
    return errors.mock.calls;
  } finally {
    errors.mockRestore();
  }
}

/** Records `event` each time any file handle fsyncs, until `restore`. */
async function spyOnFsync(event: () => string) {
  const probe = await open(import.meta.path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const sync = prototype.sync;
  const events: string[] = [];
  const spy = spyOn(prototype, "sync").mockImplementation(function (this: FileHandle) {
    events.push(event());
    return sync.call(this);
  });
  return { events, restore: () => spy.mockRestore() };
}

describe("the order an upload lands in", () => {
  test("admits and fsyncs without its token, writes its row in one platform write, then renames", async () => {
    const readGates = createReadGateCoordinator();
    const fsyncs = await spyOnFsync(
      () => `fsync, ${readersOnPhotos(readGates)} readers, ${files.ledgerRows().length} rows`,
    );
    const { events } = fsyncs;
    const inner = files.store();
    const store: ObjectStore = {
      ...inner,
      async put(key, chunks) {
        const staged = await inner.put(key, chunks);
        events.push(`staged with ${files.ledgerRows().length} rows`);
        return {
          ...staged,
          async place() {
            const row = readFileLedgerRow(files.conns().readonly, key);
            events.push(`placing a committed ${row?.state} row`);
            return staged.place();
          },
        };
      },
    };
    const mutationCoordinator = createMutationCoordinator();
    const write = mutationCoordinator.withPlatformWrite.bind(mutationCoordinator);
    mutationCoordinator.withPlatformWrite = (body, options) =>
      write((lease) => {
        const [key = ""] = files.staged();
        events.push(`writing, staged ${existsSync(join(files.root(), ".incoming", key))}`);
        return body(lease);
      }, options);

    try {
      const response = await files.upload(
        sampleFile("avif"),
        { name: "a.avif" },
        { mutationCoordinator, readGates, objectStore: store },
      );
      expect(response.status).toBe(201);
    } finally {
      fsyncs.restore();
    }
    expect(events).toEqual([
      "fsync, 0 readers, 0 rows",
      "staged with 0 rows",
      "writing, staged true",
      "placing a committed pending row",
      "fsync, 0 readers, 1 rows",
    ]);
  });

  test("whose row went in but whose bytes a cleanup took first asks for the file again", async () => {
    const inner = files.store();
    const store: ObjectStore = {
      ...inner,
      async put(key, chunks) {
        const staged = await inner.put(key, chunks);
        return {
          ...staged,
          async place() {
            await inner.delete(key);
            return staged.place();
          },
        };
      },
    };
    const response = await files.upload(
      sampleFile("png"),
      { name: "a.png" },
      { objectStore: store },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ refusal: "gone", message: ADD_FILE_AGAIN_SENTENCE });
    expect(files.ledgerRows()).toEqual([expect.objectContaining({ state: "cleanup_enqueued" })]);
    expect(files.staged()).toEqual([]);
    expect(files.stored()).toEqual([]);
  });

  test("is refused by its one write when the field stopped taking files while it streamed", async () => {
    const real = registryStore.getCapability;
    const hidden = spyOn(registryStore, "getCapability").mockImplementation((id, database) => {
      const row = real(id, database);
      if (!row || database !== files.conns().readwrite) return row;
      const fields = row.schema.fields.map((field) =>
        field.name === "photo" ? { ...field, lifecycle: "inactive" as const } : field,
      );
      return { ...row, schema: { ...row.schema, fields } };
    });
    try {
      const response = await files.upload(sampleFile("jpeg"));
      expect(response.status).toBe(404);
    } finally {
      hidden.mockRestore();
    }
    expect(files.staged()).toEqual([]);
    expect(files.stored()).toEqual([]);
    expect(files.ledgerRows()).toEqual([]);
  });
});

describe("deletion's drain", () => {
  test("cancels an upload still streaming, which leaves nothing and lets the drain finish", async () => {
    const readGates = createReadGateCoordinator();
    const body = heldBody();
    const answer = files.app({ readGates }).request(PHOTO_UPLOAD_PATH, uploadInit(body.stream));
    body.push(sampleFile("jpeg", 8192));
    await until(() => readersOnPhotos(readGates) === 1 && files.staged().length === 1);

    const drained = readGates.closeAndDrain(PHOTOS, { timeoutMs: 2000 });
    expect((await answer).status).toBe(404);
    await drained;
    expect(body.cancelled()).toBe(true);
    expect(files.staged()).toEqual([]);
    expect(files.ledgerRows()).toEqual([]);
  });
});

/** The app behind a real socket, remembering each request's abort signal. */
function serveOnSocket(fetch: (request: Request) => Response | Promise<Response>) {
  const signals: AbortSignal[] = [];
  const answered: number[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      signals.push(request.signal);
      const response = await fetch(request);
      answered.push(response.status);
      return response;
    },
  });
  const connect = () =>
    Bun.connect({
      hostname: server.url.hostname,
      port: Number(server.url.port),
      socket: { data() {} },
    });
  return { server, signals, answered, connect };
}

function chunkedHead(): string {
  return (
    `POST ${PHOTO_UPLOAD_PATH} HTTP/1.1\r\nHost: localhost\r\nx-file-name: harbour.jpg\r\n` +
    "Sec-Fetch-Site: same-origin\r\nTransfer-Encoding: chunked\r\n\r\n"
  );
}

function chunk(bytes: Uint8Array): Uint8Array {
  const size = new TextEncoder().encode(`${bytes.byteLength.toString(16)}\r\n`);
  return Buffer.concat([size, bytes, new TextEncoder().encode("\r\n")]);
}

describe("a client that hangs up", () => {
  test("mid-body leaves nothing in staging and no row, and logs nothing", async () => {
    const readGates = createReadGateCoordinator();
    const socket = serveOnSocket((request) => files.app({ readGates }).fetch(request));
    try {
      const errors = await logged(async () => {
        const client = await socket.connect();
        client.write(chunkedHead());
        client.write(chunk(sampleFile("jpeg", 4096)));
        await until(() => files.staged().length === 1);
        client.end();
        await until(() => socket.answered.length === 1);
      });
      expect(errors).toEqual([]);
      expect(socket.answered).toEqual([400]);
      expect(files.staged()).toEqual([]);
      expect(files.ledgerRows()).toEqual([]);
      expect(readersOnPhotos(readGates)).toBe(0);
    } finally {
      socket.server.stop(true);
    }
  });

  test("after its row commits leaves the row for cleanup instead of answering nobody", async () => {
    const inner = files.store();
    let hangUp = async () => {};
    const store: ObjectStore = {
      ...inner,
      async put(key, chunks) {
        const staged = await inner.put(key, chunks);
        return {
          ...staged,
          async place() {
            await hangUp();
            return staged.place();
          },
        };
      },
    };
    const socket = serveOnSocket((request) => files.app({ objectStore: store }).fetch(request));
    try {
      const client = await socket.connect();
      hangUp = async () => {
        client.end();
        await until(() => socket.signals[0]?.aborted === true);
      };
      client.write(chunkedHead());
      client.write(chunk(sampleFile("jpeg", 4096)));
      client.write("0\r\n\r\n");

      await until(() => socket.answered.length === 1);
      const [row] = files.ledgerRows();
      expect(row).toMatchObject({ state: "cleanup_enqueued", record_id: null });
      expect(files.stored()).toEqual([row?.key ?? "no row"]);
      expect(files.staged()).toEqual([]);
    } finally {
      socket.server.stop(true);
    }
  });

  test("while its bytes fail to move is still a failure, logged, not a hang-up", async () => {
    const leaving = new AbortController();
    const inner = files.store();
    const store: ObjectStore = {
      ...inner,
      async put(key, chunks) {
        const staged = await inner.put(key, chunks);
        return {
          ...staged,
          async place() {
            leaving.abort();
            throw Object.assign(new Error("the disk failed"), { code: "EIO" });
          },
        };
      },
    };
    const errors = await logged(async () => {
      const response = await files.upload(
        sampleFile("jpeg"),
        { signal: leaving.signal },
        { objectStore: store },
      );
      expect(response.status).toBe(500);
    });
    expect(errors.map(([message]) => message)).toEqual(["omni-crud request failed:"]);
    expect(files.ledgerRows()).toEqual([expect.objectContaining({ state: "cleanup_enqueued" })]);
    expect(files.staged()).toEqual([]);
  });
});
