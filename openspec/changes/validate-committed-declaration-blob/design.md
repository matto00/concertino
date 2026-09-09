# Design

## Context

At the point `squash-branch.sh` runs, the executor has already committed its
work onto the delivery branch, so `git diff --cached --name-only <merge-base>`
describes the content of the prospective squash commit. The declaration file
`<CHANGE_DIR>/files-modified.md` lives inside `<CHANGE_DIR>`, which is itself in
that committed set. The guard, however, reads that file from the filesystem:

```
FILES_MODIFIED_PATH="${WORKTREE_PATH%/}/${CHANGE_DIR_NORM}/files-modified.md"
if [ -f "$FILES_MODIFIED_PATH" ]; then ... grep ... "$FILES_MODIFIED_PATH" ...
```

Filesystem content and index content are independent. CON-163 (`fc88cd0`) moved
the `git reset --soft` to after validation but did not touch the read source,
so the defect's shape is unchanged.

## D1 — Decision: read the declaration from the staged blob

The declaration parse reads `git show :<CHANGE_DIR>/files-modified.md` instead
of the worktree path.

**Why.** This is the only change that makes the guard structurally correct: the
bytes parsed are, by construction, the bytes the commit captures. Every other
mitigation is a check layered on top of a read that is still pointed at the
wrong source; if such a check were ever weakened, relaxed, or bypassed, the
guard would silently return to approving content it does not commit. Fixing the
read source means the failure mode cannot reappear from a weakened check alone.

**Why not read-source alone.** Reading the staged blob and stopping there
satisfies "validate what you commit", but it resolves a divergence silently
toward the index: the executor's on-disk corrections are quietly discarded and
the stale staged content is committed with an approving exit 0. On HEL-732 that
is precisely the outcome that shipped 24 stale markers. Correct-but-silent is
not good enough for a record other tickets read as fact.

## D2 — Decision: an index/worktree divergence of the declaration file is a refusal

**Precondition: this check runs only when the worktree file exists.** On-disk
presence is evaluated FIRST and is what routes control (see D4/D4a); the
divergence check is reached only on the both-versions-exist path. Divergence is a
concept with no meaning when only one version exists, and — measured, not assumed —
the D7 detector does not agree with that prose on its own: `git diff --quiet`
exits 1 for a file deleted from the worktree, so without this precondition the
detector would refuse exactly the D4a shape that must proceed.

If `git show :<path>` and the worktree file differ, the script refuses,
non-zero, committing nothing, printing both the fact of divergence and a
concrete instruction (stage the corrected file, or revert it, then re-run).

**Why.** A divergence at commit time is a mistake, and neither automatic
resolution is safe. Preferring the index silently discards a correction the
author believed they had made. Preferring the worktree is the current defect.
Refusing surfaces the mistake to the only party that can say which content is
intended.

**Relationship to D1.** D1 and D2 are deliberately kept as BOTH, not either/or.
D1 makes the guard's decision structurally bound to the committed bytes; D2
makes the divergence itself visible instead of resolved. Under D2 a divergence
never reaches a commit at all, so D1 has no observable effect on the divergent
path — that is intentional. D1 is the invariant, D2 is the diagnostic, and D1
is what keeps the invariant true if D2 is ever loosened.

## D3 — Decision: the refusal is scoped to the declaration file only

The divergence check covers `<CHANGE_DIR>/files-modified.md` and nothing else.

**Why.** A broad "refuse if any declared path is dirty relative to the index"
rule is too wide and would break ordinary runs: at Delivery a worktree routinely
carries unstaged and untracked material (gitignored `workflow-state.md`, agent
reports, editor scratch), and a dirty declared source path is not a defect of
the record. The file whose content the guard's decision actually depends on is
the declaration file. Scoping to it is what makes the refusal precise rather
than a new source of spurious stops.

## D4 — Decision: a declaration present on disk but absent from the index is refused, distinctly, with a self-service remedy

If the worktree file exists but has no staged blob (untracked, or staged for
deletion), the script refuses with its own diagnostic naming that specific cause
AND printing the concrete remedy: stage the declaration
(`git add <CHANGE_DIR>/files-modified.md`) and re-run.

**Why refuse.** Such a file will not appear in the commit, so treating its
contents as a declaration is the same defect in a different costume.

**Why it must not fall through to the generic branch.** The generic
"no usable declaration" branch's remedy is `--allow-empty-declaration`, which is
the wrong remedy here and would name the wrong cause — the diagnostic-misdirection
failure CON-158 already recorded for this script.

**Why the remedy text is load-bearing, not decoration.** Detection method: branch
on the file's on-disk presence, not on `git show`'s exit code — `git show` exits
128 both for "exists on disk but not in the index" and for "missing from both",
so the exit code alone does not distinguish D4 from the ordinary missing case.

## D4a — Decision: the inverse case (staged blob, absent from disk) parses the blob and proceeds

If the declaration has a staged blob but no worktree file, the script parses the
staged blob and proceeds. This is NOT treated as a divergence.

