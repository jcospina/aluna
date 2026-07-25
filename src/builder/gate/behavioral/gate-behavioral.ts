// From the 4.4 reset every admitted capability has the same five-Action behavioral
// contract. Keep this public module as the stable Gate seam while delegating directly
// to the sole steady-state implementation; the former two-Action runner is gone.

export { runFullBehavioralRung as runBehavioralRung } from "./gate-behavioral-full.ts";
export { buildFullBehavioralTestPrompt as buildBehavioralTestPrompt } from "./gate-behavioral-full-prompt.ts";
