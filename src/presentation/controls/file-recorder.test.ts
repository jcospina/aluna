// The voice recorder in the row it records into (`design/scripts/file-recorder.js`, drawn by
// `design/scripts/file-field.js`), driven through the DOM double against a stand-in microphone.

import { describe, expect, test } from "bun:test";
import { clock } from "#design/file-parts.js";
import { finishWebm } from "#design/lib/webm.js";
import { refusalSentence, UNBLOCK, WAITING } from "#design/recorder-parts.js";
import type { El } from "./choice-picker.test-support.ts";
import {
  RECORDED,
  recorded,
  recording,
  scene,
  useRecorderScenes,
} from "./file-recorder.scene.test-support.ts";
import { settle, standInMedia } from "./file-recorder.test-support.ts";

useRecorderScenes();

describe("where the recorder is offered", () => {
  test("every field that takes a sound draws Record beside its well, alone or with others", () => {
    for (const kind of ["audio", "audio document", "video audio"]) {
      expect(scene(standInMedia(), kind).q("[data-file-record]")?.textContent).toBe("Record");
    }
    expect(scene(standInMedia(), "image").q("[data-file-record]")).toBeNull();
    expect(scene(standInMedia(), "document").q("[data-file-record]")).toBeNull();
  });

  test("a browser with no microphone access or no recorder draws no Record at all", () => {
    for (const missing of ["mediaDevices", "MediaRecorder"]) {
      const media = standInMedia();
      Reflect.deleteProperty(media.env, missing);
      expect(scene(media).q("[data-file-record]")).toBeNull();
    }
  });

  test("a held sound can be recorded over from its row, beside Replace", () => {
    const s = scene(
      standInMedia(),
      "audio",
      'data-holds-name="Dawn.m4a" data-holds-size="400" data-holds-src="/files/k"',
    );
    const square = s.q(".file__actions [data-file-record]");
    expect(square?.getAttribute("aria-label")).toBe("Record in place of Dawn.m4a");
  });
});

describe("recording in the row", () => {
  test("the microphone buttons are green, and the one that throws a recording away is red", async () => {
    const held = scene(
      standInMedia(),
      "audio",
      'data-holds-name="Dawn.m4a" data-holds-size="400" data-holds-src="/files/k"',
    );
    expect(held.q("[data-file-record]")?.getAttribute("class")).toContain("btn--primary");
    const s = scene(standInMedia({ waits: true }));
    expect(s.q("[data-file-record]")?.getAttribute("class")).toContain("btn--primary");
    await s.press("[data-file-record]");
    const cancel = () => s.q('[data-recorder-do="cancel"]')?.getAttribute("class") ?? "";
    expect(cancel()).toContain("btn--outline");
    await s.media.answer();
    expect(cancel()).toContain("btn--danger");
  });

  test("Record asks the browser, then records at once, with the time taking the keyboard", async () => {
    const s = scene(standInMedia({ waits: true }));
    await s.press("[data-file-record]");
    expect(s.stateOf()).toBe("asking");
    expect(s.focused()).toBe(WAITING.asking);
    expect(s.said()).toBe(WAITING.asking);
    expect(s.q('[data-recorder-do="cancel"]')?.getAttribute("aria-label")).toBe(
      "Stop asking for the microphone",
    );
    await s.media.answer();
    expect(s.stateOf()).toBe("recording");
    expect(s.media.asked).toBe(1);
    expect(s.focused()).toBe("Recording, 0:00");
    expect(s.said()).toBe("Recording.");
    expect(s.media.recorder?.options.mimeType).toBe("audio/webm;codecs=opus");
    expect(s.media.recorder?.timeslice).toBeGreaterThan(0);
    expect(s.q("[data-file-record]")).toBeNull();
    expect(s.q(".file__row .file__well")).not.toBeNull();
  });

  test("the time runs and the wave moves with what the microphone hears", async () => {
    const s = scene();
    await s.press("[data-file-record]");
    expect(s.q('[role="timer"]')?.textContent).toBe("Recording, 0:00");
    const wave = () => s.q("[data-recorder-wave]")?.getAttribute("d");
    const before = wave();
    s.media.tick(1000);
    expect(s.q("[data-recorder-time]")?.textContent).toBe("0:01");
    expect(wave()).not.toBe(before);
  });

  test("the form's save waits while it records, and the page asks before leaving", async () => {
    const s = scene();
    expect(s.save()).toBe("Save");
    await recording(s);
    expect(s.save()).toBe("I’m waiting on the recording…");
    expect(s.media.guards.at(-1)).toBe(true);
  });

  test("Stop turns the microphone off and uploads the finished WebM, named for when it was made", async () => {
    const s = scene();
    await recorded(s);
    expect(s.media.tracks.every((t) => t.stopped)).toBe(true);
    const [picked] = s.picks;
    expect(picked?.name).toBe("Voice note 2026-09-29 14.05.23.webm");
    expect(picked?.type).toBe("audio/webm");
    const sent = new Uint8Array(await (picked?.file as File).arrayBuffer());
    expect(Buffer.from(sent).equals(Buffer.from(finishWebm(RECORDED).bytes))).toBe(true);
    const length = clock(finishWebm(RECORDED).seconds ?? 0);
    expect(s.said()).toBe(`Stopped at ${length}. I’m uploading it.`);
    expect(s.stateOf()).toBeNull();
    expect(s.media.guards.at(-1)).toBe(true);
  });

  test("Cancel throws the recording away and gives Record the keyboard", async () => {
    const s = scene();
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await s.act("cancel");
    expect(s.stateOf()).toBeNull();
    expect(s.picks).toEqual([]);
    expect(s.media.tracks.every((t) => t.stopped)).toBe(true);
    expect(s.focused()).toBe("Record");
    expect(s.said()).toBe("I threw the recording away.");
    expect(s.media.guards.at(-1)).toBe(false);
  });

  test("stops itself before the field's cap, keeps the recording and says why", async () => {
    const s = scene(standInMedia(), "audio", 'data-file-cap="60000"');
    await recording(s);
    s.media.recorder?.emit(RECORDED.subarray(0, 12_000));
    await settle();
    expect(s.stateOf()).toBe("recording");
    s.media.recorder?.emit(RECORDED.subarray(12_000));
    await settle();
    expect(s.picks.length).toBe(1);
    expect(s.guidance()).toContain("reached the size this field takes");
    expect(s.said()).toBe("I’m uploading it.");
  });
});

