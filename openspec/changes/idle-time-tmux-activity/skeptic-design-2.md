## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Read round 1's report** (`skeptic-design-1.md`) as a claim only, then
  independently re-derived whether its blocking issue is actually resolved by
  reading the current artifacts fresh, not by trusting the executor's/round-1's
  narrative.

- **Read all current planning artifacts in full**: `ticket.md`, `proposal.md`,
  `design.md`, `tasks.md`, `specs/fleet-idle-tracking/spec.md`. No
  TODO/TBD/placeholder language found.

- **Confirmed the round-1 blocking issue is actually fixed, not just
  reworded.** Round 1's complaint was that tasks.md's test tasks presupposed
  calling the private, unexported `sampleWindows()` closure directly, with no
  injection seam for a fake `session`, while proposal.md claimed "No API
  surface change." Now:
  - `design.md` (Decision: "Extract and export a pure `idleMsFromActivity`")
    and `tasks.md` 1.1/1.2 both specify extracting `idleMsFromActivity(activity, now)`
    as a pure function and adding it to `module.exports`.
  - `tasks.md` 2.1–2.4 test `idleMsFromActivity` directly (imported from the
    module), not `sampleWindows()` — no private-closure-calling requirement
    remains anywhere in tasks.md.
  - `proposal.md`'s Impact section now reads "Small API surface addition, not
    none: `idleMsFromActivity` is added to `module.exports`..." — the
    "No API surface change" claim that created the tension is gone.
  This closes round 1's Change Request 1 cleanly; no remaining
  ambiguity about how the test tasks are actually executable.

- **Independently verified the `buildFrame`/`attachAndRestore` "exported
  purely for tests" precedent this design leans on is real**, by reading the
  pristine main-branch `lib/ui/watch.js` (not the worktree's, per the task's
  own instruction) end to end and `test/watch.test.js` end to end:
  - `watch.js:900-903`: `module.exports = { watch, buildFrame,
    attachAndRestore, CURSOR_HOME, ALT_SCREEN_ENTER, ALT_SCREEN_EXIT };`,
    with a header comment (`watch.js:895-899`) stating they are exported
    "purely for test/watch.test.js" while `watch()`'s own runtime behavior
    stays covered end-to-end by the smoke test. `test/watch.test.js:4-6`
    imports exactly these names and exercises them as pure functions
    (`buildFrame(text, cols, prevLineCount)`, `attachAndRestore(fn, restore)`)
    with no real tmux/stdout/session needed. This is exactly the pattern
    `design.md`'s Decision claims to mirror for `idleMsFromActivity` — the
    precedent is real, not fabricated, and the proposed extraction fits its
    shape precisely (same file, same `module.exports` block, same "pure,
    no closure state" justification).

- **Independently re-derived that the extraction is a minimal, sufficient fix
  for the testability gap** by reading `sampleWindows()` as it exists today
  (`watch.js:303-337`): it is a closure inside `watch()`, closed over
  `session` (built unconditionally by `createSession()` inside `watch()`,
  `watch.js:131`, no injection seam), `idle` Map, and `lastSample` — matching
  round 1's finding exactly. `idleMsFromActivity(activity, now)` needs none
  of that closure state (no `session`, no Map, no `lastSample`), so it is the
  smallest unit that carries the entire piece of logic actually under test
  (the arithmetic), while `sampleWindows()` itself correctly stays private —
  this is not overkill (it does not export the whole closure or restructure
  `session` injection) and does not still leave a gap (every arithmetic
  scenario in the ticket is now callable in isolation).

- **Checked the extracted arithmetic itself is behavior-preserving.** Current
  code (`watch.js:319-322`, `335`): first-sight seed is
  `since = w.activity != null ? Math.min(w.activity*1000, now) : now`, then
  `idleMs = Math.max(0, now - entry.since)`. The proposed
  `idleMsFromActivity(activity, now) = activity != null ? Math.max(0, now -
  activity*1000) : 0` is algebraically equivalent for the seed case: when
  `activity*1000 > now` (an activity timestamp in the "future" relative to
  `now`), the old path clamps `since` to `now` giving `idleMs = 0`; the new
  path computes a negative value clamped to `0` by `Math.max(0, ...)` —
  same result via a different but equivalent route. The one behavioral
  divergence I could find is in the `activity == null` branch persisting
  across multiple polls (old code freezes `since` at first-sight `now`, so
  `idleMs` grows monotonically from there if the hash never flips; new code
  returns `0` on every poll while `activity` stays null, not just the first).
  I checked `lib/ui/session.js:63-89` to see how reachable this branch
  actually is: `activity` is `null` only when `#{window_activity}` fails to
  parse as a finite positive number — tmux sets this variable at window
  creation and keeps it valid for the window's whole life, so this is a
  defensive fallback for essentially-unreachable malformed tmux output, not
  a state a real window sits in across multiple polls. Non-blocking.

- **Checked `design.md`'s corrected `session.capture()` wording** (round 1's
  non-blocking note). It now reads "only the one call to it inside
  `sampleWindows()` is in scope for removal... it has no other current
  production call site" — no longer claims "used elsewhere." Consistent with
  a fresh repo-wide check I ran (`grep -rn "\.capture(" lib/ bin/`): the only
  call site is `watch.js:327`, the one being removed;
  `session.js:91-95`'s own `capture()` method definition is unaffected.

