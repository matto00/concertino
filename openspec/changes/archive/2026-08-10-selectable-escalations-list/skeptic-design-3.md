## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-metrics-escalation-history/spec.md` fresh, in full, plus
  `skeptic-design-1.md`/`skeptic-design-2.md` as claims to re-verify, not
  facts.

**Round 2 fix 1 — `S.escalationHistoryItem` lifecycle.** Traced against the
real, current code:
- `lib/ui/app-state.js:428-462` (`backToFleet()`) confirmed it does NOT yet
  reset `escalationHistoryItem` (the field doesn't exist pre-implementation)
  — consistent with design.md's round-2 correction requiring it be added to
  this reset list, alongside `escalationTicket`/`escalationReply`/
  `escalationNotice`/`escalationContextScroll`/`escalationSubIndex`
  (`app-state.js:430-434`).
- `lib/ui/controllers/escalation.js:97-123` (`'open-escalation'` handler)
  confirmed it resets `escalationReply`/`escalationNotice`/
  `escalationContextScroll`/`escalationSubIndex` today but not (yet)
  `escalationHistoryItem` — consistent with design.md requiring this handler
  also gain `S.escalationHistoryItem = null`.
- Confirmed the completeness of this fix by finding **every** route into and
  out of `mode: 'escalation'` in the real code: `grep -rn "S.mode =
  'escalation'" lib/ui/` returns exactly one hit today
  (`controllers/escalation.js:98`, the `'open-escalation'` handler) — the
  second entry point (`open-historical-escalation`) is the only one this
  design adds. Every exit route is `{ type: 'back' }`, dispatched via
  `watch.js:1182-1185`'s `applyAction`, which calls `backToFleet()`
  unconditionally — including the success path of `answerEscalation()`
  (`controllers/escalation.js:36`, `ctx.backToFleet()` on a confirmed write).
  There is no third way in or out. This means the design's two fixes
  (`backToFleet()` + `'open-escalation'`) between them cover every
  transition: leaving the escalation screen always clears
  `escalationHistoryItem`, and the only other way back in
  (`'open-escalation'`) also explicitly clears it. The round-2 failure
  sequence (resolved entry → Escape → live entry, stale historical item
  bleeds through) is now closed — traced end-to-end, not merely asserted.
- Confirmed the corrected poll-loop check (`S.mode === 'escalation' &&
  !S.escalationHistoryItem`) is genuinely sound given the above: since
  `escalationHistoryItem` can now never be non-null while a *live* escalation
  is being shown (the only path to a live view always nulls it), the
  liveness check firing only when `!S.escalationHistoryItem` correctly never
  suppresses itself for a genuinely live screen.

**Round 2 fix 2 — sub-question index disambiguation.** `design.md:180-184`
now reads unambiguously: `subQuestions[subQuestions.length - 1]`
("**the LAST/most-recently-answered sub-question — not `subQuestions[0]`**"),
with no remaining `subQuestions[0]` reference anywhere in Decision 4.
`tasks.md:71-72` (item 3.2) restates the same index and the same "never
`subQuestions[0]`" callout. No contradiction remains between prose and
code-shape. The companion `handleKey` claim ("no new branch... the existing
`!run` branch already suffices") is also now correctly stated and matches
`lib/ui/screens/escalation.js:279-282`'s real `!run` early-return, confirmed
present at that shape today.

**Round 2 fix 3 — banner.js's two call sites.** `grep -n
"suppressedOnOwnScreen" lib/ui/banner.js lib/ui/watch.js` confirms exactly
the two call sites round 2 found: `lib/ui/watch.js:489`
(`computeScreenRows()`) and `lib/ui/watch.js:775` (`draw()`), both currently
calling the unchanged 3-argument form (`lib/ui/banner.js:99-102`).
`design.md:262-274` now specifies changing `suppressedOnOwnScreen`'s own
signature to take a 4th `historicalItem` argument (forcing both call sites
to be touched or become a call-site bug, not a silently-incomplete fix), and
`tasks.md:93-99` (item 3.6) explicitly names both call sites by line
function (`computeScreenRows()` and `draw()`), citing the same grep. This
structurally forecloses the round-2 failure mode (only the more visible call
site getting patched).

**Holistic re-pass beyond the three fixes:**
- Confirmed `metrics.js`'s current raised-only loop
  (`lib/ui/screens/fleet/metrics.js:106-118`) matches design.md's factual
  description of what Decision 1 is replacing.
- Confirmed `reducer.js:90` (`toOptions`) is still unexported
  (`module.exports = { reduce, TIER2_KINDS, TIER3_KINDS, PHASE_ORDER }` at
  line 338), consistent with tasks.md 1.1's requirement to export/lift it.
- Confirmed the digit-jump target (`case 'metrics': return null;`) and the
  `focus === 'quickstart'` precedent block are real and shaped as design
  describes (unchanged since round 1's verification).
- Confirmed Decision 2's header now reads "closely mirroring" rather than
  round 2's flagged "mirroring... exactly" — the non-blocking wording note
  from round 2 was incidentally also cleaned up.
- No `TODO`/`TBD`/hand-waved decisions found anywhere in
  design.md/tasks.md/proposal.md (`grep -in "TODO\|TBD\|figure out
  later\|for now"` — no hits).
- Re-checked `docs/dashboard.md`'s existing METRICS section
  (`docs/dashboard.md:73-102`) to confirm the doc structure this change's
  task 4.1 needs to extend is real and matches design's description of
  today's behavior (uncapped-in-data, capped-at-display recent-escalations
  list).
- No new self-contradictions introduced by the three round-2 edits
  themselves; no AC left uncovered by tasks.md; no scope drift beyond the
  ticket's three ACs.

### Verdict: CONFIRM

All three round-2 Change Requests are genuinely closed against the real,
current code — not just reworded in prose. The design is internally
consistent, each ticket AC maps to a specific decision/task, and the two
previously-verified risk areas (poll-loop bounce, banner call sites) are now
structurally foreclosed rather than merely asserted fixed.

### Non-blocking notes

- Decision 4's banner fix (`suppressedOnOwnScreen` returning `true`
  whenever `mode === 'escalation' && !!historicalItem`) suppresses the
  cross-screen escalation banner unconditionally while *any* historical
  view is open — including when some other, unrelated run has a genuinely
  new live escalation that just started needing a human. This is a
  reasonable, deliberate simplification (a historical view is read-only and
  the design's rationale — "there is no liveness to poll for" — extends
  naturally to "no need to interrupt it with the banner either"), and it is
  explicitly stated rather than ambiguous, so it is not a blocking design
  gap. Worth a one-line acknowledgment in Decision 4 that this is an
  intentional trade-off (a human on a historical screen may miss the global
  banner for an unrelated escalation until they back out), so a future
  reader doesn't mistake it for an unconsidered side effect — but this does
  not need another round to add.
