/**
 * The pairings a build's narration paints: the drawing of the window being made, and the band
 * under it (`design/styles/components/narration.css`). Its lines and type sit in the surface
 * rows; these are the tints and marks that carry no text.
 */

import type { Pairing } from "./contrast-audit.js";

const surface = { token: "surface" } as const;
const surface2 = { token: "surface-2" } as const;

export const NARRATION_PAIRINGS: readonly Pairing[] = [
  {
    what: "a part inked in a build's drawing",
    foreground: surface2,
    background: surface,
    threshold: "exempt",
    note:
      "The tint inside a part of the window being drawn, and it carries no text: the inked " +
      "outline around it, measured above, is what draws the part.",
    sites: [
      'design/styles/components/narration.css § .narration__sheet rect[data-state="inked"]:not([data-part="frame"]) [fill]',
    ],
  },
  {
    what: "the status tag on a card in a build's drawing",
    foreground: { mix: ["leaf", "surface"], toward: 0.55, space: "oklab" },
    background: surface,
    threshold: "exempt",
    note:
      "A tint inside the drawing that carries no text: the inked outline draws the tag, the " +
      "leaf only says it is the finished one.",
    sites: [
      'design/styles/components/narration.css § .narration__sheet rect[data-part="pill"][data-state="inked"] [fill]',
    ],
  },
  {
    what: "the button that adds a record, in a build's drawing",
    foreground: { mix: ["shade", "surface"], toward: 0.65, space: "oklab" },
    background: surface,
    threshold: "exempt",
    note:
      "A tint inside the drawing that carries no text: the inked outline and its plus draw " +
      "the button.",
    sites: [
      'design/styles/components/narration.css § .narration__sheet rect[data-part="newbtn"][data-state="inked"] [fill]',
    ],
  },
  {
    what: "a part being mended in a build's drawing",
    foreground: { token: "clay" },
    background: surface,
    threshold: "exempt",
    note:
      "The clay line says a part is being remade, and it carries no text: the band under the " +
      "drawing says Mending in words while it is.",
    sites: [
      'design/styles/components/narration.css § .narration.is-mending .narration__sheet [data-state="mending"] [stroke]',
    ],
  },
  {
    what: "the ghost of the window a build is making",
    foreground: { token: "ink-3", alpha: 0.28, over: surface },
    background: surface,
    threshold: "exempt",
    note:
      "A faint dashed copy of the window, there before any of it is drawn, and it carries no " +
      "text: the pencil and the ink drawn over it are the drawing, the line under it the words.",
    sites: [
      "design/styles/components/narration.css § .narration__ghost [data-ghost] [stroke]",
      "design/styles/components/narration.css § .narration__ghost [data-ghost] [opacity]",
    ],
  },
  {
    what: "the ghost of a part whose house rules are being written",
    foreground: { token: "ink-3", alpha: 0.44, over: surface },
    background: surface,
    threshold: "exempt",
    note:
      "The ghost growing surer while its part's rules are written, and it still carries no text: " +
      "the band under the drawing says Rule-writing in words.",
    sites: [
      'design/styles/components/narration.css § .narration__ghost [data-ghost][data-rules="writing"] [opacity]',
    ],
  },
  {
    what: "the ghost of a part whose house rules are written",
    foreground: { token: "ink-3", alpha: 0.5, over: surface },
    background: surface,
    threshold: "exempt",
    note:
      "The same ghost grown surer, and it still carries no text: it fades from under each part " +
      "as that part is drawn.",
    sites: [
      "design/styles/components/narration.css § .narration__ghost [data-ghost][data-rules] [opacity]",
    ],
  },
  {
    what: "the ghost under a part being drawn",
    foreground: { token: "ink-3", alpha: 0.02, over: surface },
    background: surface,
    threshold: "exempt",
    note:
      "All but gone while the pencil is drawn over it, and it carries no text: the pencil " +
      "stroke on top of it is the part being drawn.",
    sites: [
      'design/styles/components/narration.css § .narration__ghost [data-ghost][data-state="fading"] [opacity]',
    ],
  },
  {
    what: "a check prodding a build's drawing",
    foreground: { token: "sun" },
    background: surface,
    threshold: "exempt",
    note:
      "A tick that comes and goes while the checks run, and it carries no text: the band under " +
      "the drawing says Prodding in words.",
    sites: ["design/styles/components/narration.css § .narration__prod [stroke]"],
  },
  {
    what: "a finished stage's square beside a build's verb",
    foreground: { token: "ink", alpha: 0.35, over: surface },
    background: surface,
    threshold: "exempt",
    note:
      "A five-pixel mark that carries no text: the stage's own name, beside the squares, " +
      "says where the build is.",
    sites: [
      'design/styles/components/narration.css § .narration__dot[data-state="done"] [background-color]',
    ],
  },
];
