import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CAPABILITY_LOGO_FILENAME } from "./artifact-names.ts";
import {
  capabilityLogoExists,
  capabilityLogoPath,
  installCapabilityLogo,
  LogoInstallError,
} from "./storage.ts";

const CAPABILITY = "notes";
const INCARNATION = "11111111-1111-4111-8111-111111111111";
const ARTWORK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omni-crud-logo-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function install(bytes: Uint8Array, attempt = 1): void {
  installCapabilityLogo({
    artifactsRoot: root,
    capabilityId: CAPABILITY,
    incarnationId: INCARNATION,
    attempt,
    bytes,
  });
}

function stagingEntries(): string[] {
  const staging = join(root, CAPABILITY, INCARNATION, ".staging");
  return existsSync(staging) ? readdirSync(staging) : [];
}

describe("where a logo lives", () => {
  test("beside the immutable version directories, never inside one", () => {
    const path = capabilityLogoPath(root, CAPABILITY, INCARNATION);

    expect(path.endsWith(join(CAPABILITY, INCARNATION, CAPABILITY_LOGO_FILENAME))).toBe(true);
    // The load-bearing property: retry installs after activation, so the file must not be
    // inside a published `vN/` whose `snapshot.json` states an exact inventory.
    expect(path).not.toContain(`${INCARNATION}/v`);
  });

  test("the installed file is outside every published snapshot inventory", () => {
    const versionDirectory = join(root, CAPABILITY, INCARNATION, "v1");
    mkdirSync(versionDirectory, { recursive: true });
    install(ARTWORK);

    expect(readdirSync(versionDirectory)).toEqual([]);
    expect(readdirSync(join(root, CAPABILITY, INCARNATION)).sort()).toEqual([
      ".staging",
      "logo.svg",
      "v1",
    ]);
  });
});

describe("installation", () => {
  test("lands the exact bytes and leaves no staging artifact behind", () => {
    install(ARTWORK);

    expect(capabilityLogoExists(root, CAPABILITY, INCARNATION)).toBe(true);
    expect(readFileSync(capabilityLogoPath(root, CAPABILITY, INCARNATION)).equals(ARTWORK)).toBe(
      true,
    );
    expect(stagingEntries()).toEqual([]);
  });

  test("refuses to overwrite artwork that is already there, and keeps the first", () => {
    install(ARTWORK, 1);
    const second = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>');

    expect(() => install(second, 2)).toThrow(LogoInstallError);

    // L7: a logo is made once and never remade. The loser fails loudly rather than
    // quietly replacing a drawing the desk is already showing.
    expect(readFileSync(capabilityLogoPath(root, CAPABILITY, INCARNATION)).equals(ARTWORK)).toBe(
      true,
    );
  });

  test("a refused install removes its temporary file in finally", () => {
    install(ARTWORK, 1);
    expect(() => install(ARTWORK, 2)).toThrow(LogoInstallError);

    // Recovery never has to guess from an untracked staging artifact.
    expect(stagingEntries()).toEqual([]);
  });

  test("two incarnations of one capability keep separate artwork", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const otherBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>');

    install(ARTWORK);
    installCapabilityLogo({
      artifactsRoot: root,
      capabilityId: CAPABILITY,
      incarnationId: other,
      attempt: 1,
      bytes: otherBytes,
    });

    expect(readFileSync(capabilityLogoPath(root, CAPABILITY, INCARNATION)).equals(ARTWORK)).toBe(
      true,
    );
    expect(readFileSync(capabilityLogoPath(root, CAPABILITY, other)).equals(otherBytes)).toBe(true);
  });

  test("deleting the incarnation tree carries the artwork away with it", () => {
    install(ARTWORK);
    rmSync(join(root, CAPABILITY, INCARNATION), { recursive: true, force: true });

    // ADR-0006's existing cleanup owns the whole tree, so no second cleanup path exists.
    expect(capabilityLogoExists(root, CAPABILITY, INCARNATION)).toBe(false);
  });
});
