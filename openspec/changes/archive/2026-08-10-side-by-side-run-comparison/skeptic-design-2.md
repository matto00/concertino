## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read (fresh, cold) `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/run-comparison/spec.md`, `specs/run-archive/spec.md`,
  `workflow-state.md`, and round 1's `skeptic-design-1.md` in full, in this
  worktree — none of round 1's conclusions taken on faith, only its Change
  Requests as things to re-verify against current file contents.

**CR1 (blocking contradiction on `S.compareSelection` lifecycle) — confirmed fixed:**
- design.md's Non-Goals section now has an explicit "Selection lifecycle,
  precisely" subsection (design.md lines 56-69) stating
  `S.compareSelection` is "NOT reset on entry to, or on returning from, the
  compare screen — it persists across `esc`... It changes only via explicit
  `toggle-compare-select` action." It explicitly names itself as resolving
  "an internal contradiction the design-gate skeptic flagged in an earlier
  draft."
- tasks.md 5.2 (lines 78-84) now reads: "Leave `S.compareSelection` intact —
  it is NOT cleared on entry or exit, only via explicit
  `toggle-compare-select` (see design.md Non-Goals, 'Selection lifecycle,
  precisely,' which resolves an earlier draft's contradiction on this exact
  point)."
- These two statements are now consistent with each other (both say
  "persists / not cleared on entry or exit, only explicit toggle mutates
  it") and internally coherent: the compare screen renders from
  `compareSelection` itself (Decision 2), which now stays populated across
  the round trip — round 1's "the compare screen would have nothing to
  render" defect from the old wording ("cleared on entry") no longer
  applies, since there's no snapshot/clear-on-entry step left anywhere in
  either document. I re-read Decision 2 and Decision 3 in full to confirm
  neither reintroduces a clear-on-entry step for `compareSelection`
  specifically (only `compareReturnMode` and per-column scroll offset are
  described as reset on entry/exit, which is a different field and not in
  tension with this).

**CR2 (non-blocking: mark key never explicitly named) — confirmed fixed:**
- design.md Decision 1 now states outright: "The mark/unmark key itself is
  `space` — the same key CON-109 already binds for FAILED-row multi-select
  (`lib/ui/screens/fleet/keys.js:415`...)." (design.md lines 94-101).
- tasks.md 2.1 ("Bind `space` as the mark-for-comparison key in the archive
  list zone's key handling...") and 3.1 ("Bind `space` as the
  mark-for-comparison key for DONE rows in `lib/ui/screens/fleet/keys.js`
  (extend the existing `space` guard at keys.js:415...)") both name `space`
  explicitly rather than leaving it to inference.
- The spec deltas (`specs/run-comparison/spec.md`,
  `specs/run-archive/spec.md`) still describe "the mark-for-comparison key"
  / "a dedicated key" generically without naming the literal character —
  consistent with how OpenSpec requirement scenarios in this codebase
  describe behavior rather than keybindings verbatim (I checked: CON-109's
  own precedent, referenced throughout, is likewise keybinding-agnostic at
  the spec layer while naming the key in design/tasks). Not a regression,
  not blocking.

**Re-verified underlying technical claims against actual source** (not just
re-reading round 1's list — re-ran the checks that matter to the fix):
- `lib/ui/screens/fleet/keys.js:415-416`: confirmed live — `space` fires
  `toggle-multi-select` only when `focus === 'runs' && runs[selected] &&
  runs[selected].status === 'failed'`. Design/tasks' claim that extending
  this guard to also cover `status === 'done'` is additive and doesn't
  collide holds.
- `lib/ui/screens/archive.js`: read the full `handleKey` function
  (lines 249-314). Confirmed `space` (`key === ' '`) is bound only inside
  `focus === 'harness'` (line 288, `cycle-archive-harness`) and is
  unbound inside `focus === 'list'` (lines 297-311) — so binding `space` in
  the list zone per task 2.1 is genuinely free, as design.md claims.
- `lib/ui/screens/fleet/sections.js:46` / `lib/ui/screens/fleet/keys.js:201`:
  confirmed `c` (`CONFIRM_RESTORED_QUEUE_KEY`) is fleet-only, gated on a
  pending restored-queue confirmation; `c` does not appear anywhere in
  `archive.js`'s key handling — Decision 4's precedence-chain claim holds.
- `openspec validate side-by-side-run-comparison --strict` →
  `Change 'side-by-side-run-comparison' is valid` (re-run fresh, not
  reused from round 1).

**Re-checked the rest of the plan for soundness (not just the two fixes):**
- No new placeholders/TBDs introduced by the edit; the added "Selection
  lifecycle, precisely" subsection and the `space` key sentence are both
  fully specified, not deferred.
- No new internal contradictions introduced elsewhere: Decision 2 (compare
  screen renders from `compareSelection`), Decision 3
  (`compareReturnMode`), Decision 4 (`c` trigger/precedence), and Risks/
  Migration Plan sections are unchanged from round 1 and were already
  verified sound then; I re-read them in full this round and they remain
  consistent with the now-fixed lifecycle wording.
- ACs still traced: AC1 (two DONE runs selectable/comparable: timeline,
  gates, duration) → `run-comparison` spec's Requirements + tasks 1-6; AC2
  (documented in `docs/dashboard.md`) → task 7.1. No scope drift beyond the
  ticket-motivated origin-aware `esc` and duration delta.
- No missing contract updates — this remains purely additive per the
  Migration Plan (new state fields, new screen/controller, one new
  keybinding scoped to previously-unbound contexts); confirmed via grep
  that `compareSelection`/`compareReturnMode`/`toggle-compare-select`/
  `open-compare`/`back-to-origin-from-compare` still don't exist anywhere
  in `lib/ui/` (genuinely new).
- The round-1 non-blocking note about a marked run aging out of
  `state.runs` via `dashboard.retentionDays` while still sitting in a
  (now confirmed) persisted `compareSelection` remains unaddressed — still
  a legitimate small edge case, still not blocking (no crash path implied:
  `open-compare` would just find a `run.ticket` that already isn't in
  `state.runs`, which is the same "not found" shape the existing
  `open-drilldown` lookup already tolerates per Decision 3's design.md
  citation). Repeating as a non-blocking note below since it wasn't
  addressed, though it wasn't required to be — round 1 only blocked on CR1.

### Verdict: CONFIRM

Both round-1 Change Requests are verifiably fixed, consistently, in both
design.md and tasks.md (not just one of the two documents), and the fix
does not introduce any new contradiction or gap. The rest of the plan holds
up under a fresh, independent re-check of its concrete technical claims
against the actual worktree source. Sound enough to implement.

### Non-blocking notes

- (Carried over from round 1, still open, still non-blocking) No defined
  fallback for a marked run that ages out of `state.runs` via
  `dashboard.retentionDays` while still present in a persisted
  `compareSelection`. Worth a one-line Decision addendum in a future pass,
  but the existing `open-drilldown` precedent this design already leans on
  tolerates a stale ticket id without crashing, so it isn't a blocker.
- design.md's citation of `launchpad.js:178/196/213` for the
  `ticketviewReturnMode` precedent remains ambiguous between
  `screens/launchpad.js` and `controllers/launchpad.js` (it's the latter) —
  cosmetic only, unchanged from round 1, still not worth blocking on.
