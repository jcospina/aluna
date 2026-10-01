// The voice recorder beside a list's add well (`design/scripts/files/file-list.js`): a list that
// takes a sound records one, and the recording it keeps joins the list as one more file.

import { describe, expect, test } from "bun:test";
import { FileRefusal, type Picked, type Transfer, uploadingIn } from "#design/files/file-field.js";
import { FILE_LIST_CHANGE, type FileListChange, pickIntoList } from "#design/files/file-list.js";
import { WAITING } from "#design/files/recorder-parts.js";
import {
  listScene,
  RECORDED,
  recorded,
  recording,
  scene,
  useRecorderScenes,
} from "./file-recorder.scene.test-support.ts";
import { settle, standInMedia } from "./file-recorder.test-support.ts";

useRecorderScenes();

/** Whether the form's save waits on what the list holds back. */
const waits = (s: ReturnType<typeof listScene>) =>
  uploadingIn(s.doc.querySelector("form") as never);

const HELD = JSON.stringify([{ name: "Dawn chorus.m4a", size: 400, url: "/files/k1" }]);

/** An upload a case lands or stops, as the list's transfer hands it each file. */
function uploads() {
  const sent: { picked: Picked; land: () => void; stop: () => void }[] = [];
  const upload = (picked: Picked): ReturnType<Transfer> => {
    let land = () => {};
    let stop = () => {};
    const done = new Promise<{ name: string; size: number; url: string }>((resolve, reject) => {
      land = () => resolve({ name: picked.name, size: picked.size, url: `/files/${sent.length}` });
      stop = () => reject(new DOMException("The upload was stopped.", "AbortError"));
    });
    sent.push({ picked, land, stop });
    return { done, abort: () => stop() };
  };
  return { sent, upload };
}

describe("a list that takes a sound", () => {
  test("draws Record beside its add well, and a list that takes none draws no Record", () => {
    for (const kind of ["audio", "audio document"]) {
      const s = listScene(standInMedia(), kind);
      const record = s.q("[data-file-record]");
      expect(record).not.toBeNull();
      expect(s.q("[data-file-list-add]")?.parentElement).toBe(record?.parentElement ?? null);
    }
    expect(listScene(standInMedia(), "image").q("[data-file-record]")).toBeNull();
  });

  test("records in the add well's place, and the form's save waits on it", async () => {
    const s = listScene(standInMedia(), "audio", `data-holds='${HELD}'`);
    await recording(s);
    expect(s.stateOf()).toBe("recording");
    expect(s.q("[data-file-list-add]")).toBeNull();
    expect(s.q("[data-file-entry]")?.textContent).toContain("Dawn chorus.m4a");
    expect(waits(s)).toBe(true);
  });

  test("adds the recording it keeps as one more file, after the ones it holds", async () => {
    const { sent, upload } = uploads();
    const s = listScene(standInMedia(), "audio", `data-holds='${HELD}'`, upload);
    const changes: FileListChange[] = [];
    s.doc.addEventListener(FILE_LIST_CHANGE, (event) =>
      changes.push((event as unknown as CustomEvent<FileListChange>).detail),
    );
    await recorded(s);
    expect(sent.map((each) => each.picked.type)).toEqual(["audio/webm"]);
    const single = scene(standInMedia(), "audio", "", upload);
    await recorded(single);
    expect(s.said()).toBe(single.said());
    sent[0]?.land();
    await settle();
    const names = changes.at(-1)?.current.map((held) => held.name);
    expect(names).toEqual(["Dawn chorus.m4a", String(sent[0]?.picked.name)]);
    expect(s.q("[data-file-list-add]")).not.toBeNull();
    expect(s.media.guards.at(-1)).toBe(false);
    expect(waits(s)).toBe(false);
  });

  test("keeps a recording whose upload stopped, to send again or throw away", async () => {
    const { sent, upload } = uploads();
    const s = listScene(standInMedia(), "audio", "", upload);
    await recorded(s);
    s.doc.fire("click", s.q("[data-file-list-stop]") as never);
    await settle();
    expect(s.q("[data-file-resend]")).not.toBeNull();
    expect(waits(s)).toBe(true);
    s.media.tick(1000);
    await s.press("[data-file-resend]");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.picked).toBe(sent[0]?.picked);
    sent[1]?.land();
    await settle();
    expect(s.q("[data-file-resend]")).toBeNull();
    expect(s.q("[data-file-entry]")).not.toBeNull();
  });

  test("throws away an unsent recording on asking, and takes files again", async () => {
    const { upload } = uploads();
    const s = listScene(standInMedia(), "audio", "", upload);
    await recorded(s);
    s.doc.fire("click", s.q("[data-file-list-stop]") as never);
    await settle();
    s.media.tick(1000);
    await s.press("[data-file-forget]");
    expect(s.q("[data-file-resend]")).toBeNull();
    expect(s.q("[data-file-list-add]")).not.toBeNull();
    expect(waits(s)).toBe(false);
    expect(s.media.guards.at(-1)).toBe(false);
  });
});

