// The capability handler contract — Module 2, Epic 2.3 (ADR-0004 decision 2).
//
// This is the one shape every handler — AI-generated in 2.5, or hand-written as a
// fixture here — is authored against, and the one the router builds and invokes.
// Four parties pull on it (ADR-0004): the AI writes to it, the gate (2.5) asserts
// it, the smoke rung runs it, and the router below builds it. Generated code never
// sees raw HTTP or a table name — only this.

import type { CapabilityDataTool } from "../capability-data/index.ts";

// Parsed request input — the form fields of a POST or the query params of a GET,
// flattened to string values the way HTML forms and query strings arrive. The
// handler coerces these to its spec's field types before handing them to `data`
// (the platform can't — it does not know the spec's intent). Generated code never
// touches the raw Request (ADR-0004).
export type CapabilityInput = Readonly<Record<string, string>>;

// The single platform-built context a handler receives: parsed input plus a data
// tool already scoped to this capability — its insert/select physically cannot
// address another capability's table (ADR-0004 decision 2: scoping by construction).
export interface CapabilityContext {
  readonly input: CapabilityInput;
  readonly data: CapabilityDataTool;
}

// One handler: a single default-exported async function returning an HTML fragment
// string. The platform owns the HTTP response — headers, status, routing; the
// handler owns only the fragment (ADR-0004).
export type CapabilityHandler = (context: CapabilityContext) => Promise<string>;
