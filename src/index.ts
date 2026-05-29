// Platform entrypoint — Module 1, Epic 1.1 (the runtime spine).
//
// Pure toolchain at this stage: no server, shell, SSE, database, or AI yet.
// Those arrive in later epics and import from here. For now this just proves
// the Bun + TypeScript project boots, type-checks, and runs.

console.log(`omni-crud runtime spine ready — Bun ${Bun.version}`);
