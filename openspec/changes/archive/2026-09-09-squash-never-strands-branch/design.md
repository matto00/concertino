## Context

`core/scripts/squash-branch.sh` at `87f1a53` ends like this (verified by direct read, not from the ticket's description — the file has taken three merges since this ticket was written):

```sh
if [ "$DRY_RUN_MODE" = "1" ]; then
  echo "READY dry run: guard passed, nothing committed (DRY_RUN=1)"
  exit 0
fi

if ! git_wt reset --soft "$MERGE_BASE" >/dev/null 2>&1; then
  echo "FAIL git reset --soft ${MERGE_BASE} failed" >&2
  exit 1
fi

if ! git_wt commit -q -m "$SUBJECT" >/dev/null 2>&1; then
  echo "FAIL git commit failed after guard passed" >&2
  exit 1
fi
```

The window is real and unchanged: nothing sits between the reset and the commit, and the commit-failure branch exits without undoing the reset. The branch is then at merge-base with the entire change staged — indistinguishable at a glance from a run that produced nothing, and recoverable only via the reflog.

Three predecessors have already shaped this file, and this design is written against the merged reality of all three rather than against the ticket's account of it:

- **CON-163** (`fc88cd0`) moved the reset below the guard. Its spec requirement is worded "A refusal leaves the branch exactly as it found it" — scoped to refusals.
- **CON-162** (`2101a78`) made the guard read the declaration from the staged blob and added the index/worktree divergence refusal. All of that is above the mutation point and is untouched here.
- **CON-164** (`d792b42`) added `DRY_RUN=1`, whose single early return sits immediately above the reset. Its `design.md` D6 deferred one case into this ticket by name.

The ticket's "Collision note" — that CON-162 and CON-164 are queued and must be sequenced — is stale. Both merged before this run started. There is no live collision.

## Goals

- No exit path of this script, on any input, leaves the branch at merge-base with the change staged.
- The guard's judgment is bit-for-bit unchanged: same refusals, same exit codes, same diagnostics.
- `DRY_RUN=1` continues to mutate nothing and to return the same code for every guard verdict.
- The consumer-visible behaviour on success is unchanged, including which hooks run.

## Non-Goals

- Changing the guard's strictness, allowlist semantics, or declaration grammar (inherited from CON-162/CON-164 and still binding).
- Making an empty squash succeed. See D4.
- Re-rendering anything via `concertino sync`. See D6.

## Decisions

### D1 — Reject `git commit-tree`; take record-and-restore. The ticket's stated preference is wrong for this repo's consumers.

The ticket calls `commit-tree` "structurally stronger" and record-and-restore "a smaller diff", and it says the choice is not decided. It is decided here, against the ticket's preference, on evidence the ticket did not have.

`git commit-tree` does not run `pre-commit` or `commit-msg` hooks. `git commit` does. This script's `git commit` today therefore executes whatever hook chain the *consuming* repository installs.

This was checked rather than assumed, in both directions:

- **This repo (concertino) has no hooks at all.** `.husky/` does not exist; `git config core.hooksPath` is unset; `.git/hooks/` contains only `.sample` files. Measured, not inferred. So for concertino's own deliveries `commit-tree` would be behaviourally identical, and if concertino were the only consumer this decision would be a coin-flip.
- **The consuming repository this script is rendered into does have them, and they are substantial.** helio's `.husky/pre-commit` runs roughly twenty gates (`check:repo-integrity`, `lint`, `typecheck`, `format:check`, `check:schemas`, `check:openspec`, `check:no-credential-leak`, `check:tokens`, and more). `core/scripts/**` is copied verbatim into consumer repos as `scripts/concertino/**`, so the delivery squash in helio runs that whole chain today.

Switching to `commit-tree` would silently delete a gate from every consumer's delivery path. The failure mode is the worst kind: nothing errors, nothing is logged, the squash simply stops being checked. A change whose entire purpose is "never leave the branch in a bad state after a hook rejection" must not achieve that by arranging for the hook never to run. That is not eliminating the failure; it is eliminating the detection.

There is a further, quieter cost. `commit-tree` requires the script to assemble author and committer identity, the message, and the parent by hand, reimplementing what `git commit` derives from config and environment. `git_child` (CON-133) deliberately strips the entire `GIT_*` namespace from child invocations — including `GIT_AUTHOR_DATE`, `GIT_COMMITTER_NAME` and friends — so a `commit-tree` path would be constructing identity in exactly the environment that has been hardened to have none. That is a live footgun, not a hypothetical one.

The "structurally stronger" intuition is real but it is about *atomicity*, and atomicity is not what is at stake. The window here is two sequential git operations in a single-threaded shell script; there is no concurrent observer that could catch an intermediate state. What matters is that every exit restores, and D2 achieves that with a mechanism whose failure modes are visible.

**Decision: record HEAD before the reset; restore HEAD (and thereby the index) on any non-success exit below that point.** Smaller diff, no hook-behaviour change, no identity reconstruction, and it composes with the existing structure instead of replacing it.

### D2 — Restore with `git reset --soft <recorded HEAD>`, armed both explicitly and via a trap

`git reset --soft` moves the branch ref and leaves the index and working tree untouched. The forward reset (`--soft` to merge-base) therefore changed exactly one thing: the ref. Restoring the ref with a second `--soft` to the recorded commit restores the complete pre-script state — the index still holds what it held, the worktree was never touched by either operation. No `--hard` anywhere, so no possibility of destroying uncommitted work while trying to protect it.

The recorded value is `git rev-parse HEAD`, captured immediately before the forward reset (not at script start — it must be the commit the reset is about to move away from, and nothing between script start and that point moves HEAD, but capturing it adjacent to its use keeps the invariant local and readable).

Capturing that value can itself fail to read (an unreadable HEAD), and this adds one new early-exit branch: `FAIL could not record pre-squash HEAD before resetting; refusing to proceed`. This is a new line of output that did not exist before this change, so it is worth being explicit against AC4 ("no new refusal is introduced"): it is not a guard judgment — it adjudicates nothing about the staged file set, the declaration, or the allowlist — and it is practically unreachable in the paths that reach it (a merge-base was already computed successfully immediately above, so `HEAD` is provably resolvable at that point in the script). It exists only so that a `PRE_SQUASH_HEAD` failure cannot silently leave the rest of the restore machinery operating on an empty variable; it is defensive, not a new adjudication.

Two arming mechanisms, deliberately both:

1. **Explicit restore on the commit-failure branch.** This is the path the ticket is about, it is the path under test, and an explicit call makes the control flow readable without knowing trap semantics.
2. **An `EXIT` trap covering the reset→commit interval**, installed immediately before the forward reset and disarmed immediately after the commit succeeds. This covers abnormal termination — a harness kill, a `SIGTERM`, an unanticipated failure inside git — where no explicit branch runs. Concertino kills long-running children (`window-reaping`), so this is a real scenario in this system, not defensive padding.

The trap is scoped to that interval and disarmed on success, so it can never fire on the success path or interfere with paths above the mutation point. `set -uo pipefail` is in force but `set -e` is not, which is why the explicit branch is written as an `if !` test rather than relying on the trap alone.

One nuance a future reader should not have to rediscover: a consumer's `pre-commit` hook can itself mutate the index before failing (a `lint --fix` followed by `git add` is a common shape). In that case the restore returns the *ref* faithfully, but the index is not bit-identical to invocation time — through no fault of this script, which cannot unilaterally guarantee otherwise. The guarantee this change makes is that the script performs no index mutation of its own and leaves the ref where it found it; it is not a guarantee that a third-party hook made no changes.

A second, smaller consequence of arming both mechanisms: if the explicit restore fails and prints its two-SHA diagnostic, the `EXIT` trap will attempt the restore again and may print it a second time. That is harmless — the second attempt can even succeed — but it is expected output, not a bug.

**Post-review correction (evaluation-1.md CR1):** the commit-failure branch's confirmation line must be gated on `restore_pre_squash_head`'s own return value, not printed unconditionally. With `set -e` not in force, calling the helper in bare statement position discards its `return 1`, so an unconditional `echo "Branch restored to pre-squash HEAD ..."` printed even when the restore itself failed and HEAD was left at the merge-base — a false success claim, directly violating the spec's "The restore itself fails" scenario ("reports that explicitly ... rather than reporting a restoration that did not happen"). The branch is now `if restore_pre_squash_head; then echo "Branch restored ..."; fi`; the helper's own failure diagnostic (both SHAs, reflog pointer) already covers the `else` case, so nothing else is added there. Exit code stays 1 either way. Post-fix output when the restore itself also fails is: the commit-failure line, the helper's own `FAIL could not restore HEAD to ...` diagnostic (possibly printed twice — once from the explicit call, once from the EXIT trap's own attempt, per the paragraph above), and no "Branch restored" line at all. Verified with a real fixture (Scenario 13 / task 3.9): a `pre-commit` hook that locks the branch's own ref before exiting 1 makes both the commit AND the restoring reset fail deterministically — the "no practical fixture" premise this design originally stated for that scenario was wrong.

