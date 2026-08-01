## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/escalation-context/spec.md`, and `specs/ticket-drafting-escalation/spec.md` fresh in
  full (this round, not carried over from round 1's read).
- Confirmed `git status --short` still shows only the untracked
  `openspec/changes/force-escalation-ticket-ambiguity/` directory, and `git diff main...HEAD
  --stat` still touches none of `core/laws/`, `core/roles/orchestrator.md`,
  `core/scripts/gather-escalation-context.sh`, or `core/scripts/README.md` — the round-1 ground
  truth this design is checked against is unchanged in this worktree.
- **Change Request 1 (Phase 4 step 4 wiring) — verified resolved.** Re-read `core/roles/
  orchestrator.md` lines 429–497 (Phase 4) fresh. Step 4 (lines 473–484) is confirmed to be
  exactly what the revision claims: a single one-shot `emit-event.sh escalation --await` call
  carrying a generic `question=`/`options=` pair, gated only by "if you have a further
  observation." There is no drafting step and no filing call. Re-grepped the whole repo for
  `save_issue` (`grep -rn save_issue core/ scripts/ openspec/specs/`) — zero hits, matching
  round 1. `design.md`'s Context section (lines 18–27), Decisions section (lines 105–124), and
  `tasks.md` task 3.1 and `specs/ticket-drafting-escalation/spec.md`'s third requirement (lines
  32–41) now all describe the wiring as binding the law to composing that step's existing
  `question=` text itself — no new call site, no invented draft-then-file sequence — which
  matches ground truth exactly and closes the gap round 1 flagged (an executor following this
  now has one concrete, real touchpoint to edit, not an imagined one).
- **Change Request 2 (task 3.3's "list of laws") — verified resolved.** Re-grepped
  `core/roles/orchestrator.md` case-insensitively for `law` (`grep -ni law core/roles/
  orchestrator.md`) — zero hits, matching round 1's finding. `tasks.md` task 3.3 and
  `design.md`'s Context section (lines 24–27) now explicitly state this is orchestrator.md's
  *first* law reference, to be introduced as a single inline pointer at Phase 4 step 4 itself
  (not a repo-wide "Iron Laws" list mirroring `executor.md`'s unrelated section) — this matches
  ground truth and no longer asks the implementer to "add to" something that doesn't exist.
- Read `core/laws/README.md` and `core/laws/verification-before-completion.md` in full again —
  the two-law table format, one-concern-per-law pattern, and "Banned hedge language" precedent
  the design cites still check out as described; task 1.1/1.2 and the corresponding spec
  requirements are consistent with this format.
- Read `core/scripts/gather-escalation-context.sh` in full again — `VALID_KINDS` (five kinds),
  the `case` block, and `require`/`fail` helpers match the design's description of where the
  sixth `ticket-ambiguity` kind slots in (task 2.1); the new kind's required fields (`signal`,
  `detail`, `draft_excerpt`) are distinct from the existing five kinds' field names, so no
  collision.
- Read `core/scripts/README.md`'s `gather-escalation-context.sh` row — confirms it currently
  enumerates exactly the five kinds task 2.2 says it needs to update.
- Read `core/roles/orchestrator.md`'s "How to raise one" section (lines 507–580) fresh —
  confirms "five kinds" language (line 511) and the bash comment enumerating them, which task
  3.2 targets for a "six kinds" update, plus the `sub_questions=` multi-part form (lines
  543–568) that both `design.md` and the new spec's wiring requirement rely on for surfacing
  more than one fork in one call — this mechanism exists exactly as described.
- Read `openspec/specs/escalation-context/spec.md` (baseline) and the two change-dir spec
  deltas in full — the `escalation-context` delta is purely additive (new "sixth kind"
  requirement, doesn't touch the five existing kinds' requirement text) and the new
  `ticket-drafting-escalation` capability spec's three requirements map 1:1 onto tasks 1.1/1.2
  and 3.1, with scenarios that are concretely checkable (not vague).
- Re-checked for placeholder/hedge language in all planning artifacts: `grep -n "TODO\|TBD\|
  figure out later\|to be determined"` across `proposal.md`, `design.md`, `tasks.md`, and both
  spec deltas returns nothing.

### Verdict: CONFIRM

Both round-1 change requests are resolved with revisions that are accurate against ground
truth, not just plausible-sounding. The design no longer assumes any nonexistent call site or
nonexistent "Iron Laws" list in `orchestrator.md`; the wiring decision is now scoped to the one
real touchpoint that exists (the `question=` text Phase 4 step 4 already composes), and task
3.3 correctly frames itself as introducing the orchestrator's first law reference. The rest of
the design (new law file, sixth escalation-context kind, README/spec updates) remains
well-grounded with no placeholders, internal contradictions, or scope drift beyond the ticket's
acceptance criteria. Ready to execute.

### Non-blocking notes

- `design.md`'s Decisions section documents the round-1 correction inline (the "Alternative
  considered" note under the Phase 4 wiring decision, lines 119–124) — this is good practice
  for auditability and cost nothing to keep.
