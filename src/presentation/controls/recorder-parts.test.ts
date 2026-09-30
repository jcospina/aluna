// The voice recorder's rules, apart from any page (`design/scripts/recorder-parts.js`).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  browserOf,
  containerOf,
  levelOf,
  nearsCap,
  RECORDING_TYPES,
  recordingName,
  recordingType,
  refusalOf,
  typeOf,
  wavePath,
} from "#design/recorder-parts.js";
import { sampleFile } from "../../platform/files/sample-files.test-support.ts";

const head = (name: string) =>
  new Uint8Array(
    readFileSync(resolve(import.meta.dir, "../../platform/files/recordings", name)),
  ).subarray(0, 64);

describe("the type a browser is asked to record in", () => {
  test("is WebM wherever the browser records it, and MP4 only where it records nothing else", () => {
    const chrome = new Set([
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
    ]);
    const firefox = new Set(["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]);
    const oldSafari = new Set(["audio/mp4", "audio/mp4;codecs=mp4a.40.2"]);
    expect(recordingType((t) => chrome.has(t))).toBe("audio/webm;codecs=opus");
    expect(recordingType((t) => firefox.has(t))).toBe("audio/webm;codecs=opus");
    expect(recordingType((t) => oldSafari.has(t))).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(RECORDING_TYPES.indexOf("audio/webm")).toBeLessThan(
      RECORDING_TYPES.indexOf("audio/mp4"),
    );
  });

  test("is left to the browser when it names none, or throws when asked", () => {
    expect(recordingType(() => false)).toBe("");
    expect(
      recordingType(() => {
        throw new TypeError("no");
      }),
    ).toBe("");
  });
});

describe("the file a recording becomes", () => {
  test("takes its container from its bytes before the type the recorder reported", () => {
    expect(containerOf(head("chrome-152.webm"), "")).toBe("webm");
    expect(containerOf(head("firefox-156.ogg"), "audio/webm")).toBe("ogg");
    expect(containerOf(head("chrome-152.m4a"), "")).toBe("m4a");
    expect(containerOf(sampleFile("iso5").subarray(0, 64), "")).toBe("m4a");
    expect(containerOf(sampleFile("webm").subarray(0, 64), "")).toBe("webm");
    expect(containerOf(sampleFile("matroska").subarray(0, 64), "audio/webm")).toBeNull();
    const widened = [0x1a, 0x45, 0xdf, 0xa3, 0x8a, 0x42, 0x82, 0x40, 0x04, ...Buffer.from("webm")];
    expect(containerOf(new Uint8Array(widened), "")).toBe("webm");
    expect(containerOf(new Uint8Array(12), "audio/mp4; codecs=mp4a.40.2")).toBe("m4a");
    expect(containerOf(new Uint8Array(12), "Audio/OGG")).toBe("ogg");
    expect(containerOf(new Uint8Array(12), "")).toBeNull();
    expect(containerOf(new Uint8Array(12), "audio/wav")).toBeNull();
  });

  test("is typed for its container, never for a codec", () => {
    expect([typeOf("webm"), typeOf("m4a"), typeOf("ogg")]).toEqual([
      "audio/webm",
      "audio/mp4",
      "audio/ogg",
    ]);
  });

  test("is named for when it was recorded, to the second, with its container's extension", () => {
    const when = new Date(2026, 0, 5, 7, 3, 9);
    expect(recordingName(when, "m4a")).toBe("Voice note 2026-01-05 07.03.09.m4a");
    expect(recordingName(when, "webm").endsWith(".webm")).toBe(true);
  });
});

describe("what a browser's refusal means", () => {
  test("names the state each refusal is, and anything unknown is a failure", () => {
    const named = (name: string) => refusalOf(new DOMException("", name));
    expect(named("NotAllowedError")).toBe("denied");
    expect(named("SecurityError")).toBe("denied");
    expect(named("NotFoundError")).toBe("no-device");
    expect(named("OverconstrainedError")).toBe("no-device");
    expect(named("NotReadableError")).toBe("device-busy");
    expect(named("AbortError")).toBe("device-busy");
    expect(named("TypeError")).toBe("failed");
    expect(refusalOf("nope")).toBe("failed");
  });

  test("tells the browsers apart for their recovery steps, an iPad as the iPhone it is", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(browserOf(`${mac} (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15`)).toBe("safari");
    expect(browserOf(`${mac} (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15`, 5)).toBe("ios");
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15";
    expect(browserOf(`${iphone} Version/18.0 Safari/604.1`)).toBe("ios");
    expect(browserOf(`${iphone} CriOS/130 Safari/604.1`)).toBe("ios-app");
    expect(browserOf("Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile Safari/537.36")).toBe(
      "android",
    );
    expect(browserOf("Mozilla/5.0 (Android 15; Mobile; rv:140.0) Firefox/140.0")).toBe("android");
    expect(browserOf("Mozilla/5.0 (Macintosh; rv:156.0) Gecko/20100101 Firefox/156.0")).toBe(
      "firefox",
    );
    expect(browserOf(`${mac} (KHTML, like Gecko) Chrome/152.0 Safari/537.36`)).toBe("chrome");
    expect(browserOf(`${mac} (KHTML, like Gecko) Chrome/152.0 Safari/537.36 Edg/152.0`)).toBe(
      "chrome",
    );
    expect(browserOf("curl/8")).toBe("other");
  });
});

describe("the level, the wave and the cap", () => {
  test("a silent moment is a hair, a loud one is full, and louder is never lower", () => {
    const at = (value: number) => levelOf(new Uint8Array(64).fill(value));
    expect(at(128)).toBeGreaterThan(0);
    expect(at(255)).toBe(1);
    expect(at(160)).toBeGreaterThan(at(140));
    expect(levelOf(new Uint8Array(0))).toBe(at(128));
  });

  test("a wave is one stroke per moment, mirrored about the middle, as tall as it was loud", () => {
    const strokes = [...wavePath([0.04, 1, 0.5]).matchAll(/M([\d.]+) ([\d.]+)V([\d.]+)/g)].map(
      (m) => ({ top: Number(m[2]), bottom: Number(m[3]) }),
    );
    expect(strokes.length).toBe(3);
    for (const { top, bottom } of strokes) expect(top + bottom).toBe(100);
    const [quiet, loud, half] = strokes.map(({ top, bottom }) => bottom - top);
    expect(loud).toBeGreaterThan(half ?? 0);
    expect(half).toBeGreaterThan(quiet ?? 0);
    expect(wavePath([2, -1])).toBe(wavePath([1, 0]));
  });

  test("the recorder stops while the next chunks still fit, and a field with no cap never stops it", () => {
    const cap = 1_000_000;
    expect(nearsCap(0, 0, cap)).toBe(false);
    expect(nearsCap(cap / 2, 20_000, cap)).toBe(false);
    expect(nearsCap(cap - 30_000, 20_000, cap)).toBe(true);
    expect(nearsCap(Number.MAX_SAFE_INTEGER, 1, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
