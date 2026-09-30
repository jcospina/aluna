// A voice note from each browser's recorder, as the recorder hands it to the upload route: finished
// if it is a WebM, named for its container, and typed for it (7.2/04). The bytes are real
// recordings (`src/platform/files/recordings/`), but Safari's, which is its container's head.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { finishWebm } from "#design/lib/webm.js";
import { containerOf, recordingName, typeOf } from "#design/recorder-parts.js";
import { admitClaims } from "../../platform/files/admission.ts";
import { sampleFile } from "../../platform/files/sample-files.test-support.ts";
import * as registryStore from "../../registry/store/store.ts";
import { answeredReference, useFileRoutes } from "./file-routes.test-support.ts";

const files = useFileRoutes();

let takesAudio: { mockRestore(): void } | undefined;

beforeEach(() => {
  const real = registryStore.getCapability;
  takesAudio = spyOn(registryStore, "getCapability").mockImplementation((id, database) => {
    const row = real(id, database);
    if (!row) return row;
    const fields = row.schema.fields.map((field) =>
      field.name === "photo" ? { ...field, accepts: ["audio"] } : field,
    );
    return { ...row, schema: { ...row.schema, fields } } as typeof row;
  });
});

afterEach(() => takesAudio?.mockRestore());

const recorded = (name: string) =>
  new Uint8Array(readFileSync(resolve(import.meta.dir, "../../platform/files/recordings", name)));

/** Each browser's recording, the type its recorder reported, and the container it is admitted as. */
const RECORDERS = [
  {
    browser: "Chrome",
    bytes: recorded("chrome-152.webm"),
    reported: "audio/webm;codecs=opus",
    mime: "audio/webm",
  },
  {
    browser: "Chrome",
    bytes: recorded("chrome-152.m4a"),
    reported: "audio/mp4;codecs=mp4a.40.2",
    mime: "audio/mp4",
  },
  {
    browser: "Firefox",
    bytes: recorded("firefox-156.webm"),
    reported: "audio/webm;codecs=opus",
    mime: "audio/webm",
  },
  {
    browser: "Firefox",
    bytes: recorded("firefox-156.ogg"),
    reported: "audio/ogg;codecs=opus",
    mime: "audio/ogg",
  },
  {
    browser: "Safari",
    bytes: sampleFile("iso5"),
    reported: "audio/mp4; codecs=mp4a.40.2",
    mime: "audio/mp4",
  },
] as const;

const WHEN = new Date(2026, 8, 29, 14, 5, 23);

/** What the recorder sends for `bytes`: the file it makes of them. */
function asRecorded(bytes: Uint8Array, reported: string) {
  const container = containerOf(bytes.subarray(0, 64), reported);
  if (!container) throw new Error("the recorder can't name this container");
  const body = container === "webm" ? finishWebm(bytes).bytes : bytes;
  return { body, name: recordingName(WHEN, container), type: typeOf(container) };
}

describe("a recording from each browser", () => {
  for (const { browser, bytes, reported, mime } of RECORDERS) {
    test(`${browser}'s ${reported} is admitted to a sound field as ${mime}, under its own name`, async () => {
      const { body, name, type } = asRecorded(bytes, reported);
      const response = await files.upload(new Uint8Array(body), { name, type });
      expect(response.status).toBe(201);
      const reference = await answeredReference(response);
      expect(reference).toMatchObject({ kind: "audio", mime, name, size: body.byteLength });
    });
  }

  test("is admitted under the type its recorder reported, codecs and all", () => {
    for (const { bytes, reported } of RECORDERS) {
      const { name } = asRecorded(bytes, reported);
      expect(admitClaims(name, reported, ["audio"])).toBe("audio");
      expect(admitClaims(name, reported, ["video", "audio"])).toBe("audio");
    }
  });
});
