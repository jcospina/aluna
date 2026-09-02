import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { renameCapabilityLabel } from "../capability-rename/index.ts";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import {
  type CapabilityRow,
  canonicalCapabilityLabel,
  compareAndSwapCapability,
  fingerprintActiveRegistryCatalog,
  getCapability,
  listCapabilities,
  MAX_CAPABILITY_LABEL_CHARS,
  readActiveRegistryCatalog,
  renameCapability,
} from "../registry/index.ts";
import {
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import { renderCapabilityLogo } from "../web/fragments.ts";
import { createApp } from "./app.ts";

const NOTES_INCARNATION = "11111111-1111-4111-8111-111111111111";

function renameRequest(fields: Record<string, string>): RequestInit {
  return { method: "POST", body: new URLSearchParams(fields) };
}

/** The submission the inline editor makes: the name, and the identity it opened on. */
function renameNotes(label: string, overrides: Record<string, string> = {}): RequestInit {
  return renameRequest({
    label,
    incarnation_id: NOTES_INCARNATION,
    version: "1",
    ...overrides,
  });
}

let dir: string;
let conns: PlatformDatabase;

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  install(conns, notesRow());
});

afterEach(() => {
  teardownRouterTest(dir, conns);
});

function app() {
  return createApp({ capabilityRouter: { databases: conns } });
}

function row() {
  return getCapability("notes", conns.readonly);
}

