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
} from "../pipeline/jobs/restoration.ts";

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
  // A malformed multipart body is the form equivalent of malformed JSON: it contains no
  // usable prompt. Hono's parser throws on a missing/invalid boundary; letting that escape
  // would turn an admission refusal into a 500 that HTMX does not swap, leaving the person
  // with no visible answer. Normalize parser failures to the same empty submission shape
  // every other unusable body takes.
  const body = await c.req.parseBody().catch(() => ({}));
  return submissionFromRecord(body);
}

/**
 * Whether a prompt contains something a person can actually see or hear as content.
 *
 * `String.trim` removes ordinary surrounding whitespace but deliberately leaves Unicode
 * format/default-ignorable characters and most controls. A body made only from those bytes
 * looks empty while still reaching the resolver and spending a provider call. Remove them
 * only for this admission predicate: meaningful prompts retain their original text, including
 * internal joiners used by emoji and scripts.
 */
export function hasMeaningfulPromptContent(prompt: string): boolean {
  return prompt.replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, "").length > 0;
}

/**
 * Read the typed prompt from the request body, dispatching on `content-type`: JSON,
 * form (urlencoded or multipart), or — as a fallback — the raw request text. Always
 * returns a trimmed string, empty when no usable `prompt` is present.
 */
export async function readPromptSubmission(c: Context): Promise<PromptSubmission> {
  // Media types are case-insensitive. Compare the normalized type itself rather than using
  // substring checks, which could misclassify an unrelated type whose parameter happened to
  // contain one of these strings.
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
