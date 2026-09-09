## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Cold read of `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/verdict-sha-binding/spec.md`, `design-gate-budget-extension.md`, `skeptic-design-3.md`. Base confirmed `9dc1545` (CON-173) via `git log --oneline -3`. Also read the real `core/scripts/check-merge-readiness.sh` (lines 1-40, 140-420) and `test/scripts/check-merge-readiness.test.sh` (1-120, plus grep for repo/remote setup) rather than trusting prior rounds' claims about them.

**(a) Round-3's three change requests — all three genuinely CLOSED.**

1. *Ancestry requirement deleted.* Verified in all three named sites. `design.md` Decision 1 step 0 now reads "if `git merge-base` does not succeed and return a non-empty SHA for both `<reviewed_sha>` and `<head>` (the unrelated-histories case), the leg REFUSES"; Decision 1b "*Which ref*" now states the requirement explicitly as wrong, with the measured counter-evidence and the corrected precondition; `tasks.md` 2.4 reads "refuse if unresolvable, or if `git merge-base` fails or returns empty on either side (unrelated histories). Do NOT require the base ref to be an ancestor of the head". No occurrence of an ancestry requirement survives anywhere in the change dir. This is consistent with `spec.md`'s "the base ref cannot be determined or its merge-base cannot be computed → refuse", and correct: an existing common ancestor is exactly what steps 1-2 need.
2. *Exact-output requirement extended to refusal assertions.* `design.md` Decision 7 now carries a standalone paragraph: "Every assertion of either polarity must additionally match the exact expected output, not merely the exit code", with the reasoning about broken fixtures reading as proof, and names the `STALE <role> reviewed=… head=… changed=…` line / specific fail-closed reason string. `tasks.md` 4.8 mirrors it. Closed.
3. *Advanced-base PASS assertion has a proof method.* Decision 7's must-PASS list now includes "the advanced-`origin/<base>` case" and its mutation: "removing step 0's unconditional `git fetch origin <base>` must turn the advanced-base case red". `tasks.md` 4.8 lists "drop step 0's unconditional fetch". Closed, and the mutation is sound: with a stale local tracking ref, `MB_H` regresses behind the merge the branch performed and re-admits base-derived paths, so the case does go red without the fetch.

**Independently checked against the real scripts:** `BASE_REF` really is assigned only inside the `gh pr view` success branch under `set -uo pipefail` (script line 2, assignment at ~185) — Decision 1b's premise holds. `grep -c headRefOid` on the script is still 0 — Decision 5's correction holds. The CON-152 override is really detectable at condition 3 (`OVERRIDE=` derived from the `escalation.answered` index comparison in the existing `jq` pass), so Decision 6 is implementable without new machinery. Condition 0 pushes before conditions 1-2, so Decision 5's "attach `headRefOid` to the condition-2 query" ordering is right.

**(b)/(c) Freshness pass — two blocking items no prior round raised.** Below.

### Verdict: REFUTE

Both items are narrow and cheap; neither reopens a settled decision. Round 3's fixes are good, and the design's substance (Decisions 1/1b/1c/2/3/4/4a/5/6/6a) I could not refute.

### Change Requests

1. **Decision 7's headline mutation is unsatisfiable: the archive-prefix exclusion is applied twice, so removing either site alone leaves the squash-shaped case GREEN.**
   Decision 1 step 2 computes `PATHS` "with the archive prefix already excluded from both", and step 3 *additionally* passes `':(exclude)<prefix>/*'` to the final diff. Given step 2's exclusion, `PATHS` can never contain an archive path, so the step-3 exclusion term is a no-op on every non-empty-`PATHS` path (and on empty `PATHS` it never runs, per Decision 1c's guard). Trace the healthy squash-shaped fixture: branch touched source `w` plus archive files → `PATHS = {w}` → `git diff --name-only <reviewed> <head> -- w` is empty with or without the exclusion term → PASS either way.
   But `design.md` Decision 7 requires, and `tasks.md` 4.8 mandates a transcript for, "removing the `':(exclude)<prefix>/*'` term must turn the squash-shaped case red". As specified that mutation cannot go red, so the required evidence cannot be produced — the unsatisfiable-proof-method class round 2 flagged, in a new place. An executor meeting this wall must either fabricate the transcript or silently re-architect the exclusion, unilaterally.
   Fix: make the exclusion single-sited and say which site is load-bearing, then name the mutation against that site. Either (i) drop the exclusion from step 2 and keep the step-3 pathspec term (then the stated mutation works, and Decision 1c's empty-`PATHS` guard is what stops the degenerate case), or (ii) keep step 2's exclusion, delete the redundant step-3 term, and restate the mutation as "remove the archive-prefix exclusion from the `PATHS` computation". Update Decision 1 steps 2-3, Decision 7, `tasks.md` 2.5/2.6 and 4.8 consistently.

2. **Task 5.1 / Decision 3a materially understate the existing-fixture retrofit: the ~20 fixtures need an `origin` remote and a base branch, and the `gh` stub needs `headRefOid` — not just "real commits".**
   Measured in `test/scripts/check-merge-readiness.test.sh`: `new_repo()` (~line 39) does `git init -q -b main` plus one `--allow-empty` commit and **adds no remote at all** (the only `remote add origin` calls, at ~436/482, are inside the two BEHIND-reconcile fixtures' separate seed/origin setup). The `gh` mock serves `CLEAN_MERGE` = `{"mergeable":…,"mergeStateStatus":"CLEAN","reviewDecision":null}` — no `baseRefName`, no `headRefOid`.
   Under this design, every one of those fixtures now hits (a) step 0's unconditional `git fetch origin <base>`, which fails with no remote → refuse per Decision 3, and (b) Decision 5's `headRefOid` check, whose value is absent from the stub → exit 1. So the ~20 must-PASS fixtures go red for reasons `tasks.md` 5.1 does not mention, and "give their scratch repos real commits so the SHAs resolve" will not fix them. This is exactly the wall Decision 3a was written to keep from being read as evidence that Decision 3/5 should be weakened — so it must name the real work.
   Fix: extend `tasks.md` 5.1 (and the corresponding sentence in Decision 3a) to state that the shared fixture repo helper must gain a bare `origin` with the base branch present and fetchable, real commits so reviewed SHAs resolve, and that the `gh` stub must serve `headRefOid` equal to the fixture's local HEAD (on the condition-2 field-set) and a `baseRefName`.

### Non-blocking notes

- `tasks.md` numbering skips 4.6 (4.5 → 4.7). No content appears lost — every Decision 7 case maps to a task — but the gap invites a reader to think a task was dropped.
- `proposal.md` still contains the stray `exit-3,.` typo flagged in round 3.
- Decision 1's steps read 0/1/2/3 while the decisions are ordered 1, 1b, 1c, 1a; purely presentational.
- Once CR 1 is resolved toward option (ii), Decision 1c's rationale paragraph should be reworded — its hazard ("a pathspec list empty except for an exclusion term") only exists while the step-3 term exists.
