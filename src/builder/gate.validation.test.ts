// Validation-error marker and datetime-instant behavioral tests for the always-on gate
// (Epic 2.5, issue 05).
//
// These bypass the provider and unit-generation loop on purpose: the gate is the
// final verdict over generated strings, and must catch broken units independently.

import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { deriveCapabilityTableDdl } from "../capability-data/index.ts";
import { BEHAVIORAL_ERROR_MARKERS, MISSING_REQUIRED_FIELDS_ERROR_CODE } from "../registry/index.ts";
import {
  ARTICLE_HANDLERS,
  articlesSpec,
  expectGateFailure,
  fullBehavioralSuiteFor,
  fullHandlersFor,
  gateInput,
  MARKED_ARTICLE_CREATE_HANDLER,
  MULTI_REQUIRED_VALIDATION_SUITE,
  makeBehaviorProvider,
  notesSpec,
} from "./gate.test-support.ts";
import { runCapabilityGate } from "./gate.ts";

setDefaultTimeout(15_000);

describe("capability gate — validation-error markers", () => {
  test("validation-error behavioral cases assert stable markers, not product copy", async () => {
    const spec = articlesSpec();
    const result = await runCapabilityGate(
      gateInput({
        spec,
        ddl: deriveCapabilityTableDdl(spec),
        provider: makeBehaviorProvider(MULTI_REQUIRED_VALIDATION_SUITE).provider,
        handlers: ARTICLE_HANDLERS,
      }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
    expect(result.behavioral.tier === "on" ? result.behavioral.testRun.cases : []).toContainEqual(
      expect.objectContaining({
        name: "missing title and body emits stable validation markers",
        status: "passed",
      }),
    );
  });

  test("validation-error behavioral cases fail when markers are missing or wrong", async () => {
    const spec = articlesSpec();
    const badHandlers = [
      {
        label: "missing markers",
        create: MARKED_ARTICLE_CREATE_HANDLER.replace(
          'data-role="error" data-error-code="missing_required_fields" data-error-fields="$' +
            '{missing.join(" ")}"',
          'class="error"',
        ),
        message: /data-role="error"/,
      },
      {
        label: "wrong error code",
        create: MARKED_ARTICLE_CREATE_HANDLER.replace(
          'data-error-code="missing_required_fields"',
          'data-error-code="validation_problem"',
        ),
        message: /expected error markers code=/,
      },
    ];

    for (const entry of badHandlers) {
      const error = await expectGateFailure(
        gateInput({
          spec,
          ddl: deriveCapabilityTableDdl(spec),
          provider: makeBehaviorProvider(MULTI_REQUIRED_VALIDATION_SUITE).provider,
          handlers: { ...ARTICLE_HANDLERS, create: entry.create },
        }),
      );

      expect(error.failedRung, entry.label).toBe("behavioral");
      expect(error.outcomes[2]?.error, entry.label).toMatch(entry.message);
      expect(error.diagnostic).toMatchObject({
        testCase: { name: "missing title and body emits stable validation markers" },
        failure: expect.stringMatching(entry.message),
        fragment: expect.any(String),
        scratchRows: [],
      });
    }
  });
});

describe("capability gate — datetime instant matching", () => {
  test("datetime fields match by instant, not by literal string form", async () => {
    // Regression: a real model produced a handler that canonicalizes the datetime
    // through a Date round-trip ("2025-06-01T12:00:00Z" → "2025-06-01T12:00:00.000Z")
    // while authoring the behavioral test with the raw input form. The row is the same
    // instant, so the rung must pass — not fail on a representational difference.
    const eventsSpec = notesSpec({
      id: "events",
      label: "Events",
      schema: {
        fields: [
          { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
          {
            name: "happens_at",
            label: "Happens at",
            type: "datetime",
            required: true,
            lifecycle: "active",
          },
        ],
      },
      ui_intent: {
        form: { list_inputs: [] },
        item: {
          direction: "A timeline-style card that emphasizes event title and date.",
          shows: ["title", "happens_at"],
        },
        collection: { layout: "feed" },
        detail: { shows: ["title", "happens_at"] },
      },
      behavior: "Title and happens_at are required. Newest events appear first.",
      behavioral_errors: [
        {
          action: "create",
          trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["title", "happens_at"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        },
        {
          action: "update",
          trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["title", "happens_at"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        },
      ],
      prompt_context: "Stores the user's events.",
    });
    const canonicalizingCreate = [
      "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
      '  if (String(input.values.title ?? "").trim().length === 0 || String(input.values.happens_at ?? "").trim().length === 0) return \'<div data-role="error" data-error-code="missing_required_fields" data-error-fields="title happens_at">Required.</div>\';',
      "  const rawHappensAt = input.values.happens_at;",
      '  const happensAt = new Date(typeof rawHappensAt === "string" ? rawHappensAt : "").toISOString();',
      "  const event = mutation.create({ title: input.values.title, happens_at: happensAt });",
      "  return present(event);",
      "}",
    ].join("\n");
    const eventsRead = [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  const events = query.records({",
      '    sql: \'SELECT "id" AS "target_id" FROM "cap_events" ORDER BY "created_at" DESC, "id" DESC\',',
      "  });",
      '  return events.map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n");
    const datetimeSuite = fullBehavioralSuiteFor(eventsSpec, {
      createValues: { title: "Launch", happens_at: "2025-06-01T12:00:00Z" },
      updateValues: { title: "Updated launch", happens_at: "2025-06-02T12:00:00Z" },
      readValues: { title: "Read launch", happens_at: "2025-06-03T12:00:00Z" },
      searchMatchValues: { title: "Matching launch", happens_at: "2025-06-04T12:00:00Z" },
      searchMissValues: { title: "Other event", happens_at: "2025-06-05T12:00:00Z" },
      markerField: "title",
      searchQuery: "matching",
    });

    const result = await runCapabilityGate(
      gateInput({
        spec: eventsSpec,
        ddl: deriveCapabilityTableDdl(eventsSpec),
        provider: makeBehaviorProvider(datetimeSuite).provider,
        handlers: fullHandlersFor(eventsSpec, { create: canonicalizingCreate, read: eventsRead }),
      }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
  });
});
