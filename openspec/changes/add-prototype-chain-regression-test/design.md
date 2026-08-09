## Context

CON-95 already implemented and shipped the `Object.create(null)` hardening in
`lib/ui/ticket-provider.js`'s `MODULES`/`ALIASES` lookup tables. This change
adds only an automated regression test for that already-shipped behavior —
no production code changes, no new architecture, no external dependency.

## Goals / Non-Goals

**Goals:**
- Add automated coverage in `test/ticket-provider.test.js` for the
  prototype-chain-hardening behavior CON-95 shipped but left untested.

**Non-Goals:**
- No changes to `lib/ui/ticket-provider.js` or any other production file.
- No new spec-level behavior — the behavior under test already exists and is
  unchanged by this ticket.

## Decisions

- **Test target: `kindFor` and `moduleFor`.** These are the two exported
  functions that index `ALIASES` and `MODULES` respectively. Testing them
  directly (rather than indirectly through a higher-level entry point) keeps
  the regression test tightly scoped to the hardened lookup and immune to
  churn elsewhere in the file.
- **No design document would normally be warranted** for a change this small
  (single test file, no cross-cutting concerns, no new dependencies) — this
  file exists only to satisfy the workflow's own build order, per the
  proposal's Impact section.

## Risks / Trade-offs

- [Test could pass trivially without exercising the hardening] → Mitigation:
  each test case asserts the specific "unknown kind" throw / unresolved-alias
  behavior, and a maintainer can confirm the test fails if `Object.create(null)`
  is reverted to `{}` by temporarily reverting CON-95's hardening locally.