describe("what adversarial review found in a list that records", () => {
  test("keeps the keyboard on the recorder, and on Record when the microphone is refused", async () => {
    const asking = listScene(standInMedia({ waits: true }));
    await asking.press("[data-file-record]");
    expect(asking.focused()).toBe(WAITING.asking);
    const refused = listScene(standInMedia({ refuse: "NotAllowedError" }));
    await refused.press("[data-file-record]");
    expect(refused.doc.activeElement?.matches("[data-file-record]")).toBe(true);
  });

  test("keeps the keyboard on a recording whose upload was stopped", async () => {
    const { upload } = uploads();
    const s = listScene(standInMedia(), "audio", "", upload);
    await recorded(s);
    await s.press("[data-file-list-stop]");
    expect(s.q("[data-file-resend]")).not.toBeNull();
    expect(s.doc.activeElement).not.toBe(s.doc.body);
    expect(s.host.contains(s.doc.activeElement as never)).toBe(true);
  });

  test("takes files while a kept recording travels, and offers no second Record till it lands", async () => {
    const { sent, upload } = uploads();
    const s = listScene(standInMedia(), "audio document", "", upload);
    await recorded(s);
    expect(s.q("[data-file-record]")).toBeNull();
    pickIntoList(s.host as never, [{ name: "manual.pdf", type: "application/pdf", size: 10 }]);
    expect(sent.map((each) => each.picked.name).at(-1)).toBe("manual.pdf");
    expect(s.guidance()).toBe("");
    sent[0]?.land();
    await settle();
    expect(s.q("[data-file-record]")).not.toBeNull();
  });

  test("says why a recording stopped itself, under the list it joins", async () => {
    const s = listScene(standInMedia(), "audio", 'data-file-cap="60000"');
    await recording(s);
    s.media.recorder?.emit(RECORDED.subarray(0, 12_000));
    await settle();
    s.media.recorder?.emit(RECORDED.subarray(12_000));
    await settle();
    expect(s.picks.length).toBe(1);
    const single = scene(standInMedia(), "audio", 'data-file-cap="60000"');
    await recording(single);
    single.media.recorder?.emit(RECORDED);
    await settle();
    expect(single.guidance()).not.toBe("");
    expect(s.guidance()).toBe(single.guidance());
  });

  test("lets go of the notice to send a waiting recording once it has gone up", async () => {
    const { sent, upload } = uploads();
    const s = listScene(standInMedia(), "audio document", "", upload);
    await recorded(s);
    await s.press("[data-file-list-stop]");
    pickIntoList(s.host as never, [{ name: "manual.pdf", type: "application/pdf", size: 10 }]);
    expect(sent.map((each) => each.picked.name)).not.toContain("manual.pdf");
    expect(s.guidance()).not.toBe("");
    s.media.tick(1000);
    await s.press("[data-file-resend]");
    sent.at(-1)?.land();
    await settle();
    expect(s.guidance()).toBe("");
  });

  test("turns the empty list red for a refused file after a refused microphone", async () => {
    const s = listScene(standInMedia({ refuse: "NotAllowedError" }), "audio", "", (picked) => ({
      done: Promise.reject(new FileRefusal("signature", `${picked.name} isn’t a sound.`)),
      abort: () => {},
    }));
    await s.press("[data-file-record]");
    expect(s.host.classList.contains("is-invalid")).toBe(false);
    pickIntoList(s.host as never, [{ name: "a.txt", type: "text/plain", size: 3 }]);
    await settle();
    expect(s.host.classList.contains("is-invalid")).toBe(true);
  });

  test("offers no Record on a list already holding as many files as it takes", () => {
    const s = listScene(standInMedia(), "audio", `data-file-count="1" data-holds='${HELD}'`);
    expect(s.q("[data-file-record]")).toBeNull();
  });

  test("keeps the keyboard on a sound's Play while the list redraws around it", async () => {
    const { sent, upload } = uploads();
    const s = listScene(standInMedia(), "audio", `data-holds='${HELD}'`, upload);
    const play = s.q("[data-file-play]");
    if (!play) throw new Error("no Play on a held sound");
    play.focus();
    pickIntoList(s.host as never, [{ name: "b.m4a", type: "audio/mp4", size: 10 }]);
    sent[0]?.land();
    await settle();
    expect(s.doc.activeElement?.matches("[data-file-play]")).toBe(true);
  });
});
