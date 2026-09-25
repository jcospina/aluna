// A create claiming a pending photo, through the router and the hand-written photos fixture. Each
// case mints its ledger rows directly, as the upload route would.

import { describe, expect, test } from "bun:test";

import { fileUrl } from "../../../platform/files/file-url.ts";
import { FILE_LEDGER_TABLE, mintFileKey } from "../../../platform/files/ledger.ts";
import { capabilityCreateErrorId } from "../../../presentation/index.ts";
import { SECOND_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import { INVALID_FILE_REFERENCE_ERROR_CODE } from "../../../registry/index.ts";
import { type CapabilityFileProjection, projectFileLedgerRow } from "../../data/index.ts";
import type { CapabilityContext, CapabilityCreateContext } from "../contract.ts";
import {
  between,
  createBody,
  createHandler,
  keyOf,
  PHOTO,
  sentenceOf,
  usePhotosRouter,
} from "./router.file.test-support.ts";
import { makeSpyLoader } from "./router.test-support.ts";
import type { CapabilityRouterDeps, HandlerLoader } from "./router.ts";

describe("a create claims a pending photo", () => {
  const photos = usePhotosRouter();

  test("it stores the reference built from the ledger row, and the record owns the key", async () => {
    const key = photos.mint({ name: "harbour.jpg", mime: "image/png", size: 7_340 });

    const response = await photos.request("/capability/photos/create", createBody("Dawn", key));

    expect(response.status).toBe(200);
    const [record] = photos.stored();
    expect(JSON.parse(record?.photo ?? "null")).toEqual({
      key,
      kind: "image",
      mime: "image/png",
      size: 7_340,
      name: "harbour.jpg",
    });
    expect(photos.ledger(key)).toMatchObject({ state: "owned", record_id: record?.id });
  });

  test("a create that names no photo, or submits the field empty, stores nothing", async () => {
    for (const photo of [undefined, ""]) {
      const response = await photos.request("/capability/photos/create", createBody("Bare", photo));
      expect(response.status).toBe(200);
    }
    expect(photos.stored().map((record) => record.photo)).toEqual([null, null]);
  });

  test("the router's input, the create's return, read rows and the card carry the projection", async () => {
    const key = photos.mint({ name: "tide.jpg", mime: "image/jpeg", size: 1_024 });
    const projection = projectFileLedgerRow(photos.ledger(key));
    const seen = { input: [] as unknown[], created: [] as unknown[], read: [] as unknown[] };
    const drawn: unknown[] = [];
    const create = createHandler(({ input, mutation }) => {
      seen.input.push(Object.hasOwn(input.values, PHOTO) ? input.values.photo : "absent");
      const record = mutation.create({ caption: input.values.caption, photo: input.values.photo });
      seen.created.push(record.fields.photo);
      return record;
    });
    const deps: Partial<CapabilityRouterDeps> = {
      loadHandler: async (path, action) => {
        if (action !== "read") return create(path, action);
        return async ({ query, present }: CapabilityContext) => {
          const rows = query.records({
            sql: `SELECT "id" AS "target_id" FROM "cap_photos" ORDER BY "caption"`,
          });
          seen.read.push(...rows.map(({ record }) => record.fields.photo));
          return rows.map(({ record }) => present(record)).join("");
        };
      },
      loadItemRenderer: async () => (record) => {
        drawn.push(record.photo);
        return "<p>card</p>";
      },
    };

    for (const [caption, photo] of [
      ["A", key],
      ["B", ""],
      ["C", undefined],
    ] as const) {
      await photos.request("/capability/photos/create", createBody(caption, photo), deps);
    }
    drawn.length = 0;
    const response = await photos.request("/capability/photos/read", undefined, deps);

    expect(response.status).toBe(200);
    expect(seen.input).toEqual([projection, null, "absent"]);
    expect(seen.created).toEqual([projection, null, null]);
    expect(seen.read).toEqual([projection, null, null]);
    expect(drawn).toEqual([projection, null, null]);
  });

  test("the real fixture saves the photo and its card draws it through the projection's url", async () => {
    const key = photos.mint({ name: "harbour.jpg" });

    const created = await photos.request("/capability/photos/create", createBody("Dawn", key));
    const read = await photos.request("/capability/photos/read");

    expect(created.status).toBe(200);
    const html = await read.text();
    expect(html).toContain(`src="${fileUrl(key)}"`);
    expect(html).toContain('alt="harbour.jpg"');
  });
});

describe("a reference this field may not claim is refused before generated code runs", () => {
  const photos = usePhotosRouter();
  const cases: readonly [string, () => string][] = [
    ["another field's key", () => photos.mint({ field: "cover" })],
    ["another incarnation's key", () => photos.mint({ incarnationId: SECOND_INCARNATION_ID })],
    ["an owned key", () => photos.mint({ state: "owned" })],
    ["a key already given up", () => photos.mint({ state: "cleanup_enqueued" })],
    [
      "a kind the field does not accept",
      () => photos.mint({ kind: "document", mime: "application/pdf" }),
    ],
    ["an unknown key", () => mintFileKey()],
    ["a malformed value", () => "harbour.jpg"],
    ["a key in upper case", () => photos.mint().toUpperCase()],
    ["the served address", () => fileUrl(photos.mint())],
  ];

  for (const [name, reference] of cases) {
    test(name, async () => {
      const key = reference();
      const before = photos.ledgerRows();
      const spy = makeSpyLoader();

      const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
        loadHandler: spy.loadHandler,
      });

      expect(response.status).toBe(422);
      expect(response.headers.get("HX-Retarget")).toBe(`#${capabilityCreateErrorId("photos")}`);
      const body = await response.text();
      expect(body).toContain(`data-error-code="${INVALID_FILE_REFERENCE_ERROR_CODE}"`);
      expect(body).toContain(`data-error-fields="${PHOTO}"`);
      const sentence = sentenceOf(body);
      expect(sentence).toMatch(/file/);
      expect(sentence).not.toMatch(/key|ledger|reference|incarnation|pending/i);
      expect(spy.calls).toEqual([]);
      expect(photos.stored()).toEqual([]);
      expect(photos.ledgerRows()).toEqual(before);
    });
  }
});

