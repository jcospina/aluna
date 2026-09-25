// The capability handler contract, as amended by the presentation adapter.
//
// This is the one shape every handler — AI-generated, or hand-written as a fixture here —
// is authored against, and the one the router builds and invokes. Four parties pull on it:
// the AI writes to it, the Gate asserts it, the smoke rung runs it, and the router below
// builds it. Generated code never sees raw HTTP or a table name — only this.

import type { PresentationAdapter } from "../../presentation/index.ts";
import type {
  CapabilityDeleteMutationPort,
  CapabilityFileProjection,
  CapabilityMutationPort,
  CapabilityQueryPort,
  CapabilityUpdateMutationPort,
} from "../data/index.ts";

/**
 * Parsed request input. Multiplicity survives parsing; the submitted-field set carries presence
 * apart from values (an unchecked checkbox has presence, no value). Reserved markers enter neither.
 */
export type CapabilityInputValue = string | readonly string[];
export interface CapabilityInput<Value = CapabilityInputValue> {
  readonly values: Readonly<Record<string, Value>>;
  readonly submittedFields: ReadonlySet<string>;
}

/**
 * A save's input, the one that can name a file: the projection of what the save will store, or
 * `null` for an empty field or an edit's clear.
 */
export type CapabilitySaveInputValue = CapabilityInputValue | CapabilityFileProjection | null;
export type CapabilitySaveInput = CapabilityInput<CapabilitySaveInputValue>;

/**
 * The platform-built contexts keep write authority apart from free reads: create is
 * capability-bound, update and delete record-bound. The Handler never imports platform modules.
 */
export interface CapabilityContext {
  readonly input: CapabilityInput;
  readonly query: CapabilityQueryPort;
  readonly present: PresentationAdapter;
}

export interface CapabilityCreateContext extends Omit<CapabilityContext, "input"> {
  readonly input: CapabilitySaveInput;
  readonly mutation: CapabilityMutationPort;
}

export interface CapabilityUpdateContext extends Omit<CapabilityContext, "input"> {
  readonly input: CapabilitySaveInput;
  readonly mutation: CapabilityUpdateMutationPort;
}

export interface CapabilityDeleteContext {
  readonly input: CapabilityInput;
  readonly mutation: CapabilityDeleteMutationPort;
  readonly query: CapabilityQueryPort;
}

/**
 * One handler: a single default-exported async function returning an HTML fragment string. The
 * platform owns headers, status and routing; the handler owns only the fragment.
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
