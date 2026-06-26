// The web presentation layer — the route handlers' request parsing and HTML output.
//
// The single public entry point: reading the typed prompt off a request, escaping
// interpolated text, and rendering the shell fragments the `/prompt` and build flows
// return or stream. Everything here is transport/markup glue with no build logic.

export {
  renderCachedCapabilityCommitSwap,
  renderCachedCapabilityShell,
  renderCachedCapabilitySurface,
} from "./cached-view.ts";
export {
  PROMPT_NOTICE_TARGET,
  renderBuildSubscriber,
  renderBusyNotice,
  renderCapabilityToolbarEntry,
} from "./fragments.ts";
export { escapeHtml } from "./html.ts";
export { readPrompt } from "./prompt-request.ts";
