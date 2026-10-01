// The contract a generated unit is compiled against, and what its prompt says, for a `file[]`: an
// array of the projection a single file arrives as, `[]` when it holds none. A capability without a
// list keeps the contract it had, so code checked before lists checks the same.

import { describe, expect, test } from "bun:test";

import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../../registry/fields/file.test-support.ts";
import { handlersWithMovedFileContract } from "../../../generated-code-check.ts";
import { checkGeneratedUnit } from "../../safety/unit-checks.ts";
import {
  buildUnitPrompt,
  FILE_LIST_ARRIVES,
  ITEM_FILE_FIELD_RULE,
  ITEM_FILE_LIST_RULE,
} from "../unit-prompts.ts";

const create = { kind: "handler", name: "create" } as const;
const item = { kind: "item-renderer", name: "item" } as const;
const albumSpec = () => photoSpec([CAPTION_FIELD, ALBUM_FIELD]);

describe("the contract a capability with a file list is checked against", () => {
  /** A Handler that stores a list of projections in a value of the contract's type `alias`. */
  const holdsAList = (alias: string) =>
    `export default async function create({ mutation, present }: CapabilityCreateContext): Promise<string> {
  const files: readonly CapabilityFileProjection[] = [];
  const value: ${alias} = files;
  return present(mutation.create({ caption: String(value) }));
}
`;

  test("types a save's and a record's list as an array of projections", () => {
    for (const alias of ["CapabilitySaveInputValue", "CapabilityDataColumnValue"]) {
      expect(checkGeneratedUnit(albumSpec(), create, holdsAList(alias))).toBeUndefined();
    }
  });

  test("admits no list where no field holds one, so older code checks as it did", () => {
    for (const alias of ["CapabilitySaveInputValue", "CapabilityDataColumnValue"]) {
      expect(checkGeneratedUnit(photoSpec(), create, holdsAList(alias))).toBeDefined();
    }
  });

  test("moves every Handler's contract when a capability gains or loses its list", () => {
    const both = photoSpec([CAPTION_FIELD, PHOTO_FIELD, ALBUM_FIELD]);
    expect(handlersWithMovedFileContract(photoSpec(), both)).toHaveLength(5);
    expect(handlersWithMovedFileContract(both, photoSpec())).toHaveLength(5);
    expect(handlersWithMovedFileContract(both, both)).toEqual([]);
  });

  test("compiles a create that hands the list back as it was given it", () => {
    const content = `export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {
  const album = input.values.album;
  const count = Array.isArray(album) ? album.length : 0;
  const caption = typeof input.values.caption === "string" ? input.values.caption : "";
  return present(mutation.create({ caption, album })) + String(count);
}
`;
    expect(checkGeneratedUnit(albumSpec(), create, content)).toBeUndefined();
  });
});

describe("what the prompts say of a file list", () => {
  test("a Handler is told the list arrives whole and goes back whole", () => {
    expect(buildUnitPrompt(albumSpec(), create)).toContain(FILE_LIST_ARRIVES);
    expect(buildUnitPrompt(photoSpec(), create)).not.toContain(FILE_LIST_ARRIVES);
  });

  test("a card that shows a list is told to draw every file in order, and the empty list", () => {
    const shown = albumSpec();
    const showing = {
      ...shown,
      ui_intent: { ...shown.ui_intent, item: { ...shown.ui_intent.item, shows: ["album"] } },
    };
    const prompt = buildUnitPrompt(showing, item);
    expect(prompt).toContain(ITEM_FILE_FIELD_RULE);
    expect(prompt).toContain(ITEM_FILE_LIST_RULE);
    const single = photoSpec();
    const photoShown = {
      ...single,
      ui_intent: { ...single.ui_intent, item: { ...single.ui_intent.item, shows: ["photo"] } },
    };
    expect(buildUnitPrompt(photoShown, item)).not.toContain(ITEM_FILE_LIST_RULE);
  });
});
