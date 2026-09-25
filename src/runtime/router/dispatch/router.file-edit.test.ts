// An edit keeping, replacing and clearing a record's photo, through the router and the hand-written
// photos fixture. Each case mints its ledger rows directly, as the upload route would.

import { describe, expect, test } from "bun:test";

import { fileUrl } from "../../../platform/files/file-url.ts";
import { FILE_LEDGER_TABLE } from "../../../platform/files/ledger.ts";
import { capabilityEditErrorId } from "../../../presentation/index.ts";
import {
  INVALID_FILE_REFERENCE_ERROR_CODE,
  RECORD_CHANGED_ERROR_CODE,
} from "../../../registry/index.ts";
import {
  FILE_CLEAR_VALUE,
  projectFileLedgerRow,
  RECORD_NOT_FOUND_ERROR_CODE,
} from "../../data/index.ts";
import type { CapabilityUpdateContext } from "../contract.ts";
import {
  createBody,
  editBody,
  PHOTO,
  sentenceOf,
  updateHandler,
  usePhotosRouter,
} from "./router.file.test-support.ts";
import { makeSpyLoader } from "./router.test-support.ts";
import type { HandlerLoader } from "./router.ts";

type Photos = ReturnType<typeof usePhotosRouter>;

/** Aborts any UPDATE whose SET names the photo column, so "kept" is proved, not inferred. */
function forbidPhotoWrites(photos: Photos): void {
  photos.conns().readwrite.exec(
    `CREATE TRIGGER "photo_untouched" BEFORE UPDATE OF "photo" ON "cap_photos"
     BEGIN SELECT RAISE(ABORT, 'the photo column was written'); END;`,
  );
}

describe("an edit keeps the photo its record holds", () => {
  const photos = usePhotosRouter();

  test("an edit carrying the record's key keeps the file, and the Handler sees its projection", async () => {
    const key = photos.mint({ name: "harbour.jpg" });
    const id = await photos.save(key);
    forbidPhotoWrites(photos);
    const seen: unknown[] = [];
    const loadHandler = updateHandler(({ input, mutation }) => {
      seen.push(input.values.photo);
      const record = mutation.update({ caption: input.values.caption, photo: input.values.photo });
      seen.push(record.fields.photo);
      return record;
    });

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk", [PHOTO]: key }),
      { loadHandler },
    );

    expect(response.status).toBe(200);
    const projection = projectFileLedgerRow(photos.ledger(key));
    expect(seen).toEqual([projection, projection]);
    expect(photos.photoOf(id)).toMatchObject({ key, name: "harbour.jpg" });
    expect(photos.ledger(key)).toMatchObject({ state: "owned", record_id: id });
  });

  test("an edit that leaves the photo out keeps it too, and the card still draws it", async () => {
    const key = photos.mint();
    const id = await photos.save(key);
    forbidPhotoWrites(photos);

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk" }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`src="${fileUrl(key)}"`);
    expect(photos.photoOf(id)).toMatchObject({ key });
    expect(photos.ledger(key)).toMatchObject({ state: "owned", record_id: id });
  });

  test("an empty value keeps an empty field empty", async () => {
    const id = await photos.save();
    forbidPhotoWrites(photos);

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk", [PHOTO]: "" }),
    );

    expect(response.status).toBe(200);
    expect(photos.photoOf(id)).toBeNull();
  });
});

