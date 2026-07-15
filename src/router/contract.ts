// The capability handler contract — Module 2, Epic 2.3 (ADR-0004 decision 2), amended by
// Module 3, epic 3.4/01 (ADR-0005 §2 & §3) with the presentation adapter.
//
// This is the one shape every handler — AI-generated in 2.5, or hand-written as a
// fixture here — is authored against, and the one the router builds and invokes.
// Four parties pull on it (ADR-0004): the AI writes to it, the gate (2.5) asserts
// it, the smoke rung runs it, and the router below builds it. Generated code never
// sees raw HTTP or a table name — only this.

import type { CapabilityDataTool } from "../capability-data/index.ts";
import type { PresentationAdapter } from "../presentation/index.ts";

// Parsed request input. Multiplicity survives parsing, while the submitted-field
// set carries presence separately from values (an unchecked checkbox has presence
// but no value). Reserved platform markers never enter either collection.
export type CapabilityInputValue = string | readonly string[];
export interface CapabilityInput {
  readonly values: Readonly<Record<string, CapabilityInputValue>>;
  readonly submittedFields: ReadonlySet<string>;
}

// The single platform-built context a handler receives: parsed input, a data tool
// already scoped to this capability — its insert/select physically cannot address
// another capability's table (ADR-0004 decision 2: scoping by construction) — and the
// capability's presentation adapter (ADR-0005 §2 & §3). The handler renders each record
// by calling `present`, so create/read/search share one item composition and cannot
// drift; it never imports the item renderer, the enforcer, or the wrapper, and never
// carries its own row markup (ADR-0004 "Handlers import nothing" preserved).
export interface CapabilityContext {
  readonly input: CapabilityInput;
  readonly data: CapabilityDataTool;
  readonly present: PresentationAdapter;
}

// One handler: a single default-exported async function returning an HTML fragment
// string. The platform owns the HTTP response — headers, status, routing; the
// handler owns only the fragment (ADR-0004).
export type CapabilityHandler = (context: CapabilityContext) => Promise<string>;
