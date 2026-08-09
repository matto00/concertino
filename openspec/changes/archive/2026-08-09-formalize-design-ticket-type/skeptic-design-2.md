## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read round 1's report (`skeptic-design-1.md`) in full to know exactly what
  the two required revisions and three non-blocking notes were, then
  re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/design-ticket-type/spec.md`, `specs/followup-triage/spec.md` fresh
  (not trusting round 1's own characterization of them).
- Re-ran `openspec validate formalize-design-ticket-type --strict` myself:
  `Change 'formalize-design-ticket-type' is valid` — confirmed independently.

**Change Request 1 (open-questions extraction rule) — re-derived by hand
against the real `ticket.md`, not just read as a claim:**
- `ticket.md` line 15 is the plain paragraph "Open questions this ticket
  should resolve:" (nested inside `### Proposal to evaluate`, no `##`/any
  heading named "Open questions" anywhere — reconfirmed by re-reading the
  raw file), followed by a blank line 16, three bullets at lines 17-19, a
  blank line 20, then `## Related` at line 21.
- Applying the corrected rule exactly as design.md/spec.md state it (scan
  every line, heading or plain paragraph, any nesting level, for
  `/open questions?/i`; on match, walk forward skipping only blank lines,
  collecting bullets, stopping at the first non-bullet/non-blank line): line
  15 matches; line 16 (blank) is skipped; lines 17/18/19 (bullets) are
  collected; line 20 (blank) is skipped; line 21 (`## Related`, non-bullet
  non-blank) stops the scan. Result: exactly the three real bullets at
  17-19 — matching design.md's own re-verification claim exactly. This is
  no longer self-referentially false the way round 1 found it to be.
- The spec.md requirement (lines 29-46) and its four scenarios (heading
  case, plain-lead-in case using CON-100's own shape verbatim, no-match
  case, match-with-no-following-bullets case) are internally consistent
  with design.md's prose and with tasks.md 3.1/3.2. No heading-only
  assumption remains anywhere in the artifact set — grepped for `##` +
  "open questions" phrasing across design.md/spec.md/tasks.md and found
  none.
- **Verdict on CR1: fixed.**

**Change Request 2 (Phase 4 step-ordering ambiguity) — checked against the
live orchestrator.md, not just the change's own restated claim:**
- Read the live (unmodified) `## Phase 4: Post-merge cleanup` section
  (orchestrator.md:728-820) directly: its numbered steps are (1)
  `cleanup.sh --phase4` + `assert-phase.sh cleanup`, (2) set ticket Done +
  post closing comment, (3) hygiene check, (4) one-shot follow-up triage,
  (5) end turn. Design.md's "Step order is unchanged" note and spec.md's
  corresponding requirement (design-ticket-type spec.md lines 143-159)
  describe this exact order and correctly state the no-fold-in branch only
  substitutes the *entry condition* ("closing comment posted + Done"
  replacing the ordinary merge confirmation), not the internal 1→2→3
  sequence. tasks.md 5.2 matches this wording too.
- Read `scripts/concertino/cleanup.sh`'s `attempt_fast_forward()`
  (lines 101-162) directly to verify the no-op claim myself rather than
  trust design.md's assertion: `local_tip="$(git rev-parse refs/heads/<base>)"`,
  `remote_tip="$(git rev-parse <remote>/<base>)"`; if they're equal,
  `FF_STATUS="current"` and it returns immediately (lines 117-120) —
  touching nothing. This is exactly the behavior design.md/spec.md/tasks.md
  now cite as making the unmodified fast-forward step safe for the no-code
  branch (nothing was ever pushed to `<base>` in that branch, so the tips
  are expected to match at that point).
- **Verdict on CR2: fixed**, and the underlying code claim now checks out
  against the actual script, not merely the design's own assertion about it.

**Non-blocking notes from round 1 — checked for reasonable treatment (not
required to block, but verified they were actually addressed as claimed):**
- (a) DoD-reading-past-the-literal-answer: design.md now has an explicit
  "Note on DoD reading past the literal human answer" (lines 191-206)
  naming the CON-30 precedent, framing it as self-approvable per Planning's
  existing "self-approve everything else" posture, and explicitly
  preserving the literal "no additional doc-summary requirement" half.
  Reasonable treatment — not requiring a return trip to the human for a
  non-architectural extension of an already-established precedent.
- (b) fold-in step-1 inapplicability at the new Planning call site:
  design.md now has an explicit note (lines 208-218) stating why "make the
  change directory editable again" doesn't apply (no archive has happened
  yet at Planning time) — addressed.
- (c) tasks.md 5.2's missing "for a design ticket" qualifier: now present
  verbatim in the rewritten 5.2 — addressed.

**New-inconsistency check (edits introduced in this revision round):**
- Cross-checked the base `openspec/specs/followup-triage/spec.md`'s
  existing "orchestrator triages a suggested follow-up" requirement
  (lines 57-77, "Both of the workflow's existing... two reimplementations")
  against the change's MODIFIED-requirement delta (three call sites, "one
  shared procedure... three reimplementations") — the delta is a clean,
  non-contradictory supersession, no orphaned wording left over.
- Confirmed `sub_questions=` is real, already-documented mechanism in the
  live orchestrator.md (lines 803, 901-935), not a fabricated primitive
  this design invents.
- Confirmed the live Setup section's CON-62 harness-label check
  (orchestrator.md:135-153) is where the design's "immediately alongside"
  placement claim for the new design-ticket-type check would land —
  consistent, additive as claimed.
- No new placeholders, TODOs, or contradictions found across
  ticket.md/proposal.md/design.md/tasks.md/both spec deltas in this pass.

### Verdict: CONFIRM

Both required revisions from round 1 are correctly fixed and independently
re-derived against ground truth (the real `ticket.md` file's line structure,
and the real `cleanup.sh` script's fast-forward logic) rather than taken on
the executor's word. All three non-blocking notes were addressed reasonably.
No new inconsistencies were introduced by this revision round.

### Non-blocking notes

- None beyond what's already been folded in from round 1.
