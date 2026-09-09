## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none blocking.

**Branch-integrity verification (orchestrator's first flagged concern) — CLEARED, with a correction to the premise.**

`git diff main --stat` does *not* list only the three expected paths, but every extra
entry is benign and I verified each by object id rather than by inspection:

- The branch's merge-base is `2ce8f22`; `main` is `4bf4e92` and has advanced **3 commits**
  (CON-167, CON-159, CON-168) since the branch diverged. `git diff main` is therefore a
  two-dot diff that includes reverse deltas for main-only work.
- `.claude/skills/concertino-fleet-driver/SKILL.md`, `core/roles/auditor.md`,
  `core/scripts/README.md`, `core/scripts/check-merge-readiness.sh`,
  `test/scripts/check-merge-readiness.test.sh` — blob at HEAD is **byte-identical to the
  merge-base blob** for all five. The branch never touched them; they differ from `main`
  only because `main` moved. Not disturbance.
- `core/roles/orchestrator.md` and `test/scripts/openspec-validate-cmd.test.sh` — blob at
  HEAD is **byte-identical to `main`'s blob** (`2037958…`, `ae90d93…`). The 9ae5711 restore
  landed exactly on main's content, so the branch contributes a net-zero delta on both.
  Note these are *not* identical to CON-154's own commit `486cd53` on this branch — they
  additionally carry CON-168's `documented-as-broken` marker work that reached `main`
  separately. That is the correct target, not over-restoration.

Net: the CON-163 contribution is exactly `core/scripts/squash-branch.sh`,
`test/scripts/squash-branch.test.sh`, and `openspec/changes/validate-before-reset/**`.
Nothing else on the branch was disturbed.

**Acceptance criteria:**

- AC1 (compute prospective set without moving HEAD; reset only after guard passes) — met.
  `squash-branch.sh:120` computes `git_wt diff --cached --name-only "$MERGE_BASE"`; the
  reset block now sits at `:231-235`, immediately above the commit.
- AC2 (HEAD identical on every refusal path) — met and tested on both refusal exits
  (undeclared-stray at test `:243`, unparseable-declaration at test `:475`).
- AC3 (guard decision provably unchanged) — met; see Phase 2 D1 verification.
- AC4 (success-path squash commit byte-identical in tree and parent) — met structurally:
  the reset+commit pair was moved verbatim, so the parent is `$MERGE_BASE` by construction.
  See non-blocking suggestion 1 — no assertion pins the parent explicitly.
- AC5 (regression guard, proven mutation-failable by reintroducing the early reset) — met;
  independently re-verified, see Phase 2.
- Out-of-scope discipline: **no drift into CON-162 or CON-164.** The diff adds no
  worktree-vs-index comparison (still `--cached` throughout) and no dry-run flag or
  early-return path. Guard strictness is untouched — `is_allowed`, `DECLARED_PATHS`
  parsing, all `FAIL` messages and exit codes are byte-identical to `main`.

Tasks 1.1–4.3 all marked `[x]` and all match what was implemented. Task 4.3's claim is
independently confirmed: `git status --short` shows no entry for
`scripts/concertino/squash-branch.sh`; the render target is untouched (it now differs from
`core/`, which is the expected manual-sync posture, and no parity gate is red).

Spec delta `specs/delivery-squash-guard/spec.md` correctly re-specs the two MODIFIED
requirements against a "prospective" set and adds "A refusal leaves the branch exactly as
it found it", including the earlier-precondition case. Planning artifacts match the
implemented behavior.

### Phase 2: Code Review — PASS

**Gates (run by me, fresh, in the worktree — not taken from the executor's report):**

- `npm test` — exit 0, full suite green.
- `bash test/scripts/squash-branch.test.sh` — **25 passed, 0 failed.**

**D1 identity claim — independently verified, holds exactly.**

I did not take the design's assertion on trust. Built a throwaway repo, committed two
commits past a merge-base, and compared all three forms:

```
git diff --cached --name-only $MB            (before any reset)  -> b.txt c.txt
git reset --soft $MB
git diff --cached --name-only                (old form)          -> b.txt c.txt
```

`reset --soft` moves HEAD and leaves the index untouched, so both forms diff the same
merge-base tree against the same index object. This is a true identity, not an
approximation — the guard inspects exactly the set it inspected before. AC3 satisfied.

**Mutation proof (Scenario 2d) — independently re-run and confirmed to mutate the ORDERING.**

The orchestrator's concern was that a plausible-looking mutation might exercise the guard's
strictness rather than the ordering. It does not:

- The python3 patch inserts the *verbatim* early-reset block immediately above the
  `# --- Staged file set (prospective:` comment — i.e. back at its pre-fix position. It
  leaves the prospective `diff --cached --name-only "$MERGE_BASE"` form in place and
  changes nothing about `is_allowed`, the allowlist, or any `FAIL` branch.
- Because of the D1 identity, the mutant reaches the *same* refusal for the *same* reason
  (`RC2D != 0` is asserted). The only thing that differs is that HEAD moved. The assertion
  requires **both** `RC != 0` **and** `HEAD moved` — so it cannot pass by the run failing
  for some unrelated reason.
- Fixture is non-vacuous: `BRANCH2D` carries its own commit past the merge-base, so
  HEAD ≠ merge-base and "HEAD moved" is a real observation.

**Demand-the-red — I ran it myself rather than relying on Scenario 2d alone.** I created a
detached scratch worktree at HEAD, checked out `main`'s (pre-fix) `squash-branch.sh` into
it, left the new test file in place, and ran the suite. The three new/rewritten assertions
go red exactly as they must:

```
FAIL 3.5 no squash commit was created on guard trip (commit count unchanged)
FAIL 3.5 HEAD is unchanged across the guard trip
FAIL 3.5 the stray file remains reachable from HEAD after the guard trip (work not lost)
FAIL 3.3 HEAD is unchanged across the missing/unparseable-declaration refusal
```

These are load-bearing regression guards, not decoration. The scratch worktree was removed
(`git worktree remove --force`) and `git worktree list` is clean.

**Code quality:**

- Behavior-preserving as claimed: the diff moves the reset block and re-parameterizes one
  diff invocation. No drive-by behavior change anywhere in the guard body.
- Mutation safety: the in-place mutation of the real script in Scenario 2d is covered by
  the suite's file-level `trap restore_script EXIT` (test `:37`), which restores from a
  `mktemp` snapshot and also sweeps `.bak.*`/`.bak2.*`. The real script cannot be left
  mutated. Verified `git status --short` is clean for it after my runs.
- Comment quality is in line with CONTRIBUTING's provenance-tracking style; the rewritten
  Scenario 2 comments explain *why* the old "remains staged" form cannot hold under the new
  ordering rather than just deleting it (task 2.3 honoured — the coverage was rewritten,
  not dropped).
- No dead code, no TODO/FIXME, no over-engineering. `bash -n` clean (suite runs).
- The one uncommitted file, `openspec/changes/validate-before-reset/workflow-state.md`, is
  a `PHASE: Execution -> Evaluation` bump — ordinary in-flight orchestration state, inside
  the change-dir allowlist. Not a finding.

### Phase 3: UI Review — N/A

Concertino repo: no frontend, no dev/backend servers, no UI-affecting paths in the diff.
Per the orchestrator's brief and the trigger list, Phase 3 does not apply.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `test/scripts/squash-branch.test.sh` — no assertion pins the squash commit's parent to
  the merge-base, so AC4's "byte-identical in tree and parent" rests on structural
  reasoning rather than measurement. A one-line
  `git -C "$BRANCH..." rev-parse HEAD^` vs `merge-base` check on the success-path scenario
  would close that gap cheaply. Not blocking: the reset+commit pair moved verbatim, so the
  parent cannot differ.
- `test/scripts/squash-branch.test.sh:355-370` — the python3 mutation uses
  `lines.index(target)` against an exact comment line in `squash-branch.sh`. CON-162 and
  CON-164 are queued on that same file and may reword that comment, at which point the
  patch raises `ValueError` and the script is left unmutated. I confirmed this **fails
  closed** (against the fixed script the unmutated run leaves HEAD put, so 3.2 goes red
  loudly rather than falsely green), so it is safe — but an explicit
  `if idx is None: sys.exit(1)`-style guard, or anchoring on a shorter stable substring,
  would make the breakage self-describing instead of a confusing red.
- `core/scripts/squash-branch.sh:120` — `git_wt diff --cached --name-only "$MERGE_BASE"`
  has no `--` separator before the revision. Risk is negligible (`$MERGE_BASE` is a
  40-char sha), but `diff --cached --name-only "$MERGE_BASE" --` would be free hardening
  against rev/path ambiguity.
- Scenario 2d reuses the `.bak.$$` suffix already used by Scenario 1, while Scenario 2b
  deliberately uses `.bak2.$$` to avoid the collision. Sequencing makes it safe today
  (Scenario 1 restores before 2d copies); a `.bak3.$$` would preserve the existing
  convention.
