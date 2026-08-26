// The hosted vector service, behind a one-method contract.
//
// A logo call costs real money ([ADR-0007](../../docs/adr/0007-capability-logo-contract.md)
// L1: roughly $0.08), so the seam matters more than the client: every test in this repo
// injects a {@link LogoGenerationProvider} and no automated test ever reaches the
// network. That mirrors `src/provider/spine.ts`, which carries the same rule for the
// text spine.
//
// The client's job ends at *accepted bytes*. It bounds the call, validates the envelope,
// decodes base64 strictly and checks for an SVG document root — and then hands the bytes
// on exactly as they arrived. Nothing here strips, rewrites, prettifies or re-serializes
// them: L8 says everything the shell adds sits outside the file, and the C2PA provenance
// block is deliberately kept.

import { z } from "zod";

import {
  buildLogoGenerationRequest,
  LOGO_GENERATION_PATH,
  type LogoGenerationInputs,
  type LogoGenerationRequest,
} from "./request.ts";

/** Bring-your-own-key, like `OMNI_API_KEY`. Named in the error so a missing key says so. */
export const RECRAFT_API_KEY_ENV_VAR = "RECRAFT_API_KEY";

/** Override for a stub or a proxy. The default is the service the contract was settled on. */
export const RECRAFT_BASE_URL_ENV_VAR = "RECRAFT_BASE_URL";
export const DEFAULT_RECRAFT_BASE_URL = "https://external.api.recraft.ai/v1";

/**
 * One attempt's wall-clock bound. Generous, because a vector generation is slow and a
 * timeout burns a claimed attempt; short enough that a hung service cannot hold a tile
 * request open indefinitely.
 */
export const DEFAULT_LOGO_GENERATION_TIMEOUT_MS = 90_000;

/** Why an attempt did not produce accepted bytes. Every value consumes the claim. */
export type LogoGenerationFailure =
  | "unconfigured"
  | "http"
  | "envelope"
  | "decode"
  | "not_svg"
  | "timeout"
  | "cancelled";

export class LogoGenerationError extends Error {
  override readonly name = "LogoGenerationError";
  readonly reason: LogoGenerationFailure;

  constructor(reason: LogoGenerationFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * The whole surface the attempt orchestration depends on: given the request and a
 * cancellation signal, return the accepted SVG bytes or throw.
 */
export interface LogoGenerationProvider {
  generate(request: LogoGenerationRequest, signal: AbortSignal): Promise<Uint8Array>;
  /**
   * Whether this provider could reach the service at all — for the real client, whether
   * a key is set. Asked **before** a claim, because a claim spends an attempt the moment
   * it is won and nothing ever decrements one: without this, three desk loads on a
   * machine with no key would permanently abandon every capability's logo without a
   * single request leaving the process.
   *
   * Optional so a test fake need not state it; absent means "yes, try".
   */
  isConfigured?(): boolean;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RecraftLogoProviderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

/**
 * The response envelope, validated rather than trusted. `data` is an array because the
 * service can return several images; the request never asks for more than the default
 * one, so the first entry is the drawing and anything beyond it is not this contract's.
 */
const generationEnvelopeSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
});

export function requireRecraftApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env[RECRAFT_API_KEY_ENV_VAR]?.trim();
  if (!key) {
    throw new LogoGenerationError(
      "unconfigured",
      `${RECRAFT_API_KEY_ENV_VAR} is not set, so no capability logo can be generated. Set it in .env to give capabilities a face.`,
    );
  }
  return key;
}

export function resolveRecraftBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[RECRAFT_BASE_URL_ENV_VAR]?.trim();
  return (configured || DEFAULT_RECRAFT_BASE_URL).replace(/\/+$/, "");
}

/**
 * Decode the envelope's base64 payload strictly. `Buffer.from(…, "base64")` silently skips
 * what it does not recognize and would turn a truncated or HTML-ish body into
 * plausible-looking bytes.
 *
 * `lastChunkHandling: "strict"` is load-bearing: the default is `"loose"`, which accepts a
 * truncated final chunk. `"PHN2Zz"` decodes to exactly `<svg` under it, so a body cut short
 * in transit passes `assertSvgDocumentRoot` and a half-drawing installs as accepted
 * artwork — which L7 then forbids ever replacing.
 */