**Why.** The staged blob is what the commit will capture, and D1's invariant is
satisfied by parsing exactly that. Refusing here would be a spurious stop on a
real shape (an executor that commits the handoff and then removes it from the
worktree), and it would refuse a run whose committed record is entirely correct.
The rule "validate the bytes you commit" is fully honoured by parsing the blob;
divergence is a concept that only has meaning when two versions both exist.

**This is an exemption, so it carries its own structural check.** Skipping the
divergence check on an absent-on-disk file must not become a route to skipping the
DECLARATION check. A test asserts that with the declaration absent on disk and a
staged blob present, an undeclared staged file is still refused — i.e. the blob is
genuinely parsed and enforced, never treated as an empty declaration that waves
the run through.

**Consequence for the existing diagnostic.** The current missing-declaration
message reports the worktree path as missing (`(files-modified.md is missing at
...)`). Per D6 the generic no-usable-declaration diagnostic is phrased around the
STAGED BLOB rather than the worktree path — it reports that no staged declaration
blob exists. That rewording belongs to the generic branch, not to D4a itself: on
the D4a path a blob is precisely what IS present, and that branch instead notes in
its output that the declaration was read from the index with no worktree copy
present, so the design's one silent exemption is visible in a transcript.

## D5 — Decision: `--allow-empty-declaration` does not suppress D2 or D4

The divergence and not-in-index refusals are evaluated before, and independently
of, `ALLOW_EMPTY_DECLARATION`, and no code path lets that flag reach them.

**Both conditions, not one.** Non-suppression covers D2's divergence AND D4's
absent-from-index case. The D4 half is the more dangerous one to leave untested,
because `--allow-empty-declaration` is precisely the remedy a reader would reach
for on that branch — D4's whole rationale is that it is the wrong remedy there.

**Why.** `--allow-empty-declaration` opts in to ONE narrowly-stated condition:
no usable declaration exists while staged files remain outside the change-dir
allowlist. It is not, and must not become, a general "proceed anyway" switch.
An exemption that widens into a blanket amnesty is the precise failure this
change is obliged to avoid, so the non-suppression is asserted structurally by
a test that passes the flag and asserts the divergence refusal still fires —
not merely stated here.

## D6 — Decision: the diagnostics report the same source the decision used

Every failure branch that echoes declaration content or names where declarations
come from reports the STAGED BLOB, not the worktree path.

**Why.** D2 makes the two equal in practice, but relying on that is exactly the
coupling D1's rationale argues against. If D2 were ever loosened, the guard would
validate one source and report another — this ticket's defect class, relocated
into the diagnostic layer. Keeping the reported source bound to the validated
source means the report cannot drift even if the refusal does.

## D7 — Decision: divergence is detected with `git diff --quiet`, not string comparison

Divergence is detected via `git diff --quiet -- <CHANGE_DIR_NORM>/files-modified.md`
(exit 1 on divergence), never by comparing `"$(git show :path)"` against
`"$(cat path)"`.

**Gated by D2's precondition.** This detector is evaluated ONLY when
`[ -f "$FILES_MODIFIED_PATH" ]` holds. It reports a worktree deletion as an
unstaged change (exit 1), so run ungated it would fire on D4a's staged-blob/
absent-on-disk shape and produce precisely the BLOCKER-escalated spurious stop
this design is otherwise at pains to avoid. The order is: on-disk presence first,
then divergence.

**Why.** Command substitution strips trailing newlines, so a divergence consisting
only of trailing whitespace would be silently missed by the string comparison —
a guard with a blind spot, which is the thing this change exists to remove.

## Risks

- **D4 converts a currently-passing real-run shape into a hard stop.** Today, a run
  whose change dir is present on disk but entirely untracked at squash time passes:
  the guard reads the disk declaration and proceeds. Under D4 it refuses. This is
  not hypothetical in this repo — PRs #117 and #118 merged with zero
  `openspec/changes/**` files in any commit. Because a non-zero exit from this
  script is escalated to a human as a BLOCKER rather than retried, an unmitigated
  D4 would turn that shape into a run-halting page.
  **Mitigation:** D4's diagnostic states the self-service remedy explicitly
  (`git add <CHANGE_DIR>/files-modified.md`, then re-run), and a test asserts that
  remedy text is present — not merely that some distinct diagnostic fired. The stop
  is correct (an untracked declaration is not a committed record), so the mitigation
  is to make it self-clearing in seconds rather than to weaken it.
- **Ordinary runs must not start failing.** Mitigated by D3's scoping, D4a's
  handling of the absent-on-disk shape, and a test asserting the ordinary
  consistent-declaration path still commits. Verified against the existing suite:
  every scenario stages the declaration before invoking the script, so D1 does not
  mass-break it.
- **`git show :<path>` path spelling.** The index is keyed on repo-relative paths,
  not worktree-absolute ones, so the argument must be
  `<CHANGE_DIR_NORM>/files-modified.md` and the command must run with the worktree
  as its git directory. Covered by the ordinary-path test, which would otherwise
  regress into the empty-declaration branch.
