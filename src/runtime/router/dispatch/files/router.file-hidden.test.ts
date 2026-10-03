// A file field evolution hides (Module 7 PLAN decision 34). Hiding never destroys, so the keys the
// field held stay `owned` with their bytes until capability deletion collects them. A form drawn
// before the hide, or before a file field was made required, is refused with a sentence.

import { describe, expect, test } from "bun:test";
import { CAPTION_FIELD, PHOTO_FIELD } from "../../../../registry/fields/file.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  compareAndSwapCapability,
  defaultBehavioralErrorsForSchema,
  effectiveCapabilityLabel,
  FORM_CHANGED_ERROR_CODE,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  type SpecField,
} from "../../../../registry/index.ts";
import { NOTES_INCARNATION_ID, photosRow } from "../router.test-support.ts";
import {
  createBody,
  editBody,
  PHOTO,
  sentenceOf,
  usePhotosRouter,
} from "./router.file.test-support.ts";

const { code_attribute, fields_attribute } = BEHAVIORAL_ERROR_MARKERS;

/** The photos fixture at v2 with `photo` in place of its photo field, off the card. */
function evolvedRow(photo: SpecField) {
  const schema = { fields: [CAPTION_FIELD, photo] };
  const committed = photosRow();
  return photosRow({
    version: 2,
    schema,
    behavioral_errors: defaultBehavioralErrorsForSchema(schema),
    ui_intent: {
      ...committed.ui_intent,
      item: { ...committed.ui_intent.item, shows: ["caption"] },
    },
  });
}

describe("a file field evolution hid", () => {
  const photos = usePhotosRouter();

  const evolve = (photo: SpecField) =>
    compareAndSwapCapability(
      evolvedRow(photo),
      { state: "active", capabilityId: "photos", incarnationId: NOTES_INCARNATION_ID, version: 1 },
      photos.conns().readwrite,
    );
  const hide = () => evolve({ ...PHOTO_FIELD, lifecycle: "inactive" });

  async function refusal(response: Response) {
    const body = await response.text();
    expect(response.status).toBe(422);
    expect(body).toContain(`${code_attribute}="${FORM_CHANGED_ERROR_CODE}"`);
    expect(body).not.toContain(fields_attribute);
    const sentence = sentenceOf(body);
    expect(sentence).toContain(effectiveCapabilityLabel(photosRow()));
    return sentence;
  }

  test("keeps the keys it held owned, and their bytes, while a later edit saves", async () => {
    const key = photos.mint();
    photos.place(key);
    const id = await photos.save(key);
    hide();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk" }),
    );
    expect(response.status).toBe(200);
    expect(photos.ledger(key)).toMatchObject({ state: "owned", record_id: id, field: PHOTO });
    expect(photos.onDisk(key)).toBe(true);
    expect(photos.photoOf(id)).toMatchObject({ key });
  });

  test("refuses a create form still holding a pending upload in it, with a sentence", async () => {
    const key = photos.mint();
    photos.place(key);
    hide();

    const response = await photos.request("/capability/photos/create", createBody("Dawn", key));
    const create = await refusal(response);
    expect(create).not.toBe("");
    expect(create).not.toBe(sentenceOf(await wireError(photos)));
    expect(photos.stored()).toEqual([]);
    expect(photos.ledger(key).state).toBe("pending");
  });

  test("refuses an edit form drawn before the hide, and writes nothing", async () => {
    const held = photos.mint();
    photos.place(held);
    const id = await photos.save(held);
    const replacement = photos.mint();
    photos.place(replacement);
    hide();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk", [PHOTO]: replacement }, { [PHOTO]: [held] }),
      {},
      "as-posted",
    );
    expect(await refusal(response)).not.toBe("");
    expect(photos.ledger(held)).toMatchObject({ state: "owned", record_id: id });
    expect(photos.ledger(replacement).state).toBe("pending");
    expect(photos.onDisk(held)).toBe(true);
    expect(photos.photoOf(id)).toMatchObject({ key: held });
  });

  test("refuses an edit form that kept the photo it was drawn holding", async () => {
    const held = photos.mint();
    const id = await photos.save(held);
    hide();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk", [PHOTO]: held }, { [PHOTO]: [held] }),
      {},
      "as-posted",
    );
    expect(await refusal(response)).not.toBe("");
  });

  test("refuses a form posting only the hidden field's marker, as an empty one does", async () => {
    const id = await photos.save();
    hide();
    const body = new URLSearchParams(editBody(id, { caption: "Dusk" }).body as string);
    body.append("__aluna_present", PHOTO);
    const response = await photos.request(
      "/capability/photos/update",
      { ...editBody(id, {}), body: body.toString() },
      {},
      "as-posted",
    );
    expect(await refusal(response)).not.toBe("");
  });

  test("refuses a create form drawn before the photo was required, and not one drawn after", async () => {
    evolve({ ...PHOTO_FIELD, required: true });
    expect(
      await refusal(await photos.request("/capability/photos/create", createBody("Dawn"))),
    ).not.toBe("");

    const drawnAfter = await photos.request("/capability/photos/create", createBody("Dawn", ""));
    expect(drawnAfter.status).toBe(422);
    expect(await drawnAfter.text()).toContain(
      `${code_attribute}="${MISSING_REQUIRED_FIELDS_ERROR_CODE}"`,
    );
  });
});

/** What a submission the wire cannot read at all answers, to tell the two sentences apart. */
async function wireError(photos: ReturnType<typeof usePhotosRouter>): Promise<string> {
  const response = await photos.request("/capability/photos/create", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "__aluna_unknown=1",
  });
  expect(response.status).toBe(400);
  return response.text();
}
