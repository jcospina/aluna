// Reading the user's typed prompt off an inbound request, content-type agnostic.
//
// The prompt bar can POST as JSON, as a urlencoded/multipart form, or as raw text;
// this normalizes all three to a single trimmed string so the route handler never
// branches on transport.

import type { Context } from "hono";

import {
  RESTORATION_CAPABILITY_ID_FIELD,
  RESTORATION_INCARNATION_ID_FIELD,
  type RestorationIdentityInput,
} from "../../pipeline/jobs/restoration.ts";

export interface PromptSubmission {
  readonly prompt: string;
  readonly restoration: RestorationIdentityInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function submissionFromRecord(body: Record<string, unknown>): PromptSubmission {
  return {
    prompt: stringField(body, "prompt") ?? "",
    restoration: {
      capabilityId: stringField(body, RESTORATION_CAPABILITY_ID_FIELD),
      incarnationId: stringField(body, RESTORATION_INCARNATION_ID_FIELD),
    },
  };
}

async function readPromptFromJson(c: Context): Promise<PromptSubmission> {
  const body: unknown = await c.req.json().catch(() => ({}));
  return submissionFromRecord(isRecord(body) ? body : {});
}

async function readPromptFromForm(c: Context): Promise<PromptSubmission> {
  // A malformed multipart body contains no usable prompt. Hono's parser throws on a bad boundary,
  // and letting that escape turns an admission refusal into a 500 htmx does not swap.
  const body = await c.req.parseBody().catch(() => ({}));
  return submissionFromRecord(body);
}

/**
 * Whether a prompt contains something a person can see or hear. `String.trim` leaves Unicode
 * format and control characters, so a body of those alone still spends a call. Stripped only here.
 */
export function hasMeaningfulPromptContent(prompt: string): boolean {
  return prompt.replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, "").length > 0;
}

/**
 * Whether this submission came from somewhere else. A prompt spends provider tokens and can commit
 * a capability to this desk, and its body is simple enough that a form on another site posts it
 * with no preflight at all — so a page the user merely visited could build on their behalf. A
 * browser sends `Sec-Fetch-Site` on every request, so absence means a client that is not one.
 */
export function isCrossSitePrompt(c: Context): boolean {
  const site = c.req.header("sec-fetch-site");
  return site !== undefined && site !== "same-origin" && site !== "none";
}

/**
 * Read the typed prompt from the request body, dispatching on `content-type`: JSON, form, or the
 * raw request text. Always a trimmed string, empty when no usable `prompt` is present.
 */
export async function readPromptSubmission(c: Context): Promise<PromptSubmission> {
  // Media types are case-insensitive. Compare the normalized type itself: a substring check could
  // misclassify an unrelated type whose parameter happened to contain one of these strings.
  const contentType = c.req.header("content-type") ?? "";
  const mediaType = (contentType.split(";", 1)[0] ?? "").trim().toLowerCase();
  if (mediaType === "application/json") {
    return readPromptFromJson(c);
  }
  if (mediaType === "application/x-www-form-urlencoded" || mediaType === "multipart/form-data") {
    return readPromptFromForm(c);
  }
  return { prompt: (await c.req.text()).trim(), restoration: {} };
}

/** Prompt-only compatibility reader for non-job callers and focused parser tests. */
export async function readPrompt(c: Context): Promise<string> {
  return (await readPromptSubmission(c)).prompt;
}
