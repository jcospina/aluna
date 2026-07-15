// The capability handler contract — Module 2, Epic 2.3 (ADR-0004 decision 2), amended by
// Module 3, epic 3.4/01 (ADR-0005 §2 & §3) with the presentation adapter.
//
// This is the one shape every handler — AI-generated in 2.5, or hand-written as a
// fixture here — is authored against, and the one the router builds and invokes.
// Four parties pull on it (ADR-0004): the AI writes to it, the gate (2.5) asserts
// it, the smoke rung runs it, and the router below builds it. Generated code never
// sees raw HTTP or a table name — only this.

import type { CapabilityMutationPort, CapabilityQueryPort } from "../capability-data/index.ts";
import type { PresentationAdapter } from "../presentation/index.ts";

// Parsed request input. Multiplicity survives parsing, while the submitted-field
// set carries presence separately from values (an unchecked checkbox has presence
// but no value). Reserved platform markers never enter either collection.
export type CapabilityInputValue = string | readonly string[];
export interface CapabilityInput {
  readonly values: Readonly<Record<string, CapabilityInputValue>>;
  readonly submittedFields: ReadonlySet<string>;
}

// The platform-built contexts keep write authority separate from free reads. Every
// current Action receives the physically read-only query port; create additionally
// receives a mutation port already bound to the target capability. Both receive the
// presentation adapter (ADR-0005 §2 & §3). The Handler never imports platform modules.
export interface CapabilityContext {
  readonly input: CapabilityInput;
  readonly query: CapabilityQueryPort;
  readonly present: PresentationAdapter;
}

export interface CapabilityCreateContext extends CapabilityContext {
  readonly mutation: CapabilityMutationPort;
}

// One handler: a single default-exported async function returning an HTML fragment
// string. The platform owns the HTTP response — headers, status, routing; the
// handler owns only the fragment (ADR-0004).
export type CapabilityCreateHandler = (context: CapabilityCreateContext) => Promise<string>;
export type CapabilityReadHandler = (context: CapabilityContext) => Promise<string>;
export type CapabilityHandler = CapabilityCreateHandler | CapabilityReadHandler;
