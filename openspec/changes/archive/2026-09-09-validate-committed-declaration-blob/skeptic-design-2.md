## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Artifacts read in full at round 2:** `ticket.md`, `proposal.md`, `design.md`
(D1–D7 + Risks), `tasks.md`, `specs/delivery-squash-guard/spec.md`, plus
`skeptic-design-1.md` as the checklist.

**Round-1 change requests, each traced to the revision:**

- **CR1 (D4 turns a real passing shape into a BLOCKER) — ADDRESSED.** `design.md`
  Risks now carries a dedicated bullet naming the untracked-change-dir shape, the
  #117/#118 evidence, and the escalate-as-BLOCKER consequence. D4's heading and
  body now require the remedy text (`git add <CHANGE_DIR>/files-modified.md`), and
  the remedy is required in the artifact by BOTH task 2.2 (implementation) and task
  4.4 (assert the remedy text is present, "not merely that some distinct message
  fired"). That is the shape CR1 asked for.
- **CR2 (inverse case undecided) — ADDRESSED.** New D4a decides it (parse the blob,
  proceed, not a divergence), with a matching spec scenario ("The declaration is
  absent from the worktree but present in the index"), task 2.4, and the exemption's
  own structural check at 3.2 + 4.4b. The knock-on to the existing
  missing-declaration diagnostic that CR1's note flagged is called out in D4a's
  "Consequence for the existing diagnostic" and in 2.4.
- **CR3 (D5 one scenario short) — ADDRESSED.** Task 4.3b adds the flag-plus-D4 half,
  and 4.6's mutation set now enumerates 4.1/4.2/4.3/4.3b/4.4/4.4b, so the
  more-dangerous half is both tested and mutation-proven.
- **CR4 (diagnostics still point at the worktree) — ADDRESSED.** New D6 plus task
  1.3 (echo the staged blob as raw content; reword the "allowed:" line).
- **Both non-blocking notes adopted:** D7 (`git diff --quiet`, with the
  trailing-newline rationale) and the on-disk-presence branching folded into D4's
  "Why the remedy text is load-bearing" paragraph.

**Does D4a reopen the hole? — No.** The attack I tried: an executor stages a
permissive declaration, then deletes it from disk. Under D4a the permissive blob is
parsed AND is exactly the blob the commit captures, so the committed record still
matches the committed content — AC1 holds, and this is not the CON-162 defect
(which requires validating bytes that are *not* committed). Task 4.4b closes the
only remaining amnesty route by asserting an undeclared staged file is still refused
in that shape. D4a is correct as decided.

**Does D4a interact badly with `--allow-empty-declaration`? — No.** After D4 claims
on-disk-present/no-blob and D4a claims blob-present/no-disk-file, the only route
left into the generic no-usable-declaration branch is "no blob AND (no disk file or
a blob that parses to zero paths)" — which is precisely the narrow condition the
flag is documented to opt into. No new suppression surface.

**New defect found in the revision — measured, not inferred.** Scratch-repo probe
(reproduced on two independent shapes: a tracked-and-modified declaration, and a
never-committed one):

```
# staged blob present, file removed from disk  (the exact D4a shape)
git diff --quiet -- cd/files-modified.md   -> exit 1        # reads as DIVERGENCE
git show :cd/files-modified.md             -> exit 0, blob content
git status --porcelain                     -> "MD cd/files-modified.md"

# D4 shape (on disk, untracked)
git diff --quiet -- cd3/files-modified.md  -> exit 0        # no false trigger
```

D7's named detector reports the D4a shape as a divergence. See CR1 below.

### Verdict: REFUTE

All four round-1 change requests are genuinely closed, and the two adopted notes
improved the design materially. The refutation is a single new, specific
contradiction the revision introduced by adopting D7 and D4a independently of each
other. It is cheap to fix in the artifacts and would otherwise be settled by
implementer guess, with one of the two guesses producing exactly the spurious hard
stop that CR1 was raised to prevent.

### Change Requests

1. **D7's detector fires on D4a's shape, and nothing in the artifacts orders the two
   checks.** Task 2.1 states the divergence refusal with no precondition and names
   `git diff --quiet -- <CHANGE_DIR_NORM>/files-modified.md` as the detector; task
   2.4 states the D4a shape must "parse the blob and proceed — not a divergence".
   Measured above, `git diff --quiet` exits **1** for that shape (git treats a
   worktree deletion as an unstaged change), so an implementer following 2.1
   literally gets a refusal on the very shape 2.4 requires to proceed. Two readings,
   opposite behaviour on a real shape, and the refusing reading is a
   BLOCKER-escalated hard stop.
   Required: state the ordering/gating explicitly in both places — the divergence
   check (D2/D7) runs **only when the worktree file exists** (`[ -f
   "$FILES_MODIFIED_PATH" ]`); the on-disk-presence branch (D4 / D4a) is evaluated
   first and is what routes control. Concretely: (a) add the precondition to
   `design.md` D7 (and/or D2), which currently only implies it via D4a's prose
   "divergence is a concept that only has meaning when two versions both exist" —
   prose that does not survive contact with the detector it sits next to; and (b)
   amend `tasks.md` 2.1 to carry the same `-f` precondition, matching the way D4's
   own detection subtlety was already spelled out at 2.2. The spec delta already
   reads correctly (its divergence scenario presupposes "the worktree copy") and
   needs no change.

### Non-blocking notes

- Task 2.4's second sentence — "Report the staged blob's absence rather than the
  worktree path in the missing-declaration diagnostic" — is confusing in the D4a
  context, where the blob is precisely what is *present*. The intent (per D6) is
  that the generic missing-declaration diagnostic should be phrased around the
  staged blob rather than the worktree path. Reword to avoid an implementer reading
  it as "print blob-absent in the D4a branch".
- Consider having the D4a branch note in its output that the declaration was read
  from the index with no worktree copy present. Not required by any AC, but it makes
  the one silent exemption in the design visible in a transcript.
- Task 4.6 correctly omits 4.5 from the mutation set (4.5 is a passing-path
  regression, not failable by reverting the fix). Noting it only so a later reader
  does not mistake the omission for the CR3 gap.
