## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Detail:
- All four ticket ACs addressed explicitly, no reinterpretation:
  1. `doctor`/`validate` warn on `agentMerge.enabled: true` with no matching
     grant — `lib/config.js`'s new "Agent-merge" section in
     `collectConfigIssues` and `lib/cli/doctor.js`'s `checkAgentMerge`, both
     via the shared `checkAgentMergePermission` helper, naming the specific
     missing rule(s) and pointing at `concertino sync`.
  2. Orchestrator asks before spawning, not after a denial —
     `{{block:agentMergePermissionCheck}}` inserted immediately before the
     auditor spawn in `core/roles/orchestrator.md` Phase 3 step 7, rendered
     via `lib/cli/render.js`'s new `case 'agentMergePermissionCheck':`, with
     `PASS`→spawn / `FAIL`→escalate (`options=retry,fallback`) exactly as
     designed.
  3. Docs state the two-part opt-in plainly — new `## agentMerge` section in
     `docs/config-reference.md` and a trailing pointer added to `README.md`'s
     existing one-liner.
  4. `AGENT_MERGE = false` fallback unchanged — confirmed via diff:
     `core/roles/orchestrator.md`'s false branch is untouched; the fallback
     option in the new escalation explicitly lands on that identical path
     (spec.md's "A permission-grant fallback lands on the identical flow"
     scenario).
- All 19 `tasks.md` items marked `[x]`; each maps to a concrete diff hunk
  (verified individually — shared-rule source, check script + tests, `sync`
  merge + tests, doctor/validate section + tests, orchestrator block, docs,
  full-suite run).
- No scope creep: `git diff main...HEAD --stat` (excluding the change dir
  itself) touches exactly the files `proposal.md`'s "Impact" section and
  `files-modified.md` predicted — `lib/config.js`, `lib/cli/{doctor,emit,
  render}.js`, `core/roles/orchestrator.md`, the new check script (core +
  project copy), docs, `package.json`, and the new/updated tests. Nothing
  else.
- No regressions to existing behavior: `AGENT_MERGE = false` path, the
  auditor role, and `check-merge-readiness.sh` are untouched (confirmed by
  diff — none of those files appear in the changed-file list).
`test/validate.test.js`'s new test explicitly re-confirms the pre-existing
  byte-identical-output contract for `agentMerge.enabled: false` (task 3.3).
- Spec deltas (`specs/agent-merge/spec.md`) match the final implementation
  precisely — verified requirement-by-requirement against the diff (rule
  strings, main-checkout resolution, PASS/FAIL wording, doctor/validate
  gating, orchestrator escalation shape, fallback preservation). The design
  doc's two design-gate-round corrections (main-checkout resolution via
  `check-merge-readiness.sh`'s exact `main_checkout()` helper; sync-time
  `{{block:...}}` gating instead of a nonexistent runtime `harness` field in
  `workflow-state.md`) are both reflected correctly in the shipped code —
  `check-agent-merge-permission.sh`'s `main_checkout()` is byte-identical in
  shape to `check-merge-readiness.sh`'s, and `render.js`'s new case follows
  the existing `harnessResume` sync-time-block pattern exactly.
- No API/schema changes needed beyond what the spec called for (no new
  `concertino.config.json` schema field — `agentMerge` already existed).

### Phase 2: Code Review — PASS

Issues: none.

Gate run (fresh, in `WORKTREE_PATH`; no `CLEAN_WORKTREE` for this
speed/cycle):
```
npm test
```
Result: exit 0. `node --test`: 1568 passed, 0 failed. All 25 `test/scripts/
*.test.sh` suites passed, including the two new ones:
- `check-agent-merge-permission.sh (CON-88 ...)`: 16/16 passed (both-present,
  one-missing, both-missing, settings-missing, invalid-JSON,
  main-checkout-unresolvable, and the load-bearing worktree-vs-main-checkout
  case).
- `agent-merge permission grant rendering (CON-88 ...)`: 19/19 passed (sync
  create/preserve/no-op-when-disabled/append-only-survives-disable,
  doctor/validate warn-vs-silent).

No canonical code-quality standard is configured for this project beyond
the tests themselves, so review focused on DRY/readability/modularity/type-
safety/security/error-handling/dead-code/over-engineering by direct
inspection:

