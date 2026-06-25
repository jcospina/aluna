// The build pipeline — turning a prompt into a committed capability (Module 2).
//
// The single public entry point for the orchestration layer that sits above the
// builder stages (`src/builder`): the production `/prompt` pipeline a queued job
// runs, the `/demo/spec-build` route's runner, and the metrics-recorder type the app
// wires its writer through. The app depends only on this barrel; the stage-running,
// preview, deflection, and metrics internals stay private to the folder.

export type { RecordMetrics } from "./metrics-recorder.ts";
export { createPromptBuildPipeline, type PromptBuildPipelineDeps } from "./prompt-pipeline.ts";
export { DEMO_SPEC_PROMPT, handleSpecBuildError, streamSpecBuildDemo } from "./spec-build-demo.ts";
