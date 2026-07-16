import { describe, expect, test } from "bun:test";

import { requestFiveActionReferenceInstall } from "./install-field-lifecycle-demo.ts";

describe("five-Action reference install client", () => {
  test("a server connection failure exits without a local coordinator or database fallback", async () => {
    const unavailable: typeof fetch = () => Promise.reject(new TypeError("server unavailable"));

    await expect(requestFiveActionReferenceInstall(unavailable)).rejects.toThrow(
      "server unavailable",
    );
  });

  test("a server admission refusal is surfaced instead of bypassed", async () => {
    const refused: typeof fetch = () => Promise.resolve(new Response("busy", { status: 409 }));

    await expect(requestFiveActionReferenceInstall(refused)).rejects.toThrow(
      "running Aluna server refused the reference install (409)",
    );
  });
});
