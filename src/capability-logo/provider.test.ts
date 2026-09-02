import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertSvgDocumentRoot,
  createRecraftLogoProvider,
  decodeLogoPayload,
  type FetchLike,
  LogoGenerationError,
  RECRAFT_API_KEY_ENV_VAR,
  requireRecraftApiKey,
  resolveRecraftBaseUrl,
} from "./provider.ts";
import { buildLogoGenerationRequest } from "./request.ts";

// **No test here calls the live service.** A generation costs real money, so every case
// runs against an injected `fetch` and the four specimens `design/logo.html` was settled
// on. That is the same rule `src/platform/provider/spine.test.ts` states for the text spine, and
// it is why the client's only seam is a function you can hand it.

const SPECIMEN = readFileSync(
  resolve(import.meta.dir, "../../design/assets/logos/reading-journal.svg"),
);
const SPECIMEN_BASE64 = SPECIMEN.toString("base64");

const REQUEST = buildLogoGenerationRequest({
  subject: "an open notebook",
  ground: "cyan",
  companion: "coral",
  seed: 1436601874,
});

const ENV = { [RECRAFT_API_KEY_ENV_VAR]: "test-key" } satisfies NodeJS.ProcessEnv;

function answering(body: unknown, status = 200): FetchLike {
  return async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

async function failureOf(promise: Promise<unknown>): Promise<LogoGenerationError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LogoGenerationError);
    return error as LogoGenerationError;
  }
  throw new Error("Expected the attempt to fail.");
}

describe("configuration", () => {
  test("a missing key names itself rather than failing anonymously", () => {
    expect(() => requireRecraftApiKey({})).toThrow(/RECRAFT_API_KEY/);
    expect(() => requireRecraftApiKey({ [RECRAFT_API_KEY_ENV_VAR]: "   " })).toThrow(
      /RECRAFT_API_KEY/,
    );
  });

  test("the endpoint defaults to the service the contract was settled on", () => {
    expect(resolveRecraftBaseUrl({})).toBe("https://external.api.recraft.ai/v1");
    expect(resolveRecraftBaseUrl({ RECRAFT_BASE_URL: "http://localhost:9/v1/" })).toBe(
      "http://localhost:9/v1",
    );
  });

  // The server boots without a logo key exactly as it boots without an AI key: it is a
  // failed attempt, never a refusal to start.
  test("a missing key is a failed attempt, not a thrown boot", async () => {
    const provider = createRecraftLogoProvider({ env: {}, fetch: answering({}) });
    const failure = await failureOf(provider.generate(REQUEST, new AbortController().signal));
    expect(failure.reason).toBe("unconfigured");
  });
});

describe("a successful call", () => {
  test("sends the exact request body as a bearer-authorized POST", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const provider = createRecraftLogoProvider({
      env: ENV,
      fetch: async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify({ data: [{ b64_json: SPECIMEN_BASE64 }] }));
      },
    });

    await provider.generate(REQUEST, new AbortController().signal);

    expect(seen?.url).toBe("https://external.api.recraft.ai/v1/images/generations");
    expect(seen?.init.method).toBe("POST");
    expect((seen?.init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(seen?.init.body))).toEqual(JSON.parse(JSON.stringify(REQUEST)));
  });

  test("returns the specimen's bytes exactly as they arrived", async () => {
    const provider = createRecraftLogoProvider({
      env: ENV,
      fetch: answering({ data: [{ b64_json: SPECIMEN_BASE64 }] }),
    });

    const bytes = await provider.generate(REQUEST, new AbortController().signal);

    // Byte-for-byte, provenance block and all. L8: everything the shell adds sits outside
    // the file, so nothing here strips, reformats or re-serializes it.
    expect(Buffer.from(bytes).equals(SPECIMEN)).toBe(true);
    expect(Buffer.from(bytes).includes("c2pa:manifest")).toBe(true);
  });
});

