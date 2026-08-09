## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/ticket-provider-kind-resolution/spec.md`,
  `workflow-state.md`, `.openspec.yaml`.
- Read `lib/ui/ticket-provider.js` (lines 1-193) directly to check the
  spec's claims against the real, already-shipped implementation (not the
  ticket's narrative):
  - `MODULES = Object.assign(Object.create(null), { linear, local })`
    (line 33) and `ALIASES = Object.assign(Object.create(null), { manual:
    'local' })` (line 48) — both null-prototype, confirming CON-95's
    hardening is in fact shipped and matches the "Context" section's claim.
  - `kindFor` (line 54-57): `return ALIASES[raw] || raw;` — for any of
    `constructor`/`toString`/`hasOwnProperty`/`__proto__`,
    `ALIASES[raw]` is `undefined` (null-prototype object, no inherited
    accessor/property), so it falls through to `raw` unresolved — matches
    spec Scenario 1 exactly.
  - `moduleFor` (line 70-97): `mod = MODULES[kind]`; same reasoning makes
    `mod` `undefined` for all four probe values, hitting the `if (!mod)
    throw new Error(...)` gate at line 93-96 — matches spec Scenario 2
    exactly, including that the thrown message is the same "unknown kind"
    gate text used for any other bad kind (not a special-cased error).
  - `module.exports` (line 182-193) exports both `kindFor` and `moduleFor`,
    so the planned test can call them directly as tasks.md specifies.
- Read `test/ticket-provider.test.js` in full (140 lines). Confirmed:
  - No existing test already covers this (grepped for
    `constructor|hasOwnProperty|__proto__|toString` against
    `kindFor`/`moduleFor`/`ALIASES`/`MODULES` — only unrelated hits for
    `teamNotFoundMessage` truncation-budget prose).
  - The file's existing style (`provider.moduleFor(...)`,
    `provider.kindFor(...)` called directly with a bare config object, e.g.
    lines 115-118, 128-132) is exactly the pattern tasks.md/design.md
    describe using — no friction integrating the new test.
- Confirmed via `git log` that CON-95 (commit `3eadfaa`) is the only prior
  commit touching `lib/ui/ticket-provider.js`, and no
  `openspec/specs/ticket-provider-kind-resolution/` directory exists yet
  (`find` returned nothing) — so this genuinely is a new spec delta, not a
  duplicate/conflicting one.
- Checked AC traceability: ticket.md's two ACs ("test... probes kind values
  of constructor/toString/hasOwnProperty/__proto__... asserts each
  correctly throws" and "test suite passes") map 1:1 onto tasks.md's 1.1
  and 1.2, with no AC left uncovered and no task exceeding the ACs' scope.
- Checked design.md's Non-Goals ("no production code changes", "no new
  spec-level behavior") against proposal.md's "New Capabilities" section
  (`ticket-provider-kind-resolution`) — not a contradiction: the *spec
  document* is new, the underlying *runtime behavior* is unchanged, which
  is exactly what proposal.md states ("No behavior changes as a result of
  this change").

### Adversarial checks performed, no issues found

- **Placeholders/hand-waving:** none — every artifact is fully concrete
  (exact function names, exact probe values, exact assertion semantics).
- **Internal contradictions:** none between ticket/proposal/design/tasks/spec.
- **Ambiguity:** task 1.1 names the exact functions, exact four probe
  values, and exact expected outcome per function
  (`kindFor` → unresolved raw value; `moduleFor` → throws) — a competent
  implementer cannot read this two ways.
- **Scope drift:** none — design.md's Non-Goals explicitly forbid touching
  `lib/ui/ticket-provider.js`, and the Impact section in proposal.md scopes
  the change to `test/ticket-provider.test.js` only.
- **Missing contract updates:** N/A — no API/schema change; the new spec
  delta itself *is* the contract update this ticket is meant to produce.

### Verdict: CONFIRM

### Non-blocking notes

- design.md's Risks/Trade-offs section suggests the mitigation-verification
  path is "a maintainer can confirm the test fails if `Object.create(null)`
  is reverted... locally" — this is fine as documented intent but isn't a
  task; the executor doesn't strictly need to perform this revert-and-check
  dance during execution, since the same logical check (each assertion pins
  to the specific gate throw / unresolved-value behavior, not merely
  "doesn't throw a TypeError") is enough to make the test non-trivial. No
  action required — flagging only so the executor doesn't over-scope task
  1.1 into an unnecessary manual revert exercise.