If the restore *itself* fails, the script says so loudly, names both SHAs, and points at the reflog — a restore that silently fails would be strictly worse than today's honest stranding. The exit code stays non-zero either way; a failed commit is a failed squash regardless of how cleanly it was cleaned up.

### D3 — The forward-reset failure branch needs no restore

The existing `git reset --soft "$MERGE_BASE"` failure branch is left as-is. If the reset failed, it did not move the ref, so there is nothing to restore; calling a restore there would be a no-op at best and a confusing diagnostic at worst. The trap from D2 is installed before this reset and would fire, so the restore must be idempotent — restoring HEAD to the value it already holds is a successful no-op reset, which it is. This is stated because it is the one place where D2's two mechanisms overlap and the overlap must be harmless rather than merely unlikely.

### D4 — Ruling on CON-164 design.md D6: the harm is taken, the divergence is upheld and closed

CON-164 D6 identified that with an empty prospective staged set the guard passes, `DRY_RUN=1` exits 0 truthfully, and the wet path exits 1 because `git commit` has nothing to capture. It deferred this to CON-170 on the grounds that both obvious fixes — `--allow-empty`, or a new emptiness refusal — are unrequested behaviour changes, the second of which would change the guard's judgment.

**That reasoning was correct and is upheld.** Both fixes remain rejected, for CON-164's own reasons, restated as this change's own position rather than inherited:

