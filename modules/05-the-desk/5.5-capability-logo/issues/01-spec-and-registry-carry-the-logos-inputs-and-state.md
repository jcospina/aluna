# The spec and registry carry the logo's inputs and state, and a prompt cannot direct a logo

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.5 — The capability logo
(PLAN decisions 39, 40, 42; [ADR-0007](../../../../docs/adr/0007-capability-logo-contract.md):
`modules/05-the-desk/PLAN.md`)

## What to build

The data the logo needs, and the rule that keeps users out of it.

This is the module's second and last reset-bounded authored-spec cut. Capabilities
built as placeholder proofs in 5.1–5.4 predate the required birth facts and have
never spent logo credits, so run `bun run reset` here before rebuilding them. No
missing-field compatibility default, registry-only backfill, or snapshot/spec
drift is introduced. From this issue onward every capability is born with the
final logo inputs and no later Module 5 issue resets the corpus.

**Three model-authored keys on the spec.** `subject` (a short phrase), `ground`
(one of the eight tint anchors) and `noun` (for the desk's empty-state copy).

**Two runtime values owned by the registry.** The per-incarnation `seed`, stored
rather than derived from a name or position, and a durable logo lifecycle value
containing both `status` and `attempts`. Status is **absent**, **generating**,
**present**, or **abandoned**. `generating` is the atomic claim that prevents two
desk loads from spending the same attempt; `attempts` is incremented when that
claim is won, not after the provider returns. The artwork itself is not a registry
column and is not part of an immutable version snapshot — 5.5/02 stores it once
under the incarnation's artifact root.

`subject` and `ground` are birth facts. Evolution must preserve them byte-for-byte
and they never become Diff facts; accepting a change would make the spec disagree
with artwork that L7 forbids remaking. `noun` may evolve as a platform-View fact
and never selects logo generation. The seed and lifecycle value are
platform-owned and absent from authored candidates.

**Ground validation becomes a word-list check.** The eight anchors are leaf,
shade, teal, sky, sun, ochre, clay and violet. Signal red is reserved and is not
offered. This deletes the chroma-and-lightness validator entirely: *in the
palette*, *saturated*, *light enough for daylight*, *no near-blacks*, *no
pastels* and *no greys* are all satisfied by construction, because the eight
anchors were chosen that way. A model choosing beats a hash because the colour
stays apt — telescope on sky, recipes on ochre. Two capabilities are allowed to
look alike (L9), so no uniqueness rule is owed.

The request's second colour is not another authored fact. The shell derives it
from one closed, symmetric companion lookup — leaf/shade, teal/sky, sun/ochre and
clay/violet — and passes the selected ground first. That makes every request
fully determined by the three authored keys plus registry seed without quietly
asking the model for a fourth key or letting a caller choose presentation.

**Users do not steer presentation, and the logo is presentation.** The subject
phrase is derived from intent, never from user-authored art direction. A prompt
attempting to direct the logo is refused by the intent classifier under the same
general rule that refuses *"move this 2px right"* or *"add more padding"* — no
logo-specific defence and no logo-specific validator. ADR-0007's existing
requirement stands unchanged: the request wraps the injected subject phrase,
because `controls.no_text: true` is recorded as not sufficient on its own.

## Acceptance criteria

- [ ] A spec carrying `subject`, `ground` and `noun` round-trips through
      generation, validation and storage
- [ ] `bun run reset` removes the pre-logo placeholder corpus before the schema
      cut; no old row is backfilled and no later Module 5 issue requires a reset
- [ ] A `ground` outside the eight anchors fails validation; signal red fails
      validation
- [ ] The second request colour comes from the closed companion lookup; it is not
      authored, stored, caller-variable or inferred ad hoc by the provider client
- [ ] The chroma-and-lightness validator is deleted, not bypassed
- [ ] The registry carries the per-incarnation seed plus durable logo status and
      attempt count; `generating` is an atomically claimed state
- [ ] Evolution preserves `subject` and `ground` exactly; a `noun` change is a
      View-only fact and no evolution fact can select logo generation
- [ ] A prompt attempting to direct a logo is refused by the intent classifier,
      on the same path as any other presentation-steering prompt — with no
      logo-specific rule added
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability with the logo provider disabled and confirm the developer
preview shows its `subject`, `ground`, `noun`, seed, status and attempt count.
Evolve the capability and confirm its subject, ground and seed do not move.
Submit *"make the notes icon blue and bigger"*
and confirm the ordinary presentation-steering refusal.

## Blocked by

- modules/05-the-desk/5.4-desk-wallpaper-logos-prompt-bar/issues/02-the-logo-layer-replaces-the-toolbar.md