describe("renaming a capability from its logo", () => {
  test("writes the override and nothing else — no version, no build, no artwork", async () => {
    const before = row();
    const response = await app().request("/capability-rename/notes", renameNotes("Journal"));

    expect(response.status).toBe(200);
    const after = row();
    expect(after?.display_label_override).toBe("Journal");
    expect(after && canonicalCapabilityLabel(after)).toBe("Journal");

    // The authored spec is untouched, byte for byte, and so is everything the platform
    // assigned at birth. A rename is not a version of anything (PLAN decision 19).
    expect(after?.label).toBe(before?.label);
    expect(after?.version).toBe(1);
    expect(after?.incarnation_id).toBe(NOTES_INCARNATION);
    expect(after?.artifacts_path).toBe(before?.artifacts_path);
    expect(after?.seed).toBe(before?.seed);
    expect(after?.logo).toEqual(before?.logo);
    expect(after?.schema).toEqual(before?.schema);
  });

  test("the desk gets the logo back with the new name under the same picture", async () => {
    const html = await (
      await app().request("/capability-rename/notes", renameNotes("Journal"))
    ).text();

    expect(html).toContain('id="capability-logo-notes"');
    expect(html).toContain('aria-label="Open Journal"');
    expect(html).toContain('<span class="logo-label" data-logo-label>Journal</span>');
    // The address is what it was. Renaming moves the name and not the door.
    expect(html).toContain('hx-get="/capability/notes"');
    // And it arms no attempt: a rename never enters the logo path, so a faceless
    // capability must not collect a free generation for every name it is given.
    expect(html).not.toContain("logo-attempt");
  });

  // Every label sink escapes, and that is what makes this safe — but a copy rule that
  // admits `<img src=x onerror=alert(1)>` (three words, twenty-eight characters, no
  // sentence punctuation) is a copy rule not looking at what it admits.
  test("a markup-shaped name is not a name, and nothing is written", async () => {
    const response = await app().request(
      "/capability-rename/notes",
      renameNotes('Not <b>bold</b> "x"'),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain('data-error-code="rename_refused"');
    expect(row()?.display_label_override).toBeNull();
  });

  test("a stored name that is not a name is not shown either", () => {
    // No rename can put one there any more, which is exactly why this is worth pinning:
    // a row edited by hand still has to come out as something a desk can write under a tile.
    const stored = row() as CapabilityRow;
    const html = renderCapabilityLogo({
      ...stored,
      display_label_override: 'Not <b>bold</b> "x"',
      logo: { status: "absent", attempts: 0 },
    });

    // Nothing a person reads shows it: not the label under the tile, not the accessible
    // name, not the value the rename editor opens with.
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain('<span class="logo-label" data-logo-label>Notes</span>');
    expect(html).toContain('aria-label="Open Notes"');
    expect(html).toContain('value="Notes"');
    // The compare-and-swap field is the one place the stored bytes belong — it is what the
    // next rename is checked against, not a name — and it is escaped like everything else.
    expect(html).toContain(
      'name="previous_label" value="Not &lt;b&gt;bold&lt;/b&gt; &quot;x&quot;"',
    );
  });

  test("a name the registry will not take is refused, and nothing is written", async () => {
    for (const refused of ["", "   ", "This is a whole sentence about my notes."]) {
      const response = await app().request("/capability-rename/notes", renameNotes(refused));

      expect(response.status).toBe(422);
      expect(await response.text()).toContain('data-error-code="rename_refused"');
      expect(row()?.display_label_override).toBeNull();
    }
  });

  test("a rename bound to another incarnation or another version is refused stale", async () => {
    const wrongIncarnation = await app().request(
      "/capability-rename/notes",
      renameNotes("Journal", { incarnation_id: "99999999-9999-4999-8999-999999999999" }),
    );
    expect(wrongIncarnation.status).toBe(409);
    expect(await wrongIncarnation.text()).toContain('data-error-code="rename_refused"');

    const wrongVersion = await app().request(
      "/capability-rename/notes",
      renameNotes("Journal", { version: "2" }),
    );
    expect(wrongVersion.status).toBe(409);

    // A version that is not a number at all is stale rather than a bad name: nothing about
    // the name is wrong, and the submission does not describe a capability that exists.
    const nonsenseVersion = await app().request(
      "/capability-rename/notes",
      renameNotes("Journal", { version: "one" }),
    );
    expect(nonsenseVersion.status).toBe(409);

    expect(row()?.display_label_override).toBeNull();
  });

  test("a capability that is already gone is refused, not created", async () => {
    const response = await app().request("/capability-rename/absent", renameNotes("Journal"));

    expect(response.status).toBe(409);
    expect(listCapabilities(conns.readonly).map((each) => each.id)).toEqual(["notes"]);
  });

  test("a repeated field decides nothing — the submission this form makes carries one", async () => {
    const body = new URLSearchParams({ label: "Journal", version: "1" });
    body.append("incarnation_id", NOTES_INCARNATION);
    body.append("incarnation_id", "99999999-9999-4999-8999-999999999999");

    const response = await app().request("/capability-rename/notes", { method: "POST", body });

    expect(response.status).toBe(409);
    expect(row()?.display_label_override).toBeNull();
  });
});

describe("what a rename costs the rest of the platform", () => {
  test("the name survives an evolution, which cannot write it and does not clear it", async () => {
    await app().request("/capability-rename/notes", renameNotes("Journal"));

    // What an evolution does: a CAS built from a row read a moment ago, carrying the whole
    // row back in. The override is not on the write shape, so it cannot ride along — and
    // the update's own `SET` list does not name it, so it is not cleared either.
    const before = row();
    if (!before) throw new Error("the renamed row is the fixture this test needs");
    compareAndSwapCapability(
      { ...before, version: 2, label: "Notes v2", display_label_override: "hijacked" },
      { state: "active", capabilityId: "notes", incarnationId: NOTES_INCARNATION, version: 1 },
      conns.readwrite,
    );

    const after = row();
    expect(after?.version).toBe(2);
    expect(after?.label).toBe("Notes v2");
    expect(after?.display_label_override).toBe("Journal");
    expect(after && canonicalCapabilityLabel(after)).toBe("Journal");
  });

  test("the name goes with the capability, and a rebuilt one is born without it", () => {
    const renamed = renameCapability(
      {
        capabilityId: "notes",
        incarnationId: NOTES_INCARNATION,
        version: 1,
        previousOverride: null,
      },
      "Journal",
      conns.readwrite,
    );
    expect(renamed?.display_label_override).toBe("Journal");

    // Deleted and made again under the same semantic id: a different lifetime, which must
    // not inherit a name chosen for the one before it.
    conns.readwrite.run("DELETE FROM capability_registry WHERE id = ?", ["notes"]);
    install(conns, notesRow());

    expect(row()?.display_label_override).toBeNull();
    expect(row() && canonicalCapabilityLabel(row() as CapabilityRow)).toBe("Notes");
  });

  test("a name longer than the registry takes is refused at the same length the field stops at", async () => {
    const longest = "a".repeat(MAX_CAPABILITY_LABEL_CHARS);

    expect((await app().request("/capability-rename/notes", renameNotes(longest))).status).toBe(
      200,
    );
    expect(row()?.display_label_override).toBe(longest);

    const over = await app().request("/capability-rename/notes", renameNotes(`${longest}a`));
    expect(over.status).toBe(422);
    expect(row()?.display_label_override).toBe(longest);
  });

  // A rename does not bump the version, so the version alone cannot tell two submissions
  // made against the same one apart: both matched, and the second overwrote the first with
  // no conflict signal anywhere. The name each submission *replaces* is what distinguishes
  // them, and it is a fact the menu already holds.
  test("a second rename made against a name that has since changed is refused, not applied", async () => {
    expect((await app().request("/capability-rename/notes", renameNotes("Journal"))).status).toBe(
      200,
    );

    // A second menu, opened before the first rename landed: same id, same incarnation, same
    // version, and the name it saw was the original one.
    const stale = await app().request("/capability-rename/notes", renameNotes("Diary"));

    expect(stale.status).toBe(409);
    expect(row()?.display_label_override).toBe("Journal");

    // And a submission that names what is actually there goes through.
    const fresh = await app().request(
      "/capability-rename/notes",
      renameNotes("Diary", { previous_label: "Journal" }),
    );
    expect(fresh.status).toBe(200);
    expect(row()?.display_label_override).toBe("Diary");
  });

  test("the rename advances the resolver catalog binding", async () => {
    const before = readActiveRegistryCatalog(conns.readonly).fingerprint;

    await app().request("/capability-rename/notes", renameNotes("Journal"));

    const after = readActiveRegistryCatalog(conns.readonly).fingerprint;
    expect(after).not.toBe(before);
    // It is the override that moved it, and only that: a catalog rebuilt from the same
    // rows fingerprints the same, so nothing else about the capability changed.
    expect(after).toBe(fingerprintActiveRegistryCatalog(listCapabilities(conns.readonly)));
  });

  test("it is one platform write, and it waits its turn behind a queued build", async () => {
    const mutationCoordinator = createMutationCoordinator();
    const order: string[] = [];

    // A build reserves the head of the queue and has not asked for its lease yet.
    const reservation = mutationCoordinator.reserveBuild();

    const rename = renameCapabilityLabel(
      { capabilityId: "notes", incarnationId: NOTES_INCARNATION, version: 1, previousLabel: "" },
      "Journal",
      { database: conns.readwrite, mutationCoordinator },
    ).then((outcome) => {
      order.push("rename");
      return outcome;
    });

    // Nothing has happened yet: the rename is queued behind the build, exactly where every
    // other short platform write queues. It does not jump the coordinator's FIFO order.
    await Promise.resolve();
    expect(order).toEqual([]);
    expect(row()?.display_label_override).toBeNull();
    expect(mutationCoordinator.snapshot().queuedTickets.map((ticket) => ticket.kind)).toEqual([
      "build",
      "platform",
    ]);

    await mutationCoordinator.withBuildLease(reservation, () => {
      order.push("build");
    });

    expect(await rename).toEqual({ status: "renamed", row: expect.anything() });
    expect(order).toEqual(["build", "rename"]);
    expect(row()?.display_label_override).toBe("Journal");
  });

  test("a refused name never reaches the queue", async () => {
    const mutationCoordinator = createMutationCoordinator();
    let admitted = 0;

    const outcome = await renameCapabilityLabel(
      { capabilityId: "notes", incarnationId: NOTES_INCARNATION, version: 1, previousLabel: "" },
      "Got it — I'll set that up for you.",
      {
        database: conns.readwrite,
        mutationCoordinator,
        rename: () => {
          admitted += 1;
          return null;
        },
      },
    );

    expect(outcome).toEqual({ status: "refused" });
    expect(admitted).toBe(0);
    expect(mutationCoordinator.snapshot().activeLease).toBeNull();
  });
});
