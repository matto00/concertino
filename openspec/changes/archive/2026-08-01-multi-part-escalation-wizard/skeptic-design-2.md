## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/multi-part-escalation/spec.md` fresh (cold), plus round 1's report
  (`skeptic-design-1.md`) treated as a claim to re-verify, not fact.

**Round 1, Change Request 1 (oversized-`sub_questions` guard only covered one
of two fallbacks) — re-verified against the live code:**

- Read `core/scripts/emit-event.sh`'s field-parsing loop (lines 160-217) and
  `write_escalation_raised()` in full (lines 269-365).
- Confirmed `OTHER_FIELDS` (built in the generic `*)` case, line 215-216)
  already accumulates every non-`context`, non-structural field — including
  `sub_questions`, since it has no special case of its own — mirroring
  `FIELDS` minus `context`. This is exactly the mechanism design.md's revised
  Decision 4 needs: building a candidate line from `OTHER_FIELDS` (context
  entirely absent) and measuring its byte length is already how the existing
  last-resort fallback at lines 361-364 (`FIELDS="$OTHER_FIELDS"; write_line`)
  computes "does it fit without context at all" — the revision just moves an
  equivalent check to run *unconditionally*, before either fallback (a)
  `[ -z "$CONTEXT" ]` at line 280, or (b) the post-truncation-loop fallback at
  lines 361-364, is reached.