- **DRY**: The two required rule strings live in exactly one JS source of
  truth (`lib/config.js`'s `agentMergePermissionRules()`), consumed by both
  the writer (`emit.js`'s `mergeAgentMergeSettings`) and the checker
  (`checkAgentMergePermission`, used by both `collectConfigIssues` and
  `doctor.js`). The shell script's necessary duplication (no Node/shell
  shared runtime elsewhere in this suite either) is cross-referenced by
  comment in all three places, matching the codebase's existing
  `budgets`-defaults precedent design.md cites.
  `checkAgentMergePermission` itself is shared between `collectConfigIssues`
  and `doctor.js`'s `checkAgentMerge` rather than being re-derived in each —
  exactly the "one script, one contract, two callers" shape Decision 2 calls
  for.
- **Readable**: naming is clear and self-documenting throughout
  (`agentMergePermissionRules`, `checkAgentMergePermission`,
  `mergeAgentMergeSettings`, `checkAgentMerge`); no magic values — the rule
  strings are named constants/return values, not inlined at each use site.
- **Modular**: each new function has one job (compute rules / check grant /
  merge settings / render doctor section / render orchestrator prose); the
  orchestrator's harness-conditional prose is isolated behind the existing
  `block()` dispatch rather than inlined as new `if` branches in the role
  file itself.
- **Type safety**: N/A (untyped JS codebase, consistent with the rest of the
  project); defensive guards are present at every JSON-boundary read
  (`typeof settings !== 'object'` guard in `emit.js`, try/catch around
  `JSON.parse` treated as `{}`, `Array.isArray` guards on `harnesses`/
  `permissions.allow`).
- **Security**: `checkAgentMergePermission` uses `execFileSync` (not
  `exec`/string interpolation into a shell) with an argument array — no
  injection surface from `out`. The shell script quotes `$WORKTREE_PATH`
  and `$SETTINGS` consistently.
- **Error handling**: no silent failures — a malformed pre-existing
  `.claude/settings.json` degrades to `{}` rather than crashing `sync`
  (matches doctor's existing degrade-safely posture cited in the design); the
  check script fails closed (never a silent PASS) on every unresolvable
  state (missing file, invalid JSON, unresolvable main checkout), matching
  `check-merge-readiness.sh`'s existing fail-closed convention.
- **Tests meaningful**: new tests exercise the actual code paths added, not
  just the happy path — one-rule-missing, both-missing, missing file,
  invalid JSON, unresolvable main checkout, and the worktree-vs-main-checkout
  distinction that is the entire reason this script exists; the render tests
  cover create/preserve/disabled-no-op/append-only-on-disable plus
  doctor/validate silent-vs-warning transitions in both directions. These
  would catch a real regression (e.g. reverting to checking
  `$WORKTREE_PATH/.claude/settings.json` directly would fail test 7.2/7.3).
- **No dead code**: no leftover TODO/FIXME/commented-out code in the diff;
  all new exports (`agentMergePermissionRules`, `checkAgentMergePermission`)
  are actually consumed by at least one call site.
- **No over-engineering**: no premature abstraction — a single pure function
  plus a single shared checker, matching the minimal shape design.md
  specifies; no new persisted state, no new config schema field, no
  speculative generality (e.g. no attempt to generalize this to
  Codex/OpenCode, correctly deferred per design.md's Non-Goals).
- **Behavior-preserving where expected**: the `AGENT_MERGE = false` path and
  every existing doctor/validate section are byte-for-byte unchanged
  (verified both by diff and by `test/validate.test.js`'s new regression
  test). No drive-by behavior changes detected anywhere in the diff.

### Phase 3: UI Review — N/A

This change is config/CLI/orchestrator-prose/shell-script only; no UI
surface. Dev-server steps skipped per the task framing.

### Overall: PASS

### Non-blocking Suggestions

- `emit.js`'s `mergeAgentMergeSettings` appends newly-added rules in
  iteration order rather than sorting the final `permissions.allow` array,
  while design.md Decision 4's prose says "the (sorted, deduplicated)
  required entries." This is a cosmetic mismatch between the design doc's
  wording and the implementation, not a spec violation — no scenario in
  `specs/agent-merge/spec.md` requires a specific array order, only that
  both rules be present — and every render test that checks ordering-
  independent membership (`grep -qF`) passes regardless. Not worth a change
  request, but a one-line design.md wording fix (or an `Array.prototype.sort`
  call before writing) would make the two agree if this surfaces again in a
  future change touching the same code.
