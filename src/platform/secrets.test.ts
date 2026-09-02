// The vault's two promises: after capture the ambient environment holds no credential,
// and the callers that already read through `env` still get one.
//
// Every case restores whatever the real environment held, because these are the only tests
// in the suite that touch `process.env` on purpose.

import { afterEach, describe, expect, test } from "bun:test";

import { requireRecraftApiKey } from "../lifecycle/logo/generation/provider.ts";
import { API_KEY_ENV_VAR, requireApiKey } from "./provider/config.ts";
import { captureProcessSecrets, clearProcessSecrets, VAULTED_SECRET_ENV_VARS } from "./secrets.ts";

const RECRAFT_ENV_VAR = "RECRAFT_API_KEY";

function withAmbient(values: Record<string, string | undefined>, body: () => void): void {
  const restore = new Map(VAULTED_SECRET_ENV_VARS.map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    body();
  } finally {
    for (const [name, value] of restore) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

afterEach(clearProcessSecrets);

describe("the process secret vault", () => {
  test("takes both credentials out of the ambient environment", () => {
    withAmbient({ [API_KEY_ENV_VAR]: "sk-live", [RECRAFT_ENV_VAR]: "rc-live" }, () => {
      captureProcessSecrets();

      // The whole point: code that walks its way to `process.env` finds nothing there.
      expect(process.env[API_KEY_ENV_VAR]).toBeUndefined();
      expect(process.env[RECRAFT_ENV_VAR]).toBeUndefined();
      expect(API_KEY_ENV_VAR in process.env).toBe(false);
      expect(RECRAFT_ENV_VAR in process.env).toBe(false);
    });
  });

  test("keeps both credentials readable by the callers that need them", () => {
    withAmbient({ [API_KEY_ENV_VAR]: "sk-live", [RECRAFT_ENV_VAR]: "rc-live" }, () => {
      captureProcessSecrets();

      expect(requireApiKey()).toBe("sk-live");
      expect(requireRecraftApiKey()).toBe("rc-live");
    });
  });

  test("answers an explicitly supplied environment from itself alone", () => {
    withAmbient({ [API_KEY_ENV_VAR]: "sk-live", [RECRAFT_ENV_VAR]: "rc-live" }, () => {
      captureProcessSecrets();

      // A caller that hands in `{}` means "this is not set", whatever the vault holds —
      // which is what keeps every other test in the suite honest.
      expect(() => requireApiKey({})).toThrow(API_KEY_ENV_VAR);
      expect(() => requireRecraftApiKey({})).toThrow(RECRAFT_ENV_VAR);
      expect(requireApiKey({ [API_KEY_ENV_VAR]: "sk-supplied" })).toBe("sk-supplied");
    });
  });

  test("capturing an unset variable leaves it unset rather than vaulting an empty value", () => {
    withAmbient({ [API_KEY_ENV_VAR]: undefined, [RECRAFT_ENV_VAR]: "  " }, () => {
      captureProcessSecrets();

      expect(() => requireApiKey()).toThrow(API_KEY_ENV_VAR);
      expect(() => requireRecraftApiKey()).toThrow(RECRAFT_ENV_VAR);
    });
  });

  test("a later capture cannot un-vault what an earlier one took", () => {
    withAmbient({ [API_KEY_ENV_VAR]: "sk-live" }, () => {
      captureProcessSecrets();
      captureProcessSecrets();

      expect(requireApiKey()).toBe("sk-live");
    });
  });
});