describe("what counts as a failed attempt", () => {
  test("a non-2xx answer", async () => {
    const provider = createRecraftLogoProvider({ env: ENV, fetch: answering({}, 402) });
    expect((await failureOf(provider.generate(REQUEST, new AbortController().signal))).reason).toBe(
      "http",
    );
  });

  test("a body that is not JSON", async () => {
    const provider = createRecraftLogoProvider({ env: ENV, fetch: answering("<html>nope") });
    expect((await failureOf(provider.generate(REQUEST, new AbortController().signal))).reason).toBe(
      "envelope",
    );
  });

  test("an envelope with no image in it", async () => {
    for (const body of [{}, { data: [] }, { data: [{ url: "https://…" }] }]) {
      const provider = createRecraftLogoProvider({ env: ENV, fetch: answering(body) });
      const failure = await failureOf(provider.generate(REQUEST, new AbortController().signal));
      expect(failure.reason).toBe("envelope");
    }
  });

  test("a payload that is not base64", async () => {
    const provider = createRecraftLogoProvider({
      env: ENV,
      fetch: answering({ data: [{ b64_json: "not base64 !!!" }] }),
    });
    expect((await failureOf(provider.generate(REQUEST, new AbortController().signal))).reason).toBe(
      "decode",
    );
  });

  test("valid base64 that is not an SVG document", async () => {
    const provider = createRecraftLogoProvider({
      env: ENV,
      fetch: answering({
        data: [{ b64_json: Buffer.from("<html><body>hello</body></html>").toString("base64") }],
      }),
    });
    expect((await failureOf(provider.generate(REQUEST, new AbortController().signal))).reason).toBe(
      "not_svg",
    );
  });

  test("a call that exceeds its budget", async () => {
    const provider = createRecraftLogoProvider({
      env: ENV,
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    expect((await failureOf(provider.generate(REQUEST, new AbortController().signal))).reason).toBe(
      "timeout",
    );
  });

  // The budget covers the whole call, not just the headers. A service that answers
  // promptly and then dribbles its body forever would otherwise hold this incarnation's
  // read token past deletion's drain deadline.
  test("a body that never finishes arriving", async () => {
    const provider = createRecraftLogoProvider({
      env: ENV,
      timeoutMs: 10,
      fetch: async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"data":[{"b64_json":"'));
              init.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("aborted", "AbortError")),
              );
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });

    expect((await failureOf(provider.generate(REQUEST, new AbortController().signal))).reason).toBe(
      "timeout",
    );
  });
});

describe("cancellation", () => {
  test("an already-cancelled attempt opens no request at all", async () => {
    let called = false;
    const provider = createRecraftLogoProvider({
      env: ENV,
      fetch: async () => {
        called = true;
        return new Response("{}");
      },
    });
    const controller = new AbortController();
    controller.abort();

    const failure = await failureOf(provider.generate(REQUEST, controller.signal));

    expect(failure.reason).toBe("cancelled");
    // Nothing is spent for a capability whose gate closed before the call: the fetch is
    // never made, so nothing is ordered.
    expect(called).toBe(false);
  });

  test("a cancellation in flight aborts the request", async () => {
    const controller = new AbortController();
    let innerSignal: AbortSignal | undefined;
    const provider = createRecraftLogoProvider({
      env: ENV,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          innerSignal = init.signal ?? undefined;
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          queueMicrotask(() => controller.abort());
        }),
    });

    const failure = await failureOf(provider.generate(REQUEST, controller.signal));

    expect(failure.reason).toBe("cancelled");
    expect(innerSignal?.aborted).toBe(true);
  });
});

describe("the validators, against the shipped specimens", () => {
  const specimens = ["reading-journal", "coffee-tasting-log", "telescope-observations", "recipes"];

  test.each(specimens)("%s decodes and is recognized as an SVG document", (name) => {
    const bytes = readFileSync(resolve(import.meta.dir, `../../design/assets/logos/${name}.svg`));
    const decoded = decodeLogoPayload(bytes.toString("base64"));
    expect(Buffer.from(decoded).equals(bytes)).toBe(true);
    expect(() => assertSvgDocumentRoot(decoded)).not.toThrow();
  });

  test("a prologue longer than the fast window is re-read rather than refused", () => {
    // A false rejection here throws away a paid generation, so the window is an
    // optimization and never the rule.
    const longComment = `<!--${"x".repeat(8192)}--><svg xmlns="http://www.w3.org/2000/svg"/>`;
    expect(() => assertSvgDocumentRoot(Buffer.from(longComment))).not.toThrow();
    expect(() => assertSvgDocumentRoot(Buffer.from(`${"x".repeat(8192)}<svg/>`))).toThrow(
      LogoGenerationError,
    );
  });

  test("a DOCTYPE whose internal subset contains a bracket is still a prologue", () => {
    const awkward = Buffer.from('<!DOCTYPE svg [ <!ENTITY a "b]c"> ]><svg xmlns="x"/>');
    expect(() => assertSvgDocumentRoot(awkward)).not.toThrow();
  });

  // The case a greedy internal subset gets wrong: it runs past the DOCTYPE to the last
  // `]` in the document, so the root disappears and a valid drawing is refused.
  test("a DOCTYPE followed by a CDATA section still has a root", () => {
    const withCdata = Buffer.from(
      '<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="x"><style><![CDATA[ .a{} ]]></style></svg>',
    );
    expect(() => assertSvgDocumentRoot(withCdata)).not.toThrow();
  });

  test("the root is case-sensitive, because SVG is XML", () => {
    expect(() => assertSvgDocumentRoot(Buffer.from('<SVG xmlns="x"/>'))).toThrow(
      LogoGenerationError,
    );
  });

  test("an XML declaration, a DOCTYPE and comments are skipped, not stripped", () => {
    const prologued = Buffer.from(
      `\uFEFF<?xml version="1.0" standalone="no"?>\n<!DOCTYPE svg [ <!ENTITY a "b"> ]>\n<!-- drawn -->\n<svg xmlns="http://www.w3.org/2000/svg"/>`,
    );
    expect(() => assertSvgDocumentRoot(prologued)).not.toThrow();
  });

  test("something that merely mentions svg is not an svg", () => {
    for (const impostor of ["<html><svg/></html>", '{"svg":true}', "svg", "<svgx/>"]) {
      expect(() => assertSvgDocumentRoot(Buffer.from(impostor))).toThrow(LogoGenerationError);
    }
  });

  // `Buffer.from(…, "base64")` would happily turn this into plausible bytes.
  test("a truncated or padded-with-junk payload is refused rather than salvaged", () => {
    expect(() => decodeLogoPayload("PHN2Zw==!!!")).toThrow(LogoGenerationError);
    expect(() => decodeLogoPayload("")).toThrow(LogoGenerationError);
  });
});
