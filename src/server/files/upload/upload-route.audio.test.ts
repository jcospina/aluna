import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { SIGNATURE_WINDOW_BYTES } from "../../../platform/files/admission/admission.ts";
import { NOT_ADMITTED_SENTENCES } from "../../../platform/files/admission/refusal-copy.ts";
import {
  concatBytes,
  id3Tag,
  mp3File,
  sampleFile,
  webmWithTracks,
} from "../../../platform/files/admission/sample-files.test-support.ts";
import * as registryStore from "../../../registry/store/store.ts";
import { answeredReference, useFileRoutes } from "../file-routes.test-support.ts";
import { INERT_PLAYER_POLICY } from "../serve/serve-route.ts";

const files = useFileRoutes();

const NOT_A_SOUND = NOT_ADMITTED_SENTENCES.audio;

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

describe("a sound that travels in", () => {
  test("an MP3 behind cover art larger than 64 KB is admitted, and served to a player", async () => {
    const bytes = mp3File(SIGNATURE_WINDOW_BYTES * 2 + 311, 40);
    const response = await files.upload(bytes, { name: "Dawn chorus.mp3", type: "audio/mpeg" });
    expect(response.status).toBe(201);
    const reference = await answeredReference(response);
    expect(reference).toMatchObject({ kind: "audio", mime: "audio/mpeg", size: bytes.byteLength });

    const player = { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "audio" };
    const served = await files.app().request(reference.url, { headers: player });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("audio/mpeg");
    expect(served.headers.get("content-security-policy")).toBe(INERT_PLAYER_POLICY);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);

    const range = { ...player, range: "bytes=100-199" };
    const seeked = await files.app().request(reference.url, { headers: range });
    expect(seeked.status).toBe(206);
    expect(new Uint8Array(await seeked.arrayBuffer())).toEqual(bytes.subarray(100, 200));

    // A browser's own page for a sound opened in a tab of its own asks again, in cors mode.
    const own = { "sec-fetch-mode": "cors", "sec-fetch-dest": "audio" };
    expect((await files.app().request(reference.url, { headers: own })).status).toBe(200);
  });

  test("an iPhone's .m4a, an Ogg and a WAV are admitted by extension and container", async () => {
    for (const [format, name, type, mime] of [
      ["m4a", "New Recording 3.m4a", "audio/x-m4a", "audio/mp4"],
      ["isom", "memo.m4a", "", "audio/mp4"],
      ["opus", "note.ogg", "audio/ogg", "audio/ogg"],
      ["wav", "take 2.wav", "audio/x-wav", "audio/wav"],
    ] as const) {
      const response = await files.upload(sampleFile(format), { name, type });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ kind: "audio", mime });
    }
  });

  test("a WebM holding only sound is admitted, though a browser declares a picked one a video", async () => {
    const sound = await files.upload(webmWithTracks([2]), {
      name: "2026-09-28 09.14.webm",
      type: "video/webm",
    });
    expect(sound.status).toBe(201);
    expect(await sound.json()).toMatchObject({ kind: "audio", mime: "audio/webm" });
    const recorded = await files.upload(webmWithTracks([2]), {
      name: "memo.webm",
      type: "audio/webm;codecs=opus",
    });
    expect(await recorded.json()).toMatchObject({ kind: "audio", mime: "audio/webm" });
  });

  test("markup inside an admitted MP3's tag is served inert, and never to a script", async () => {
    const markup = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    const tag = id3Tag(markup.byteLength + 20);
    tag.set(markup, 10);
    const bytes = concatBytes(tag, mp3File());
    const reference = await answeredReference(await files.upload(bytes, { name: "page.mp3" }));
    expect(reference.mime).toBe("audio/mpeg");
    const script = { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
    expect((await files.app().request(reference.url, { headers: script })).status).toBe(404);
    const opened = await files.app().request(reference.url, {
      headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    });
    expect(opened.headers.get("content-type")).toBe("audio/mpeg");
    expect(opened.headers.get("x-content-type-options")).toBe("nosniff");
    expect(opened.headers.get("content-security-policy")).toBe(INERT_PLAYER_POLICY);
  });

  test("with no frames after its tag, or a picture's bytes, is refused in the audio field's words", async () => {
    for (const bytes of [
      concatBytes(id3Tag(SIGNATURE_WINDOW_BYTES + 9), sampleFile("text", 80_000)),
      sampleFile("jpeg", 90_000),
    ]) {
      const response = await files.upload(bytes, { name: "song.mp3" });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ refusal: "signature", message: NOT_A_SOUND });
    }
    const video = await files.upload(webmWithTracks([2, 1]), {
      name: "a.webm",
      type: "video/webm",
    });
    expect(await video.json()).toEqual({ refusal: "not_accepted", message: NOT_A_SOUND });
    expect(files.ledgerRows()).toEqual([]);
    expect(files.stored()).toEqual([]);
  });
});