describe("a microphone it can't have", () => {
  test("leaves the field empty, with the reason and this browser's fix under it", async () => {
    const cases = [
      ["NotAllowedError", "denied"],
      ["SecurityError", "denied"],
      ["NotFoundError", "no-device"],
      ["NotReadableError", "device-busy"],
      ["AbortError", "device-busy"],
      ["TypeError", "failed"],
    ] as const;
    for (const [error, refusal] of cases) {
      const s = scene(standInMedia({ refuse: error }));
      await s.press("[data-file-record]");
      expect(s.stateOf()).toBeNull();
      expect(s.guidance()).toBe(refusalSentence(refusal, "firefox"));
      expect(s.said()).toBe(s.guidance());
      expect(s.focused()).toBe("Record");
      expect(s.host.classList.contains("is-refused")).toBe(true);
      expect(s.host.classList.contains("is-invalid")).toBe(false);
    }
    expect(refusalSentence("denied", "firefox")).toContain(UNBLOCK.firefox);
  });

  test("that goes away keeps what it heard, or says so when it heard nothing", async () => {
    const kept = scene();
    await recording(kept);
    kept.media.recorder?.emit(RECORDED);
    kept.media.tracks[0]?.dispatchEvent(new Event("ended"));
    await settle();
    expect(kept.picks.length).toBe(1);
    expect(kept.guidance()).toBe("Your microphone went away, so I stopped the recording there.");

    const lost = scene();
    await lost.press("[data-file-record]");
    lost.media.tracks[0]?.dispatchEvent(new Event("ended"));
    await settle();
    expect(lost.picks).toEqual([]);
    expect(lost.guidance()).toBe(refusalSentence("device-lost", "firefox"));
  });

  test("that heard nothing at all says so rather than uploading an empty file", async () => {
    const s = scene();
    await recording(s);
    await s.act("stop");
    expect(s.picks).toEqual([]);
    expect(s.guidance()).toBe(refusalSentence("empty", "firefox"));
  });
});

describe("leaving a recording", () => {
  test("closing the form releases the microphone through the region it is in", async () => {
    const s = scene();
    await recording(s);
    const [held] = s.holds;
    expect(held?.label).toBe("voice recording");
    held?.release();
    await settle();
    expect(s.media.tracks.every((t) => t.stopped)).toBe(true);
    expect(s.stateOf()).toBeNull();
    expect(s.picks).toEqual([]);
    expect(held?.released).toBe(true);
    expect(s.media.guards.at(-1)).toBe(false);
  });

  test("a form's cancel puts the field back and the microphone off", async () => {
    const s = scene();
    await recording(s);
    const { settleFileFields } = await import("#design/file-field.js");
    settleFileFields(s.doc.querySelector("form") as never, "revert");
    expect(s.stateOf()).toBeNull();
    expect(s.media.tracks.every((t) => t.stopped)).toBe(true);
  });

  test("a field put out of sight stops recording and keeps what it heard", async () => {
    const s = scene();
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    s.media.hide();
    await settle();
    expect(s.media.tracks.every((t) => t.stopped)).toBe(true);
    expect(s.picks.length).toBe(1);
  });

  test("a file dropped mid-recording is refused out loud", async () => {
    const s = scene();
    await recording(s);
    const file = new File([new Uint8Array(4)], "other.mp3", { type: "audio/mpeg" });
    s.doc.fire("drop", s.host as El, {
      preventDefault() {},
      dataTransfer: { files: [file], types: [] },
    });
    expect(s.picks).toEqual([]);
    expect(s.stateOf()).toBe("recording");
    expect(s.said()).toBe("Stop the recording first, then add the file.");
  });
});
