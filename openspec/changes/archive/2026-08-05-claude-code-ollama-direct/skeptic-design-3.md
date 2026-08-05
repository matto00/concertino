## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/model-providers/spec.md` fresh in full, plus `skeptic-design-2.md`
  as a claims list to re-verify against ground truth, not as fact.

- **Round-2's sole Change Request (a fourth stale gateway doc comment at
  `lib/ui/controllers/launchpad.js:442`, missing from proposal.md's Impact
  section and tasks.md 3.8, plus two mislabeled function-name locators) —
  confirmed fully resolved.**

  proposal.md's Impact section (lines 29-33) and tasks.md item 3.8
  (lines 24-29) now both enumerate all four locations with corrected
  function-name attribution:
  - `open-launchplan` ~lines 294-296
  - `cycle-harness` ~lines 419-421
  - `cycle-provider` ~lines 441-442 (header comment)
  - `cycle-row-provider` ~lines 505-508 (header comment)

  I re-grepped the live file myself (not trusting the prior report's grep):

  ```
  lib/ui/controllers/launchpad.js:295:  // harness-dependent (claude-code needs a gateway; see
  lib/ui/controllers/launchpad.js:420:  // (claude-code without a gateway cannot go local) — drop it rather than
  lib/ui/controllers/launchpad.js:442:  // that validity, so claude-code without a gateway offers nothing and
  lib/ui/controllers/launchpad.js:508:  // label path's own refusals (claude-code needs a gateway; 'default'
  ```

  Exactly four matches — no fifth mention exists, so tasks.md 3.8's
  now-added re-grep instruction ("Re-grep the file for `gateway` after
  editing to confirm no fifth stale mention was missed") will find nothing
  extra once the executor makes these edits.

  I independently verified the function-name attribution against the live
  switch-case boundaries (`grep -n "case '"` over the full file):
  - `case 'open-launchplan':` spans lines 205-366 → line 295 (and 294-296)
    falls inside it. Correct (round 2 flagged this as mislabeled
    `cycle-harness`; now fixed to `open-launchplan`).
  - `case 'cycle-harness':` spans lines 391-430 → lines 419-421 fall inside
    it. Correct (round 2 flagged this as mislabeled `cycle-provider`; now
    fixed to `cycle-harness`).
  - `case 'cycle-provider':` starts line 448, its header comment begins
    line 440 → lines 441-442 are that header comment. Correct.
  - `case 'cycle-row-provider':` starts line 510, its header comment begins
    line 505 → lines 505-508 are that header comment. Correct.

  All four line-number/function-name pairs now match the live source
  exactly. This closes both the missing-fourth-location gap and the two
  mislabeling nits round 2 raised.

- Spot-checked the rest of the artifacts for regressions introduced by this
  round's edit: proposal.md's Impact section and tasks.md elsewhere are
  otherwise unchanged from round 2 (diffed by re-reading both in full — no
  other new gaps, no reintroduced placeholder/TBD language, no new
  contradictions between proposal/design/tasks). `specs/model-providers/spec.md`
  is unchanged from round 2 and remains internally consistent (route
  derivation via gateway presence, per-role model resolution split by route,
  doctor route reporting, launch-plan/label provider availability — all
  scenarios trace cleanly to design.md's six decisions and tasks.md's
  sections 1-7). No new AC coverage gaps: all four ticket.md acceptance
  criteria still map to explicit tasks (P/p offering → tasks 3.3-3.4; model
  resolution per route → tasks 2.1, 4.1-4.2; doctor route reporting → task
  5.1; CON-74-style real-run verification → tasks 1.1-1.3, 7.2).

### Verdict: CONFIRM

### Non-blocking notes

- None beyond what round 2 already recorded as non-blocking (now resolved
  alongside the required fix). The design is sound and ready for execution.
