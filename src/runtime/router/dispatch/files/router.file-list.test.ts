// A `file[]` through the router: an ordered list of keys, each judged by the rule a single file
// follows, none twice and no more than the configured count, every file an edit removes named as
// removed, what generated code writes always the list the router checked, and every entry an edit
// or a delete gives up cleaned once it commits.

import { afterEach, describe, expect, test } from "bun:test";
import { tooManyFilesSentence } from "../../../../platform/files/admission/refusal-copy.ts";
import { MAX_LIST_FILES_ENV_VAR } from "../../../../platform/files/file-cap.ts";
import { requireFileLedgerRow } from "../../../../platform/files/store/ledger.test-support.ts";
import { ALBUM_FIELD } from "../../../../registry/fields/file.test-support.ts";
import { SECOND_INCARNATION_ID } from "../../../../registry/incarnations.test-support.ts";
import {
  INVALID_FILE_REFERENCE_ERROR_CODE,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  RECORD_CHANGED_ERROR_CODE,
  type SpecField,
  TOO_MANY_FILES_ERROR_CODE,
} from "../../../../registry/index.ts";
import {
  type CapabilityFileProjection,
  FILE_CLEAR_VALUE,
  FILE_REMOVE_PREFIX,
} from "../../../data/index.ts";
import { FileFieldWriteError } from "../../../data/internal.ts";
import { storedFileList } from "../../../data/schema/file-values.ts";
import type { CapabilityCreateContext, CapabilityUpdateContext } from "../../contract.ts";
import {
  ALUNA_DRAWN_MARKER,
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  drawnFileValue,
} from "../../wire/wire-protocol.ts";
import { makeSpyLoader } from "../router.test-support.ts";
import type { HandlerLoader } from "../router.ts";
import {
  albumsRow,
  between,
  keyOf,
  sentenceOf,
  usePhotosRouter,
} from "./router.file.test-support.ts";

const ALBUM = ALBUM_FIELD.name;

/** What the list control posts for a file an edit removes. */
const removed = (key: string) => `${FILE_REMOVE_PREFIX}${key}`;

/**
 * A save's body: the caption, and the album's marker with one value per key, in order. An edit
 * given `drawn` posts it as what the list held when its form was drawn.
 */
function albumBody(
  keys: readonly string[] | undefined,
  recordId?: string,
  drawn?: readonly string[],
): RequestInit {
  const body = new URLSearchParams(
    recordId === undefined ? [] : [[ALUNA_RECORD_ID_MARKER, recordId]],
  );
  body.append(ALUNA_PRESENT_MARKER, "caption");
  body.append("caption", "Lisbon");
  if (keys !== undefined) {
    body.append(ALUNA_PRESENT_MARKER, ALBUM);
    for (const key of keys) body.append(ALBUM, key);
  }
  if (drawn !== undefined) body.append(ALUNA_DRAWN_MARKER, drawnFileValue(ALBUM, drawn));
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

function useAlbumsRouter(album?: SpecField) {
  const photos = usePhotosRouter(() => albumsRow(album));
  const mint = (overrides: Parameters<typeof photos.mint>[0] = {}) =>
    photos.mint({ field: ALBUM, ...overrides });
  const albumOf = (id: string): string[] => {
    const row = photos.conns().readwrite.query(`SELECT "album" FROM "cap_photos" WHERE "id" = ?`);
    const { album: stored } = row.get(id) as { album: string | null };
    return stored === null ? [] : (JSON.parse(stored) as { key: string }[]).map((file) => file.key);
  };
  const create = async (keys?: readonly string[]) => {
    const before = new Set(photos.stored().map((record) => record.id));
    const response = await photos.request("/capability/photos/create", albumBody(keys));
    const id = photos.stored().find((record) => !before.has(record.id))?.id;
    return { response, id };
  };
  const saved = async (keys: readonly string[]) => {
    const { response, id } = await create(keys);
    expect(response.status).toBe(200);
    if (!id) throw new Error("the create stored nothing");
    return id;
  };
  const edit = (
    id: string,
    keys?: readonly string[],
    loadHandler?: HandlerLoader,
    drawn?: readonly string[],
  ) =>
    photos.request(
      "/capability/photos/update",
      albumBody(keys, id, drawn),
      loadHandler ? { loadHandler } : {},
    );
  const state = (key: string) => (photos.gone(key) ? "gone" : photos.ledger(key).state);
  return { ...photos, mint, albumOf, create, saved, edit, state };
}

async function refusal(response: Response) {
  const html = await response.text();
  return { status: response.status, code: /data-error-code="([^"]+)"/.exec(html)?.[1], html };
}

