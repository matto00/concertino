## Evaluation Report — Cycle 2 (evaluation-2.md)

### Resumed review

Resumed from cycle 1 (`evaluation-1.md`). Ticket/proposal/design/tasks/spec
were not re-read (stable across cycles per the resumability contract).
Reviewed the new commit only: `a11b9ed "CON-111 Remove dead open-presets
case from controllers/presets.js"`, on top of `7d71715` (cycle 1's commit).

Cycle 1's single change request was: remove the dead, duplicate `case
'open-presets':` from `lib/ui/controllers/presets.js`'s `handle` (it
shadowed `lib/ui/controllers/settings.js:78`'s case and was unreachable via
the real `applyAction` dispatch, violating `controllers/index.js`'s own
"Action-type sets are disjoint across controllers" invariant), and update
the test that had been exercising that dead path.

### Phase 1: Spec Review — PASS

No change from cycle 1's PASS — this commit touches only
`lib/ui/controllers/presets.js` and its test, plus the standard
`files-modified.md`/`workflow-state.md` handoff bookkeeping; no
ticket/spec/AC-relevant behavior changed. Re-confirmed:
- `git show a11b9ed --stat`: `lib/ui/controllers/presets.js`,
  `test/controllers-presets.test.js`, `openspec/changes/launch-plan-presets/
  {evaluation-1.md,files-modified.md,workflow-state.md}` only — no scope
  creep, no unrelated files touched.
- `files-modified.md`'s new "Cycle 2 (evaluator change request 1)" section
  accurately describes the fix.

### Phase 2: Code Review — PASS

**Fix verified against cycle 1's change request:**
- `grep -n "'open-presets'" lib/ui/controllers/*.js` now shows the case only
  in `lib/ui/controllers/settings.js:78`; `lib/ui/controllers/presets.js`'s
  `handle` switch no longer has a `case 'open-presets':` at all (confirmed
  by reading the diff and the resulting file directly) — the duplicate/dead
  code cycle 1 flagged is gone.
- `presets.js`'s header comment was tightened to say `'open-presets'`
  "deliberately has NO case in this file's own `handle` switch below" and
  explains why, closing the gap between the code and
  `controllers/index.js`'s documented disjointness invariant.
- `test/controllers-presets.test.js` no longer exercises the removed dead
  path. It was replaced with two tests: `handle` returns `false` for
  `'open-presets'` (proving `presets.js` truly doesn't own it), and a new
  end-to-end test that dispatches through the *real*
  `controllers/index.js`'s `applyAction` (not a direct `presetsCtl.handle()`
  call) confirming `settings.js`'s case is the one that actually opens the
  PRESETS screen in production — this is a strictly better test than the one
  it replaced, since it now proves the real dispatch path works, not just
  that the (now-removed) shortcut did.

**Gates (fresh run, this evaluation, in `WORKTREE_PATH`; `CLEAN_WORKTREE`
not set):** `npm test` — exit code 0, `node --test` summary `# pass 1843` /
`# fail 0` (one more passing assertion than cycle 1, from the new
disjointness test), full shell-script test suites also passed, no `not ok`
lines anywhere in the output.

No new issues found on re-review of the changed files. Everything else
reviewed and passed in cycle 1 (DRY, readability, modularity, type safety,
security, error handling, meaningful tests, no dead code elsewhere, no
over-engineering, behavior-preserving refactor) is unaffected by this
narrowly-scoped fix.

### Phase 3: UI Review — N/A

Per orchestrator instructions, this project has no UI review configured;
Phase 3 is skipped, no dev servers were started.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

None.
