## 1. Shared rule source + check script

- [x] 1.1 Add `agentMergePermissionRules()` to `lib/config.js` (exported),
      returning `['Bash(gh pr merge:*)', 'Task(concertino-auditor)']`, with a
      comment cross-referencing the shell script (1.2) as the other place
      that must stay in sync.
- [x] 1.2 Add `scripts/concertino/check-agent-merge-permission.sh
      <WORKTREE_PATH>`: duplicates `check-merge-readiness.sh`'s
      `main_checkout()` helper (`git rev-parse --git-common-dir` from
      `$WORKTREE_PATH`) to resolve the **main checkout**, then reads
      `<main_checkout>/.claude/settings.json` via `jq`; `PASS`+exit 0 when
      both required rule strings are present in `permissions.allow`;
      otherwise `FAIL <reason>` per missing rule (or "no .claude/settings.json
      found" / "could not resolve main checkout" / a JSON-parse-failure
      reason) to stderr, non-zero exit. Same stdout/stderr contract as
      `check-merge-readiness.sh`. **Never** reads `$WORKTREE_PATH/.claude/settings.json`
      directly — worktrees don't have one (gitignored, not copied by
      `setup-worktree.sh`). Comment cross-referencing 1.1.
- [x] 1.3 `scripts/concertino/.gitignore`/packaging: confirm the new script
      ships the same way `check-merge-readiness.sh` already does (core →
      copyAssets → project `scripts/concertino/`); no separate change needed
      if it's picked up by the existing directory-wide copy, but verify.
- [x] 1.4 Shell tests: `test/scripts/check-agent-merge-permission.test.sh` —
      both rules present (PASS), one missing (FAIL naming it), file missing
      (FAIL), invalid JSON (FAIL), **and invoked with a real worktree path
      (`git worktree add`) whose main checkout's `.claude/settings.json`
      carries the grant — confirms the check passes from a worktree even
      though the worktree itself has no `.claude/` directory** — mirror
      `check-merge-readiness.test.sh`'s `ok/bad/check/has` helpers, its own
      `new_repo`-style throwaway-repo isolation, and its worktree-from-repo
      test setup pattern.
- [x] 1.5 Add the new test script to `package.json`'s `test` script chain,
      alongside the other `test/scripts/*.test.sh` entries.

## 2. `concertino sync` maintains the grant

- [x] 2.1 In `lib/cli/emit.js`'s `emitClaude`, when `c.agentMerge.enabled` is
      `true`: read `<out>/.claude/settings.json` if present (tolerate
      missing/unparseable → treat as `{}`), merge `agentMergePermissionRules()`
      into `permissions.allow` (dedup, preserve every other key/entry), write
      back pretty-printed JSON via the existing `write()` helper (respecting
      `dry`). No-op entirely when `agentMerge.enabled` is `false` — never
      read or write the file in that case.
- [x] 2.2 Shell test: `test/scripts/agent-merge-permission-render.test.sh` (or
      fold into `auditor-render.test.sh` as new cases) — sync with
      `agentMerge.enabled: true` + `claude-code` creates
      `.claude/settings.json` with both rules; sync against an existing
      hand-authored settings.json preserves its other keys/entries and adds
      only the missing rules; sync with `agentMerge.enabled: false` never
      touches an existing settings.json (byte-identical before/after); a
      prior grant survives a later sync with `agentMerge.enabled: false`.

## 3. doctor / validate: Agent-merge section

- [x] 3.1 In `lib/config.js`'s `collectConfigIssues`, add a new "Agent-merge"
      section (after "Providers"): no-op unless `cfg.agentMerge.enabled` is
      `true` and `claude-code` is in `cfg.harnesses`; otherwise shell out to
      `check-agent-merge-permission.sh` against `opts.out`, `ok(...)` on
      `PASS`, `warn(...)` naming the missing rule(s) plus "run `concertino
      sync` to add the missing grant" on `FAIL`.
- [x] 3.2 Unit tests in `test/config.test.js`: enabled+claude-code+grant
      present → no warning; enabled+claude-code+grant missing → warning
      naming the rule; enabled+claude-code+no settings.json → warning;
      disabled → section silent; claude-code absent from harnesses →
      section silent.
- [x] 3.3 Confirm `concertino validate`'s existing byte-identical-output
      contract (test/validate.test.js) still holds for a config with
      `agentMerge.enabled: false` (the default) — this section must add
      nothing to that output.

## 4. Orchestrator pre-check before the auditor spawn

- [x] 4.1 Update `core/roles/orchestrator.md` Phase 3 step 7's
      `AGENT_MERGE = true` branch: insert a new `{{block:agentMergePermissionCheck}}`
      placeholder immediately before the existing auditor spawn — **not** a
      runtime `workflow-state.md` harness lookup (no such field exists; see
      Decision 3's design-gate-round-1 correction). Add the `agentMergePermissionCheck`
      case to `lib/cli/render.js`'s `block(name, c, harness)` function
      (alongside the existing `harnessResume` case): for `harness ===
      'claude-code'`, return prose instructing the orchestrator to run
      `scripts/concertino/check-agent-merge-permission.sh "$WORKTREE_PATH"`
      before spawning — `PASS` → proceed to spawn exactly as today; `FAIL` →
      do not attempt the spawn, raise one escalation (per "How to raise
      one", `kind=blocker`) naming the missing rule(s) verbatim,
      `options=retry,fallback`. For `codex`/`opencode`, return a one-line
      note that this step is N/A on this harness and the auditor spawn
      proceeds unconditionally.
- [x] 4.2 Document the `retry` branch: re-run the check; on `PASS`, proceed to
      spawn the auditor; on `FAIL` again, re-raise (does not count against
      any existing budget — this is a one-off permission-state check, not a
      REFUTE/FAIL loop).
- [x] 4.3 Document the `fallback` branch: proceed exactly as the existing
      `AGENT_MERGE = false` path — present the PR, wait for a human "merged"
      confirmation, no auditor spawn this run.
- [x] 4.4 Update the "Escalation & Circuit Breakers" table/prose if needed so
      this new escalation point is named consistently with the existing
      auditor `ESCALATE`/`BLOCKER` row (it is a distinct, earlier check, not
      a modification of that row).

## 5. Specs / docs

- [x] 5.1 (already drafted — verify against final implementation)
      `openspec/changes/agent-merge-permission-preflight/specs/agent-merge/spec.md`
      matches what actually shipped; adjust scenarios if implementation
      details changed during execution.
- [x] 5.2 `docs/config-reference.md`: new `## agentMerge` section (after
      `## budgets`, before `## providers`) stating the two-part opt-in
      explicitly — the config default/override, and the
      `.claude/settings.json` grant `concertino sync` now maintains for
      Claude Code — and that (1) alone never authorizes a merge under auto
      mode.
- [x] 5.3 `README.md` line ~33 (agent-merge one-liner): add a trailing
      pointer to the new config-reference section.

## 6. End-to-end sanity

- [x] 6.1 Run the full existing test suite (`npm test`) — no regressions in
      `auditor-render.test.sh`, `config.test.js`, `validate.test.js`,
      `doctor-artifacts.test.sh`.
- [x] 6.2 Manually trace: `concertino init` (or hand-edit) → `agentMerge.enabled:
      true` → `concertino sync` → `.claude/settings.json` gains both rules →
      `concertino doctor` reports success → flip `agentMerge.enabled` back to
      `false` → `concertino sync` again → settings.json unchanged (rules still
      present, doctor silent since the section itself is now gated off).
