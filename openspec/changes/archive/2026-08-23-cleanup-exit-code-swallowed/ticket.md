# CON-131: cleanup.sh exits 0 having done nothing when its git operations fail

## Description

`cleanup.sh --phase4` printed `fatal: this operation must be run in a work tree` and **exited 0 having performed zero work** — worktree still present, local branch still present, `main` not fast-forwarded. Because the exit code was 0, any caller that checks it reports a clean cleanup that never happened.

Observed on the HEL-657 delivery, 2026-08-21.

### Correction to this ticket's original framing

This ticket was first filed claiming the helio repo root "is a bare checkout" and that cleanup.sh should be taught to support bare roots. **That premise was wrong and the title has been changed accordingly.** The repo is not normally bare. `core.bare = true` was set in `.git/config` at some point during that session by an unidentified actor; at session start the working tree was intact. The flag has since been cleared and the repo resynced.

So the `fatal: this operation must be run in a work tree` message was a *symptom* of a separate incident, not a standing property of the repo. **Do not implement bare-repo support** — that would be building for a state the repo should never be in.

What survives the correction, and is the entire point of this ticket, is the failure-handling defect: **whatever the underlying git error, the script swallowed it and exited 0.** That is independent of why git failed. Had it exited non-zero, the incident would have surfaced immediately instead of being discovered an hour later by an unrelated ticket that could not create a worktree.

For contrast, the existing cleanup.sh tickets all describe *partial* failures that at least surface — CON-119 (leaves the empty parent directory), HEL-655 (aborts with "Directory not empty", exit 255), HEL-764 (fast-forward safety check false-positives), CON-121 (`other_runs_live()` false-positives). The new element here is silent total failure carrying a success exit code.

Session tally when found: `cleanup.sh` failed 8 of 8 Phase-4 runs — 7 left the branch behind, 1 silently skipped the fast-forward, 1 did nothing at all.

## What should change

1. The script must not exit 0 when any of its git operations fail. Fail loudly, naming the failing command and its stderr.
2. Phase 4 completion must be asserted by **result**, not by exit code: verify the worktree is gone, the local and remote branches are gone, and `main` actually matches `origin/main`, and report which of those were confirmed.
3. A caller (orchestrator, TUI, CI) must be able to distinguish "cleanup completed" from "cleanup could not run" without reading the log.

## Related, worth checking together

The manual repair of the HEL-657 cleanup surfaced a git detail the script is likely to get wrong too: after a squash merge, branch commits are **not** ancestors of main, so `git merge-base --is-ancestor` returns false and `git branch -d` refuses even when the branch is fully merged in content terms. The correct safety check is content-equality — `git diff origin/main <branch>` empty — followed by `git branch -D`. A `-d` refusal must not be read as "unmerged work exists". Ordering also matters: `git branch -D` fails while a worktree still uses the branch, so the worktree must be removed first.

Also in scope by necessity: there is a REAL, CURRENT case to exercise against — cleanup must handle "main cannot fast-forward" as a distinct, reportable outcome rather than either a silent skip or a hard failure.

## Acceptance criteria

- [ ] When any git operation inside the script fails, the script exits non-zero and prints the failing command and its stderr. Proven with a probe that forces a git failure — red-before-green, not merely a green run on a healthy repo.
- [ ] The script verifies its own postconditions by result — worktree absent, local branch absent, remote branch absent, `main` == `origin/main` — and reports which it confirmed.
- [ ] A regression probe reproduces the original symptom on the unfixed script (a git failure, exit 0, zero work done) and passes on the fixed one.
- [ ] Branch deletion uses content-equality (`git diff origin/main <branch>` empty) rather than ancestry, and removes the worktree before deleting the branch.
- [ ] Cleanup remains scoped to its own run: other live worktrees and branches are untouched.

## Explicitly out of scope

Do NOT implement bare-repo support. Do NOT scope-creep into CON-119 (empty parent dir), CON-121 (`other_runs_live()` false-positives), HEL-655 (worktree removal "Directory not empty"), HEL-764 (fast-forward safety check false-positives), CON-132, CON-127, CON-126 — reference them if the fix naturally subsumes one, but do not silently expand into them.
