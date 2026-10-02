// A save whose Handler answers without claiming the upload it carried (Module 7 PLAN decision 32):
// the form counts the upload saved, so nothing would claim it again, and the save gives it up in
// its own transaction. A save that is refused gives up nothing.

import { describe, expect, test } from "bun:test";
import type { HandlerLoader } from "../router.ts";
import { createBody, editBody, PHOTO, usePhotosRouter } from "./router.file.test-support.ts";

/** A Handler that answers with a card and writes nothing. */
const answersWithoutWriting: HandlerLoader = async () => async () => "<p>card</p>";

/** A Handler that refuses the save. */
const refuses: HandlerLoader = async () => async () => {
  throw new Error("the Handler failed");
};

describe("a save whose Handler never claims the upload it carried", () => {
  const photos = usePhotosRouter();

  test("a create gives the pending key up, and the worker removes its bytes", async () => {
    const key = photos.mint();
    photos.place(key);
    const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
      loadHandler: answersWithoutWriting,
    });
    expect(response.status).toBe(200);
    expect(photos.gone(key)).toBe(true);
    expect(photos.onDisk(key)).toBe(false);
  });

  test("an edit gives the replacement up and leaves the record's own photo where it is", async () => {
    const held = photos.mint();
    photos.place(held);
    const id = await photos.save(held);
    const replacement = photos.mint();
    photos.place(replacement);

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk", [PHOTO]: replacement }),
      { loadHandler: answersWithoutWriting },
    );
    expect(response.status).toBe(200);
    expect(photos.gone(replacement)).toBe(true);
    expect(photos.onDisk(replacement)).toBe(false);
    expect(photos.ledger(held)).toMatchObject({ state: "owned", record_id: id });
    expect(photos.onDisk(held)).toBe(true);
  });

  test("a refused save leaves the key pending for the form that still holds it", async () => {
    const key = photos.mint();
    const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
      loadHandler: refuses,
    });
    expect(response.ok).toBe(false);
    expect(photos.ledger(key).state).toBe("pending");
  });

  test("a save that claims its upload keeps it owned", async () => {
    const key = photos.mint();
    photos.place(key);
    const id = await photos.save(key);
    expect(photos.ledger(key)).toMatchObject({ state: "owned", record_id: id });
    expect(photos.onDisk(key)).toBe(true);
  });
});
