// What adversarial review of 7.2/04 found in the voice recorder, each kept as the case that
// showed it (`design/scripts/file-recorder.js`).

import { describe, expect, test } from "bun:test";
import {
  RECORDED,
  recording,
  scene,
  useRecorderScenes,
} from "./file-recorder.scene.test-support.ts";
import { Recording, settle, standInMedia } from "./file-recorder.test-support.ts";

useRecorderScenes();

describe("what adversarial review found", () => {
  test("a recorder the browser stopped on its own still finishes", async () => {
    const s = scene();
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    s.media.recorder?.stop();
    await settle();
    s.media.tracks[0]?.dispatchEvent(new Event("ended"));
    await settle();
    expect(s.picks.length).toBe(1);
    expect(s.guidance()).toBe(
      "The recording stopped on its own, so I kept what I heard up to there.",
    );
  });

  test("a recorder let go says and holds nothing, whatever arrives after", async () => {
    const s = scene(standInMedia(), "audio", 'data-file-cap="60000"');
    await recording(s);
    const recorder = s.media.recorder;
    recorder?.emit(RECORDED.subarray(0, 10_000));
    s.holds[0]?.release();
    await settle();
    const said = s.said();
    recorder?.emit(RECORDED);
    await settle();
    expect(s.stateOf()).toBeNull();
    expect(s.picks).toEqual([]);
    expect(s.media.guards.at(-1)).toBe(false);
    expect(s.said()).toBe(said);
  });

  test("a recording let go while it is being made is neither uploaded nor announced", async () => {
    const s = scene();
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    s.doc.fire("click", s.q('[data-recorder-do="stop"]') as never);
    s.holds[0]?.release();
    await settle();
    expect(s.picks).toEqual([]);
    expect(s.said()).not.toContain("uploading");
  });

  test("a recorder that won't start is a failure said out loud, with the microphone off", async () => {
    const media = standInMedia();
    const start = Recording.prototype.start;
    Recording.prototype.start = () => {
      throw new DOMException("inactive stream", "InvalidStateError");
    };
    try {
      const s = scene(media);
      await s.press("[data-file-record]");
      expect(s.stateOf()).toBeNull();
      expect(s.guidance()).toContain("I couldn’t start the microphone.");
    } finally {
      Recording.prototype.start = start;
    }
    expect(media.tracks.every((t) => t.stopped)).toBe(true);
  });

  test("an answer that comes after Cancel turns the microphone straight back off", async () => {
    const media = standInMedia({ waits: true });
    const s = scene(media);
    await s.press("[data-file-record]");
    await s.act("cancel");
    await media.answer();
    expect(media.tracks.length).toBe(1);
    expect(media.tracks.every((t) => t.stopped)).toBe(true);
    expect(s.stateOf()).toBeNull();
  });

  test("the note a stopped recording leaves goes with the next thing the field takes", async () => {
    const s = scene(standInMedia(), "audio", 'data-file-cap="60000"');
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await settle();
    expect(s.guidance()).toContain("reached the size");
    const file = new File([new Uint8Array(4)], "dawn.mp3", { type: "audio/mpeg" });
    s.doc.fire("drop", s.host, { preventDefault() {}, dataTransfer: { files: [file], types: [] } });
    expect(s.guidance()).not.toContain("reached the size");
  });
});

