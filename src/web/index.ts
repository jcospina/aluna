// The web presentation layer — the route handlers' request parsing and HTML output.
//
// The single public entry point: reading the typed prompt off a request and
// rendering the shell fragments the `/prompt` and build flows return or stream.
// Everything here is transport/markup glue with no build logic. (`escapeHtml` is
// deliberately not re-exported: every caller imports it from `./html.ts` directly.)

export {
  renderCachedCapabilityCommitSwap,
  renderCachedCapabilityShell,
  renderCachedCapabilitySurface,
  renderRehydratedShellPage,
} from "./cached-view.ts";
export {
  renderBuildSubscriber,
  renderCapabilityToolbarEntry,
  renderRehydratedShell,
} from "./fragments.ts";
export { readPrompt, readPromptSubmission } from "./prompt-request.ts";
