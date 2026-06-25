// The greeting round-trip — Module 1 liveness content with zero domain logic.
//
// A tiny structured ask backing the `/stream` route: the real provider returns a
// warm, product-voice hello and a one-line invitation. Streaming the `greeting` as
// it builds (from the contract's `partialStream`) and reading `invitation` off the
// validated final object exercises *both* halves of `generate(prompt, schema)` — the
// streamed partial and the schema-validated result — which is exactly the issue-02
// round-trip, shown in the shell instead of asserted in a (money-burning) test.

import { z } from "zod";

import type { Provider } from "./provider/index.ts";
import type { Send } from "./sse/index.ts";
import { escapeHtml } from "./web/index.ts";

const GreetingSchema = z.object({
  greeting: z.string().describe("A warm, first-person hello, one or two sentences."),
  invitation: z
    .string()
    .describe("A short, gentle one-line nudge inviting them to share what they'd like to keep."),
});

// Product voice baked into the prompt (CONTEXT.md "Product voice", ARCH §9.7): warm,
// first person, addresses "you", no internals jargon. Kept here as demo content,
// the way the throwaway demo's fixed strings used to live here.
const GREETING_PROMPT =
  "You are Aluna — a warm, gently curious companion in a place where what someone " +
  "wants to keep track of becomes a little app that builds itself. Someone has just " +
  "opened Aluna for the first time. Speaking in the first person, directly to them " +
  'as "you", plainspoken and concise with a quiet thread of wonder, write a short ' +
  "greeting (one or two sentences) and a one-line invitation for them to tell you " +
  "what they would like to keep track of. Never mention anything technical.";

/**
 * Stream the real greeting: narrate the `greeting` as it builds (only the
 * newly-arrived suffix each tick), reveal the `invitation` from the validated
 * object, then close. Bails immediately if the client has gone (`isAborted`).
 */
export async function streamGreeting(send: Send, isAborted: () => boolean, provider: Provider) {
  const result = provider.generate(GREETING_PROMPT, GreetingSchema);

  let shown = 0;
  for await (const partial of result.partialStream) {
    if (isAborted()) return;
    const greeting = typeof partial.greeting === "string" ? partial.greeting : "";
    if (greeting.length > shown) {
      await send("narration", greeting.slice(shown)); // only the newly-arrived suffix
      shown = greeting.length;
    }
  }
  if (isAborted()) return;

  const { invitation } = await result.object; // schema-validated
  await send("fragment", `<p class="intro__invitation">${escapeHtml(invitation)}</p>`);
  await send("done", "ok");
}

/**
 * Surface a greeting-stream failure *clearly*: precise in the server log for the
 * developer, warm and jargon-free in the UI (product voice, ARCH §9.7). Covers both
 * a missing key (`createProvider` throws) and a provider/transport error mid-stream.
 */
export async function handleStreamError(send: Send, isAborted: () => boolean, err: unknown) {
  console.error("Aluna greeting stream failed:", err instanceof Error ? err.message : err);
  if (isAborted()) return;
  await send("narration", "Hmm, I couldn't quite find my words just now — mind trying again?");
  await send("done", "error");
}