describe("a file list saves in the order it was posted", () => {
  const albums = useAlbumsRouter();

  test("a create claims every entry for the record, in order", async () => {
    const keys = [albums.mint(), albums.mint(), albums.mint()];
    const id = await albums.saved(keys);
    expect(albums.albumOf(id)).toEqual(keys);
    for (const key of keys)
      expect(albums.ledger(key)).toMatchObject({ state: "owned", record_id: id });
  });

  test("a create that posts none, or leaves the field out, holds [] rather than nothing", async () => {
    for (const keys of [[], undefined]) {
      const { response, id } = await albums.create(keys);
      expect(response.status).toBe(200);
      const row = albums.conns().readwrite.query(`SELECT "album" FROM "cap_photos" WHERE "id" = ?`);
      expect(row.get(id ?? "")).toEqual({ album: "[]" });
    }
  });

  test("a Handler is handed every entry's projection, in order", async () => {
    const keys = [albums.mint({ name: "b.jpg" }), albums.mint({ name: "a.jpg" })];
    const seen: CapabilityFileProjection[][] = [];
    const loadHandler: HandlerLoader = async () => async (context: CapabilityCreateContext) => {
      const album = context.input.values[ALBUM] as CapabilityFileProjection[];
      seen.push([...album]);
      return context.present(context.mutation.create({ caption: "Lisbon", [ALBUM]: album }));
    };
    const response = await albums.request("/capability/photos/create", albumBody(keys), {
      loadHandler,
    });
    expect(response.status).toBe(200);
    expect(seen[0]?.map(keyOf)).toEqual(keys);
    expect(seen[0]?.map((file) => file.name)).toEqual(["b.jpg", "a.jpg"]);
  });
});

