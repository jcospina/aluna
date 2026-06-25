// Reading the user's typed prompt off an inbound request, content-type agnostic.
//
// The prompt bar can POST as JSON, as a urlencoded/multipart form, or as raw text;
// this normalizes all three to a single trimmed string so the route handler never
// branches on transport.

import type { Context } from "hono";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readPromptFromJson(c: Context): Promise<string> {
  const body: unknown = await c.req.json().catch(() => ({}));
  return isRecord(body) && typeof body.prompt === "string" ? body.prompt.trim() : "";
}

async function readPromptFromForm(c: Context): Promise<string> {
  const body = await c.req.parseBody();
  const prompt = body.prompt;
  return typeof prompt === "string" ? prompt.trim() : "";
}

/**
 * Read the typed prompt from the request body, dispatching on `content-type`: JSON,
 * form (urlencoded or multipart), or — as a fallback — the raw request text. Always
 * returns a trimmed string, empty when no usable `prompt` is present.
 */
export async function readPrompt(c: Context): Promise<string> {
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
  return (await c.req.text()).trim();
}
