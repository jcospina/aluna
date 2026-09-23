// The record router's door (Module 7 PLAN decision 9). A chunked body carries no declared length,
// so Bun's `maxRequestBodySize` never saw one and a record write read as much as it was sent.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { createApp } from "../../../server/app.ts";
import { probeBody, streamedInit } from "../../../server/http/writing-route-guard.test-support.ts";
import { TEXT_BODY_LIMIT_BYTES } from "../../../server/http/writing-route-guard.ts";
import { resolveServeOptions } from "../../../server/serve-options.ts";
import {
  createCapabilityDataTool,
  formBody,
  install,
  makeSpyLoader,
  notesRow,
  notesSpec,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";

const WRITES = ["create", "update", "delete"] as const;
const FORM = { "content-type": "application/x-www-form-urlencoded" };

describe("the record router refuses at its door", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
    install(conns, notesRow());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("a chunked body over its limit, before any Handler loads", async () => {
    const spy = makeSpyLoader();
    const app = createApp({ capabilityRouter: { databases: conns, loadHandler: spy.loadHandler } });
    for (const action of WRITES) {
      const response = await app.request(
        `/capability/notes/${action}`,
        streamedInit("POST", probeBody(TEXT_BODY_LIMIT_BYTES + 1, "text="), FORM),
      );
      expect({ action, status: response.status }).toEqual({ action, status: 413 });
    }
    expect(spy.calls).toEqual([]);
    expect(createCapabilityDataTool(notesSpec(), conns).select()).toEqual([]);
  });

  test("another site's write, before the body is read or any Handler loads", async () => {
    const spy = makeSpyLoader();
    const app = createApp({ capabilityRouter: { databases: conns, loadHandler: spy.loadHandler } });
    for (const action of WRITES) {
      const body = probeBody(64, "text=");
      const response = await app.request(
        `/capability/notes/${action}`,
        streamedInit("POST", body, { ...FORM, "sec-fetch-site": "cross-site" }),
      );
      expect({ action, status: response.status, pulled: body.pulledBytes() }).toEqual({
        action,
        status: 403,
        pulled: 0,
      });
    }
    expect(spy.calls).toEqual([]);
  });

  test("over a real socket, where Bun's own cap let a chunked body through", async () => {
    const app = createApp({ capabilityRouter: { databases: conns } });
    const server = Bun.serve({ ...resolveServeOptions({ PORT: "0" }), fetch: app.fetch });
    // Each request on its own connection: Bun's `fetch` stops sending a refused body and reuses
    // the connection, so the server reads the next request as the rest of the old body.
    const send = (init: RequestInit) =>
      fetch(`http://localhost:${server.port}/capability/notes/create`, {
        ...init,
        keepalive: false,
      });
    try {
      const chunked = await send(
        streamedInit("POST", probeBody(TEXT_BODY_LIMIT_BYTES + 1, "text="), FORM),
      );
      expect(chunked.status).toBe(413);
      const declared = await send({
        method: "POST",
        headers: FORM,
        body: `text=${"a".repeat(TEXT_BODY_LIMIT_BYTES)}`,
      });
      expect(declared.status).toBe(413);
      expect(createCapabilityDataTool(notesSpec(), conns).select()).toEqual([]);

      // The guard hands on the socket's own body: an honest save still lands, byte for byte.
      const saved = await send(formBody({ text: "Leche y pan — ñ", pinned: "true" }));
      expect(saved.status).toBe(200);
      expect(createCapabilityDataTool(notesSpec(), conns).select()).toMatchObject([
        { text: "Leche y pan — ñ", pinned: true },
      ]);
    } finally {
      server.stop(true);
    }
  });
});
