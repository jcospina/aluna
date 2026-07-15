// The deterministic capability router — Module 2, Epic 2.3 (ARCH §6.2, ADR-0004).
//
// The single public entry point for the router subsystem: the handler contract
// (the shape generated handlers are authored against and the gate asserts) and the
// route registration the app wires in. Later epics import from here and depend on
// nothing inside.

export type {
  CapabilityContext,
  CapabilityHandler,
  CapabilityInput,
  CapabilityInputValue,
} from "./contract.ts";
export {
  type CapabilityRouterDeps,
  type HandlerLoader,
  ITEM_RENDERER_FILE,
  type ItemRendererLoader,
  registerCapabilityRoutes,
} from "./router.ts";
export {
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  ALUNA_RESERVED_PREFIX,
  type ParsedCapabilityRequest,
  parseCapabilityRequest,
  type WireProtocolAction,
  WireProtocolError,
} from "./wire-protocol.ts";
