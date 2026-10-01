// The edit form the server draws, posted back through the router as a browser posts it: what each
// file field says it was drawn with is what the record stores, whatever the read Handler presented,
// and a list's form drawn before another window saved it never keeps a file that window removed.

import { describe, expect, test } from "bun:test";
import { renderEditForm } from "../../../../presentation/fields/field-renderer.ts";
import { submittedInputs } from "../../../../presentation/fields/form-submission.test-support.ts";
import { renderableFromRow } from "../../../../presentation/fields/renderable-capability.ts";
import { ALBUM_FIELD } from "../../../../registry/fields/file.test-support.ts";
import { capabilitySpecFromRow, RECORD_CHANGED_ERROR_CODE } from "../../../../registry/index.ts";
import { type CapabilityActionRecord, FILE_REMOVE_PREFIX } from "../../../data/index.ts";
import type { CapabilityContext } from "../../contract.ts";
import {
  ALUNA_DRAWN_MARKER,
  ALUNA_PRESENT_MARKER,
  drawnFileValue,
} from "../../wire/wire-protocol.ts";
import { createCapabilityDataTool, photosRow } from "../router.test-support.ts";
import type { HandlerLoader } from "../router.ts";
import { albumsRow, editBody, PHOTO, usePhotosRouter } from "./router.file.test-support.ts";

const ALBUM = ALBUM_FIELD.name;

function formPost(pairs: readonly [string, string][]): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(pairs).toString(),
  };
}

describe("a list edited through the form the server draws", () => {
  const albums = usePhotosRouter(albumsRow);
  const mint = () => albums.mint({ field: ALBUM });
  const albumOf = (id: string) => {
    const tool = createCapabilityDataTool(capabilitySpecFromRow(albumsRow()), albums.conns());
    return tool.select().find((record) => record.id === id);
  };
  const form = (id: string) => renderEditForm(renderableFromRow(albumsRow()), albumOf(id) ?? {});

  /** The pairs `html` posts, its album's keys swapped for `keys`. */
  async function posting(html: string, keys: readonly string[]) {
    const rest = (await submittedInputs(html)).filter(([name]) => name !== ALBUM);
    return formPost([...rest, ...keys.map((key): [string, string] => [ALBUM, key])]);
  }

  async function saved(keys: readonly string[]): Promise<string> {
    const body = formPost([
      [ALUNA_PRESENT_MARKER, "caption"],
      ["caption", "Lisbon"],
      [ALUNA_PRESENT_MARKER, ALBUM],
      ...keys.map((key): [string, string] => [ALBUM, key]),
    ]);
    const before = new Set(albums.stored().map((record) => record.id));
    expect((await albums.request("/capability/photos/create", body)).status).toBe(200);
    const id = albums.stored().find((record) => !before.has(record.id))?.id;
    if (!id) throw new Error("the create stored nothing");
    return id;
  }

  test("keeps, removes and adds from the form as drawn", async () => {
    const [a, b] = [mint(), mint()];
    const id = await saved([a, b]);
    const added = mint();
    const html = form(id);
    expect(html).toContain(`value="${drawnFileValue(ALBUM, [a, b])}"`);

    const response = await albums.request(
      "/capability/photos/update",
      await posting(html, [added, a, `${FILE_REMOVE_PREFIX}${b}`]),
    );

    expect(response.status).toBe(200);
    expect(albums.gone(b)).toBe(true);
    expect(albums.ledger(added)).toMatchObject({ state: "owned", record_id: id });
  });

  test("a form drawn before another window removed a file keeps nothing that window gave up", async () => {
    const [a, b] = [mint(), mint()];
    const id = await saved([a, b]);
    const stale = form(id);
    const fresh = await posting(form(id), [a, `${FILE_REMOVE_PREFIX}${b}`]);
    expect((await albums.request("/capability/photos/update", fresh)).status).toBe(200);
    expect(albums.gone(b)).toBe(true);

    const response = await albums.request(
      "/capability/photos/update",
      await posting(stale, [a, b]),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(`data-error-code="${RECORD_CHANGED_ERROR_CODE}"`);
  });
});

describe("a read Handler that reshapes the photo it presents", () => {
  const photos = usePhotosRouter(photosRow);
  const reshaping: HandlerLoader = async () => async (context: CapabilityContext) =>
    context.query
      .records({ sql: 'SELECT "id" AS "target_id" FROM "cap_photos"' })
      .map(({ record }: { record: CapabilityActionRecord }) =>
        context.present({ ...record, fields: { ...record.fields, photo: "a picture" } }),
      )
      .join("");

  test("still draws the edit form holding the photo the record stores", async () => {
    const key = photos.mint();
    const id = await photos.save(key);

    const response = await photos.request(
      "/capability/photos/read",
      { headers: { "HX-Request": "true" } },
      { loadHandler: reshaping },
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`name="${ALUNA_DRAWN_MARKER}" value="${drawnFileValue(PHOTO, [key])}"`);
    expect(photos.photoOf(id)).toMatchObject({ key });
  });
});

describe("an edit whose form says nothing of what it was drawn with", () => {
  const photos = usePhotosRouter(photosRow);

  test("is asked to open the record again, and gives nothing up", async () => {
    const key = photos.mint();
    const id = await photos.save(key);
    const replacement = photos.mint();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: replacement }),
      {},
      "as-posted",
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(`data-error-code="${RECORD_CHANGED_ERROR_CODE}"`);
    expect(photos.photoOf(id)).toMatchObject({ key });
    expect(photos.ledger(replacement).state).toBe("pending");
  });
});
