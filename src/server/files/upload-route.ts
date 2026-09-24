// The upload route (Module 7 PLAN decisions 8, 11 and 13 to 15; ADR-0009). Nothing is awaited
// before the body is read but the store opening its staging file. The read token goes back the
// moment the last byte is read and admitted, before the fsync, so deletion's drain never waits on
// the disk. Every refusal the route writes is JSON naming its stage and the field's sentence; a 413
// can also come from Bun, with no body, when the declared length is over the cap.

import type { Context, Hono } from "hono";
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
  oversizeSentence,
} from "../../platform/files/refusal-copy.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import {
  type CapabilityRow,
  getCapability,
  isFileFieldType,
  type SpecField,
} from "../../registry/index.ts";
import {
  type MutationCoordinator,
  MutationReservationCancelledError,
} from "../../runtime/concurrency/mutation-coordinator.ts";
import type {
  CapabilityIncarnation,
  ReadGateCoordinator,
  ReadTokenSet,
} from "../../runtime/concurrency/read-gates.ts";
import { BodyTooLargeError, guardStreamingRoute, isSendersDoing } from "../http/index.ts";
import { tryReadToken } from "./read-token.ts";

export interface FileRouteDeps {
  readonly databases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
  readonly objectStore: ObjectStore;
  /** The per-file cap the upload's guard counts against (7.1/01). */
  readonly maxFileBytes: number;
}

const FILE_UPLOAD_ROUTE = "/capability/:id/:incarnation_id/upload/:field";

/** The header an upload names its file in, percent-encoded: a header cannot carry `日本.jpg`. */
export const FILE_NAME_HEADER = "x-file-name";

export function fileUploadPath(capabilityId: string, incarnationId: string, field: string): string {
  const segments = [capabilityId, incarnationId, "upload", field].map(encodeURIComponent);
  return `/capability/${segments.join("/")}`;
}

const NO_STORE = { "cache-control": "no-store" } as const;

/** Deletion's drain closed the incarnation's gate while the body streamed. */
class IncarnationClosedError extends Error {
  override readonly name = "IncarnationClosedError";
}

interface UploadTarget {
  readonly incarnation: CapabilityIncarnation;
  readonly field: SpecField;
}

function uploadField(row: CapabilityRow, name: string): SpecField | undefined {
  return row.schema.fields.find(
    (field) => field.name === name && field.lifecycle === "active" && isFileFieldType(field.type),
  );
}

function readUploadTarget(
  c: Context,
  readonly: PlatformDatabase["readonly"],
): UploadTarget | undefined {
  const incarnation = {
    capabilityId: c.req.param("id") ?? "",
    incarnationId: c.req.param("incarnation_id") ?? "",
  };
  const row = getCapability(incarnation.capabilityId, readonly);
  if (!row || row.incarnation_id !== incarnation.incarnationId) return undefined;
  const field = uploadField(row, c.req.param("field") ?? "");
  return field ? { incarnation, field } : undefined;
}

function refuse(c: Context, status: 409 | 413 | 415, refusal: string, message: string) {
  return c.json({ refusal, message }, status, NO_STORE);
}

function notAdmitted(c: Context, field: SpecField, error: FileAdmissionRefusal): Response {
  const [family = "image"] = field.accepts ?? [];
  return refuse(c, 415, error.reason, NOT_ADMITTED_SENTENCES[family]);
}

/** The name to keep and the family its extension names, or the refusal owed before a byte is read. */
function admitBeforeReading(
  c: Context,
  field: SpecField,
): { name: string; kind: string } | Response {
  const decoded = decodeFileName(c.req.header(FILE_NAME_HEADER) ?? "");
  if (decoded === undefined) return c.body(null, 400, NO_STORE);
  try {
    const kind = admitClaims(decoded, c.req.header("content-type"), field.accepts ?? []);
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
  deps: FileRouteDeps,
  kind: string,
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

/** The one platform write: the incarnation and field still take this file, and the row goes in. */
function recordPendingFile(database: PlatformDatabase["readwrite"], file: PendingFile): boolean {
  return database.transaction(() => {
    const row = getCapability(file.capability_id, database);
    const field = row?.incarnation_id === file.incarnation_id && uploadField(row, file.field);
    if (!(field && (field.accepts as readonly string[] | undefined)?.includes(file.kind))) {
      return false;
    }
    insertPendingFile(database, file);
    return true;
  })();
}

/** The key an upload minted and never handed back goes to cleanup. */
function abandon(deps: FileRouteDeps, key: string): Promise<boolean> {
  return deps.mutationCoordinator.withPlatformWrite(() =>
    enqueuePendingFile(deps.databases.readwrite, key),
  );
}

async function recordAndPlace(
  c: Context,
  deps: FileRouteDeps,
  file: PendingFile,
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

/** The client left, and this error is only how its leaving surfaced. */
function isHangUp(c: Context, error: unknown): boolean {
  const { signal } = c.req.raw;
  if (!signal.aborted) return false;
  return (
    error === signal.reason ||
    error instanceof MutationReservationCancelledError ||
    isSendersDoing(error)
  );
}

/** The answer an upload that stopped short earns, or undefined for a failure that is ours. */
function stoppedShort(c: Context, deps: FileRouteDeps, field: SpecField, error: unknown) {
  // Nobody reads this one; answering it keeps a hang-up from being logged as a failure.
  if (isHangUp(c, error)) return c.body(null, 400, NO_STORE);
  if (error instanceof FileAdmissionRefusal) return notAdmitted(c, field, error);
  if (error instanceof BodyTooLargeError) {
    return refuse(c, 413, "too_large", oversizeSentence(deps.maxFileBytes));
  }
  if (error instanceof IncarnationClosedError) return c.body(null, 404, NO_STORE);
  return undefined;
}

async function upload(c: Context, deps: FileRouteDeps): Promise<Response> {
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
    const file: PendingFile = {
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
    const answer = stoppedShort(c, deps, target.field, error);
    if (answer) return answer;
    throw error;
  } finally {
    await staged?.discard();
  }
}

export function registerFileUploadRoute(app: Hono, deps: FileRouteDeps): void {
  app.post(FILE_UPLOAD_ROUTE, guardStreamingRoute(deps.maxFileBytes), (c) => upload(c, deps));
}
