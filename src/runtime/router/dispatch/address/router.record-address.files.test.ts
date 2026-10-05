// What a record address draws of a record holding a file, and of a capability with no record view.

import { describe, expect, test } from "bun:test";
import { FILE_URL_PREFIX } from "../../../../platform/files/file-url.ts";
import { RECORD_TEMPLATE_ID_PREFIX } from "../../../../presentation/index.ts";
import { FULL_CAPABILITY_TOOLS } from "../../../../registry/index.ts";
import { usePhotosRouter } from "../files/router.file.test-support.ts";
import { photosRow } from "../router.test-support.ts";

const IN_PAGE = { headers: { "HX-Request": "true" } };

describe("a record address naming a record that holds a file", () => {
  const photos = usePhotosRouter();

  test("draws the file as the card's view does, and never its stored reference", async () => {
    const key = photos.mint();
    photos.place(key);
    const id = await photos.save(key);
    const response = await photos.request(`/capability/photos/${id}`, IN_PAGE);
    const fragment = await response.text();
    expect(response.status).toBe(200);

    const stored = photos.photoOf(id);
    expect(stored).toMatchObject({ key });
    const cards = await (await photos.request("/capability/photos/read", IN_PAGE)).text();
    const opening = `<template id="${RECORD_TEMPLATE_ID_PREFIX}-photos-${id}">`;
    expect(cards).toContain(opening);
    const from = cards.indexOf(opening) + opening.length;
    expect(fragment).toContain(cards.slice(from, cards.indexOf("</template>", from)));
    expect(fragment).toContain(`${FILE_URL_PREFIX}${key}`);
    for (const spelling of ['"key"', "&quot;key&quot;", "&#34;key&#34;"]) {
      expect(fragment).not.toContain(spelling);
    }
  });
});

describe("a record address on a capability that cannot update", () => {
  const photos = usePhotosRouter();

  test("opens nothing in the window and says nothing, so the desk opens the collection", async () => {
    const id = await photos.save();
    const tools = FULL_CAPABILITY_TOOLS.filter((action) => action !== "update");
    const lookupCapability = () => photosRow({ tools });
    const inPage = await photos.request(`/capability/photos/${id}`, IN_PAGE, { lookupCapability });
    expect(inPage.status).toBe(404);
    expect(await inPage.text()).toBe("");
    const page = await photos.request(`/capability/photos/${id}`, {}, { lookupCapability });
    expect(page.status).toBe(404);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect((await photos.request(`/capability/photos/${id}`, IN_PAGE)).status).toBe(200);
  });
});
