## Skeptic Report — design gate (round 2 of the fold-in sub-run; orchestrator passed N=2)

Note on filename: the orchestrator passed N=2, but `skeptic-design-1.md`
through `skeptic-design-5.md` already exist in this change directory
(4 rounds from the original delivery, plus round 1 of this fold-in
sub-run filed as round 5 per that report's own note). To avoid
overwriting `skeptic-design-2.md` (original-delivery history), this
report is filed as round 6 (the next unused slot), consistent with the
precedent set by `skeptic-design-5.md`. Scope: only the fold-in scope
(ticket.md's "Additional Scope", design.md Decision 7 + the round-5 Risk
correction, tasks.md task group 7, `specs/dashboard-iconography/spec.md`
delta), per instructions — the rest was read only for context.

### What I verified (with evidence)

- Read `ticket.md`'s "Additional Scope" section, `design.md`'s Decision 7
  (lines 243-275) and its round-5-corrected Risks/Trade-offs entry (lines
  277-294), `tasks.md`'s task group 7 (lines 53-61), the
  `specs/dashboard-iconography/spec.md` delta in full, and
  `skeptic-design-5.md` (round 1 of this sub-run) to know exactly what the
  three change requests were.

- **Round-5 Change Request 1 (add a regression test for
  `controllers/drilldown.js:116`'s `docTitle`, verified against the
  pre-swap composition, before task 7.4's swap) — addressed.**
  `tasks.md` now has task 7.0: adds a regression test for all three
  fallback branches (`action.label` present; absent-with-`action.ref`;
  both absent → `'(untitled)'`), explicitly "written and verified against
  the CURRENT inline composition." Task 7.4 now reads "only after task
  7.0's regression test exists and passes against the pre-swap code" —
  the dependency is explicit, not just implied by ordering.

- **Round-5 Change Request 2 (correct design.md's Risk-mitigation
  overstatement) — addressed.** design.md's Risks/Trade-offs section
  (lines 284-294) now has a "(Design-gate round 5 correction, fold-in
  scope)" note stating the mitigation held for six of seven call sites but
  not `controllers/drilldown.js:116`, and that "Task 7.0 adds that missing
  regression test... so this mitigation now genuinely holds for all seven
  sites rather than overstating coverage for the one it didn't." This is
  accurate and does not overclaim — it correctly frames the fix as
  contingent on 7.0 actually landing, not as already-true.

- **Round-5 Change Request 3 (fix task 7.6's false-acceptance-signal
  wording) — addressed.** Task 7.6 now reads: "Run `drilldown.js`'s and
  `ticketDetail.js`'s existing test suites (which genuinely cover their
  respective migrations), task 7.0's new `controllers/drilldown.js`
  regression test (which now covers that migration), and the full test
  suite..." — this no longer implies a pre-existing suite for the
  controller call site; it correctly attributes coverage to the new task
  7.0 test.

- **Re-verified the underlying facts fresh (not trusting round 5's
  citations) against current source:**
  - `lib/ui/controllers/drilldown.js:116` — `S.docTitle = icons.evidence +
    ' ' + (action.label || action.ref || '(untitled)');` — unchanged,
    matches Decision 7 and task 7.0/7.4's citations verbatim.
  - `grep -rln "controllers/index\|controllers')" test/ lib/` — matches
    only in `lib/ui/controllers/*.js` (other controllers requiring
    `controllers/index.js` internally) and `lib/ui/watch.js`; **zero
    matches under `test/`**, confirming no test file requires this
    controller module at all.
  - `grep -rn "docTitle\|open-evidence-doc" test/*.js` — only
    `test/docview.test.js` (constructs its own inline title, doesn't
    invoke the controller) and `test/drilldown.test.js:778-854` (asserts
    only the dispatched *action* shape, upstream of the reducer that
    builds `docTitle`). Confirms the coverage gap task 7.0 targets is
    real, not a stale/exaggerated claim.
  - `grep -n "controllers" lib/ui/reducer.js test/reducer.test.js` — no
    matches, ruling out indirect coverage via a generic reducer test.
  - `specs/dashboard-iconography/spec.md` delta — unchanged from what
    round 5 already verified as an accurate, non-widening restatement of
    Decision 7 (folds all three groups into the SHALL's consumer list, no
    stale exclusion language); re-read in full, still holds.

- **No new issues introduced by the fix**: grepped `design.md` and
  `tasks.md` for `TODO|TBD|FIXME|placeholder` — the one hit
  (`design.md:182`, "`'confirm-placeholder']`") is an unrelated reference
  to an actual code identifier, not a design placeholder. Task 7.0's file
  placement ("a new small test file or an addition to an existing test")
  is intentionally non-prescriptive, matching round 5's own allowance
  ("the design doesn't need to specify which file, only that this
  specific assertion needs to exist"). No new ambiguity, contradiction, or
  scope drift found in the task-group-7 / Decision-7 / spec-delta diff
  between round 5 and this round.

- Cross-checked `workflow-state.md`'s `LAST_SKEPTIC_VERDICT` line, which
  independently records the same round-5 REFUTE reason and fix — consistent
  with the artifacts, not relied upon as the basis for the verdict.

### Verdict: CONFIRM

All three round-5 change requests are fully and verifiably addressed:
task 7.0 adds the missing regression test against the pre-swap
composition and is a hard dependency of task 7.4's swap; design.md's Risk
mitigation no longer overstates coverage; task 7.6 no longer implies a
pre-existing suite that doesn't exist. The fold-in design (Decision 7,
task group 7, and the spec delta) is sound, internally consistent, and
ready to implement.

### Non-blocking notes

- Same as round 5: `test/docview.test.js:194`'s comment attributing the
  evidence-title-prefixing caller to "watch.js's 'open-evidence-doc'
  handler" is stale (that logic now lives in
  `lib/ui/controllers/drilldown.js`). Pre-existing, not part of this
  change's diff, not blocking — flagging again only in case the executor
  touches this file anyway and wants to fix it in passing.
