## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Artifacts read in full from the worktree: `ticket.md`, `design.md` (D1–D7 +
Risks), `tasks.md`, `specs/delivery-squash-guard/spec.md`, plus
`skeptic-design-2.md` as the checklist. Verdict derived from the files, not from
the revision summary.

**Round-2 CR1 (D7's detector fires on D4a's shape; nothing orders the checks) —
CLOSED.** Traced to four independent places, all mutually consistent:

- `design.md` D2 now opens with a bold precondition: the divergence check runs
  only when the worktree file exists; on-disk presence is evaluated FIRST and
  routes control, with the measured detector behaviour named as the reason.
- `design.md` D7 carries a "Gated by D2's precondition" paragraph stating the
  same ordering in the detector's own section — which is where an implementer
  reading only the detector decision would land.
- `tasks.md` 2.1 leads with `ONLY WHEN the worktree file exists
  ([ -f "$FILES_MODIFIED_PATH" ] ...)` and warns the detector exits 1 for a
  worktree deletion.
- `tasks.md` 2.4 states the detector "is not reached at all on this path".

There is no longer any reading of 2.1 that produces a refusal on the 2.4 shape.

**Detector behaviour reproduced independently** (scratch repo, not inherited from
round 2): staged blob present, file removed from disk →
`git diff --quiet -- cd/files-modified.md` exits **1**, while
`git show :cd/files-modified.md` exits 0 with content. The gating is genuinely
load-bearing, not defensive prose.

**Is 4.4c failable? — Yes.** It fixes a shape (staged blob, no worktree file,
blob declares every staged path) whose only two possible outcomes are COMMIT (the
required ordering) and a non-zero divergence refusal (the wrong ordering, exactly
what the ungated detector produces per the measurement above). An implementation
that ran the detector before the on-disk-presence branch turns 4.4c red on its
required assertion (a commit exists / exit 0). It is not a vacuous
already-passing scenario, and it does not duplicate 4.4b: 4.4b pins that the blob
is ENFORCED in that shape (refusal), 4.4c pins that a clean blob PROCEEDS. Both
directions of the exemption are now covered.

**Both round-2 non-blocking notes adopted, correctly.** Task 2.4's confusing
"report the blob's absence" sentence is reattributed to the GENERIC branch with
an explicit "that is the generic branch, not this one"; D4a's "Consequence for
the existing diagnostic" says the same. The D4a output note (read from the index,
no worktree copy) appears in both D4a and 2.4.

**Did the revision introduce anything new? — No.** Diffing the round-3 artifacts
against what round 2 recorded: the changes are confined to D2's opening
paragraph, D7's gating paragraph, D4a's consequence paragraph, tasks 2.1/2.4, and
new task 4.4c. No decision was reversed, no scope added, the six out-of-scope
items at §6 are intact, and the spec delta is unchanged — correctly, since its
divergence scenario already presupposes "the worktree copy" and its
absent-from-worktree scenario already requires proceed-and-enforce. AC1–AC5 each
still trace: AC1→D1/1.1, AC2→D2/2.1/4.1, AC3→D3/2.3/4.5, AC4→4.1+4.6 mutation,
AC5→D5/3.2/4.3b/4.4b/4.4c.

### Verdict: CONFIRM

The single round-2 change request is closed in all four artifacts, the ordering
is now stated where each of the two conflicting readings lived, and the new
scenario that pins it is genuinely failable. Sound enough to implement.

### Non-blocking notes

- Task 4.6's mutation set enumerates 4.1/4.2/4.3/4.3b/4.4/4.4b and omits 4.4c.
  That omission is defensible on the same grounds as 4.5's (4.6's mutation is
  "revert the fix", which is not the mutation 4.4c is sensitive to — 4.4c is
  failable by an ORDERING mutation, moving the detector ahead of the `-f`
  branch). If the executor can cheaply demonstrate that ordering mutation during
  4.6, the transcript would be stronger evidence than the prose argument above.
- D2's precondition and D7's gating paragraph now say the same thing twice. That
  redundancy is deliberate and I would keep it, but the implementation should end
  up with exactly one `-f` branch, not two guards that could drift.