describe("an edit changes a list entry by entry", () => {
  const albums = useAlbumsRouter();

  test("removing an entry cleans it and keeps the rest in order", async () => {
    const [a, b, c] = [albums.mint(), albums.mint(), albums.mint()];
    const id = await albums.saved([a, b, c]);
    expect((await albums.edit(id, [a, c, removed(b)])).status).toBe(200);
    expect(albums.albumOf(id)).toEqual([a, c]);
    expect([a, b, c].map(albums.state)).toEqual(["owned", "gone", "owned"]);
  });

  test("reordering writes the new order and gives nothing up", async () => {
    const [a, b] = [albums.mint(), albums.mint()];
    const id = await albums.saved([a, b]);
    expect((await albums.edit(id, [b, a])).status).toBe(200);
    expect(albums.albumOf(id)).toEqual([b, a]);
    expect([a, b].map(albums.state)).toEqual(["owned", "owned"]);
  });

  test("adding a pending entry claims it beside the ones kept", async () => {
    const a = albums.mint();
    const id = await albums.saved([a]);
    const added = albums.mint();
    expect((await albums.edit(id, [a, added])).status).toBe(200);
    expect(albums.albumOf(id)).toEqual([a, added]);
    expect(albums.ledger(added)).toMatchObject({ state: "owned", record_id: id });
  });

  test("removing every entry empties it and cleans each", async () => {
    const keys = [albums.mint(), albums.mint()];
    const id = await albums.saved(keys);
    expect((await albums.edit(id, keys.map(removed))).status).toBe(200);
    expect(albums.albumOf(id)).toEqual([]);
    expect(keys.map(albums.state)).toEqual(["gone", "gone"]);
  });

  test("an empty list never clears one: it says the list held nothing, and it did", async () => {
    const keys = [albums.mint()];
    const id = await albums.saved(keys);
    expect(await refusal(await albums.edit(id, []))).toMatchObject({
      status: 422,
      code: RECORD_CHANGED_ERROR_CODE,
    });
    expect(albums.albumOf(id)).toEqual(keys);
  });

  test("a key the record no longer holds says it changed in another window", async () => {
    const [a, b] = [albums.mint(), albums.mint()];
    const id = await albums.saved([a, b]);
    expect((await albums.edit(id, [a, removed(b)])).status).toBe(200);
    expect(albums.state(b)).toBe("gone");
    expect(await refusal(await albums.edit(id, [a, b], undefined, [a, b]))).toMatchObject({
      status: 422,
      code: RECORD_CHANGED_ERROR_CODE,
    });
    expect(albums.albumOf(id)).toEqual([a]);
  });

  test("a file another window added since the form was drawn is never removed by it", async () => {
    const [a, b] = [albums.mint(), albums.mint()];
    const id = await albums.saved([a, b]);
    const c = albums.mint();
    expect((await albums.edit(id, [a, b, c])).status).toBe(200);
    for (const stale of [[a, removed(b)], [a, b], [b, a], []]) {
      expect(await refusal(await albums.edit(id, stale, undefined, [a, b]))).toMatchObject({
        status: 422,
        code: RECORD_CHANGED_ERROR_CODE,
      });
    }
    expect(albums.albumOf(id)).toEqual([a, b, c]);
    expect([a, b, c].map(albums.state)).toEqual(["owned", "owned", "owned"]);
  });

  test("a removal of a file already gone is no change, since the edit wanted it gone", async () => {
    const [a, b] = [albums.mint(), albums.mint()];
    const id = await albums.saved([a, b]);
    expect((await albums.edit(id, [a, removed(b)])).status).toBe(200);
    expect((await albums.edit(id, [a, removed(b)])).status).toBe(200);
    expect(albums.albumOf(id)).toEqual([a]);
  });

  test("a stale list never reaches generated code", async () => {
    const id = await albums.saved([albums.mint()]);
    const spy = makeSpyLoader();
    const response = await albums.edit(id, [], spy.loadHandler);
    expect(await refusal(response)).toMatchObject({ code: RECORD_CHANGED_ERROR_CODE });
    expect(spy.calls).toEqual([]);
  });

  test("the check runs again inside the save, so another save in between is still seen", async () => {
    const a = albums.mint();
    const id = await albums.saved([a]);
    const added = albums.mint({ state: "owned", recordId: id });
    const { readwrite } = albums.conns();
    const spy = makeSpyLoader();
    const response = await albums.request("/capability/photos/update", albumBody([a], id), {
      loadHandler: spy.loadHandler,
      mutationCoordinator: between(() => {
        const stored = [a, added].map((key) => requireFileLedgerRow(readwrite, key));
        readwrite.run(`UPDATE "cap_photos" SET "album" = ? WHERE "id" = ?`, [
          storedFileList(stored),
          id,
        ]);
      }),
    });
    expect(await refusal(response)).toMatchObject({ code: RECORD_CHANGED_ERROR_CODE });
    expect(spy.calls).toEqual([]);
    expect(albums.state(added)).toBe("owned");
  });

  test("leaving the field out keeps it whole", async () => {
    const keys = [albums.mint(), albums.mint()];
    const id = await albums.saved(keys);
    expect((await albums.edit(id)).status).toBe(200);
    expect(albums.albumOf(id)).toEqual(keys);
  });

  test("deleting the record cleans every entry", async () => {
    const keys = [albums.mint(), albums.mint(), albums.mint()];
    const id = await albums.saved(keys);
    const body = new URLSearchParams([[ALUNA_RECORD_ID_MARKER, id]]);
    const response = await albums.request("/capability/photos/delete", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(response.status).toBe(200);
    expect(keys.map(albums.state)).toEqual(keys.map(() => "gone"));
  });
});

describe("a list the router refuses, before generated code runs", () => {
  const albums = useAlbumsRouter();
  afterEach(() => {
    delete process.env[MAX_LIST_FILES_ENV_VAR];
  });

  const refusedCreate = async (keys: readonly string[], code: string) => {
    const before = albums.ledgerRows();
    const { response, id } = await albums.create(keys);
    expect(await refusal(response)).toMatchObject({ status: 422, code });
    expect(id).toBeUndefined();
    expect(albums.ledgerRows()).toEqual(before);
  };

  test("a key twice", async () => {
    const key = albums.mint();
    await refusedCreate([key, albums.mint(), key], INVALID_FILE_REFERENCE_ERROR_CODE);
  });

  test("a key minted for another field, another incarnation, or nobody", async () => {
    const foreign = [
      albums.mint({ field: "photo" }),
      albums.mint({ incarnationId: SECOND_INCARNATION_ID }),
      crypto.randomUUID(),
      "not a key",
    ];
    for (const key of foreign) {
      await refusedCreate([albums.mint(), key], INVALID_FILE_REFERENCE_ERROR_CODE);
    }
  });

  test("a key another record owns", async () => {
    const owned = albums.mint({ state: "owned", recordId: "someone-else" });
    await refusedCreate([owned], INVALID_FILE_REFERENCE_ERROR_CODE);
  });

  test("a removal on a create, a removal of no key, or the clear, which a list never takes", async () => {
    await refusedCreate([removed(albums.mint())], INVALID_FILE_REFERENCE_ERROR_CODE);
    await refusedCreate([FILE_CLEAR_VALUE], INVALID_FILE_REFERENCE_ERROR_CODE);
    const kept = albums.mint();
    const id = await albums.saved([kept]);
    for (const posted of [
      [kept, FILE_CLEAR_VALUE],
      [kept, removed("not-a-key")],
    ]) {
      expect(await refusal(await albums.edit(id, posted))).toMatchObject({
        status: 422,
        code: INVALID_FILE_REFERENCE_ERROR_CODE,
      });
    }
  });

  test("a key both kept and removed", async () => {
    const kept = albums.mint();
    const id = await albums.saved([kept]);
    expect(await refusal(await albums.edit(id, [kept, removed(kept)]))).toMatchObject({
      code: INVALID_FILE_REFERENCE_ERROR_CODE,
    });
  });

  test("ranks the record changing above every other refusal, wherever it sits in the list", async () => {
    const [a, b] = [albums.mint(), albums.mint()];
    const id = await albums.saved([a, b]);
    expect((await albums.edit(id, [a, removed(b)])).status).toBe(200);
    const foreign = albums.mint({ field: "photo" });
    for (const posted of [
      [foreign, a, b],
      [a, b, foreign],
    ]) {
      expect(await refusal(await albums.edit(id, posted, undefined, [a, b]))).toMatchObject({
        code: RECORD_CHANGED_ERROR_CODE,
      });
    }
  });

  test("ranks the record changing above a bad removal, a count and a key twice", async () => {
    const [a, b] = [albums.mint(), albums.mint()];
    const id = await albums.saved([a, b]);
    expect(await refusal(await albums.edit(id, [a, removed("not-a-key")]))).toMatchObject({
      code: RECORD_CHANGED_ERROR_CODE,
    });
    expect((await albums.edit(id, [b, removed(a)])).status).toBe(200);
    const fresh = albums.mint();
    process.env[MAX_LIST_FILES_ENV_VAR] = "2";
    for (const posted of [
      [a, b, albums.mint()],
      [a, b, fresh, fresh],
    ]) {
      expect(await refusal(await albums.edit(id, posted, undefined, [a, b]))).toMatchObject({
        code: RECORD_CHANGED_ERROR_CODE,
      });
    }
  });

  test("more entries than the configured count, in the sentence design/ settles", async () => {
    process.env[MAX_LIST_FILES_ENV_VAR] = "2";
    const three = [albums.mint(), albums.mint(), albums.mint()];
    const { response } = await albums.create(three);
    const answer = await refusal(response);
    expect(answer).toMatchObject({ status: 422, code: TOO_MANY_FILES_ERROR_CODE });
    expect(sentenceOf(answer.html)).toBe(tooManyFilesSentence(3, 2));
    expect(three.map(albums.state)).toEqual(["pending", "pending", "pending"]);
    const id = await albums.saved(three.slice(0, 2));
    const five = [...three.slice(0, 2), albums.mint(), albums.mint(), albums.mint()];
    expect(sentenceOf((await refusal(await albums.edit(id, five))).html)).toBe(
      tooManyFilesSentence(5, 2),
    );
  });

  test("a list a lowered count already passes may still be edited, so long as it does not grow", async () => {
    const [a, b, c] = [albums.mint(), albums.mint(), albums.mint()];
    const id = await albums.saved([a, b, c]);
    process.env[MAX_LIST_FILES_ENV_VAR] = "2";
    expect((await albums.edit(id, [a, b, c])).status).toBe(200);
    expect((await albums.edit(id, [a, c, removed(b)])).status).toBe(200);
    const grown = [a, c, albums.mint(), albums.mint()];
    expect(await refusal(await albums.edit(id, grown))).toMatchObject({
      code: TOO_MANY_FILES_ERROR_CODE,
    });
  });
});

describe("a required list", () => {
  const albums = useAlbumsRouter({ ...ALBUM_FIELD, required: true });

  test("refuses a save that leaves it empty, on a create and on an edit", async () => {
    const { response } = await albums.create([]);
    expect(await refusal(response)).toMatchObject({
      status: 422,
      code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    });
    const keys = [albums.mint()];
    const id = await albums.saved(keys);
    expect(await refusal(await albums.edit(id, keys.map(removed)))).toMatchObject({
      status: 422,
      code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    });
    expect(albums.albumOf(id)).toEqual(keys);
    expect(albums.state(keys[0] as string)).toBe("owned");
  });
});

describe("what generated code hands back is the list the router checked, or nothing", () => {
  const albums = useAlbumsRouter();

  const rewrites: readonly [string, (album: readonly CapabilityFileProjection[]) => unknown][] = [
    ["an entry dropped", (album) => album.slice(1)],
    ["an entry added twice", (album) => [...album, album[0]]],
    ["the entries reordered", (album) => [...album].reverse()],
    ["null for the list", () => null],
    ["one file for the list", (album) => album[0]],
  ];

  for (const [name, rewrite] of rewrites) {
    test(`refuses ${name} before anything is written`, async () => {
      const keys = [albums.mint(), albums.mint()];
      const id = await albums.saved(keys);
      const added = albums.mint();
      const before = { stored: albums.stored(), ledger: albums.ledgerRows() };
      const refusals: unknown[] = [];
      const loadHandler: HandlerLoader = async () => async (context: CapabilityUpdateContext) => {
        const album = context.input.values[ALBUM] as readonly CapabilityFileProjection[];
        try {
          return context.present(context.mutation.update({ [ALBUM]: rewrite(album) }));
        } catch (error) {
          refusals.push(error);
          throw error;
        }
      };
      const response = await albums.edit(id, [...keys, added], loadHandler);
      expect(response.status).toBe(500);
      expect(refusals[0]).toBeInstanceOf(FileFieldWriteError);
      expect({ stored: albums.stored(), ledger: albums.ledgerRows() }).toEqual(before);
      expect(albums.albumOf(id)).toEqual(keys);
    });
  }

  test("refuses a create that reorders or drops the list it was handed, writing nothing", async () => {
    const rewrites = [
      (album: readonly CapabilityFileProjection[]) => [...album].reverse(),
      (album: readonly CapabilityFileProjection[]) => album.slice(1),
    ];
    for (const rewrite of rewrites) {
      const keys = [albums.mint(), albums.mint()];
      const before = { stored: albums.stored(), ledger: albums.ledgerRows() };
      const refusals: unknown[] = [];
      const loadHandler: HandlerLoader = async () => async (context: CapabilityCreateContext) => {
        const album = context.input.values[ALBUM] as readonly CapabilityFileProjection[];
        try {
          return context.present(
            context.mutation.create({ caption: "x", [ALBUM]: rewrite(album) }),
          );
        } catch (error) {
          refusals.push(error);
          throw error;
        }
      };
      const response = await albums.request("/capability/photos/create", albumBody(keys), {
        loadHandler,
      });
      expect(response.status).toBe(500);
      expect(refusals[0]).toBeInstanceOf(FileFieldWriteError);
      expect({ stored: albums.stored(), ledger: albums.ledgerRows() }).toEqual(before);
    }
  });

  test("and writes it once when a Handler saves the same edit twice", async () => {
    const keys = [albums.mint(), albums.mint()];
    const id = await albums.saved(keys);
    const next = [keys[1] as string, albums.mint()];
    const posted = [...next, removed(keys[0] as string)];
    const loadHandler: HandlerLoader = async () => async (context: CapabilityUpdateContext) => {
      const patch = { caption: "Porto", [ALBUM]: context.input.values[ALBUM] };
      context.mutation.update(patch);
      return context.present(context.mutation.update(patch));
    };
    expect((await albums.edit(id, posted, loadHandler)).status).toBe(200);
    expect(albums.albumOf(id)).toEqual(next);
    expect([...keys, ...next].map(albums.state)).toEqual(["gone", "owned", "owned", "owned"]);
  });

  test("and writes the checked list when it hands back a copy, or leaves the list out", async () => {
    for (const give of [(album: unknown) => structuredClone(album), () => undefined]) {
      const keys = [albums.mint(), albums.mint()];
      const id = await albums.saved(keys);
      const next = [keys[1] as string, albums.mint()];
      const posted = [...next, removed(keys[0] as string)];
      const loadHandler: HandlerLoader = async () => async (context: CapabilityUpdateContext) => {
        const given = give(context.input.values[ALBUM]);
        const patch =
          given === undefined ? { caption: "Porto" } : { caption: "Porto", [ALBUM]: given };
        return context.present(context.mutation.update(patch));
      };
      expect((await albums.edit(id, posted, loadHandler)).status).toBe(200);
      expect(albums.albumOf(id)).toEqual(next);
      expect(albums.state(keys[0] as string)).toBe("gone");
    }
  });
});