- This confirms the revised Decision 4 / task 1.2 ("independent of whether
  `context` is present or absent... before either existing lossy fallback")
  is mechanically buildable from the current code shape, and — critically —
  correctly scoped to fire only when `sub_questions` is present, so the
  single-question path's existing fallback behavior (a) and (b) are
  untouched, matching task 2.3's/design's "single-question path unchanged"
  commitment. **Gap 1 is closed as claimed.**
- Also confirmed task 7.2 now explicitly plans both distinct test cases round
  1 asked for: "(a) `sub_questions` oversized with no `context` at all, and
  (b) `sub_questions` oversized with a small, otherwise-truncatable `context`
  also present." Spec.md's scenario (lines 15-18) exercises exactly the
  harder case (b).

**Round 1, Change Request 2 (persisted `subAnswers` claimed as a "resume
point" but no restore task existed) — re-verified against the live code:**

- Read `lib/ui/watch.js`'s `case 'open-escalation':` (lines 1435-1441, current
  unrevised state: unconditionally resets to a fresh escalation view, no
  step-index concept at all today) and confirmed `root` and `runs` are both
  in scope at that point in the closure — `root` is assigned once at
  `watch()`'s top (`const root = opts.root;`, line 309) and used by sibling
  handlers in the same closure (e.g. `store.writeAnswer(root, ticket, value)`
  at line 1113); `runs.find((r) => r.ticket === ...)` is an established
  pattern already used elsewhere in the same closure (lines 810, 850, 1512).
  This confirms Decision 7 / task 5.5's plan — "call
  `store.readSubAnswers(root, ticket)`... set `escalationSubIndex` to the
  index of the first `null` slot" inside this case — is wireable with
  existing scope/variables, not hand-waved.
- Read `lib/ui/reducer.js`'s `escalation.raised` case (lines 137-153): task
  4.1 (`JSON.parse ev.sub_questions` into `run.escalation.subQuestions`) has
  a clear, single insertion point consistent with how `context`/`options`
  are already surfaced there.
- Read `lib/ui/store.js`'s `writeAnswer` (lines 199-228) and its
  `module.exports`: confirmed no read-back path for `answer.json` exists
  today (matching round 1's finding), and that task 3.3's new
  `readSubAnswers` (returning `null` on missing/invalid file, never
  throwing) is the same defensive shape `writeAnswer` already uses for its
  own error path — a plausible, consistent addition, not a new pattern.
- Confirmed tasks.md 3.1/3.3/5.5 and design.md Decision 7 are now mutually
  consistent: `writeSubAnswer` seeds `total` nulls on first write (task 3.1),
  so `readSubAnswers`'s "first null index" logic (task 5.5) is well-defined
  for a legitimately-partial file, and "no file yet → index 0" is handled
  explicitly (task 5.5's parenthetical, matching `readSubAnswers`'s
  `null`-on-missing-file contract from task 3.3).
- Confirmed spec.md gained the corresponding requirement and both scenarios
  (lines 81-93: resume-at-first-unanswered-step on reopen, and fresh-wizard
  starts at step 1) — the behavioral contract is now traceable end-to-end
  through design → tasks → spec, not asserted in only one artifact.
  **Gap 2 is closed as claimed.**

**Fresh full pass for other soundness issues:**

- Grepped the whole change directory for `TODO|TBD|figure out|placeholder`
  — none found (only round 1's own report text matching the grep pattern
  itself, as expected).
- Traced every ticket.md acceptance/scope bullet to a design decision and a
  task: schema extension (Decision 1, task 1.1), answer completeness
  (Decision 2, tasks 3.1/3.3), wizard UX + no-jump-ahead (Decisions 6/7,
  tasks 5.1-5.5), poll-loop completeness (Decision 2/4, tasks 2.1-2.4),
  single-question-path preservation (explicit non-goal + tasks 2.3, 3.2,
  5.4). No AC left uncovered; no task exceeds ticket scope (the
  truncated-full-copy alternative for oversized `sub_questions` is
  explicitly declined as a non-goal, matching the ticket's "fails the raise
  outright" framing, not scope creep).
- Checked for internal contradictions between design.md/tasks.md/spec.md on
  naming (`subAnswers`/`total`/`complete`, `sub_questions`/`sub_answers`)
  — consistent throughout all three artifacts.
- Checked proposal.md's Impact section against the now-larger blast radius:
  it does not name `lib/ui/watch.js` (needed for Decision 7/task 5.5's
  `open-escalation` resume logic) or mention `store.js` gaining a *read*
  path, only a write path. This is a real gap in proposal.md's own
  bookkeeping, but design.md and tasks.md (the artifacts that actually drive
  implementation and were the object of round 1's two REFUTE items) fully
  and consistently specify it — I'm treating this as a non-blocking
  documentation nit, not a REFUTE-worthy contradiction, since it doesn't
  create ambiguity for an implementer working from tasks.md.
- Confirmed round 1's non-blocking note (task 1.3 needing a raw-string
  `sub_questions` capture, analogous to `CONTEXT`) is now explicitly written
  into task 1.3 itself, closing that suggestion too.

### Verdict: CONFIRM

Both of round 1's REFUTE items are genuinely closed, verified against the
actual current code (not just the revised prose): Decision 4's guard is
mechanically buildable from `OTHER_FIELDS` and correctly scoped to run before
either lossy fallback; Decision 7 / task 5.5's resume-on-reopen logic has a
concrete, scope-correct wiring path through `watch.js`'s existing
`open-escalation` closure, `reducer.js`'s existing extension point, and a
`readSubAnswers` companion to the already-planned `writeSubAnswer`. The
fresh full pass found no new placeholders, contradictions, ambiguity, scope
drift, or missing contract updates.

### Non-blocking notes

- `proposal.md`'s Impact list (lines 23-30) doesn't name `lib/ui/watch.js`
  (the file Decision 7/task 5.5 actually changes) or mention that
  `store.js` gains a read path (`readSubAnswers`), only a write path. Worth
  a one-line addition for consistency with the now-fuller design, but
  doesn't block execution since tasks.md is unambiguous on its own.
- spec.md's oversized-payload scenario (lines 15-18) only spells out the
  harder case (b) (small `context` + oversized `sub_questions`); case (a)
  (no `context` at all) is covered by task 7.2 but has no dedicated spec
  scenario. Not blocking — the requirement text above it already states the
  behavior generally, and task 7.2 will exercise both.
