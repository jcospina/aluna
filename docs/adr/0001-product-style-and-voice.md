# 0001 — Product style and voice

Status: Accepted

## Context

Aluna writes, checks and hosts code while it runs, so its insides are specs,
Handlers, migrations and Gate checks. The person it serves wants to keep track of
something and has no interest in designing software. When those insides show
through in a sentence or a screen, Aluna reads as the coding agent or developer
console that [PRODUCT.md](../../PRODUCT.md) rules out. A model writes some of what
the person sees, from a build's opening line to each record's card, so the rules
have to bind its output as well as the platform's.

## Decision

### One product voice

Every sentence Aluna says to the person is warm, encouraging and gently curious, in
the first person and addressed to "you", plainspoken and never cutesy or cryptic.
No sentence exposes internals: no word from Aluna's engineering vocabulary, such
as handler, spec, migration or schema, reaches the person. The prompts behind a
build's opening line, a Handler's validation errors and a spoken answer carry the
same rule. The [Product voice](../../CONTEXT.md#product-voice) section of
CONTEXT.md is the guide.

A build narration is the one departure from "never cutesy": it names each stage
with an odd little verb, such as Scheming or Prodding, over a plain line
(`design/scripts/narration/voice.js`). The departure covers what the narration
says while a build runs and the line a build that lands ends on. A build that does
not land ends in the plain voice.

The developer panel stands outside the voice. It shows a build's raw payloads, in
the only monospace face in Aluna.

### One name

Aluna is the only name a person sees, and it is the page title. The desk carries no
styled wordmark and no header row.

### One visual system

Aluna has one visual system, High Meadow, and ships `design/styles/` as its
stylesheet. A logo's artwork is the one exception, with shades of its own
([ADR-0007](0007-capability-logo-contract.md)). `design/styles/tokens.css` is the
source of truth for every token's name and value. The shell's own sheets in
`public/css/` load after `design/styles/index.css` and declare no token and no
literal colour. [`design/design-system.md`](../../design/design-system.md) holds
the system's names and rules, and
[ADR-0005](0005-opinionated-capability-ui-design-contract-and-gate.md) binds a
model's card markup to them.

### Two faces, shipped with the app

Fraunces sets display type and Outfit sets body type. Both are OFL-licensed
variable woff2 files in `design/assets/fonts/`, declared in
`design/styles/base.css`, so Aluna's type needs no build step, no CDN and no
network. The developer panel's system monospace is the only other face.

### No dark theme

High Meadow is a daylight palette with no dark variant. `tokens.css` declares
`color-scheme: light` and has no `prefers-color-scheme` rule, so a dark OS setting
changes nothing. A dark theme is declined, not deferred.

## Considered options

**A dark theme, or one that follows the OS.** A contrast audit sets High Meadow's
type strengths against its own fills, so a dark theme would need a second audited
palette that every generated card also reads on. PRODUCT.md lists dark themes among
Aluna's anti-references.

**A copy of High Meadow in the app's own stylesheet.** Two copies drift apart.
Loading `design/styles/` directly keeps the product and its design pages on the
same files, and the shell's sheets add rules on top without restating a token.

**A technical voice.** Machinery words make Aluna sound like the coding agent it is
not, and the developer panel already shows the machinery to anyone who wants it.

## Consequences

A change to a colour, a type size or a spacing step is one edit to `tokens.css`, and
the product and the design pages pick it up together. Lint policies keep the token
layer in that file (`src/presentation/tokens/high-meadow-token-layer.policy.ts`) and
the wordmark off the desk (`src/presentation/shell/desk/desk-ground.policy.ts`).
Tests on the surfaces that speak assert that their copy names no machinery.

A viewer whose OS is set to dark sees Aluna in daylight.