describe("the check runs again inside the save's transaction", () => {
  const photos = usePhotosRouter();
  const flips: readonly [string, string][] = [
    ["another save claimed it", `"state" = 'owned', "record_id" = 'someone-else'`],
    ["a sweep took it", `"state" = 'cleanup_enqueued'`],
  ];

  for (const [name, assignment] of flips) {
    test(`and refuses the save when ${name} between the two checks`, async () => {
      const key = photos.mint();
      let flipped = 0;
      const mutationCoordinator = between(() => {
        flipped += 1;
        photos
          .conns()
          .readwrite.run(`UPDATE ${FILE_LEDGER_TABLE} SET ${assignment} WHERE "key" = ?`, [key]);
      });
      const spy = makeSpyLoader();

      const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
        loadHandler: spy.loadHandler,
        mutationCoordinator,
      });

      expect(flipped).toBe(1);
      expect(response.status).toBe(422);
      expect(await response.text()).toContain(
        `data-error-code="${INVALID_FILE_REFERENCE_ERROR_CODE}"`,
      );
      expect(spy.calls).toEqual([]);
      expect(photos.stored()).toEqual([]);
    });
  }
});

describe("what a Handler hands back for a photo", () => {
  const photos = usePhotosRouter();

  test("an edited projection still writes the ledger's name and type", async () => {
    const key = photos.mint({ name: "tide.jpg", mime: "image/jpeg" });
    const loadHandler = createHandler(({ input, mutation }) =>
      mutation.create({
        caption: input.values.caption,
        photo: { ...(input.values.photo as object), name: "renamed.gif", mime: "image/gif" },
      }),
    );

    const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
      loadHandler,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(photos.stored()[0]?.photo ?? "null")).toMatchObject({
      key,
      name: "tide.jpg",
      mime: "image/jpeg",
    });
  });

  test("leaving the photo out writes the submission", async () => {
    const key = photos.mint();
    const loadHandler = createHandler(({ input, mutation }) =>
      mutation.create({ caption: input.values.caption }),
    );

    const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
      loadHandler,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(photos.stored()[0]?.photo ?? "null")).toMatchObject({ key });
    expect(photos.ledger(key).state).toBe("owned");
  });
});

