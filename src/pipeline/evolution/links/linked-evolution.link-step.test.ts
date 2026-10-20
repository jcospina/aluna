// An evolution links only the text fields it adds. On the desk where Notes' shelf is linked to
// Shelves, Notes gains an author field beside a flagged Authors and relabels its text, and the
// link step links the author, while its answer's tries at the shelf and at the relabelled text go
// nowhere. A failed step still publishes, an evolution adding no single-line text field or
// flagging nothing makes no link call, and one that ends stops its step. Every call is answered by
// the engine's fake provider.

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { evolutionIntentFor } from "../../../builder/evolution/candidate/candidate.test-support.ts";
import { LINK_STEP_PROMPT_PREFIX } from "../../../builder/link/link-step.ts";
import { SEVENTH_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import {
  type CapabilitySpec,
  canonicalCapabilityLabel,
  type Relation,
  renameCapability,
  type SpecField,
} from "../../../registry/index.ts";
import { notesSpec } from "../../../registry/spec/spec.test-support.ts";
import * as linking from "../../build/linking.ts";
import {
  addCommittedDependency,
  DUE_DATE_FIELD,
  type EvolveResult,
  evolve,
} from "../run/evolution-run.test-support.ts";
import {
  closeLinkedDesk,
  evolveTo,
  fieldDrawnAs,
  type LinkedDesk,
  linkRows,
  notesWith,
  openLinkedDesk,
  pickStatus,
  row,
  SHELF_FIELD,
  withField,
} from "./linked-evolution.test-support.ts";

const textField = (name: string, label: string): SpecField => ({
  name,
  label,
  type: "string",
  required: false,
  lifecycle: "active",
});

const AUTHORS = withField(
  notesSpec({
    id: "authors",
    label: "Authors",
    noun: "author",
    plural_noun: "authors",
    prompt_context: "Stores the authors of the books I read.",
  }),
  { ...SHELF_FIELD, name: "name", label: "Name" },
  [],
);
const AUTHOR = textField("author", "Author");
const EDITOR = textField("editor", "Editor");
const AUTHOR_NAME = { capability: AUTHORS.id, target_field: "name" };
const AUTHOR_RELATION: Relation = {
  field: AUTHOR.name,
  to: { capability: AUTHORS.id, incarnation: SEVENTH_INCARNATION_ID, field: "name" },
};

const notes = notesWith();
const titled = notes.schema.fields.map((field) =>
  field.name === "text" ? { ...field, label: "Title" } : field,
);
const withAuthor = withField({ ...notes, schema: { fields: titled } }, AUTHOR, []);
const withEditor = withField(withAuthor, EDITOR, []);
const withNoText = withField(
  withField(withEditor, DUE_DATE_FIELD, []),
  textField("synopsis", "Synopsis"),
  ["synopsis"],
);
const withPublisher = withField(withNoText, textField("publisher", "Publisher"), ["synopsis"]);
const withTranslator = withField(withPublisher, textField("translator", "Translator"), [
  "synopsis",
]);

let desk: LinkedDesk;
let before: { relations: Relation[]; rows: ReturnType<typeof linkRows> };
let afterAuthor: Relation[];
let author: EvolveResult;
let editor: EvolveResult;
let noText: EvolveResult;
let unflagged: EvolveResult;
let stoppedStep: linking.LinkStepRun | undefined;
let versionBeforeCancel: number;
let failedStepLogged: number;
const errors = spyOn(console, "error");

/** Evolve Notes to `candidate`, the Resolver flagging `flagged` and the link step answering `link`. */
function evolveNotes(
  candidate: CapabilitySpec,
  buildId: string,
  flagged: readonly string[],
  link?: unknown,
): Promise<EvolveResult> {
  return evolveTo(desk, candidate, buildId, { resolvedIntent: flagging(buildId, flagged), link });
}

function flagging(buildId: string, flagged: readonly string[]) {
  return evolutionIntentFor(row(desk, "notes"), `change notes for ${buildId}`, {
    related_capabilities: [...flagged],
  });
}

/**
 * Evolves Notes to hold a translator while the link step's call never answers, cancelling once the
 * plan is out, and returns the step the evolution started.
 */
async function cancelWhileTheStepRuns(): Promise<linking.LinkStepRun | undefined> {
  const starts = spyOn(linking, "startLinkStep");
  let cancelled = false;
  try {
    await evolve(desk.env, withTranslator, "change notes", {
      buildId: "notes-cancelled",
      behavioralTierEnabled: false,
      resolvedIntent: flagging("notes-cancelled", [AUTHORS.id]),
      link: new Promise(() => {}),
      isAborted: () => cancelled,
      onSend: async (event) => {
        if (event === "candidate-preview") cancelled = true;
      },
    }).catch(() => undefined);
    const [started] = starts.mock.results;
    return started?.type === "return" ? started.value : undefined;
  } finally {
    starts.mockRestore();
  }
}

const linkCalls = (result: EvolveResult) =>
  result.prompts.filter((prompt) => prompt.startsWith(LINK_STEP_PROMPT_PREFIX)).length;

/** What the narration says while an evolution of Notes connects its author to Authors. */
const connectingAuthor = () =>
  ` ${linking.connectingNarration(withAuthor, { relations: [AUTHOR_RELATION], flagged: [row(desk, AUTHORS.id)] })}`;

const narration = (result: EvolveResult) =>
  result.events.filter(({ event }) => event === "narration").map(({ data }) => data);

beforeAll(async () => {
  const quiet = spyOn(console, "log").mockImplementation(() => {});
  errors.mockImplementation(() => {});
  try {
    desk = await openLinkedDesk();
    await addCommittedDependency(desk.env, AUTHORS, SEVENTH_INCARNATION_ID);
    const committed = row(desk, "notes");
    const expectation = {
      capabilityId: committed.id,
      incarnationId: committed.incarnation_id,
      version: committed.version,
      previousOverride: null,
    };
    renameCapability(expectation, "Reading notes", desk.env.conns.readwrite);
    before = { relations: [...row(desk, "notes").relations], rows: linkRows(desk) };
    author = await evolveNotes(withAuthor, "notes-author", [AUTHORS.id], {
      relations: [
        { field: "shelf", ...AUTHOR_NAME },
        { field: "text", ...AUTHOR_NAME },
        { field: "author", ...AUTHOR_NAME },
      ],
    });
    afterAuthor = [...row(desk, "notes").relations];
    errors.mockClear();
    editor = await evolveNotes(
      withEditor,
      "notes-editor",
      [AUTHORS.id],
      new Error("the provider is down"),
    );
    failedStepLogged = errors.mock.calls.length;
    noText = await evolveNotes(withNoText, "notes-no-text", [AUTHORS.id]);
    unflagged = await evolveNotes(withPublisher, "notes-unflagged", []);
    versionBeforeCancel = row(desk, "notes").version;
    stoppedStep = await cancelWhileTheStepRuns();
  } finally {
    quiet.mockRestore();
  }
}, 180_000);

afterAll(() => {
  errors.mockRestore();
  closeLinkedDesk(desk);
});

describe("an evolution adding a text field beside a flagged capability", () => {
  test("keeps the author field and links it, and its form draws a dropdown of the authors", async () => {
    expect(linkCalls(author)).toBe(1);
    expect(row(desk, "notes").schema.fields.map(({ name }) => name)).toContain(AUTHOR.name);
    expect(afterAuthor).toStrictEqual([...before.relations, AUTHOR_RELATION]);
    expect(await fieldDrawnAs(desk, AUTHOR.name)).toBe("dropdown");
    expect(await pickStatus(desk, AUTHOR.name)).toBe(200);
  });

  test("names the capability by the name its person gave it", () => {
    const [prompt] = author.prompts.filter((each) => each.startsWith(LINK_STEP_PROMPT_PREFIX));
    expect(prompt).toContain(JSON.stringify(canonicalCapabilityLabel(row(desk, "notes"))));
  });

  test("says what it connects just before the sentence it checks the change under", () => {
    const plain = narration(noText);
    expect(plain.at(-1)?.trim()).toBeTruthy();
    expect(narration(author)).toStrictEqual([
      ...plain.slice(0, -1),
      connectingAuthor(),
      ...plain.slice(-1),
    ]);
  });

  test("leaves the committed shelf relation and its link rows as they were", async () => {
    expect(afterAuthor.filter(({ field }) => field === SHELF_FIELD.name)).toStrictEqual(
      before.relations,
    );
    expect(linkRows(desk)).toStrictEqual(before.rows);
    expect(await fieldDrawnAs(desk)).toBe("dropdown");
  });
});

describe("a link step that fails", () => {
  test("leaves the evolution published with the relations it had, and says nothing of it", async () => {
    expect(linkCalls(editor)).toBe(1);
    expect(editor.outcome.kind).toBe("activated");
    expect(row(desk, "notes").relations).toStrictEqual(afterAuthor);
    expect(await fieldDrawnAs(desk, EDITOR.name)).toBe("chain");
    expect(await pickStatus(desk, EDITOR.name)).toBe(422);
    expect(failedStepLogged).toBeGreaterThan(0);
    expect(narration(editor)).toStrictEqual(narration(noText));
  });
});

describe("an evolution with nothing for the step to link", () => {
  test("makes no link call when it adds no single-line text field", () => {
    expect(noText.outcome.kind).toBe("activated");
    expect(linkCalls(noText)).toBe(0);
  });

  test("makes no link call when the Resolver flagged nothing", () => {
    expect(unflagged.outcome.kind).toBe("activated");
    expect(linkCalls(unflagged)).toBe(0);
  });
});

test("an evolution that ends stops a step still running", async () => {
  if (!stoppedStep) throw new Error("the cancelled evolution started no link step");
  const ended = await Promise.race([stoppedStep.settled(), Bun.sleep(50).then(() => "running")]);
  expect(ended).not.toBe("running");
  expect(row(desk, "notes").version).toBe(versionBeforeCancel);
});
