## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/verdict-sha-binding/spec.md`, `skeptic-design-1.md`, `skeptic-design-2.md` in full. Base confirmed `9dc1545` (CON-173) via `git log --oneline -5`; worktree otherwise clean (only the untracked change dir).

**(a) Round-2 CR closure, checked against the artifacts and the real scripts:**

1. *spec.md lease scenario* — **CLOSED.** The scenario is now "The auditor lease protocol is unchanged by a stale outcome … the auditor lease is NOT released inside the check", matching Decision 4a. The requested missing scenarios were also added (branch-contribution scoping both directions, caller-supplied archive prefix, head-being-merged both directions, override asymmetry, empty contribution, unresolvable base).
2. *proposal.md contradictions* — **CLOSED.** Now reads "The CON-171 auditor-lease protocol is deliberately left unchanged" and "(this repo tracks no rendered agent definitions, so those have no render target here)"; the Impact line matches task 5.2. (Stray `exit-3,.` typo — non-blocking.)
3. *base ref undefined/unset/stale* — **PARTIALLY CLOSED, and one sub-item introduced a new blocking defect.** (a) unset: closed — Decision 1b + task 2.4 specify `.baseRefName` → `CONCERTINO_BASE_BRANCH` → `main` resolved at a scope condition 3 can see, guarding `set -u`. Verified the premise is real: `check-merge-readiness.sh:2` is `set -uo pipefail`, and `BASE_REF` is assigned only at `:185`/`:186` inside the `gh pr view` success branch at `:182`. (c) staleness: closed — step 0 fetches unconditionally. (b) *ancestor* requirement: adopted verbatim and it is wrong — CR 1 below.
4. *empty `PATHS` inverts the pathspec* — **CLOSED.** Decision 1c, task 2.6, task 4.7, and a spec scenario ("does not fall back to comparing every path").
5. *`headRefOid` not fetched* — **CLOSED and correctly re-grounded.** Verified independently: `grep -n 'gh pr view'` → `:182` (`mergeStateStatus,baseRefName`), `:216` (`statusCheckRollup`), `:260` (`mergeable,mergeStateStatus,reviewDecision`); `grep -c headRefOid` → 0. Decision 5 now states the correction, pins it to the condition-2 query (post-reconcile-push), and classifies the mismatch/failed-query as exit 1, not exit 4.
6. *unsatisfiable red-before rule* — **CLOSED in structure** (Decision 7 rewritten by polarity, task 4.8), with a residual hole — CR 2/CR 3 below.

**(c) Decision 1b's load-bearing reasoning — I tried to refute it and could not; it is CORRECT.** Reproduced both directions in throwaway repos:

- Branch merged base commit `X`; `origin/main` then advanced to `m3`. `git merge-base origin/main feat` returned exactly `X`, and `git diff --name-only $MB feat` returned only `w` (the branch's own file). The advanced base is harmless, precisely for the stated reason (the base fast-forwards, so `X` stays an ancestor of the newer tip and `merge-base` still returns it).
- The stale/behind direction is indeed the harmful one, for the stated reason.

So Decision 1 as a whole rests on sound ground, and the unconditional fetch in step 0 is the right remedy.

**(b)/(e) New machinery attacked freshly:** Decision 1c is sound and correctly explains git's pathspec semantics. Decision 6a (exit 1 dominates exit 4) is sound and the placement in the header alongside the CON-159 contract is right. Decision 5's post-condition-0 ordering argument is correct against the script as it stands (condition 0 pushes at `:197`). Decision 4a remains correct (one acquire at `:155`, one release in `emit-event.sh` gated on `role=auditor`). The remaining blockers are below.

### Verdict: REFUTE

Three items, all genuinely blocking and all cheap to fix. CR 1 is the serious one: as specified, the check would refuse on essentially every healthy run in a busy fleet, and it directly contradicts both spec.md and the design's own self-test.

### Change Requests

1. **Delete the "base ref must be an ancestor of `<head>`" requirement — it refuses the healthy case, and contradicts this design's own self-test and spec.md.**
   `design.md` Decision 1 step 0 and Decision 1b ("*Which ref*") require `origin/<base>` to be an ancestor of `<head>`, refusing otherwise; `tasks.md` 2.4 repeats it ("refuse if unresolvable **or not an ancestor of the head**").
   `origin/<base>` is an ancestor of a feature head only when the base has not moved since the branch's last reconcile. Measured, in both fixtures above: `git merge-base --is-ancestor origin/main feat` → **NO** in the plain advanced-base case *and* in the branch-already-merged-`X` case — while `merge-base` returned the right commit and the diff scoped correctly in both. So the guard refuses exactly the runs Decision 1b's staleness paragraph declares harmless, and exactly the case `tasks.md` 4.7 requires to assert **PASS**. It is self-contradictory within one document, and in a repo whose whole premise is many lanes advancing a shared `origin/main`, it fires on the ordinary path.
   `specs/verdict-sha-binding/spec.md` already has this right ("the base ref cannot be determined **or its merge-base cannot be computed** → refuse") — the normative artifact and the design disagree. Resolve toward the spec: the only precondition step 1 actually needs is that `merge-base` **succeeds and returns a non-empty SHA** for both `<reviewed_sha>` and `<head>` (i.e. a common ancestor exists — the unrelated-histories case). Remove the ancestry test from Decision 1 step 0, Decision 1b, and task 2.4, and state the merge-base-computable condition in their place.

2. **Decision 7's exact-output requirement must apply to refusal assertions too — a vacuous refusal can still slip through.** Decision 7 imposes "assert it *reached* condition 3, by matching the exact expected output rather than only `rc 0`" on must-PASS assertions only. But red-against-pre-fix proves only that a refusal assertion is not precondition-guaranteed; it does not prove the refusal fired *for the intended reason*. Every fail-closed leg in task 4.4 (erroring git invocation, unresolvable SHA, absent `head_sha`) refuses under Decision 3, and so does a fixture that is simply broken — missing event log, failed `gh`, unresolvable `BASE_REF`. A fixture whose `gh` stub is misconfigured would read as a passing proof of the erroring-diff leg. Extend the rule symmetrically in `design.md` Decision 7 and `tasks.md` 4.8: refusal assertions must match the exact refusal message (`STALE <role> reviewed=… head=… changed=…`, or the specific fail-closed reason string), not merely the exit code, so each proves it refused on the leg under test.

3. **Task 4.7's stale/advanced-`origin/<base>` PASS assertion has no proof method.** Decision 7's must-PASS list enumerates exactly three cases — healthy squash-shaped, base-derived untouched paths, empty `PATHS` — and names one mutation for each. `tasks.md` 4.7's second assertion ("advance `origin/<base>` past the merge the branch performed and assert PASS") is a fourth must-PASS assertion, and it is the one guarding the load-bearing reasoning verified in (c) above. Under Decision 7 as written it is unprovable, and it is green whether or not step 0's fetch exists. Add it to Decision 7's must-PASS list with its own mutation of the fix — removing the unconditional `git fetch origin <base>` from step 0 must turn it red — plus the same exact-output assertion.

### Non-blocking notes

- `proposal.md`: stray `exit-3,.` (comma before period) in the Drift bullet.
- Decision 1's step ordering reads 0, 1, 2, 3 while the decisions are numbered 1, 1b, 1c, 1a — 1a appearing after 1c is mildly confusing to read in order; no substantive effect.
- Consider stating in Decision 1b that the unconditional fetch in step 0 replaces nothing about condition 0's existing BEHIND-path fetch at `:188` (they coexist); an executor could otherwise read step 0 as licence to move that call.