- **Checked internal consistency across all four documents**: proposal ↔
  design ↔ tasks ↔ spec. `sampleWindows()`'s return shape (`{ ticket, alive,
  idleMs }`) is stated identically in design.md's Non-Goals and preserved
  unmodified by tasks.md 1.3/1.8; confirmed against real callers
  (`reducer.js:194`, `fleet.js:62-63`), which only read `idleMs`/`alive` off
  the object — no downstream break.

- **Traced tasks.md against every scenario in `specs/fleet-idle-tracking/spec.md`**:
  - "Idle time reflects the current poll's activity timestamp" → tasks 1.3 + 2.1.
  - "A window that redraws identical pane content does not read as idle" →
    tasks 1.3 (helper has no content input) + 2.2 (structural test).
  - "No capture-pane subprocess is invoked while sampling idle time" → tasks
    1.6 (removal) + 3.2 (grep verification) + 1.8 (manual re-read). Not an
    automated regression test, but this is a reasonable, deliberate choice
    given `sampleWindows()`'s lack of an injection seam (the design
    explicitly considered and rejected exporting `sampleWindows` with an
    injectable `session` fake as "more surface area than the test scenarios
    actually need") — consistent with round 1's own grep-based verification
    method for the same claim.
  - "Idle time survives a dashboard restart" → tasks 2.3 (stateless call
    stands in for restart).
  All four scenarios are covered by the combination of tasks.md sections 1–3;
  none is left completely unaddressed.

### Verdict: CONFIRM

### Non-blocking notes

- `design.md`'s Decision text ("Extract and export...") overclaims slightly:
  it says the extraction "makes *every* scenario in
  `specs/fleet-idle-tracking/spec.md`... directly unit-testable," but only
  lists 3 of spec.md's 4 scenarios and only 3 are actually reachable via a
  content-free, session-free pure function — the fourth ("No capture-pane
  subprocess is invoked") is necessarily verified by code removal + grep
  (tasks.md 1.6/3.2), not by an `idleMsFromActivity` unit test. This doesn't
  cause any task-execution ambiguity (tasks.md itself correctly splits these
  across sections 2 and 3), but the sentence should be tightened to "three of
  the four scenarios" or similar so a future reader doesn't go looking for a
  fourth unit test that was never intended to exist.
- The `activity == null` fallback's divergence from old behavior across
  repeated polls (noted above) is real but effectively unreachable given how
  tmux populates `#{window_activity}`; not worth blocking on, but if an
  implementer wants to be precise, design.md's claim that this "preserves
  existing behavior for the edge case" is only exactly true for the first
  poll of that (unreachable) state, not for it persisting.