export function decodeLogoPayload(payload: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(payload, { lastChunkHandling: "strict" });
  } catch (error) {
    throw new LogoGenerationError(
      "decode",
      `The logo payload is not valid base64: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (bytes.length === 0) {
    throw new LogoGenerationError("decode", "The logo payload decoded to zero bytes.");
  }
  return bytes;
}

// Everything an SVG file may legally carry before its root element: an XML declaration,
// a DOCTYPE (internal subset and all), processing instructions, comments and whitespace.
// Skipped rather than stripped — the bytes handed on are the bytes that arrived.
//
// The internal subset is matched **lazily**, and backtracking is what makes a `]` inside
// an entity value work. Greedy looks equivalent and is not: it runs to the last `]` in
// the document, so a DOCTYPE followed anywhere by a `CDATA` section swallows the root and
// throws away a paid generation.
const PROLOGUE_PATTERN =
  /^(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)+/i;

// The root element itself. Case-sensitive, because SVG is XML: `<SVG` is not an SVG root.
const SVG_ROOT_PATTERN = /^<svg(?=[\s/>])/;

// Enough of the document to find the root in the ordinary case. Every specimen opens with
// `<svg` at byte zero, so this window is never actually needed — it exists so a 111 kB
// drawing is not decoded in full on the happy path.
const ROOT_SEARCH_WINDOW = 4096;

function startsAtSvgRoot(text: string): boolean {
  return SVG_ROOT_PATTERN.test(text.replace(PROLOGUE_PATTERN, ""));
}

/**
 * Assert the decoded bytes are an SVG document — the root element is `<svg`, not HTML,
 * not JSON, not a PNG the service substituted. Read-only: it never returns a rewritten
 * document, because L8 forbids touching what arrived.
 *
 * The window is an optimization, never a rule: a document whose prologue is longer than
 * it is re-read in full rather than refused, because a false rejection here throws away
 * a paid generation.
 */
export function assertSvgDocumentRoot(bytes: Uint8Array): void {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  if (startsAtSvgRoot(decoder.decode(bytes.subarray(0, ROOT_SEARCH_WINDOW)))) return;
  if (bytes.length > ROOT_SEARCH_WINDOW && startsAtSvgRoot(decoder.decode(bytes))) return;
  throw new LogoGenerationError(
    "not_svg",
    "The generated bytes are not an SVG document: no <svg> root element.",
  );
}

/**
 * One attempt's budget: the caller's cancellation signal and the client's own timeout,
 * merged into a single signal that covers the **whole** call.
 *
 * Bounding only the fetch would leave the body read unbounded, and a service that
 * answers its headers promptly and then dribbles 111 kB forever would hold this
 * incarnation's read token past deletion's drain deadline. The budget therefore stays
 * open until the bytes are validated.
 */
interface CallBudget {
  readonly signal: AbortSignal;
  readonly caller: AbortSignal;
  timedOut: boolean;
  dispose(): void;
}

function openCallBudget(caller: AbortSignal, timeoutMs: number): CallBudget {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  caller.addEventListener("abort", cancel, { once: true });
  const budget: CallBudget = {
    signal: controller.signal,
    caller,
    timedOut: false,
    dispose() {
      clearTimeout(timer);
      caller.removeEventListener("abort", cancel);
    },
  };
  const timer = setTimeout(() => {
    budget.timedOut = true;
    controller.abort();
  }, timeoutMs);
  return budget;
}

/**
 * Classify whatever went wrong. Cancellation before the timeout, the timeout before an
 * ordinary transport failure — a validation error already knows its own reason and
 * passes straight through.
 */
function callFailure(error: unknown, budget: CallBudget, timeoutMs: number): LogoGenerationError {
  if (error instanceof LogoGenerationError) return error;
  if (budget.caller.aborted) {
    return new LogoGenerationError("cancelled", "The logo attempt was cancelled in flight.");
  }
  if (budget.timedOut) {
    return new LogoGenerationError(
      "timeout",
      `The logo generation call exceeded its ${timeoutMs}ms budget.`,
    );
  }
  return new LogoGenerationError("http", `The logo generation call failed: ${describe(error)}`);
}

/** Pull the accepted base64 payload out of a successful response, or say why not. */
async function readGeneratedPayload(response: Response, budget: CallBudget): Promise<string> {
  if (!response.ok) {
    // Cancel the unread body before throwing; `budget.dispose()` clears the timer but never
    // aborts, so an abandoned body holds its connection open until GC.
    await response.body?.cancel().catch(() => {});
    throw new LogoGenerationError(
      "http",
      `The logo generation service answered ${response.status}.`,
    );
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (error) {
    // A body that stopped arriving because the budget ran out is a timeout, not a
    // malformed envelope; leaving it unwrapped lets `callFailure` say which.
    if (budget.signal.aborted) throw error;
    throw new LogoGenerationError(
      "envelope",
      `The logo generation response was not JSON: ${describe(error)}`,
    );
  }

  const parsed = generationEnvelopeSchema.safeParse(envelope);
  const payload = parsed.success ? parsed.data.data[0]?.b64_json : undefined;
  if (!payload) {
    throw new LogoGenerationError(
      "envelope",
      "The logo generation response carried no base64 image.",
    );
  }
  return payload;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The real client. Bounded by its own timeout and by the caller's cancellation signal —
 * the read token's — so a deletion closing the gate aborts the call in flight.
 */
export function createRecraftLogoProvider(
  options: RecraftLogoProviderOptions = {},
): LogoGenerationProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGO_GENERATION_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));

  return {
    isConfigured(): boolean {
      return Boolean((options.env ?? process.env)[RECRAFT_API_KEY_ENV_VAR]?.trim());
    },

    async generate(request: LogoGenerationRequest, signal: AbortSignal): Promise<Uint8Array> {
      // Checked before anything is spent: a cancelled attempt must not open a request at
      // all, let alone pay for one.
      if (signal.aborted) {
        throw new LogoGenerationError(
          "cancelled",
          "The logo attempt was cancelled before it began.",
        );
      }
      // The environment is read per call, never frozen at import, so a key added to
      // `.env` after boot is picked up and a test can hand in its own.
      const env = options.env ?? process.env;
      const apiKey = requireRecraftApiKey(env);
      const url = `${resolveRecraftBaseUrl(env)}${LOGO_GENERATION_PATH}`;

      const budget = openCallBudget(signal, timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: budget.signal,
        });
        const bytes = decodeLogoPayload(await readGeneratedPayload(response, budget));
        assertSvgDocumentRoot(bytes);
        return bytes;
      } catch (error) {
        throw callFailure(error, budget, timeoutMs);
      } finally {
        budget.dispose();
      }
    },
  };
}

/** Convenience for callers holding a claim rather than an assembled request. */
export function generateCapabilityLogo(
  provider: LogoGenerationProvider,
  inputs: LogoGenerationInputs,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return provider.generate(buildLogoGenerationRequest(inputs), signal);
}
