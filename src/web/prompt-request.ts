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
} from "../pipeline/restoration.ts";

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
  const body = await c.req.parseBody();
  return submissionFromRecord(body);
}

/**
 * Read the typed prompt from the request body, dispatching on `content-type`: JSON,
 * form (urlencoded or multipart), or — as a fallback — the raw request text. Always
 * returns a trimmed string, empty when no usable `prompt` is present.
 */
export async function readPromptSubmission(c: Context): Promise<PromptSubmission> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return readPromptFromJson(c);
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    return readPromptFromForm(c);
  }
  return { prompt: (await c.req.text()).trim(), restoration: {} };
}

/** Prompt-only compatibility reader for non-job callers and focused parser tests. */
export async function readPrompt(c: Context): Promise<string> {
  return (await readPromptSubmission(c)).prompt;
}
