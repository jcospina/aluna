import { expect, test } from "bun:test";
import {
  ARTIFACTS_ROOT_ENV_VAR,
  DEFAULT_ARTIFACTS_ROOT,
  resolveArtifactsRoot,
} from "./artifacts-root.ts";

test("the artifacts root is the setting, or the default when it is unset or blank", () => {
  expect(resolveArtifactsRoot({})).toBe(DEFAULT_ARTIFACTS_ROOT);
  expect(resolveArtifactsRoot({ [ARTIFACTS_ROOT_ENV_VAR]: "   " })).toBe(DEFAULT_ARTIFACTS_ROOT);
  expect(resolveArtifactsRoot({ [ARTIFACTS_ROOT_ENV_VAR]: " /srv/aluna/capabilities " })).toBe(
    "/srv/aluna/capabilities",
  );
});
