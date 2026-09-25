// The upload route (Module 7 PLAN decisions 8, 11 and 13 to 15; ADR-0009). Nothing is awaited
// before the body is read but the store opening its staging file. The read token goes back the
// moment the last byte is read and admitted, before the fsync, so deletion's drain never waits on
// the disk. A 409 or 415 is JSON naming its stage and the field's sentence. A 413 is the guard's
// or Bun's and carries no sentence, and neither does a 400 or a 404.

import type { Context, Hono } from "hono";
import { FILE_NAME_HEADER } from "#shell/shell-dom.js";
import {
  type AdmittedType,
  admitClaims,
  FileAdmissionRefusal,
  SignatureCheck,
} from "../../platform/files/admission.ts";
import { capFileName, decodeFileName } from "../../platform/files/file-name.ts";
import {
  enqueuePendingFile,
  insertPendingFile,
  mintFileKey,
  type PendingFile,
} from "../../platform/files/ledger.ts";
import type { ObjectStore, StagedObject } from "../../platform/files/object-store.ts";
import {
  ADD_FILE_AGAIN_SENTENCE,
  NOT_ADMITTED_SENTENCES,
} from "../../platform/files/refusal-copy.ts";
import { FILE_UPLOAD_ROUTE } from "../../platform/files/upload-path.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import { activeFileFields, type FileFamily, getCapability } from "../../registry/index.ts";
import {
  type MutationCoordinator,
  MutationReservationCancelledError,
} from "../../runtime/concurrency/mutation-coordinator.ts";
import type {
  CapabilityIncarnation,
  ReadGateCoordinator,
  ReadTokenSet,
} from "../../runtime/concurrency/read-gates.ts";
import { NO_STORE } from "../http/cache-headers.ts";
import { guardStreamingRoute } from "../http/index.ts";
import { tryReadToken } from "./read-token.ts";

export interface FileUploadDeps {
  readonly databases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
  readonly objectStore: ObjectStore;
  /** The per-file cap the upload's guard counts against (7.1/01). */
  readonly maxFileBytes: number;
}

/** Deletion's drain closed the incarnation's gate while the body streamed. */
class IncarnationClosedError extends Error {
  override readonly name = "IncarnationClosedError";
}

/** An active file field of the incarnation's registry row: the families it takes, never none. */
interface UploadField {
  readonly name: string;
  readonly accepts: readonly [FileFamily, ...FileFamily[]];
}

interface UploadTarget {
  readonly incarnation: CapabilityIncarnation;
  readonly field: UploadField;
}

function findUploadField(
  database: PlatformDatabase["readonly"],
  incarnation: CapabilityIncarnation,
  name: string,
): UploadField | undefined {
  const row = getCapability(incarnation.capabilityId, database);
  if (row?.incarnation_id !== incarnation.incarnationId) return undefined;
  const field = activeFileFields(row.schema.fields).find((candidate) => candidate.name === name);
  const [first, ...rest] = field?.accepts ?? [];
  return first === undefined ? undefined : { name, accepts: [first, ...rest] };
}

function readUploadTarget(
  c: Context,
  readonly: PlatformDatabase["readonly"],
): UploadTarget | undefined {
  const incarnation = {
    capabilityId: c.req.param("id") ?? "",
    incarnationId: c.req.param("incarnation_id") ?? "",
  };
  const field = findUploadField(readonly, incarnation, c.req.param("field") ?? "");
  return field ? { incarnation, field } : undefined;
}

function refuse(c: Context, status: 409 | 415, refusal: string, message: string) {
  return c.json({ refusal, message }, status, NO_STORE);
}

function notAdmitted(c: Context, field: UploadField, error: FileAdmissionRefusal): Response {
  return refuse(c, 415, error.reason, NOT_ADMITTED_SENTENCES[field.accepts[0]]);
}

/** The name to keep and the family its extension names, or the refusal owed before a byte is read. */
function admitBeforeReading(
  c: Context,
  field: UploadField,
): { name: string; kind: FileFamily } | Response {
  const decoded = decodeFileName(c.req.header(FILE_NAME_HEADER) ?? "");
  if (decoded === undefined) return c.body(null, 400, NO_STORE);
  try {
    const kind = admitClaims(decoded, c.req.header("content-type"), field.accepts);
    return { name: capFileName(decoded), kind };
  } catch (error) {
    if (error instanceof FileAdmissionRefusal) return notAdmitted(c, field, error);
    throw error;
  }
}

