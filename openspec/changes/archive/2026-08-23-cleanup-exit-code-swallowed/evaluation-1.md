## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All 5 ticket acceptance criteria addressed:
  1. Hard git failures exit non-zero, naming the failing command + isolated stderr (`run_git`, `core/scripts/cleanup.sh:96-124`). Proven red-before-green: task 1.2/1.3 probes established the real (already-nonzero, exit 128) script-side baseline and the caller-side swallow mechanism; §6.1 re-runs the identical `core.bare=true` trigger against the fixed script and asserts non-zero exit, isolated stderr, and no `READY`.
  2. Postconditions (worktree absent, local branch absent/skipped, remote branch, base) verified by direct re-probe immediately after the destructive step, driving the exit code the instant a postcondition is found unmet (worktree re-probe at cleanup.sh:200-206; branch re-probe at cleanup.sh:243-247). Confirmed working via §6.7 (stuck-worktree simulation) and §6.8 (unrelated failure not masked by tolerant fast-forward).
  3. `RESULT ...` line (machine-parseable, on stderr) present on every exit path, including the earliest failure inside a command substitution — confirmed by §6.1's stream-separated assertion (`hasnt "RESULT never leaks onto stdout"` / `has "RESULT lands on stderr"`).
  4. Branch deletion uses two-dot content-equality (`git diff "${BASE_REMOTE}/${BASE_BRANCH}" "${BRANCH}"`, cleanup.sh:227), not three-dot/ancestry, and the worktree is removed before branch deletion is attempted (control flow order confirmed by reading the diff). §6.2 proves a squash-merged (non-ancestor) branch deletes cleanly; §6.3 proves a genuinely-unmerged branch is left alone.
  5. Scoping: §6.9 proves an unrelated second worktree/branch is untouched by a targeted cleanup run.
- No AC silently reinterpreted. The ticket's original "bare-repo" framing was already corrected in the ticket text itself before delivery began; the delivered work matches the corrected framing, not the original one, and explicitly does not add bare-repo support.
- All 34 tasks in tasks.md are marked `[x]` and match what's actually in the diff (verified against the diff directly, not just tasks.md's own checkmarks — see Phase 2 for line-level confirmation of each design decision).
- No scope creep: changes are confined to `core/scripts/cleanup.sh`, `core/roles/orchestrator.md`, `test/scripts/cleanup.test.sh`, and this change's own `openspec/changes/cleanup-exit-code-swallowed/**` artifacts. `scripts/concertino/cleanup.sh` (the rendered copy) is deliberately NOT touched.
- No regressions: the original 73 pre-existing `cleanup.test.sh` assertions all still pass unmodified (verified — see Phase 2), and `attempt_fast_forward`'s tolerant behavior is unchanged (confirmed by reading the diff — that block was not touched, and §6.6/§6.8 exercise it directly against the new code).
- No API/schema impact — this is a bash-script + role-doc change only; correctly out of scope for that check.
- Planning artifacts (proposal.md, design.md, tasks.md, the three spec deltas) accurately reflect the final implementation. Spot-checked `specs/cleanup-failure-visibility/spec.md` line-by-line against `cleanup.sh`'s actual `run_git`/`fail`/`print_result` implementation — exact match, including the `RESULT` grammar and stderr-only requirement.
- Verified the flagged "known gap" (rendered-copy drift) is legitimate, not an unverified excuse: `diff core/scripts/cleanup.sh scripts/concertino/cleanup.sh` shows the header-comment divergence (expected — sync was correctly not run against this live repo, per proposal.md's own Impact section and design.md's explicit constraint). Grepped `test/diff-coverage.test.js:53` (the only test file referencing `scripts/concertino/cleanup.sh`) — it renders into a throwaway `--out=` tmp dir via `newSyncedTarget()` and never reads or depends on this repo's own live `scripts/concertino/cleanup.sh` copy being in sync. `npm test` passes with the drift present. The gap is real, flagged, and does not currently break anything — legitimate.

### Phase 2: Code Review — PASS

Ran the project's actual verification gate myself, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` flag was passed — `slow` speed not in effect):

