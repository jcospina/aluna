# Runtime allow-list enforcer

Status: ready-for-agent

## Epic

Module 3 — Opinionated Capability UI · Epic 3.1 — Closed-value design contract +
primitive vocabulary (`docs/modules.md` §3.1, ADR-0005 §3 & §4, PLAN decision 3:
`modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

The runtime enforcer the presentation adapter applies to **every rendered
record**, so a dynamic field value can never become executable markup even after
build-time validation passes (ADR-0005 §3 — "enforces the allowed
HTML/class/style surface at runtime on every rendered record"). This is the
*safety* half of the closed-value contract: the design-lint **Gate** rung (3.6)
catches violations at build time; the enforcer is the last line at render time.

- Given generated inner markup for one record, accept only the allow-listed
  classes/elements from the 3.1/01 vocabulary; reject or neutralize
  fabricated/unknown classes, interactive descendants, scripts/event handlers,
  and unsafe field interpolation.
- **Sanitize inline `style` to the 3.1/01 token discipline** rather than
  stripping it wholesale: drop declarations that set a token-owned axis
  (color/font/type/spacing/border) with an off-token value, and drop forbidden
  constructs (`url(...)`, item-escaping position values); pass conforming
  declarations through. A hostile field value smuggled into a `style` attribute
  must come out inert.
- Deterministic and dependency-free enough to run on every record render inside
  the adapter (3.4/01) without a measurable latency cost.

## Acceptance criteria

- [ ] The enforcer passes markup composed of allow-listed classes/elements —
      including token-disciplined inline `style` — through unchanged
- [ ] Fabricated/unknown classes, off-token declarations on the token-owned axes
      (color/font/type/spacing/border), forbidden style constructs (`url(...)`,
      item-escaping position), interactive descendants, scripts/event handlers,
      and unsafe interpolation are rejected or neutralized
- [ ] Hostile synthetic field values (script tags, `on*=` handlers, style
      injection, class smuggling) cannot produce executable markup through the
      enforcer
- [ ] Tests cover the accept path and each hostile category; no external
      dependency is required at render time
- [ ] Not independently demo-relevant — the enforcer has no visual surface of its
      own and is exercised once records render through the adapter (3.4/01); noted
      here per the living-demo rule

## Blocked by

- modules/03-opinionated-ui-design-contract/3.1-closed-value-contract-and-primitives/issues/01-closed-value-class-vocabulary-and-css.md