describe("a kept key the record no longer holds is refused before generated code runs", () => {
  const photos = usePhotosRouter();
  const elsewhere: readonly [string, () => Promise<[id: string, kept: string]>][] = [
    [
      "another window replaced it",
      async () => {
        const kept = photos.mint();
        const id = await photos.save(kept);
        await photos.request("/capability/photos/update", editBody(id, { [PHOTO]: photos.mint() }));
        return [id, kept];
      },
    ],
    [
      "another window cleared it",
      async () => {
        const kept = photos.mint();
        const id = await photos.save(kept);
        await photos.request(
          "/capability/photos/update",
          editBody(id, { [PHOTO]: FILE_CLEAR_VALUE }),
        );
        return [id, kept];
      },
    ],
    [
      "another window added one where this form held none",
      async () => {
        const id = await photos.save();
        await photos.request("/capability/photos/update", editBody(id, { [PHOTO]: photos.mint() }));
        return [id, ""];
      },
    ],
  ];

  for (const [name, arrange] of elsewhere) {
    test(`when ${name}`, async () => {
      const [id, kept] = await arrange();
      const before = { stored: photos.stored(), ledger: photos.ledgerRows() };
      const spy = makeSpyLoader();

      const response = await photos.request(
        "/capability/photos/update",
        editBody(id, { caption: "Dusk", [PHOTO]: kept }),
        { loadHandler: spy.loadHandler },
      );

      expect(response.status).toBe(422);
      expect(response.headers.get("HX-Retarget")).toBe(`#${capabilityEditErrorId("photos")}`);
      const body = await response.clone().text();
      expect(body).toContain(`data-error-code="${RECORD_CHANGED_ERROR_CODE}"`);
      expect(body).toContain(`data-error-fields="${PHOTO}"`);
      const sentence = sentenceOf(await response.text());
      expect(sentence).toMatch(/another window/);
      expect(sentence).not.toMatch(/key|ledger|reference|incarnation|pending|record|file/i);
      expect(spy.calls).toEqual([]);
      expect({ stored: photos.stored(), ledger: photos.ledgerRows() }).toEqual(before);
    });
  }
});

describe("a record that no longer exists answers as not found before any key is judged", () => {
  const photos = usePhotosRouter();
  const submissions: readonly [string, (gone: string) => string][] = [
    ["the key it held", (gone) => gone],
    ["a pending key", () => photos.mint()],
    ["a value that is no key at all", () => "harbour.jpg"],
    ["the clear", () => FILE_CLEAR_VALUE],
  ];

  for (const [name, photo] of submissions) {
    test(`an edit carrying ${name}`, async () => {
      const gone = photos.mint();
      const id = await photos.save(gone);
      await photos.request("/capability/photos/delete", editBody(id, {}));
      const submitted = photo(gone);
      const before = photos.ledgerRows();
      const spy = makeSpyLoader();

      const response = await photos.request(
        "/capability/photos/update",
        editBody(id, { caption: "Dusk", [PHOTO]: submitted }),
        { loadHandler: spy.loadHandler },
      );

      expect(response.status).toBe(404);
      expect(await response.text()).toContain(`data-error-code="${RECORD_NOT_FOUND_ERROR_CODE}"`);
      expect(spy.calls).toEqual([]);
      expect(photos.ledgerRows()).toEqual(before);
    });
  }
});