/** The body, chunk by chunk, until it ends or `signal` stops it; a stop throws its reason. */
async function* readUntilAborted(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  const stop = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return;
      yield value;
    }
  } finally {
    signal.removeEventListener("abort", stop);
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Each chunk passes the signature check before it is written. The end of the body settles the
 * check and calls `read`, while the store has yet to fsync what it wrote.
 */
async function* admittedChunks(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
  check: SignatureCheck,
  read: () => void,
): AsyncGenerator<Uint8Array> {
  if (body) {
    for await (const chunk of readUntilAborted(body, signal)) {
      check.inspect(chunk);
      yield chunk;
    }
  }
  check.finish();
  read();
}

/** Stream into staging holding the read token, and give it back once the whole body is in. */
async function stageUnderReadToken(
  c: Context,
  deps: FileUploadDeps,
  kind: FileFamily,
  tokens: ReadTokenSet,
): Promise<{ staged: StagedObject; admitted: AdmittedType }> {
  const check = new SignatureCheck(kind);
  const signal = AbortSignal.any([c.req.raw.signal, tokens.signal]);
  let read = false;
  const release = () => {
    read = true;
    deps.readGates.release(tokens);
  };
  try {
    const chunks = admittedChunks(c.req.raw.body, signal, check, release);
    const staged = await deps.objectStore.put(mintFileKey(), chunks);
    return { staged, admitted: check.finish() };
  } catch (error) {
    // Read before the release below, which aborts the same signal to mark the tokens spent.
    if (!read && tokens.signal.aborted) throw new IncarnationClosedError("The incarnation closed.");
    throw error;
  } finally {
    deps.readGates.release(tokens);
  }
}

type AdmittedFile = PendingFile & AdmittedType;

/** The one platform write: the incarnation and field still take this file, and the row goes in. */
function recordPendingFile(database: PlatformDatabase["readwrite"], file: AdmittedFile): boolean {
  return database.transaction(() => {
    const incarnation = { capabilityId: file.capability_id, incarnationId: file.incarnation_id };
    const field = findUploadField(database, incarnation, file.field);
    if (!field?.accepts.includes(file.kind)) return false;
    insertPendingFile(database, file);
    return true;
  })();
}

/** The key an upload minted and never handed back goes to cleanup. */
function abandon(deps: FileUploadDeps, key: string): Promise<boolean> {
  return deps.mutationCoordinator.withPlatformWrite(() =>
    enqueuePendingFile(deps.databases.readwrite, key),
  );
}

async function recordAndPlace(
  c: Context,
  deps: FileUploadDeps,
  file: AdmittedFile,
  staged: StagedObject,
): Promise<Response> {
  const recorded = await deps.mutationCoordinator.withPlatformWrite(
    () => recordPendingFile(deps.databases.readwrite, file),
    { signal: c.req.raw.signal },
  );
  if (!recorded) return c.body(null, 404, NO_STORE);
  let placed: boolean;
  try {
    placed = await staged.place();
  } catch (error) {
    await abandon(deps, file.key);
    throw error;
  }
  if (!placed) {
    await abandon(deps, file.key);
    return refuse(c, 409, "gone", ADD_FILE_AGAIN_SENTENCE);
  }
  if (c.req.raw.signal.aborted) {
    await abandon(deps, file.key);
    return c.body(null, 400, NO_STORE);
  }
  const { key, name, kind, mime, size } = file;
  return c.json({ key, url: deps.objectStore.url(key), name, kind, mime, size }, 201, NO_STORE);
}

/**
 * The client left and this error is only how the route saw it go. The socket's own errors and an
 * overflow are the streaming guard's to answer, so they escape.
 */
function isHangUp(c: Context, error: unknown): boolean {
  const { signal } = c.req.raw;
  if (!signal.aborted) return false;
  return error === signal.reason || error instanceof MutationReservationCancelledError;
}

/** The answer an upload that stopped short earns, or undefined for a failure it does not own. */
function stoppedShort(c: Context, field: UploadField, error: unknown) {
  // Nobody reads this one; answering it keeps a hang-up from being logged as a failure.
  if (isHangUp(c, error)) return c.body(null, 400, NO_STORE);
  if (error instanceof FileAdmissionRefusal) return notAdmitted(c, field, error);
  if (error instanceof IncarnationClosedError) return c.body(null, 404, NO_STORE);
  return undefined;
}

async function upload(c: Context, deps: FileUploadDeps): Promise<Response> {
  const target = readUploadTarget(c, deps.databases.readonly);
  if (!target) return c.body(null, 404, NO_STORE);
  const claims = admitBeforeReading(c, target.field);
  if (claims instanceof Response) return claims;
  const tokens = tryReadToken(deps.readGates, deps.databases.readonly, target.incarnation);
  if (!tokens) return c.body(null, 404, NO_STORE);

  let staged: StagedObject | undefined;
  try {
    const stage = await stageUnderReadToken(c, deps, claims.kind, tokens);
    staged = stage.staged;
    const { capabilityId, incarnationId } = target.incarnation;
    const file: AdmittedFile = {
      key: staged.key,
      capability_id: capabilityId,
      incarnation_id: incarnationId,
      field: target.field.name,
      ...stage.admitted,
      size: staged.size,
      name: claims.name,
    };
    return await recordAndPlace(c, deps, file, staged);
  } catch (error) {
    const answer = stoppedShort(c, target.field, error);
    if (answer) return answer;
    throw error;
  } finally {
    await staged?.discard();
  }
}

export function registerFileUploadRoute(app: Hono, deps: FileUploadDeps): void {
  app.post(FILE_UPLOAD_ROUTE, guardStreamingRoute(deps.maxFileBytes), (c) => upload(c, deps));
}
