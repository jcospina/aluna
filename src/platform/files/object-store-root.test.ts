import { expect, test } from "bun:test";
import {
  OBJECT_STORE_ROOT,
  OBJECT_STORE_ROOT_ENV_VAR,
  resolveObjectStoreRoot,
} from "./object-store-root.ts";

test("the object store's root is the setting, or the default when it is unset or blank", () => {
  expect(resolveObjectStoreRoot({})).toBe(OBJECT_STORE_ROOT);
  expect(resolveObjectStoreRoot({ [OBJECT_STORE_ROOT_ENV_VAR]: "   " })).toBe(OBJECT_STORE_ROOT);
  expect(resolveObjectStoreRoot({ [OBJECT_STORE_ROOT_ENV_VAR]: " /srv/aluna/files " })).toBe(
    "/srv/aluna/files",
  );
});
