// A create claiming a pending photo, through the router and the hand-written photos fixture. The
// upload route is 7.1/07's, so each case mints its ledger rows directly.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  type FileLedgerSeed,
  requireFileLedgerRow,
  seedFileLedgerRow,
} from "../../../platform/files/ledger.test-support.ts";
import {
  FILE_LEDGER_TABLE,
  type FileLedgerRow,
  mintFileKey,
} from "../../../platform/files/ledger.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { capabilityCreateErrorId } from "../../../presentation/index.ts";
import { SECOND_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import { INVALID_FILE_REFERENCE_ERROR_CODE } from "../../../registry/index.ts";
import { createApp } from "../../../server/app.ts";
import { createMutationCoordinator } from "../../concurrency/mutation-coordinator.ts";
import {
  type CapabilityActionRecord,
  type CapabilityFileProjection,
  FILE_URL_PREFIX,
} from "../../data/index.ts";
import type { CapabilityContext, CapabilityCreateContext } from "../contract.ts";
import { ALUNA_PRESENT_MARKER, ALUNA_RECORD_ID_MARKER } from "../wire/wire-protocol.ts";
import {
  install,
  makeSpyLoader,
  NOTES_INCARNATION_ID,
  photosRow,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";
import type { CapabilityRouterDeps, HandlerLoader } from "./router.ts";

const PHOTO = "photo";

function createBody(caption: string, photo?: string): RequestInit {
  const body = new URLSearchParams([
    [ALUNA_PRESENT_MARKER, "caption"],
    ["caption", caption],
  ]);
  if (photo !== undefined) {
    body.append(ALUNA_PRESENT_MARKER, PHOTO);
    body.append(PHOTO, photo);
  }
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

function projectionOf(row: FileLedgerRow): CapabilityFileProjection {
  return {
    url: `${FILE_URL_PREFIX}${row.key}`,
    name: row.name,
    kind: row.kind as CapabilityFileProjection["kind"],
    mime: row.mime,
    size: row.size,
  };
}

function createHandler(
  write: (context: CapabilityCreateContext) => CapabilityActionRecord,
): HandlerLoader {
  return async () => async (context: CapabilityCreateContext) => context.present(write(context));
}

/** A scratch database with the photos fixture installed, fresh for every case. */
function usePhotosRouter() {
  const scratch: { dir?: string; conns?: PlatformDatabase } = {};
  beforeEach(() => {
    const env = setupRouterTest();
    Object.assign(scratch, { dir: env.dir, conns: env.conns });
    install(env.conns, photosRow());
  });
  afterEach(() => {
    if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
  });

  const conns = (): PlatformDatabase => {
    if (!scratch.conns) throw new Error("the photos router is used outside a test");
    return scratch.conns;
  };
  return {
    conns,
    mint: (overrides: Partial<FileLedgerSeed> = {}) =>
      seedFileLedgerRow(conns().readwrite, {
        capabilityId: "photos",
        incarnationId: NOTES_INCARNATION_ID,
        field: PHOTO,
        ...overrides,
      }),
    request: (path: string, init?: RequestInit, deps: Partial<CapabilityRouterDeps> = {}) => {
      const { mutationCoordinator, ...router } = deps;
      // The app owns the coordinator its routes share, so one handed only to the router is unused.
      return createApp({
        capabilityRouter: { databases: conns(), ...router },
        ...(mutationCoordinator ? { mutationCoordinator } : {}),
      }).request(path, init);
    },
    stored: () =>
      conns().readwrite.query(`SELECT "id", "photo" FROM "cap_photos"`).all() as {
        id: string;
        photo: string | null;
      }[],
    ledger: (key: string) => requireFileLedgerRow(conns().readwrite, key),
    ledgerRows: () => conns().readwrite.query(`SELECT * FROM ${FILE_LEDGER_TABLE}`).all(),
  };
}

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
    const projection = projectionOf(photos.ledger(key));
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
    expect(html).toContain(`src="${FILE_URL_PREFIX}${key}"`);
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
    ["the served address", () => `${FILE_URL_PREFIX}${photos.mint()}`],
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
      const sentence = /<p[^>]*>([^<]+)<\/p>/.exec(body)?.[1] ?? "";
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
      const mutationCoordinator = createMutationCoordinator();
      const acquire = mutationCoordinator.tryAcquireRecordWrite.bind(mutationCoordinator);
      let flipped = 0;
      // The route takes this lease after its first check and before the transaction opens.
      mutationCoordinator.tryAcquireRecordWrite = () => {
        flipped += 1;
        photos
          .conns()
          .readwrite.run(`UPDATE ${FILE_LEDGER_TABLE} SET ${assignment} WHERE "key" = ?`, [key]);
        return acquire();
      };
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
  const keyOf = (photo: CapabilityFileProjection) => photo.url.slice(FILE_URL_PREFIX.length);
  const values: readonly [string, (photo: CapabilityFileProjection, other: string) => unknown][] = [
    ["a null the save never asked for", () => null],
    [
      "another pending key's address",
      (photo, other) => ({ ...photo, url: FILE_URL_PREFIX + other }),
    ],
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
    const projection = projectionOf(photos.ledger(key));
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

describe("an edit of the caption keeps a claimed photo", () => {
  const photos = usePhotosRouter();

  test("the update never names the photo column, and the card still draws the photo", async () => {
    const key = photos.mint();
    await photos.request("/capability/photos/create", createBody("Dawn", key));
    const [record] = photos.stored();
    if (!record) throw new Error("the create stored nothing");
    // Aborts any UPDATE whose SET names the column, so "kept" is proved, not inferred.
    photos.conns().readwrite.exec(
      `CREATE TRIGGER "photo_untouched" BEFORE UPDATE OF "photo" ON "cap_photos"
       BEGIN SELECT RAISE(ABORT, 'the photo column was written'); END;`,
    );
    const body = new URLSearchParams([
      [ALUNA_PRESENT_MARKER, "caption"],
      ["caption", "Dusk"],
      [ALUNA_RECORD_ID_MARKER, record.id],
    ]);

    const response = await photos.request("/capability/photos/update", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`src="${FILE_URL_PREFIX}${key}"`);
    expect(photos.stored()).toEqual([record]);
    expect(photos.ledger(key)).toMatchObject({ state: "owned", record_id: record.id });
  });
});

describe("a write queued behind the Handler's answer is refused", () => {
  const photos = usePhotosRouter();
  type Late = (context: CapabilityCreateContext, write: () => void) => Promise<string>;
  const handlers: readonly [string, Late][] = [
    [
      "a Handler that never awaited",
      async (_context, write) => {
        queueMicrotask(write);
        return "<p>answered first</p>";
      },
    ],
    [
      "a write queued in the turn an awaiting Handler answers in",
      async (_context, write) => {
        await null;
        queueMicrotask(write);
        return "<p>answered first</p>";
      },
    ],
    [
      "work a Handler left running when it answered",
      async (_context, write) => {
        await null;
        void (async () => {
          for (let turn = 0; turn < 3; turn += 1) await null;
          write();
        })();
        return "<p>answered first</p>";
      },
    ],
  ];

  for (const [name, late] of handlers) {
    test(name, async () => {
      const key = photos.mint();
      const refused: unknown[] = [];
      const loadHandler: HandlerLoader = async () => (context: CapabilityCreateContext) =>
        late(context, () => {
          try {
            context.mutation.create({ caption: "Late", photo: context.input.values.photo });
          } catch (error) {
            refused.push(error);
          }
        });

      const response = await photos.request("/capability/photos/create", createBody("Late", key), {
        loadHandler,
      });
      await Bun.sleep(0);

      expect(response.status).toBe(200);
      expect(refused).toHaveLength(1);
      expect(photos.stored()).toEqual([]);
      expect(photos.ledger(key).state).toBe("pending");
    });
  }
});

describe("the write window's edges", () => {
  const photos = usePhotosRouter();

  test("a Handler that answers with a promise holds it open until that promise is adopted", async () => {
    const outcomes: string[] = [];
    const loadHandler: HandlerLoader = async () => async (context: CapabilityCreateContext) => {
      const write = (caption: string) => () => {
        try {
          context.mutation.create({ caption });
          outcomes.push(`${caption} written`);
        } catch {
          outcomes.push(`${caption} refused`);
        }
      };
      queueMicrotask(write("during"));
      void (async () => {
        for (let turn = 0; turn < 5; turn += 1) await null;
        write("after")();
      })();
      return Promise.resolve("<p>answered with a promise</p>");
    };

    const response = await photos.request("/capability/photos/create", createBody("x"), {
      loadHandler,
    });
    await Bun.sleep(0);

    expect(response.status).toBe(200);
    expect(outcomes).toEqual(["during written", "after refused"]);
  });

  test("a guarded write keeps its name and arity", async () => {
    let seen: readonly [string, number] | undefined;
    const loadHandler = createHandler(({ input, mutation }) => {
      seen = [mutation.create.name, mutation.create.length];
      return mutation.create({ caption: input.values.caption });
    });

    await photos.request("/capability/photos/create", createBody("x"), { loadHandler });

    expect(seen).toEqual(["create", 1]);
  });
});
