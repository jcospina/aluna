import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  assertVerifiedPublishedSnapshot,
  publishCapabilitySnapshot,
  type SnapshotFileEntry,
  type SnapshotManifest,
  SnapshotVerificationError,
  verifyCapabilitySnapshot,
} from "./artifact-lifecycle.ts";
import { gateInput, generatedUnitsFor } from "./gate.test-support.ts";
import { type CapabilityGateResult, runCapabilityGate } from "./gate.ts";
import { buildUnitPrompt } from "./unit-prompts.ts";
import type { GeneratedUnit, UnitDescriptor } from "./units.ts";

const INCARNATION_ID = "11111111-1111-4111-8111-111111111111";
const TIER_OFF_FILES = [
  "create.ts",
  "delete.ts",
  "item.ts",
  "read.ts",
  "search.ts",
  "snapshot.json",
  "spec.json",
  "update.ts",
] as const;
const TIER_ON_FILES = [
  "create.ts",
  "delete.ts",
  "item.ts",
  "read.ts",
  "search.ts",
  "snapshot.json",
  "spec.json",
  "tests/behavioral.json",
  "update.ts",
] as const;

function notesSpec(): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        {
          name: "pinned",
          label: "Pinned",
          type: "boolean",
          required: false,
          lifecycle: "active",
        },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
      {
        action: "update",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's text notes.",
  };
}

function notesUnits(): GeneratedUnit[] {
  return [...generatedUnitsFor(notesSpec())];
}

function sha256(content: string | NodeJS.ArrayBufferView): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function aggregateSnapshotDigest(entries: readonly SnapshotFileEntry[]): string {
  const canonical = entries
    .filter(
      (entry): entry is SnapshotFileEntry & { content_digest: string } =>
        entry.path !== "snapshot.json" && entry.content_digest !== undefined,
    )
    .sort((left, right) => left.path.localeCompare(right.path, "en"))
    .map((entry) => `${entry.path}\0${entry.content_digest}\n`)
    .join("");
  return sha256(canonical);
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function relativeFinalDirectory(root: string): string {
  return join(root, "notes", INCARNATION_ID, "v1");
}

let sandbox: string;
let artifactsRoot: string;
let tierOffGate: CapabilityGateResult;
let tierOnGate: CapabilityGateResult;

beforeAll(async () => {
  const units = notesUnits();
  const handlers = Object.fromEntries(
    units.filter((unit) => unit.kind === "handler").map((unit) => [unit.name, unit.content]),
  );
  const itemRenderer = units.find((unit) => unit.kind === "item-renderer")?.content;
  if (!itemRenderer) throw new Error("Expected the item renderer fixture.");
  tierOffGate = await runCapabilityGate(
    gateInput({
      spec: notesSpec(),
      handlers,
      itemRenderer,
      behavioralTier: { enabled: false },
    }),
  );
  tierOnGate = await runCapabilityGate(gateInput({ spec: notesSpec(), handlers, itemRenderer }));
});

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "omni-crud-artifact-lifecycle-"));
  artifactsRoot = join(sandbox, "capabilities");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function publish(
  options: {
    readonly buildId?: string;
    readonly gate?: CapabilityGateResult;
    readonly beforePublish?: (stagingDirectory: string) => void;
  } = {},
) {
  return publishCapabilitySnapshot({
    buildId: options.buildId ?? "build-one",
    spec: notesSpec(),
    incarnationId: INCARNATION_ID,
    version: 1,
    units: notesUnits(),
    gate: options.gate ?? tierOffGate,
    artifactsRoot,
    ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
  });
}