describe("any other value from generated code is refused before anything is written", () => {
  const photos = usePhotosRouter();
  const values: readonly [string, (photo: CapabilityFileProjection, other: string) => unknown][] = [
    ["a null the save never asked for", () => null],
    ["another pending key's address", (photo, other) => ({ ...photo, url: fileUrl(other) })],
    [
      "the stored shape",
      ({ url: _url, ...rest }) => ({ key: keyOf({ url: _url, ...rest }), ...rest }),
    ],
    ["the bare key", (photo) => keyOf(photo)],
    ["the address alone", (photo) => ({ url: photo.url })],
    ["a projection with a key added", (photo) => ({ ...photo, key: keyOf(photo) })],
    ["an address off the served route", (photo) => ({ ...photo, url: `/other/${keyOf(photo)}` })],
  ];

  for (const [name, value] of values) {
    test(name, async () => {
      const key = photos.mint();
      const other = photos.mint();
      const loadHandler = createHandler(({ input, mutation }) =>
        mutation.create({
          caption: input.values.caption,
          photo: value(input.values.photo as CapabilityFileProjection, other),
        }),
      );

      const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
        loadHandler,
      });

      expect(response.status).toBe(500);
      expect(photos.stored()).toEqual([]);
      expect(photos.ledger(key).state).toBe("pending");
      expect(photos.ledger(other).state).toBe("pending");
    });
  }

  test("a projection handed back when the save named no photo", async () => {
    const key = photos.mint();
    const projection = projectFileLedgerRow(photos.ledger(key));
    const loadHandler = createHandler(({ input, mutation }) =>
      mutation.create({ caption: input.values.caption, photo: projection }),
    );

    const response = await photos.request("/capability/photos/create", createBody("Dawn"), {
      loadHandler,
    });

    expect(response.status).toBe(500);
    expect(photos.stored()).toEqual([]);
    expect(photos.ledger(key).state).toBe("pending");
  });
});

describe("a save that does not finish gives its key back", () => {
  const photos = usePhotosRouter();

  test("a Handler that fails after its create leaves the key pending and no record", async () => {
    const key = photos.mint();
    const loadHandler: HandlerLoader = async () => async (context: CapabilityCreateContext) => {
      context.mutation.create({ caption: "Dawn", photo: context.input.values.photo });
      throw new Error("the Handler broke after writing");
    };

    const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
      loadHandler,
    });

    expect(response.status).toBe(500);
    expect(photos.stored()).toEqual([]);
    expect(photos.ledger(key)).toMatchObject({ state: "pending", record_id: null });
  });

  test("an insert that fails gives the key back, even to a Handler that answers anyway", async () => {
    const key = photos.mint();
    photos.conns().readwrite.exec(
      `CREATE TRIGGER "refuse_photos" BEFORE INSERT ON "cap_photos"
       BEGIN SELECT RAISE(ABORT, 'the insert failed'); END;`,
    );
    const loadHandler: HandlerLoader = async () => async (context: CapabilityCreateContext) => {
      try {
        context.mutation.create({ caption: "Dawn", photo: context.input.values.photo });
      } catch {
        // Swallowed, so the route answers 200 and commits whatever the transaction holds.
      }
      return "<p>saved, it thinks</p>";
    };

    const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
      loadHandler,
    });

    expect(response.status).toBe(200);
    expect(photos.stored()).toEqual([]);
    expect(photos.ledger(key)).toMatchObject({ state: "pending", record_id: null });
  });
});
