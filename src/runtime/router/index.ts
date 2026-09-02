// The deterministic capability router.
//
// The single public entry point for the router subsystem: the handler contract
// (the shape generated handlers are authored against and the gate asserts) and the
// route registration the app wires in. Later epics import from here and depend on
// nothing inside.

export type {
  CapabilityContext,
  CapabilityCreateContext,
  CapabilityCreateHandler,
  CapabilityDeleteContext,
  CapabilityDeleteHandler,
  CapabilityHandler,
  CapabilityInput,
  CapabilityInputValue,
  CapabilityReadHandler,
  CapabilityUpdateContext,
  CapabilityUpdateHandler,
} from "./contract.ts";
export {
  CapabilityReadAbandonedError,
  DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS,
  withHandlerDeadline,
} from "./dispatch/generated-code.ts";
export {
  type CapabilityRouterDeps,
  type HandlerLoader,
  ITEM_RENDERER_FILE,
  type ItemRendererLoader,
  registerCapabilityRoutes,
} from "./dispatch/router.ts";
export { READ_UNAVAILABLE_FRAGMENT } from "./wire/failure-responses.ts";
export {
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  ALUNA_RESERVED_PREFIX,
  type ParsedCapabilityRequest,
  parseCapabilityRequest,
  type WireProtocolAction,
  WireProtocolError,
} from "./wire/wire-protocol.ts";
