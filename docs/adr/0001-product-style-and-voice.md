# 0001 — Product style & voice: subtler neobrutalism on Paper & Ink

Status: accepted

**Amended 2026-08-20 — the visual half is superseded, the voice half is not.**
This ADR settles four separable things, and the desktop design session
(`modules/05-the-desk/PLAN.md`, decision 7) supersedes exactly one of them.

*Superseded.* The Paper & Ink palette, the neobrutalist border and shadow ladder,
the 10px radius, the single `public/app.css` with one `:root` (since split into
`public/css/`), and the Outfit-only typography all give way to the **High
Meadow** system in `design/styles/`. That directory is the shipped stylesheet
rather than a reference mockup, and it is the source of truth for the visual
system **including token names**, so the `--color-*` vocabulary introduced here
does not survive the move. High Meadow pairs a display face (Fraunces) with
Outfit as the body face, which retires "no separate display face is carried
over"; both are still vendored locally, so the offline, build-free, no-CDN part
of the typography decision holds. The 10px radius gets no successor value: every
corner is mitred and there are no radius tokens at all. ADR-0005's closed design
axes re-derive against High Meadow names, in its own 2026-08-20 amendment.

*Survives.* The warm, encouraging, first-person product voice with zero internals
jargon is untouched, and `CONTEXT.md` stays its home as durable guidance for
every coding agent's copy. Aluna stays the user-facing wordmark. The styled
lockup that carried the name in the deleted shell goes with that shell — the
design handbook's wordmark section is a deletion rather than a rewrite (§7a) —
but the name this ADR introduced stands.

*The pet is still deferred, and has since gained a direction.* It remains
unimplemented and undesigned, so a future issue still implements it cold. What
changed is that it is no longer only a delight layer: the companion is a talking
pet, expected to carry the product's narration once it lands (§13). That is why
the surfaces for a disposable query answer and for a behavioural proposal wait on
it rather than being drawn now.

*Retired.* "A dark theme stays a purely additive future override" no longer
holds. High Meadow is daylight and does not invert, and no dark theme is planned
(§12f). The semantic-token insurance below bought a future that has since been
declined.

## Decision

Aluna's base visual style is subtler neobrutalism on a Paper & Ink palette,
typeset in Outfit (vendored locally) and expressed through semantic CSS
custom-property tokens in a single `public/app.css` with one `:root` and no
theming machinery (light theme only). The product speaks in a warm, first-person
product voice that never exposes internals (ARCH §9.7). This ADR introduces
Aluna as the user-facing wordmark. The pet, the anthropomorphic spark of Aluna,
is specified but deferred: none of it is implemented now.

## Context / why

The token source is an existing Paper & Ink theme, not a loud, high-chroma
default. Paper & Ink is already quiet: warm cream page, warm near-black ink,
terracotta primary. Its full role set (text/surface/background, primary,
secondary, info, feature, warm) carries over, re-homed under `--color-*` names,
and some roles are reserved for capabilities to use later.

Shadows and borders make the style subtler, not color; the result is a quieter,
PostHog-like register. We turn the neobrutalist dial *down*: 1px softened-ink
borders on structural surfaces only, where loud neobrutalism uses 2–4px; two-step
down-right hard shadows `2px/4px`, where loud neobrutalism piles up left-down
`-2/-6/-12/-16px`; a gentle 1–2px press instead of a 3–6px slam. The 10px radius
is retained.

The owner is locking Paper & Ink, so there is a single `:root` and no theming
machinery — no `data-schema`, no theme registry, no dark stylesheet. Using
*semantic* tokens still leaves a dark theme as a purely additive future override,
which satisfies the "structured for dark later" requirement without building any
switching machinery.

Typography is the highest-leverage warmth lever, and "look how friendly" is part
of the thesis (ARCH §2, §9.7), so Outfit is vendored locally: the OFL-licensed
variable woff2 keeps it build-free and offline, with no CDN. No separate shaded
display/logo face is carried over — the wordmark is typographic in Outfit.

The product voice is warm, encouraging and gently curious, first person, with
zero internals jargon (ARCH §9.7). It lives in `CONTEXT.md` as durable guidance
because it steers every future coding agent's copy.

The pet is deferred because the thesis is the self-building app and the pet is a
delight layer to build *after* the spine works. The originating issue specifies
it fully — concept, placement, state vocabulary, rendering constraints,
reduced-motion — so a future issue can implement it cold. Its name stays TBD
pending verification of an authentic Kogi word; nothing is fabricated.

## Consequences

- A dark theme, status/tone color tokens (error/success), and the pet are all
  additive future work; none of them requires reworking what ships here.
- Coding agents must consult `docs/design-system.md` for the practical reference
  and `CONTEXT.md` for language and voice before adding UI. The CSS in
  `public/app.css` is the source of truth for token *values*.