- `--allow-empty` would make an empty squash silently succeed, producing an empty commit and a PR with no diff. That is a semantic change nobody asked for and it converts a loud failure into a quiet one.
- A pre-commit emptiness refusal would be a new refusal, and this change's AC4 forbids changing the guard's judgment in either direction. It would also be the wrong shape: an empty staged set is not a scope violation, which is what this guard adjudicates.

**But D6 conflated two things, and only one of them was properly a Non-Goal.** The exit-code divergence (dry 0, wet 1) is a correct answer to a correct question and stays. The *harm* — that the wet path's exit 1 on that input leaves the branch stranded at merge-base — is not a separate concern deferred alongside it. It is exactly the defect this ticket exists to fix, and it is fixed here by D2, with no special-casing: the empty-staged-set commit failure takes the same restore path as a hook rejection, because the script does not care why the commit failed.

So the ruling is: **taken, in the part that is this ticket's, and closed rather than re-deferred in the part that is not.** After this change, `DRY_RUN=1` on an empty staged set still exits 0, the wet run still exits 1, and the wet run now leaves the branch exactly where it found it. The divergence is documented in the existing spec scenario ("A dry run does not predict failure of the reset or commit themselves"), which remains accurate; the spec delta below adds the companion guarantee that the wet failure is non-destructive. **No owner is named because nothing is left outstanding.** A regression test covers this input explicitly so the ruling is enforced rather than merely recorded.

### D5 — Testing: the mutation proof is the test, not the green run

Per this repo's "demand the red" law and the existing `Scenario 2d` / CON-164 `D4a` convention, a no-strand assertion that passes is worthless unless it has been shown to fail against the defect it claims to catch.

Fixtures need a `git commit` that fails *after* a passing guard. The chosen mechanism is a repository-local `pre-commit` hook in the fixture that exits 1 — this is the ticket's own named cause ("hook rejection"), it needs no privileged state, and, importantly, **it also proves that hooks still run**, which is D1's whole argument. A test that could not tell `commit-tree` from `git commit` would leave D1 unenforced; this one fails immediately if someone later switches to `commit-tree`, because the hook would stop firing and the commit would stop failing. That is a deliberate second job for this fixture and it is why a hook was chosen over an easier synthetic failure.

Note the interaction with `git_child`: it strips `GIT_*` but does not set `core.hooksPath`, so a hook installed in the fixture's own `.git/hooks/pre-commit` is found normally. This was reasoned about rather than assumed and is asserted directly by the fixture (the hook must actually fire for the commit to fail at all, so a hook that silently did not run would surface as a test failure, not a false pass).

Scenarios:

1. **Commit fails after a passing guard → branch restored.** Assert exit non-zero; `git rev-parse HEAD` identical before and after; `git write-tree` and `git status --porcelain` identical before and after (both, per CON-164 D4: the tree hash catches staged-content change, the porcelain catches staging-area movement at the same tree); no new commit on the branch; the diagnostic names both the failure and the restoration.
2. **Failability (the red).** Mutate the real script in place to delete the restore, re-run scenario 1's fixture, assert HEAD **is** at merge-base — the exact stranding the ticket describes — then restore from `PRISTINE_SCRIPT`. Reuses the existing snapshot-plus-trap machinery rather than adding a second restoration mechanism.
3. **D4's empty staged set.** Guard passes, nothing staged, commit fails, branch restored. This is CON-164 D6's input, now covered. The fixture's branch must genuinely diverge from the merge-base (two commits — add, then `git rm` the same files — not zero commits beyond the base) so the forward reset is a real ref movement and the restore assertion is not vacuous; see the failability arm below and skeptic-final-1.md CR1.
4. **Success path unchanged.** The squash commit is created and the trap did not interfere — guarding against a restore that fires spuriously on success, which would be a far worse defect than the one being fixed.
5. **`DRY_RUN=1` still mutates nothing** on a fixture whose wet run would fail at the commit, confirming the dry path still returns above the newly-trapped region.
6. **The `EXIT` trap actually firing under an abnormal, catchable termination (Scenario 12, tasks 3.7/3.8).** `kill -TERM` while the script is parked inside a slow `pre-commit` hook, after the forward reset and before the commit returns; assert HEAD is restored, plus a failability arm deleting the `trap` installation line. Added post-cycle-1 in response to skeptic-design-1.md's blocking change request; this list undercounted it through cycle 3 (evaluation-3.md non-blocking note) — corrected here.
7. **"The restore itself fails" (Scenario 13, task 3.9).** A `pre-commit` hook that locks the branch's own ref before exiting 1, so the restoring `git reset --soft` fails too; assert the honest failure diagnostic and the explicit absence of a false "Branch restored" claim, plus a failability arm. Added post-cycle-2 in response to evaluation-1.md CR2, which disproved this design's original claim that no practical fixture existed for this scenario; also undercounted through cycle 3 — corrected here.

### D6 — The rendered copy is updated by `cp`, and `concertino sync` is not run

`test/scripts/rendered-scripts-drift.test.sh` (CON-172, 18/18 green at `87f1a53`) byte-compares every `core/scripts/**` file against `scripts/concertino/**`. `core/scripts/squash-branch.sh` and its rendered copy were confirmed byte-identical at the start of this run, so changing the source without re-rendering turns that gate red.

The re-render is done with a direct `cp` from `core/scripts/squash-branch.sh` to `scripts/concertino/squash-branch.sh`. `concertino sync` is **not** run, anywhere, for any reason: two untracked files in the main checkout (`scripts/concertino/pricing-table.json`, `scripts/concertino/report-cost.sh`) are pending an owner ruling under CON-173, and a sync would render them into the tree and carry them onto `main` through this PR. `cp` produces a byte-identical result for this one file, which is exactly what the drift gate checks.

Note the standing hazard CON-164's own design recorded: the guard protecting *this* delivery is the rendered copy, and the copy is only updated partway through this change's implementation. Correctness of the changed script is therefore established by the test suite, which runs against `core/` directly (`SCRIPT="$ROOT/core/scripts/squash-branch.sh"`), never by this run's own delivery happening to succeed.

## Gate-chain implications

Verified rather than assumed, and the answer is the same as CON-164 reached for the same file: `scripts/concertino/check-gate-chain-change.sh` classifies a change as gate-chain-affecting when it touches a path under `.husky/` or a script referenced from `.husky/pre-commit`'s command list. Neither `core/scripts/squash-branch.sh` nor `scripts/concertino/squash-branch.sh` is either — this script is invoked by the orchestrator during Delivery, not by any pre-commit hook. No Gate-Chain Implications Checklist is required and `assert-phase.sh delivery` should not demand one.

This is worth stating precisely because D1 turns on hook behaviour: this change *depends on* hooks running, but it does not *run as part of* the hook chain. Those are different relationships and only the second triggers the classifier. If the Delivery check nevertheless fires, the classification above is wrong and the discrepancy must be investigated, not worked around.

## Risks

- **Risk: the restore is itself a mutation added to a failure path.** A bug in it could damage a branch that today merely looks damaged. Mitigated by using `--soft` exclusively (never `--hard`), by restoring to a SHA read from the same process moments earlier, by making a failed restore loud with both SHAs and a reflog pointer, and by scenario 4 asserting the restore never fires on success.
- **Risk: the trap could fire in an unintended interval.** Mitigated by installing it immediately before the forward reset and disarming it immediately after a successful commit, so its armed window is exactly the interval it exists to cover, and by D3's idempotence argument for the one overlapping case.
- **Risk: D1's hook-preservation argument is only enforced by a test, not by the type system.** Accepted, and directly addressed by D5's choice of a hook-based failure fixture: a future switch to `commit-tree` breaks that test rather than passing it silently.