describe("capability artifact lifecycle — snapshot shape", () => {
  test("tier-off publishes the exact snapshot shape with no behavioral-test artifacts", () => {
    const publication = publish();

    expect(publication.files).toEqual(TIER_OFF_FILES);
    expect(publication.manifest.behavioral_tier).toBe("off");
    expect(publication.files.some((path) => path.startsWith("tests/"))).toBe(false);
    expect(existsSync(join(publication.directory, "tests"))).toBe(false);
    expect(JSON.parse(readFileSync(join(publication.directory, "spec.json"), "utf8"))).toEqual(
      notesSpec(),
    );
  });

  test("tier-on freezes the exact behavioral suite and inventories its artifact", () => {
    const publication = publish({ gate: tierOnGate });
    const frozenTestPath = join(publication.directory, "tests", "behavioral.json");

    expect(publication.files).toEqual(TIER_ON_FILES);
    expect(publication.manifest.behavioral_tier).toBe("on");
    if (tierOnGate.behavioral.tier !== "on") throw new Error("Expected tier-on Gate evidence.");
    expect(readFileSync(frozenTestPath, "utf8")).toBe(
      canonicalJson(tierOnGate.behavioral.frozenTests),
    );
    expect(JSON.parse(readFileSync(frozenTestPath, "utf8"))).toEqual(
      tierOnGate.behavioral.frozenTests,
    );
  });

  test("manifest omits only its self-digest and records every other SHA-256 digest plus unit provenance", () => {
    const spec = notesSpec();
    const units = notesUnits();
    const publication = publish();
    const { manifest } = publication;

    expect(manifest).toMatchObject({
      manifest_version: 1,
      capability_id: spec.id,
      incarnation_id: INCARNATION_ID,
      version: 1,
      build_id: "build-one",
      behavioral_tier: "off",
    });
    expect(manifest.files.map((entry) => entry.path)).toEqual([...TIER_OFF_FILES]);
    expect(manifest.files.find((entry) => entry.path === "snapshot.json")).toEqual({
      path: "snapshot.json",
    });

    for (const entry of manifest.files) {
      if (entry.path === "snapshot.json") continue;
      expect(entry.content_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(entry.content_digest).toBe(
        sha256(readFileSync(join(publication.directory, entry.path))),
      );
    }
    expect(manifest.snapshot_content_digest).toBe(aggregateSnapshotDigest(manifest.files));

    expect(Object.keys(manifest.unit_provenance)).toEqual([
      "item.ts",
      "create.ts",
      "read.ts",
      "update.ts",
      "delete.ts",
      "search.ts",
    ]);
    for (const unit of units) {
      const descriptor: UnitDescriptor =
        unit.kind === "handler"
          ? { kind: "handler", name: unit.name }
          : { kind: "item-renderer", name: "item" };
      expect(manifest.unit_provenance[unit.filename]).toEqual({
        active_context_digest: sha256(buildUnitPrompt(spec, descriptor)),
        dependencies: [],
      });
    }
  });
});

describe("capability artifact lifecycle — verification", () => {
  test("verifier rejects a tampered file and published evidence cannot be consumed afterward", () => {
    const publication = publish();
    writeFileSync(join(publication.directory, "read.ts"), "tampered\n");

    expect(() => verifyCapabilitySnapshot(publication.directory)).toThrow(
      /read\.ts failed content verification/,
    );
    expect(() => assertVerifiedPublishedSnapshot(publication)).toThrow(SnapshotVerificationError);
  });

  test("verifier rejects a missing file", () => {
    const publication = publish();
    unlinkSync(join(publication.directory, "search.ts"));

    expect(() => verifyCapabilitySnapshot(publication.directory)).toThrow(
      /inventory mismatch.*search\.ts/,
    );
  });

  test("verifier returns canonical evidence and rejects a changed expected manifest", () => {
    const publication = publish();
    const verified = verifyCapabilitySnapshot(publication.directory);

    expect(verified.directory).toBe(publication.directory);
    expect(verified.files).toEqual(TIER_OFF_FILES);
    expect(verified.manifest).toEqual(publication.manifest);
    expect(assertVerifiedPublishedSnapshot(publication)).toEqual(verified);
    expect(() =>
      verifyCapabilitySnapshot(publication.directory, {
        ...publication.manifest,
        build_id: "different-build",
      }),
    ).toThrow(/manifest changed after verification/);
  });

  test("issued publication evidence cannot be mutated into authority for another path", () => {
    const publication = publish();
    (publication as { artifactsPath: string }).artifactsPath = join(sandbox, "copied", "v1");

    expect(() => assertVerifiedPublishedSnapshot(publication)).toThrow(
      /evidence changed after issuance/,
    );
  });

  test("standalone verifier rejects a self-consistent manifest that omits a required artifact", () => {
    const publication = publish();
    const readPath = join(publication.directory, "read.ts");
    unlinkSync(readPath);
    const files = publication.manifest.files.filter((entry) => entry.path !== "read.ts");
    const forgedManifest: SnapshotManifest = {
      ...publication.manifest,
      files,
      snapshot_content_digest: aggregateSnapshotDigest(files),
    };
    writeFileSync(join(publication.directory, "snapshot.json"), canonicalJson(forgedManifest));

    expect(() => verifyCapabilitySnapshot(publication.directory)).toThrow(/inventory|required/i);
  });
});

describe("capability artifact lifecycle — publication safety", () => {
  test("caller-constructed Gate status is refused before staging creates filesystem state", () => {
    const forgedGate = { ...tierOffGate } as CapabilityGateResult;
    expect(() => publish({ gate: forgedGate })).toThrow(/evidence issued by the Gate/);
    expect(existsSync(artifactsRoot)).toBe(false);
  });

  test("post-verdict Gate mutation invalidates its opaque evidence", () => {
    const handlers = tierOffGate.handlers as Record<string, string>;
    const originalRead = handlers.read;
    if (!originalRead) throw new Error("Expected issued read Handler evidence.");
    handlers.read = `${originalRead}\n// changed after verdict`;
    try {
      expect(() => publish()).toThrow(/immutable evidence issued by the Gate/);
      expect(existsSync(artifactsRoot)).toBe(false);
    } finally {
      handlers.read = originalRead;
    }
  });

  test("publication refuses derived bytes that differ from the successful Gate verdict", () => {
    const units = notesUnits();
    const gate = tierOffGate;
    const readUnit = units[2];
    if (!readUnit) throw new Error("Expected the read unit fixture.");
    units[2] = { ...readUnit, content: "export default function changed() {}\n" };

    expect(() =>
      publishCapabilitySnapshot({
        buildId: "changed-after-gate",
        spec: notesSpec(),
        incarnationId: INCARNATION_ID,
        version: 1,
        units,
        gate,
        artifactsRoot,
      }),
    ).toThrow(/read\.ts does not match the bytes cleared by the Gate/);
    expect(existsSync(artifactsRoot)).toBe(false);
  });

  test("build-id staging is unique and reusing a retained build id writes nothing", () => {
    const fault = new Error("stop before publish");
    let stagingDirectory = "";
    expect(() =>
      publish({
        buildId: "build-unique",
        beforePublish: (directory) => {
          stagingDirectory = directory;
          throw fault;
        },
      }),
    ).toThrow(fault);
    const retainedManifest = readFileSync(join(stagingDirectory, "snapshot.json"), "utf8");

    expect(() => publish({ buildId: "build-unique" })).toThrow();
    expect(readFileSync(join(stagingDirectory, "snapshot.json"), "utf8")).toBe(retainedManifest);
    expect(existsSync(relativeFinalDirectory(artifactsRoot))).toBe(false);
  });

  test("a fault immediately before publish leaves verified staging, no final directory, and retry with a new build id succeeds", () => {
    const fault = new Error("injected immediately before publish");
    let retainedStaging = "";
    expect(() =>
      publish({
        buildId: "build-faulted",
        beforePublish: (stagingDirectory) => {
          retainedStaging = stagingDirectory;
          expect(verifyCapabilitySnapshot(stagingDirectory).files).toEqual(TIER_OFF_FILES);
          throw fault;
        },
      }),
    ).toThrow(fault);

    expect(existsSync(retainedStaging)).toBe(true);
    expect(existsSync(relativeFinalDirectory(artifactsRoot))).toBe(false);

    const retried = publish({ buildId: "build-retry" });
    expect(retried.manifest.build_id).toBe("build-retry");
    expect(retried.files).toEqual(TIER_OFF_FILES);
    expect(existsSync(retainedStaging)).toBe(true);
    expect(verifyCapabilitySnapshot(retried.directory).manifest).toEqual(retried.manifest);
  });
});

describe("capability artifact lifecycle — lock and path safety", () => {
  test("a live publication lock is never removed by a contender", () => {
    const finalDirectory = relativeFinalDirectory(artifactsRoot);
    mkdirSync(join(artifactsRoot, "notes", INCARNATION_ID), { recursive: true });
    const lockPath = `${finalDirectory}.publish-lock`;
    writeFileSync(lockPath, canonicalJson({ pid: process.pid }));

    expect(() => publish()).toThrow();
    expect(readFileSync(lockPath, "utf8")).toBe(canonicalJson({ pid: process.pid }));
  });

  test("a stale crash lock is recovered and a new build id can publish", () => {
    const finalDirectory = relativeFinalDirectory(artifactsRoot);
    mkdirSync(join(artifactsRoot, "notes", INCARNATION_ID), { recursive: true });
    const lockPath = `${finalDirectory}.publish-lock`;
    writeFileSync(lockPath, canonicalJson({ pid: 2_147_483_647 }));

    const publication = publish({ buildId: "after-crash" });
    expect(publication.manifest.build_id).toBe("after-crash");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("two stale-lock contenders cannot remove the live successor generation", () => {
    const finalDirectory = relativeFinalDirectory(artifactsRoot);
    mkdirSync(join(artifactsRoot, "notes", INCARNATION_ID), { recursive: true });
    const lockPath = `${finalDirectory}.publish-lock`;
    const stalePayload = canonicalJson({ pid: 2_147_483_647 });
    const successorPath = `${lockPath}.next-${sha256(stalePayload).slice("sha256:".length)}`;
    const livePayload = canonicalJson({ pid: process.pid, token: "live-successor" });
    writeFileSync(lockPath, stalePayload);
    writeFileSync(successorPath, livePayload);

    expect(() => publish({ buildId: "second-contender" })).toThrow();
    expect(readFileSync(lockPath, "utf8")).toBe(stalePayload);
    expect(readFileSync(successorPath, "utf8")).toBe(livePayload);
  });

  test("an empty lock from a crash during old lock initialization is recoverable", () => {
    const finalDirectory = relativeFinalDirectory(artifactsRoot);
    mkdirSync(join(artifactsRoot, "notes", INCARNATION_ID), { recursive: true });
    const lockPath = `${finalDirectory}.publish-lock`;
    writeFileSync(lockPath, "");

    const publication = publish({ buildId: "after-empty-lock" });
    expect(publication.manifest.build_id).toBe("after-empty-lock");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("a symlinked capability directory cannot redirect staging outside the artifact root", () => {
    const outside = join(sandbox, "outside");
    mkdirSync(outside);
    mkdirSync(artifactsRoot);
    symlinkSync(outside, join(artifactsRoot, "notes"));

    expect(() => publish()).toThrow(/not a real directory/);
    expect(readdirSync(outside)).toEqual([]);
  });

  test("publication refuses an existing empty final directory without replacing it", () => {
    const finalDirectory = relativeFinalDirectory(artifactsRoot);
    mkdirSync(finalDirectory, { recursive: true });

    expect(() => publish()).toThrow(/Refusing to overwrite existing capability snapshot/);
    expect(readdirSync(finalDirectory)).toEqual([]);
  });

  test("publication refuses an existing populated final directory without changing it", () => {
    const finalDirectory = relativeFinalDirectory(artifactsRoot);
    const marker = join(finalDirectory, "owner.txt");
    mkdirSync(finalDirectory, { recursive: true });
    writeFileSync(marker, "original owner\n");

    expect(() => publish()).toThrow(/Refusing to overwrite existing capability snapshot/);
    expect(readdirSync(finalDirectory)).toEqual(["owner.txt"]);
    expect(readFileSync(marker, "utf8")).toBe("original owner\n");
  });
});