describe("what review of the recorder in the row found", () => {
  test("a second press straight after Record doesn't cancel or stop what it started", async () => {
    const asking = scene(standInMedia({ waits: true }));
    await asking.press("[data-file-record]");
    await asking.press('[data-recorder-do="cancel"]');
    expect(asking.stateOf()).toBe("asking");

    const live = scene();
    await live.press("[data-file-record]");
    await live.press('[data-recorder-do="stop"]');
    expect(live.stateOf()).toBe("recording");
  });

  test("a recording whose upload fails is kept, to send again or throw away", async () => {
    const offline = () => ({ done: Promise.reject(new Error("offline")), abort: () => {} });
    const s = scene(standInMedia(), "audio", "", offline);
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await s.act("stop");
    expect(s.q("[data-file-resend]")).not.toBeNull();
    expect(s.save()).toBe("I’m waiting on the unsent recording…");
    expect(s.media.guards.at(-1)).toBe(true);
    s.media.tick(500);
    await s.press("[data-file-resend]");
    expect(s.picks.length).toBe(2);
    expect(s.picks[1]?.file).toBe(s.picks[0]?.file);
    s.media.tick(500);
    await s.press("[data-file-forget]");
    expect(s.q("[data-file-record]")).not.toBeNull();
    expect(s.save()).toBe("Save");
    expect(s.media.guards.at(-1)).toBe(false);
    expect(s.said()).toBe("I threw the recording away.");
  });

  test("a recording whose upload is stopped is kept too", async () => {
    const s = scene();
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await s.act("stop");
    await s.press("[data-file-stop]");
    expect(s.q("[data-file-resend]")).not.toBeNull();
  });

  test("the form's save waits while the browser is asked", async () => {
    const s = scene(standInMedia({ waits: true }));
    await s.press("[data-file-record]");
    expect(s.save()).toBe("I’m waiting on the recording…");
    expect(s.media.guards.at(-1)).toBe(false);
  });

  test("a note a recording left goes when the form is put back", async () => {
    const s = scene(standInMedia(), "audio", 'data-file-cap="60000"');
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await settle();
    expect(s.guidance()).toContain("reached the size");
    const { settleFileFields } = await import("#design/file-field.js");
    settleFileFields(s.doc.querySelector("form") as never, "revert");
    expect(s.guidance()).toBe("");
  });

  test("an upload refused at once is said, not talked over", async () => {
    const s = scene(standInMedia(), "audio", "", () => {
      throw new Error("no cap");
    });
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await s.act("stop");
    expect(s.said()).toBe(s.guidance());
    expect(s.q("[data-file-resend]")).not.toBeNull();
  });

  test("while it finishes, a drop is told to wait, and a recorder that never finishes is made anyway", async () => {
    const s = scene();
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    const recorder = s.media.recorder;
    if (recorder) recorder.stop = () => Object.assign(recorder, { state: "inactive" });
    await s.act("stop");
    expect(s.stateOf()).toBe("finishing");
    const file = new File([new Uint8Array(4)], "other.mp3", { type: "audio/mpeg" });
    s.doc.fire("drop", s.host, { preventDefault() {}, dataTransfer: { files: [file], types: [] } });
    expect(s.guidance()).toBe("I’m still finishing the recording.");
    s.media.tick(5000);
    await settle();
    expect(s.picks.length).toBe(1);
  });

  test("a field hidden while the browser is asked stops asking", async () => {
    const s = scene(standInMedia({ waits: true }));
    await s.press("[data-file-record]");
    s.media.hide();
    await s.media.answer();
    expect(s.stateOf()).toBeNull();
    expect(s.media.tracks.every((t) => t.stopped)).toBe(true);
  });
});

describe("what the last review of the recorder found", () => {
  test("a double click on the upload's Stop can't reach the square that throws it away", async () => {
    const s = scene();
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await s.act("stop");
    await s.press("[data-file-stop]");
    expect(s.focused()).toBe(s.picks[0]?.name ?? "no pick");
    await s.press("[data-file-forget]");
    expect(s.q("[data-file-resend]")).not.toBeNull();
  });

  test("a held Enter presses once, and its repeats press nothing", () => {
    const s = scene();
    const repeat = s.doc.fire("keydown", s.q("[data-file-record]") as never, { repeat: true });
    const first = s.doc.fire("keydown", s.q("[data-file-record]") as never, { repeat: false });
    expect(repeat.prevented).toBe(true);
    expect(first.prevented).toBe(false);
  });

  test("a drop onto a recording kept unsent is refused out loud rather than replacing it", async () => {
    const offline = () => ({ done: Promise.reject(new Error("offline")), abort: () => {} });
    const s = scene(standInMedia(), "audio", "", offline);
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await s.act("stop");
    const file = new File([new Uint8Array(4)], "other.mp3", { type: "audio/mpeg" });
    s.doc.fire("drop", s.host, { preventDefault() {}, dataTransfer: { files: [file], types: [] } });
    expect(s.picks.length).toBe(1);
    expect(s.guidance()).toBe("Upload the recording again or throw it away first.");
    expect(s.q("[data-file-resend]")).not.toBeNull();
  });

  test("a recording the platform refused isn't offered again, and its form isn't held", async () => {
    const { FileRefusal } = await import("#design/file-field.js");
    const refusing = () => ({
      done: Promise.reject(
        new FileRefusal("signature", "That isn’t an audio file I can play here."),
      ),
      abort: () => {},
    });
    const s = scene(standInMedia(), "audio", "", refusing);
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await s.act("stop");
    expect(s.q("[data-file-resend]")).toBeNull();
    expect(s.save()).toBe("Save");
    expect(s.media.guards.at(-1)).toBe(false);
  });

  test("closing the form around an unsent recording lets it go and draws the row again", async () => {
    const offline = () => ({ done: Promise.reject(new Error("offline")), abort: () => {} });
    const s = scene(standInMedia(), "audio", "", offline);
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await s.act("stop");
    const unsent = s.holds.find((h) => h.label === "unsent recording");
    unsent?.release();
    expect(s.q("[data-file-resend]")).toBeNull();
    expect(s.q("[data-file-record]")).not.toBeNull();
    expect(s.media.guards.at(-1)).toBe(false);
  });

  test("the reason a recording stopped itself stays through a retry", async () => {
    let tries = 0;
    const flaky = () => ({
      done:
        tries++ === 0 ? Promise.reject<never>(new Error("offline")) : new Promise<never>(() => {}),
      abort: () => {},
    });
    const s = scene(standInMedia(), "audio", 'data-file-cap="60000"', flaky);
    await recording(s);
    s.media.recorder?.emit(RECORDED);
    await settle();
    s.media.tick(500);
    await s.press("[data-file-resend]");
    expect(s.picks.length).toBe(2);
    expect(s.guidance()).toContain("reached the size");
  });
});
