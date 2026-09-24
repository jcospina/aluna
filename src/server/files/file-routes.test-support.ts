// The photos fixture behind the file-route suites: a scratch database with it installed, an object
// store under the same scratch directory, and the request an upload control sends. Not a test
// file itself, so bun never runs it.

import { afterEach, beforeEach } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FILE_LEDGER_TABLE, type FileLedgerRow } from "../../platform/files/ledger.ts";
import { createLocalObjectStore, type ObjectStore } from "../../platform/files/object-store.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import {
  install,
  photosRow,
  setupRouterTest,
  teardownRouterTest,
} from "../../runtime/router/dispatch/router.test-support.ts";
import { type AppDeps, createApp } from "../app.ts";
import { FILE_NAME_HEADER, fileUploadPath } from "./index.ts";

const photos = photosRow();
export const PHOTOS = { capabilityId: photos.id, incarnationId: photos.incarnation_id } as const;
export const PHOTO_UPLOAD_PATH = fileUploadPath(PHOTOS.capabilityId, PHOTOS.incarnationId, "photo");

/** What an admitted upload answers with: the file reference, and the address that serves it. */
export interface AnsweredReference {
  readonly key: string;
  readonly url: string;
  readonly name: string;
  readonly kind: string;
  readonly mime: string;
  readonly size: number;
}

export async function answeredReference(response: Response): Promise<AnsweredReference> {
  return (await response.json()) as AnsweredReference;
}

export interface UploadOptions {
  /** Sent percent-encoded, as the control sends it; `rawName` is sent exactly as given. */
  readonly name?: string;
  readonly rawName?: string;
  readonly type?: string;
  readonly site?: string;
  readonly signal?: AbortSignal;
}

/** The request the upload control makes: the bytes as the body, the name in its header. */
export function uploadInit(
  body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>,
  options: UploadOptions = {},
): RequestInit {
  const headers: Record<string, string> = {
    [FILE_NAME_HEADER]: options.rawName ?? encodeURIComponent(options.name ?? "harbour.jpg"),
    "sec-fetch-site": options.site ?? "same-origin",
  };
  if (options.type !== undefined) headers["content-type"] = options.type;
  return { method: "POST", headers, body, signal: options.signal, duplex: "half" } as RequestInit;
}

/** A scratch database with the photos fixture installed and a store beside it, fresh per case. */
export function useFileRoutes() {
  const scratch: { dir?: string; conns?: PlatformDatabase; store?: ObjectStore } = {};
  beforeEach(() => {
    const env = setupRouterTest();
    install(env.conns, photosRow());
    Object.assign(scratch, {
      dir: env.dir,
      conns: env.conns,
      store: createLocalObjectStore(join(env.dir, "storage")),
    });
  });
  afterEach(() => {
    if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
  });

  const conns = (): PlatformDatabase => {
    if (!scratch.conns) throw new Error("the file routes are used outside a test");
    return scratch.conns;
  };
  const store = (): ObjectStore => {
    if (!scratch.store) throw new Error("the file routes are used outside a test");
    return scratch.store;
  };
  const root = () => join(scratch.dir ?? "", "storage");
  const entries = (path: string) => (existsSync(path) ? readdirSync(path).sort() : []);
  const app = (deps: AppDeps = {}) =>
    createApp({ capabilityRouter: { databases: conns() }, objectStore: store(), ...deps });

  return {
    conns,
    store,
    root,
    app,
    upload: (
      body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>,
      options: UploadOptions = {},
      deps: AppDeps = {},
    ) => app(deps).request(PHOTO_UPLOAD_PATH, uploadInit(body, options)),
    /** What sits in `.incoming/`. */
    staged: () => entries(join(root(), ".incoming")),
    /** What sits in place, beside `.incoming/`. */
    stored: () => entries(root()).filter((entry) => entry !== ".incoming"),
    ledgerRows: () =>
      conns().readonly.query(`SELECT * FROM ${FILE_LEDGER_TABLE}`).all() as FileLedgerRow[],
  };
}

/** Resolves once `condition` holds, polling; fails the case after `timeoutMs`. */
export async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("the awaited condition never held");
    await Bun.sleep(5);
  }
}

/** A body the test pushes by hand, so a case can hold an upload mid-stream. */
export function heldBody() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start: (control) => {
      controller = control;
    },
    cancel: () => {
      cancelled = true;
    },
  });
  return {
    stream,
    push: (chunk: Uint8Array) => controller?.enqueue(chunk),
    end: () => controller?.close(),
    cancelled: () => cancelled,
  };
}
