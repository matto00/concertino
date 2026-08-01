## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/launchpad-team-resolution/spec.md` in full.
- Traced all four acceptance criteria from `ticket.md` to specific tasks and spec
  scenarios:
  1. "Fetch distinguishes team-returned-nothing from team-key-matched-no-team" →
     Decision 1 (`resolveTeam` via Linear's `teams` filter, not inference from the
     `issues` result) + tasks 1.1–1.3, 2.1–2.3 + spec's first requirement/scenarios.
  2. Two distinct on-screen messages (`no open tickets in CON` /
     `no team with key "ABC" — check ticketProvider.teamKey`) → Decisions 3–4 +
     tasks 3.1–3.2 + spec's second requirement, with exact wording matching the
     ticket verbatim.
  3. `concertino validate` warning → task 4.1–4.3 + spec's fourth requirement,
     with warn/no-warn cases enumerated (enabled+absent, enabled+present, disabled).
  4. Cold cache must not regress → Decision 2 framing, task 2.4, spec's third
     requirement — and I independently verified this claim against the running
     code (see below), not just the design's assertion of it.
- Cross-checked every factual claim the design makes about the current codebase
  against the actual files in the worktree:
  - `lib/ui/linear.js`: `fetchTickets`, `post()`, `teamKeyFromConfig`,
    `launchPadStatus`, `module.exports` all exist as described; `fetchTickets`
    takes an options object with `apiKey`/`transport` defaults, confirming the
    design's proposed `resolveTeam(transport, apiKey, teamKey)` helper is
    additive and doesn't collide with existing exports.
  - `lib/ui/watch.js`: `refreshLaunchPad` (line 622) exists exactly as
    described — sets `lp.error = null` up front, calls `teamKeyFromConfig` and
    `fetchTickets`, catches into `lp.error = 'refresh failed: ...'`. Confirmed
    `refreshLaunchPad()` is called from exactly one place, the
    `'refresh-launchpad'` action case (line 1817, bound to the `r` key) — never
    from `openLaunchPad()` (lines ~592–614) or any render path. This
    independently confirms the design's "cold cache path never reaches the
    network" claim rather than trusting the assertion.
  - `lib/ui/screens/launchpad.js`: `headerLine` (line 161) currently renders
    bare `<n> open`; `f.red(lp.error)` rendering (line 291-292) and the
    cold-cache `no tickets cached yet — press r to fetch` line (line 280-281,
    gated on `cache.isCold(lp.cache) && !lp.refreshing`) both exist as the
    design assumes.
  - `lib/ui/linear.js` `normalise()` (confirmed) stores `teamKey` on the cache
    object, matching Decision 4's claim that `lp.cache.teamKey` is available
    for the header without re-deriving it.
  - `bin/concertino` `cmdValidate` (line 1398) has the `warn()`/`fail()`/`ok()`
    helper pattern the design says the new check will reuse, and the
    `ticketProvider` section (line 1447) is a real, matching insertion point;
    confirmed `dashboard.launchPad.enabled` is not yet referenced anywhere in
    `bin/concertino` today (new ground, not a collision), while
    `config.dashboard.launchPad.{enabled,backlog}` is an established path used
    identically elsewhere (`lib/ui/linear.js` lines 282, 364, 367;
    `docs/dashboard.md` lines 161, 428, 438).
  - `test/linear.test.js` and `test/watch.test.js` exist; `test/linear.test.js`
    already uses a `fakeTransport`/canned-response pattern matching what task
    1.3 asks new tests to reuse.
- Checked for spec collisions: `openspec/specs/` has `launchpad-detail-pane` and
  `launchpad-queue-status` as existing capabilities, neither of which covers the
  bulk-fetch/team-resolution path — confirms the proposal's claim that
  `launchpad-team-resolution` is new ground, not a modification that should have
  targeted an existing spec.
- Checked for placeholders/hand-waving: none found. No `TODO`/`TBD`, no deferred
  decisions that block implementation — the design explicitly resolves the two
  design choices that most invite ambiguity (when to call `resolveTeam` — only
  on a zero-result fetch, Decision 2; and where to carry the distinction —
  reuse `lp.error`, not a new field, Decision 3) with stated alternatives and
  rejection rationale.
- Checked for internal contradictions between proposal/design/tasks/spec: none.
  Message wording, the "warning not error" severity for the validate check, and
  the "unaffected cold-cache path" claim are stated identically in all four
  documents.
- Checked for scope drift: `concertino init` prompting for `teamKey` is
  correctly kept out of scope and explicitly labeled a non-goal, consistent
  with the ticket's own "Notes" section framing it as a follow-up rather than
  an acceptance criterion. No work beyond the four ACs is proposed.

### Verdict: CONFIRM

### Non-blocking notes
- `resolveTeam(transport, apiKey, teamKey)` is specified as a positional-arg
  helper, unlike `fetchTickets(options)`'s options-object-with-defaults style.
  `refreshLaunchPad` will need to pass `process.env.LINEAR_API_KEY` and
  `linear.httpsTransport` explicitly rather than relying on defaults the way
  `fetchTickets` currently is called. This is unambiguous from the design text
  but worth the executor double-checking against task 2.1's wording, since it's
  a style asymmetry with the rest of the file.
- Task 3.1's guard ("total is 0 and `lp.error` is not the team-not-found
  error") is slightly indirect — it could equally be phrased as "team is
  confirmed real" — but the two are equivalent given Decision 3's design, and
  the task is unambiguous enough to implement correctly.
