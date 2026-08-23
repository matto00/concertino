## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS
Cycle 1's single change request was to add the permanent test file
`test/scripts/tui-attached.test.sh` (a mechanical `tasks.md` completion gap —
`scripts/concertino/tui-attached.sh` and `core/scripts/tui-attached.sh` shipped
in a2f3467 without a corresponding regression test committed alongside them).
Commit a7e5215 adds this file (165 lines, 10 scenarios) and wires it into
`npm test`. No other changes to scope, planning artifacts, or spec deltas
since cycle 1 — re-verified only the delta.
Issues: none.

### Phase 2: Code Review — PASS
Ran the project's `test` gate fresh (this repo has no `lint`/`format:check`
scripts and no `frontend/**`/`backend/**` dirs — only `test` applies):

- `bash test/scripts/tui-attached.test.sh` standalone: 10 passed, 0 failed.
- Full `npm test` (all suites, `node --test` + every `test/scripts/*.test.sh`):
  exit 0, no failures anywhere in the output.

Reviewed the new test file against `core/scripts/tui-attached.sh`:
- Isolation matches project convention (`new_repo()`/`ok`/`bad`/`check` mirrors
  `check-agent-merge-permission.test.sh`'s shape, per its own header comment);
  uses throwaway `mktemp -d` repos, never the checkout's own state.
- Scenarios 1–8 cover: live owned pid (attached), missing lockfile, dead pid,
  torn JSON, missing/non-numeric pid field, EPERM-owned-but-live pid 1 (the
  documented `pidAlive()` "exists, not ours" contract from design-gate CR4),
  non-git-repo target, and worktree-resolves-main-checkout's-lockfile (the
  load-bearing scenario `main_checkout()` exists for).
- Scenario 9 (mutation check, test/scripts/tui-attached.test.sh:139-158):
  `sed 's/process\.exit(e && e\.code === "EPERM" ? 0 : 1);/process.exit(0);/'`
  against `core/scripts/tui-attached.sh:106` — confirmed this literal string
  is byte-for-byte present in the source at that line
  (`grep -n process.exit core/scripts/tui-attached.sh` → line 106 matches
  exactly), so the sed substitution is real, not a silent no-op that would
  make the mutation check vacuously pass. The mutant is built to a
  `mktemp` file, chmod +x'd, run in isolation, and cleaned up — genuinely
  exercises red-before-green rather than asserting against the unmodified
  script.
- No dead code, no scope creep beyond the cycle-1 CR, `package.json`'s `test`
  script correctly appends `&& bash test/scripts/tui-attached.test.sh`.

Issues: none.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**`
(product) files changed — this change touches only `core/scripts/`,
`scripts/concertino/`, `test/scripts/`, `core/roles/orchestrator.md`, and its
own `openspec/changes/` planning dir. Not a helio UI change; no dev servers
applicable.

### Overall: PASS

### Non-blocking Suggestions
- none