```
npm test
```
Result: full suite passes, exit 0 (`[exited with code 0]`), including `bash test/scripts/cleanup.test.sh` reporting **112 passed, 0 failed** (73 original + 39 new, matching the executor's own report exactly) and `test/diff-coverage.test.js` (`node --test`) passing 12/12, confirming the rendered-copy drift does not break anything the gate checks.

Read `CONTRIBUTING.md` first (this repo's canonical standard — confirmed there is no separate lint/format/typecheck gate here; `npm test` is the entire gate, matching what was run).

Design-decision spot-checks against `design.md`, verified directly in the diff:
- **RESULT genuinely goes to stderr, not stdout, even inside a command substitution**: `print_result()` (cleanup.sh:88) and `fail()` (cleanup.sh:99) both write via `echo ... >&2`. §6.1's `run_cleanup_streams` helper captures stdout/stderr into separate files and asserts `hasnt "RESULT never leaks onto stdout"` against stdout and `has "RESULT lands on stderr"` against stderr — this is a real, stream-discriminating regression probe, not a merged-stream check that could hide a stdout leak. Confirmed passing.
- **Two-dot, not three-dot, diff form**: `git_child -C "$REPO_ROOT" diff "${BASE_REMOTE}/${BASE_BRANCH}" "${BRANCH}"` (cleanup.sh:227) — no `...`. §6.2 (squash-merge, non-ancestor commits) proves this practically: the branch deletes cleanly under two-dot equality, which would be impossible under three-dot/ancestry.
- **Postcondition re-probes call `fail()` immediately, not deferred**: worktree re-probe at cleanup.sh:200-206 (`if [ -d "$WORKTREE_PATH" ]; then WT_OK=fail; fail ...; fi`, executed directly after `run_git "remove worktree"`) and branch re-probe at cleanup.sh:243-247 (directly after `run_git "delete local branch"`) — both exit via `fail()` at the point of detection, not at end-of-script. §6.7 (simulated stuck worktree via a fake-`git` PATH shim) and the branch-deletion analog are both exercised as real subprocess runs, not reimplementations.
- **`WT_OK=ok` on already-absent worktree**: cleanup.sh's `else` branch (worktree not present at start) sets `WT_OK=ok` directly, matching Decision 4/spec's explicit requirement that absence-at-start is a satisfied postcondition, not `not-attempted`. This is exactly what keeps the 73 pre-existing scenarios (none of which create a real worktree) green.
- **Branch naming-convention fallback, ambiguity-safe**: `git branch --list "*/${T}" --format='%(refname:short)'`, gated on exactly one match via `grep -c .` (cleanup.sh:150-155). §6.4 proves the single-match case resolves and deletes; §6.5 proves a two-match (ambiguous) case resolves to empty `BRANCH` and deletes neither candidate branch — a real, non-reimplemented assertion against actual branch state after the run.

Other checklist items:
- **Canonical code-quality compliance**: `CONTRIBUTING.md` has no bash-specific mechanical lint rules beyond "no build step, `npm test` is the whole gate" and "comment-heavy, provenance-tracking style, tag non-obvious decisions with the originating ticket id." The diff follows this: comments throughout cite "design.md Decision N" and "design-gate round N" consistently, matching the codebase's established convention (e.g. `watch.js`'s `// CON-52: ...` style).
- **DRY**: `run_git`/`fail`/`print_result` factor the previously-implicit `set -e` propagation into one reusable helper set, used uniformly for every hard-failing call; no duplicated logic. Test-file fixture extensions (`new_worktree`, `squash_merge_into_main`, `run_cleanup_streams`, `new_fakegit_worktree_remove_noop`) are additive helpers reusing `new_pair()` rather than a parallel harness, matching Decision 6's explicit requirement.
- **Readable**: no magic values; `RESULT` field vocabulary is documented inline and matches the spec's grammar verbatim.
- **Modular**: `run_git`/`fail`/`print_result` are small, single-purpose, composable; branch resolution and content-equality gating are each self-contained blocks.
- **Type safety**: N/A (bash).
- **Security**: no new external input handling beyond existing `git_child` env-hardening (reused unchanged, per proposal.md's stated Impact); no injection surface introduced — `run_git`'s `"$@"` array-based invocation avoids word-splitting/injection hazards.
- **Error handling**: this is the entire point of the change — errors are now named, isolated, and drive the exit code; no silent failures remain on the hard-failing path. The one deliberately-soft path (`attempt_fast_forward`, `worktree prune`) is unchanged and explicitly documented as intentional, matching design.md Decision 1/2.
- **Tests meaningful**: 39 new assertions, each exercising the real script as a subprocess against real git fixtures (not reimplementations of the logic under test) — confirmed by reading the full test diff. Task 6.11's four false-positive-evidence traps (inline-copy assertions, self-referential spec checks, silently-dying mutation arms, ambient-branch-name inheritance) are each visibly avoided in the actual fixtures (real subprocess invocation throughout, `new_pair()`'s existing explicit `main`-pinning reused, no reimplementation of content-equality or postcondition logic in the test file itself).
- **No dead code**: no unused imports/vars; no leftover TODO/FIXME introduced.
- **No over-engineering**: `run_git`/`fail`/`print_result` are the minimum machinery needed for the stated contract; no premature abstraction (e.g. no generic "result-tracking" library was built beyond this script's own five fields).
- **Behavior-preserving where expected**: `attempt_fast_forward` and `worktree prune` are untouched (confirmed via diff — no lines inside that block changed except reordering `T` resolution earlier, which does not alter its behavior). The `run_git`-wrapped calls (`REPO_ROOT`, `worktree remove`, `branch -D`) are the only calls whose failure-signaling behavior changed, exactly as scoped.

No violations found. No non-blocking suggestions beyond noting (as the executor's own handoff already does) that the rendered `scripts/concertino/cleanup.sh` copy will need a real `concertino sync` run against this live repo at some point outside this change's own scope — already correctly flagged, not a defect in this delivery.

### Phase 3: UI Review — N/A

No files under `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` changed (this ticket does not touch helio at all — it modifies Concertino's own `core/scripts/cleanup.sh`, `core/roles/orchestrator.md`, and `test/scripts/cleanup.test.sh`, a bash-script/role-doc/test-only change with no UI or dev-server surface). Per the evaluator role definition's own framing for this repo, Phase 3 is correctly skipped.

### Overall: PASS

### Non-blocking Suggestions
- None beyond what the executor's own handoff already flagged (rendered-copy drift, to be resolved by a future `concertino sync` run outside this change's scope).