describe("replacing a photo", () => {
  const photos = usePhotosRouter();

  test("promotes the new key, writes it from the ledger and gives up the old one", async () => {
    const old = photos.mint({ name: "old.jpg" });
    const id = await photos.save(old);
    const next = photos.mint({ name: "new.png", mime: "image/png", size: 9_001 });
    const seen: unknown[] = [];
    const loadHandler = updateHandler(({ input, mutation }) => {
      seen.push(input.values.photo);
      return mutation.update({ photo: input.values.photo });
    });

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: next }),
      { loadHandler },
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([projectFileLedgerRow(photos.ledger(next))]);
    expect(photos.photoOf(id)).toEqual({
      key: next,
      kind: "image",
      mime: "image/png",
      size: 9_001,
      name: "new.png",
    });
    expect(photos.ledger(next)).toMatchObject({ state: "owned", record_id: id });
    expect(photos.ledger(old)).toMatchObject({ state: "cleanup_enqueued", record_id: id });
  });

  test("through the real fixture, whose card then draws the new photo", async () => {
    const old = photos.mint();
    const id = await photos.save(old);
    const next = photos.mint();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk", [PHOTO]: next }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`src="${fileUrl(next)}"`);
    expect(photos.ledger(old).state).toBe("cleanup_enqueued");
  });

  test("onto a record that held none gives nothing up", async () => {
    const id = await photos.save();
    const next = photos.mint();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: next }),
    );

    expect(response.status).toBe(200);
    expect(photos.ledger(next)).toMatchObject({ state: "owned", record_id: id });
    expect(
      photos.conns().readwrite.query(`SELECT count(*) AS n FROM ${FILE_LEDGER_TABLE}`).get(),
    ).toEqual({ n: 1 });
  });

  test("a Handler that updates and then fails leaves the old key owned and the new one pending", async () => {
    const old = photos.mint();
    const id = await photos.save(old);
    const next = photos.mint();
    const loadHandler: HandlerLoader = async () => async (context: CapabilityUpdateContext) => {
      context.mutation.update({ photo: context.input.values.photo });
      throw new Error("the Handler broke after writing");
    };

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: next }),
      { loadHandler },
    );

    expect(response.status).toBe(500);
    expect(photos.photoOf(id)).toMatchObject({ key: old });
    expect(photos.ledger(old)).toMatchObject({ state: "owned", record_id: id });
    expect(photos.ledger(next)).toMatchObject({ state: "pending", record_id: null });
  });

  test("an update that fails gives both keys back, even to a Handler that answers anyway", async () => {
    const old = photos.mint();
    const id = await photos.save(old);
    const next = photos.mint();
    photos.conns().readwrite.exec(
      `CREATE TRIGGER "refuse_edits" BEFORE UPDATE ON "cap_photos"
       BEGIN SELECT RAISE(ABORT, 'the update failed'); END;`,
    );
    const loadHandler: HandlerLoader = async () => async (context: CapabilityUpdateContext) => {
      try {
        context.mutation.update({ photo: context.input.values.photo });
      } catch {
        // Swallowed, so the route answers 200 and commits whatever the transaction holds.
      }
      return "<p>saved, it thinks</p>";
    };

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: next }),
      { loadHandler },
    );

    expect(response.status).toBe(200);
    expect(photos.photoOf(id)).toMatchObject({ key: old });
    expect(photos.ledger(old)).toMatchObject({ state: "owned", record_id: id });
    expect(photos.ledger(next)).toMatchObject({ state: "pending", record_id: null });
  });

  test("with a key another record owns is refused as a file this field may not claim", async () => {
    const theirs = photos.mint();
    await photos.save(theirs);
    const id = await photos.save(photos.mint());
    const spy = makeSpyLoader();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: theirs }),
      { loadHandler: spy.loadHandler },
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("HX-Retarget")).toBe(`#${capabilityEditErrorId("photos")}`);
    expect(await response.text()).toContain(
      `data-error-code="${INVALID_FILE_REFERENCE_ERROR_CODE}"`,
    );
    expect(spy.calls).toEqual([]);
  });
});

describe("clearing a photo", () => {
  const photos = usePhotosRouter();

  test("the control's clear empties the field and gives up the old key", async () => {
    const old = photos.mint();
    const id = await photos.save(old);
    const seen: unknown[] = [];
    const loadHandler = updateHandler(({ input, mutation }) => {
      seen.push(input.values.photo);
      const record = mutation.update({ photo: input.values.photo });
      seen.push(record.fields.photo);
      return record;
    });

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: FILE_CLEAR_VALUE }),
      { loadHandler },
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([null, null]);
    expect(photos.photoOf(id)).toBeNull();
    expect(photos.ledger(old)).toMatchObject({ state: "cleanup_enqueued", record_id: id });
  });

  const clears: readonly [string, HandlerLoader | undefined][] = [
    [
      "a Handler that leaves it out of its patch",
      updateHandler(({ input, mutation }) => mutation.update({ caption: input.values.caption })),
    ],
    ["the real fixture", undefined],
  ];

  for (const [name, loadHandler] of clears) {
    test(`the clear still empties the field through ${name}`, async () => {
      const old = photos.mint();
      const id = await photos.save(old);

      const response = await photos.request(
        "/capability/photos/update",
        editBody(id, { caption: "Dusk", [PHOTO]: FILE_CLEAR_VALUE }),
        loadHandler ? { loadHandler } : {},
      );

      expect(response.status).toBe(200);
      expect(photos.photoOf(id)).toBeNull();
      expect(photos.ledger(old).state).toBe("cleanup_enqueued");
    });
  }

  test("an empty value never clears a photo the record holds", async () => {
    const kept = photos.mint();
    const id = await photos.save(kept);

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: "" }),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(`data-error-code="${RECORD_CHANGED_ERROR_CODE}"`);
    expect(photos.photoOf(id)).toMatchObject({ key: kept });
    expect(photos.ledger(kept).state).toBe("owned");
  });

  test("a create has nothing to clear, so it refuses the clear", async () => {
    const response = await photos.request(
      "/capability/photos/create",
      createBody("Dawn", FILE_CLEAR_VALUE),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(
      `data-error-code="${INVALID_FILE_REFERENCE_ERROR_CODE}"`,
    );
    expect(photos.stored()).toEqual([]);
  });
});
