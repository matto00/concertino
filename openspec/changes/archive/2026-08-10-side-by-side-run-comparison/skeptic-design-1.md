## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/run-comparison/spec.md`, `specs/run-archive/spec.md`,
  `workflow-state.md` in full.
- `openspec validate side-by-side-run-comparison --strict` → `Change
  'side-by-side-run-comparison' is valid` (schema/scenario formatting is
  sound).
- Cross-checked every concrete technical claim in design.md against the
  actual worktree source, all of which held up:
  - `app-state.js`: `initialState()`/`currentState()`, existing
    `multiSelect: { failed: new Set(), queued: new Set() }` (line 325),
    existing `ticketviewReturnMode` field/pattern (lines 272, 346-372, 427).
  - `lib/ui/controllers/launchpad.js:178/196/213/225` really does set/consume
    `S.ticketviewReturnMode` the way design.md Decision 3 describes as its
    precedent (design.md cites it as bare `launchpad.js`, ambiguous between
    `screens/launchpad.js` and `controllers/launchpad.js` — trivial, not
    blocking).
  - `lib/ui/screens/drilldown.js` exports `timelineLines`, `gatesLines`,
    `describeEvent`, `fmtGateDuration` (module.exports line 810-812) and both
    `timelineLines(run, width)` / `gatesLines(run, width)` are indeed
    width-parametric, exactly as Decision 2 claims.
  - `lib/ui/layout.js` exports `hsplit`; `lib/ui/screens/drilldown.js:647`
    really does call `layout.hsplit(...)`, confirming Decision 2's "same
    primitive drilldown.js already uses" claim.
  - `lib/ui/screens/docview.js` exports `windowBody` (module.exports line
    255-258), confirming task 4.6's reuse claim.
  - `lib/ui/format.js` has `dur()`; `lib/ui/screens/drilldown.js`'s
    `elapsedText()` (line 364) does compose `f.dur(run.elapsedMs)`,
    confirming the "matches `elapsedText`'s existing convention" claim in
    Decision 2.
  - `lib/ui/screens/fleet/sections.js`: `MAX_FINISHED = 5` (line 26),
    `CONFIRM_RESTORED_QUEUE_KEY = 'c'` (line 46) — confirms Decision 4's
    precedence-chain premise.
  - `lib/ui/screens/fleet/keys.js`: `space` toggles `multiSelect.failed` only
    when `focus === 'runs' && runs[selected].status === 'failed'` (line
    415-416) — confirms the DONE-row mark key can be added at an analogous,
    currently-unclaimed guard without collision.
  - Grepped `lib/ui/` for `compareSelection`, `compareReturnMode`,
    `open-compare`, `back-to-origin-from-compare` — none exist yet (this is
    genuinely new, additive work, matching the Migration Plan's "purely
    additive" claim).
  - Grepped `archive.js`'s key handling — no existing binding on `c` or
    `space` in the list zone, confirming both are free for this change's use.
- Traced both ACs:
  1. "Two DONE runs can be selected and compared side by side: timeline,
     gate results, duration" → covered by `run-comparison` spec's four
     Requirements + tasks sections 1-6.
  2. "Documented in `docs/dashboard.md`" → task 7.1, mirroring the existing
     "The run-archive screen" section (confirmed that section exists at
     `docs/dashboard.md:826`).
- No scope drift found beyond the ACs: the origin-aware `esc` and
  duration-delta are reasonable, ticket-motivated elaborations (the ticket's
  own "why one run took 3x longer" framing implies a delta), not unrelated
  work.

### Verdict: REFUTE

### Change Requests

1. **Blocking internal contradiction: does `S.compareSelection` survive
   returning from the compare screen?** design.md's Non-Goals section
   (lines 53-56) states selection is "in-memory `S` state, cleared on entry
   to compare **and on returning from it**." tasks.md task 5.2 (lines 72-77)
   states the opposite: `back-to-origin-from-compare` should "leave
   `S.compareSelection` intact so re-opening compare from the same selection
   still works," explicitly reading design.md's precedent as "applying to
   entry, not to leaving via `esc`" — a reading design.md's own sentence
   does not support (it says "on entry ... and on returning from it," not
   "on entry only"). Worse, if design.md's literal wording were implemented
   ("cleared on entry to compare"), the compare screen would have nothing to
   render — no other field is defined anywhere in design.md/tasks.md to
   snapshot which two runs are being compared once `compareSelection` itself
   is wiped at the moment `open-compare` fires; Decision 2's rendering is
   described as driven by the same `compareSelection` the marking UI writes.
   Resolve this before implementation: either (a) fix design.md's Non-Goals
   wording to match tasks.md's actual (workable) behavior — persists across
   the round trip, cleared only when the user unmarks or marks a
   replacement — or (b) if the intent really is "marks reset after viewing
   the comparison," update tasks.md to match and add a distinct field
   (e.g. a `compareTickets` snapshot separate from the toggleable
   `compareSelection`) so the compare screen still has data to render after
   `compareSelection` is cleared on entry. As written, an implementer
   following design.md and an implementer following tasks.md will build two
   different, incompatible behaviors, and one of the two literal readings
   (design.md's) doesn't even render.

2. **Non-blocking but should be tightened: the mark-for-comparison key is
   never explicitly named.** design.md Decision 1 ("Only DONE runs are
   toggleable; the key has no effect on a non-DONE row (mirrors CON-109's
   own section-scoping of `space`)"), tasks.md 2.1/2.2/3.1/3.2, and both
   spec deltas all refer to "a dedicated key" / "the mark-for-comparison
   key" without ever stating the literal character. The `space`-mirrors-
   CON-109 aside strongly implies `space`, and I confirmed `space` is free
   in both the archive list zone and the fleet DONE-row guard — but nothing
   in the Decisions section actually commits to it. Please add an explicit
   line (e.g. under Decision 1 or 4) naming the key, so tasks 2.1/3.1 and
   the docs task (7.1) aren't left for the implementer to infer.

### Non-blocking notes

- The design doesn't address what happens if a marked run later ages out of
  `state.runs` via `dashboard.retentionDays` while still sitting in a
  (per CR1's resolution) persisted `compareSelection` — pressing `c` with a
  now-pruned ticket id present would need a defined fallback (e.g. drop the
  stale id, or no-op until re-marked). Small edge case, worth a one-line
  Decision addendum but not blocking on its own.
- design.md's citation of `launchpad.js:178/196/213` for the
  `ticketviewReturnMode` precedent is ambiguous between
  `screens/launchpad.js` and `controllers/launchpad.js` (it's the latter) —
  cosmetic only, the line numbers still resolve correctly.
