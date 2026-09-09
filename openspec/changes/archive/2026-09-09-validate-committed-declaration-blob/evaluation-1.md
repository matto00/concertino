## Evaluation Report — Cycle 1 (evaluation-1.md)

Repo: concertino (self-hosting). Pure bash change — no frontend/backend, no UI surface.

### Phase 1: Spec Review — PASS

Issues: none.

- AC1 (validate the bytes you commit): met. `core/scripts/squash-branch.sh:143-147` reads
  `git_wt show ":${DECLARATION_INDEX_PATH}"` into `STAGED_BLOB`, and the D2a parse at
  `:187-201` now pipes `printf '%s\n' "$STAGED_BLOB"` into the unchanged grep chain. The
  worktree path is no longer a parse input anywhere.
- AC2 (divergence is a loud refusal): met — `:166-176`, non-zero, before any `reset --soft`,
  prints cause + both remedies.
- AC3 (scoped, ordinary runs unaffected): met. The divergence check is scoped to
  `<CHANGE_DIR_NORM>/files-modified.md` only (D3); no other declared path is checked for
  dirtiness. Scenario 4.5 asserts the ordinary consistent run still commits, and the
  28 pre-existing CON-129/151/163 assertions are untouched and green.
- AC4 (mutation-proven regression test): met, and independently re-verified — see Phase 2.
- AC5 (escape hatch has its own structural check): met. D4a's exemption is pinned by 4.4b
  (amnesty) and 4.4c (ordering/parse-reached), and I confirmed each catches a distinct
  mutation that nothing else in the suite catches.
- Spec delta (`specs/delivery-squash-guard/spec.md`) matches implemented behaviour, including
  the reworded generic no-usable-declaration scenario (staged blob, not worktree path).
- Tasks 1.1–5.1 marked done and each is actually present in the diff. 6.1/6.2/6.3 correctly
  left unchecked (out-of-scope markers).
- Scope: clean. Diff touches only `core/scripts/squash-branch.sh`,
  `test/scripts/squash-branch.test.sh`, and the change dir. No dry-run flag (CON-164 respected),
  no edit to the render target `scripts/concertino/squash-branch.sh` (CON-172 respected), no
  drive-by refactor. Worktree is clean at 2086609.

### Phase 2: Code Review — PASS

Gates run fresh by me in the worktree (not trusted from the executor's report):

- `npm test` → exit 0, zero `FAIL` lines across the whole 14.9k-line run.
- `squash-branch.test.sh: 39 passed, 0 failed`.

Mutation claims re-run independently, in an isolated copy at `/tmp/con162-eval`
(the executor's worktree was never mutated):

1. **Full revert** (`git show main:core/scripts/squash-branch.sh`): reproduced the executor's
   Probe 1 result exactly — `28 passed, 11 failed`; 4.1, 4.2, 4.3, 4.3b, 4.4, 4.4c red;
   **4.4b green**. The executor's claim is TRUE, not an excuse.
2. **Probe 2 (targeted D4a-amnesty)**: reproduced — `38 passed, 1 failed`, the single failure
   being 4.4b. So 4.4b is the *only* assertion in the suite sensitive to that mutation; it is
   a legitimate discriminating test, not a test that cannot fail for the right reason.
3. **My own additional probe** (the more natural D4a regression: gate the blob parse on
   `FILE_ON_DISK -eq 1`, i.e. never parse the blob on the D4a path): `38 passed, 1 failed`,
   caught by 4.4c. Together 4.4b (wave-through) and 4.4c (never-parsed) close both sides of
   the D4a exemption, which is what AC5 asks for.
4. **Probe 3 (ordering: ungated D7 detector ahead of the `-f` branch)**: reproduced — 4.4c red.

Verdict on the flagged question: the targeted mutation is legitimate. A full revert is a
fail-closed coincidence on 4.4b's shape (pre-fix, the missing on-disk file empties
`DECLARED_PATHS` and `sneaky.txt` trips the generic branch), so a full revert genuinely cannot
discriminate 4.4b. The executor diagnosed that correctly and chose a probe that targets D4a's
own stated risk.

Other checks:

- Exactly ONE `[ -f "$FILES_MODIFIED_PATH" ]` branch-routing control, at `:140`, feeding the
  `FILE_ON_DISK` boolean that every downstream branch reuses (D2/D7/skeptic-design-3 satisfied).
  The only other mentions of `FILES_MODIFIED_PATH` are its definition (`:130`), the comment
  (`:136`), and the D4 diagnostic string (`:155`) — none of them route control.
- Tests invoke the REAL script by path (`SCRIPT="$ROOT/core/scripts/squash-branch.sh"`, invoked
  as a subprocess in every scenario); no logic is reimplemented inline. Fixtures are all
  `mktemp -d` throwaway repos, never this repo.
- D7 honoured: `git_wt diff --quiet -- "$DECLARATION_INDEX_PATH"`, not a string comparison of
  command substitutions — so a trailing-whitespace-only divergence is still caught.
- D5 honoured structurally: both refusals sit above and are textually independent of
  `ALLOW_EMPTY_DECLARATION`; no code path can route the flag into them.
- D6 honoured: both diagnostic branches now report the staged blob / index path.
- Error handling: `if STAGED_BLOB="$(git_wt show ... 2>/dev/null)"` correctly takes the command
  substitution's status; an empty-but-present blob yields `STAGED_BLOB_PRESENT=1`, which is the
  right classification.
- No dead code, no TODO/FIXME, no untyped/unsafe constructs, no over-engineering. Comments cite
  design IDs and explain *why* (the ungated-detector hazard), matching the repo comment standard.

### Phase 3: UI Review — N/A

Concertino repo, bash-only change. No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`,
no `openspec/specs/**` runtime surface. Per the orchestrator's instruction and the trigger
rules, no dev servers were started and the UI phase was skipped entirely.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `test/scripts/squash-branch.test.sh:4.2`, `4.3`, `4.3b` assert only a non-zero exit and (for
  4.2/4.3b) an unchanged HEAD; they do not pin *which* refusal fired. I demonstrated this is
  loose: when I ran the suite against a copy missing `core/scripts/lib/git-child-env.sh`, the
  script died at merge-base computation and those three assertions still went green. Consider
  adding the same message grep 4.1 and 4.4 already use (`differs between the staged index and
  the worktree` / `no staged blob in the index`) so they cannot be satisfied by an unrelated
  early failure.
- `4.4b refusal names the undeclared file` greps for `sneaky.txt` anywhere in combined output,
  which the routine `Staged files:` listing also satisfies. Anchoring it to the
  `exceeds the run's declared touched-file set` refusal text would make it pin the intended
  reason. (Not blocking: the reason is already pinned by Probe 2's exclusivity.)
- Consider adding `core/scripts/lib/` to the suite's stated prerequisites, or asserting it
  exists up front — the failure mode when it is absent is 21 confusing red assertions plus
  several false greens.
