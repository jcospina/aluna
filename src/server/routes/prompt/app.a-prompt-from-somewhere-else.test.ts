// A prompt that arrived from somewhere other than this desk.
//
// `POST /prompt` is the one admission path, and what it admits is not cheap: a build spends
// provider tokens and commits a capability, and a question spends them too. The body is
// urlencoded, so a form on another site posts it with no preflight and with the user's session —
// which means a page they merely visited could build on their behalf. `Sec-Fetch-Site` is what
// tells the two apart, and a browser sends it on every request.
//
// The check lived on module 6's developer-gated exercise and went down with it in 6.5/05; the
// route that actually spends the tokens never had one.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createBuildJobQueue } from "../../../pipeline/jobs/build-jobs.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { GenerateResult, Provider } from "../../../platform/provider/index.ts";
import {
  createScratchDbEnv,
  makeMetricsRecorder,
  responseText,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { createApp } from "../../app.ts";

/** A provider the refused submissions must never reach, and the admitted ones stop short of. */
function forbiddenProvider(calls: { count: number }): Provider {
  return {
    generate<T>(): GenerateResult<T> {
      calls.count += 1;
      throw new Error("an admitted prompt generates nothing until its stream is opened");
    },
  };
}

describe("a prompt from somewhere other than this desk", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let artifactsRoot: string;

  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-cross-site-prompt-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  function submittingApp(calls: { count: number }, issued: { ids: number }) {
    return createApp({
      getProvider: () => forbiddenProvider(calls),
      recordMetrics: makeMetricsRecorder().recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      buildJobs: createBuildJobQueue({
        createId: () => {
          issued.ids += 1;
          return `cross-site-job-${issued.ids}`;
        },
      }),
    });
  }

  function submit(site: string | undefined): RequestInit {
    return {
      method: "POST",
      headers: site === undefined ? {} : { "sec-fetch-site": site },
      body: new URLSearchParams({ prompt: "track my notes" }),
    };
  }

  test("is refused, and no job is issued for it to stream", async () => {
    // A prompt builds a capability and spends provider tokens, and a urlencoded POST crosses
    // origins with no preflight — so a page the user merely visited must not be able to make one.
    const calls = { count: 0 };
    const issued = { ids: 0 };
    const app = submittingApp(calls, issued);

    for (const site of ["cross-site", "same-site"]) {
      const response = await app.request("/prompt", submit(site));
      expect({ site, status: response.status }).toEqual({ site, status: 403 });
    }
    expect(issued.ids).toBe(0);
    expect(calls.count).toBe(0);
  });

  test("while the desk's own submission, and a client that is not a browser, are admitted", async () => {
    // `none` is a direct navigation and an absent header is a non-browser client; neither is a
    // third party's page, and refusing them would break `curl` and the tests that post like it.
    const app = submittingApp({ count: 0 }, { ids: 0 });

    for (const site of ["same-origin", "none", undefined]) {
      const body = await responseText(await app.request("/prompt", submit(site)));
      expect({ site, subscriber: body.includes("data-build-job-id") }).toEqual({
        site,
        subscriber: true,
      });
    }
  });
});
