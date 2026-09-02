// The capability handler contract, as amended by the presentation adapter.
//
// This is the one shape every handler — AI-generated, or hand-written as a fixture here —
// is authored against, and the one the router builds and invokes. Four parties pull on it:
// the AI writes to it, the Gate asserts it, the smoke rung runs it, and the router below
// builds it. Generated code never sees raw HTTP or a table name — only this.

import type { PresentationAdapter } from "../../presentation/index.ts";
import type {
  CapabilityDeleteMutationPort,
  CapabilityMutationPort,
  CapabilityQueryPort,
  CapabilityUpdateMutationPort,
} from "../data/index.ts";

/**
 * Parsed request input. Multiplicity survives parsing, while the submitted-field
 * set carries presence separately from values (an unchecked checkbox has presence
 * but no value). Reserved platform markers never enter either collection.
 */
export type CapabilityInputValue = string | readonly string[];
export interface CapabilityInput {
  readonly values: Readonly<Record<string, CapabilityInputValue>>;
  readonly submittedFields: ReadonlySet<string>;
}

/**
 * The platform-built contexts keep write authority separate from free reads. Every
 * current Action receives the physically read-only query port. Create receives
 * capability-bound insert authority; update/delete receive record-target-bound
 * authority. Record-rendering Actions also receive the presentation adapter
 * The Handler never imports platform modules.
 */
export interface CapabilityContext {
  readonly input: CapabilityInput;
  readonly query: CapabilityQueryPort;
  readonly present: PresentationAdapter;
}

export interface CapabilityCreateContext extends CapabilityContext {
  readonly mutation: CapabilityMutationPort;
}

export interface CapabilityUpdateContext extends CapabilityContext {
  readonly mutation: CapabilityUpdateMutationPort;
}

export interface CapabilityDeleteContext {
  readonly input: CapabilityInput;
  readonly mutation: CapabilityDeleteMutationPort;
  readonly query: CapabilityQueryPort;
}

/**
 * One handler: a single default-exported async function returning an HTML fragment
 * string. The platform owns the HTTP response — headers, status, routing; the
 * handler owns only the fragment.
 */
export type CapabilityCreateHandler = (context: CapabilityCreateContext) => Promise<string>;
export type CapabilityReadHandler = (context: CapabilityContext) => Promise<string>;
export type CapabilityUpdateHandler = (context: CapabilityUpdateContext) => Promise<string>;
export type CapabilityDeleteHandler = (context: CapabilityDeleteContext) => Promise<string>;
export type CapabilityHandler =
  | CapabilityCreateHandler
  | CapabilityReadHandler
  | CapabilityUpdateHandler
  | CapabilityDeleteHandler;
