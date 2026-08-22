## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed: GIT_* strip at every HEL-805 call site (assert-phase.sh 7 sites,
  cleanup.sh 12 sites, setup-worktree.sh 8 sites, start-servers.sh 1 site), `git-child-env.sh`
  helper + `git-child-env.selftest.sh` both ported into `core/scripts/lib/`, `nohup` env-prefix
  fix confirmed already present in core (verified — `1e3c293` predates this cycle), render+diff
  acceptance test independently re-run against a fresh render (see Phase 2), red-before-green
  demonstrated by the selftest's own real-file assertion (independently confirmed — see Phase 2),
  CON-128/131/132 scope untouched.
- No AC reinterpreted. The `cleanup.sh` sync guard was correctly built as the env-gated
  `CONCERTINO_CLEANUP_SKIP_SYNC` form per design.md Decision 5, not a byte-identical port of
  helio's hardcoded `if true`/CON-128 local hack — this is the ticket's own explicit instruction
  ("decide and port the correct upstream form... do not fix CON-131's separate defect here"),
  not scope creep.
- All 25 tasks.md items marked `[x]`, and each matches what's actually in the diff (verified by
  reading the corresponding code, not just trusting the checkbox).
- No scope creep: the two test-fixture edits (`test/scripts/harness-identity.test.sh`,
  `test/scripts/cleanup.test.sh`) are legitimate — they stage `lib/git-child-env.sh` into their
  isolated fixture dirs because `setup-worktree.sh`/`cleanup.sh` now `source` it; without the
  fixture fix those tests would fail on the new `source` line. Confirmed both tests still pass
  (Phase 2 gate run).
- No regressions to existing behavior: `git`→`git_child` substitutions preserve every existing
  `return 0`/exit-code branch verbatim (diffed line-by-line in cleanup.sh's `attempt_fast_forward`
  and elsewhere — only the invocation target changed, no control-flow edited).
- No API/schema changes — out of scope for this change.
- Planning artifacts (design.md, spec deltas, tasks.md) accurately reflect the final
  implementation; no drift found between design.md's decisions and the diff.

### Phase 2: Code Review — PASS
Issues: none.

Ran `npm test` fresh (not trusting the executor's report): full suite passed, 0 failures across
all `node --test` unit tests and all `test/scripts/*.test.sh` integration tests, including the
two touched fixtures (`harness-identity.test.sh`, `cleanup.test.sh`).

Ran `bash core/scripts/lib/git-child-env.selftest.sh` directly: `ALL PASS`, including the
dual-arm non-vacuous poisoning check, all four call-site exercises, the static wiring check
(no bare `git` remains in the four scripts), and — critically — the real-file assertion against
`setup-worktree.sh`'s actual hook-eval line (not an inline copy).

Independently re-ran the render+diff acceptance test (task 7) from scratch:
- `node bin/concertino sync --out=<tmpdir> --config=config/examples/helio.json` succeeded and
  produced `scripts/concertino/lib/git-child-env.sh` and `.selftest.sh`, both `0o755`.
- `diff -rq` against `/home/matt/Development/helio/scripts/concertino/` showed differences only
  in: `cleanup.sh` (expected — env-gated guard vs. helio's hardcoded CON-128 local hack, per
  Decision 5), `.concertino.env`/`speeds.json` (expected — project-specific config values), and
  cosmetic ticket-reference wording in `git-child-env.sh`/`.selftest.sh` comments (`HEL-657`/
  `HEL-805` → generic "ported by CON-133"/"see this file's selftest"). `setup-worktree.sh`'s
  hook-eval line diff was a single comment-line rewording only (`See HEL-805` → `See
  core/scripts/lib/git-child-env.sh`) — the actual code line is byte-identical to helio's.
  Zero loss of any of the four fixes confirmed independently.

Verified the hook-eval line verbatim match against helio's ground truth
(`/home/matt/Development/helio/scripts/concertino/setup-worktree.sh`) — byte-identical:
`( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true`

Verified `git_child()` in `core/scripts/lib/git-child-env.sh` is byte-identical in logic to
helio's (comments genericized only, function body untouched):
```
git_child() (
  unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true
  exec git "$@"
)
```

Confirmed no bare `git` invocations remain in any of the four touched scripts (grep hits were
only string literals in error-message text, not code).

Confirmed the three `listFilesRecursive` engine call sites (`emit.js` copyAssets, `doctor.js`
checkArtifacts, `resolve-core.js` coresDiffer) are all wired, with `resolve-core.js` correctly
special-cased to avoid `fileDiffers`'s unguarded `EISDIR` (per design.md Decision 6).

Confirmed CON-128/131/132 scope untouched: no version-stamping, no cleanup.sh exit-code
semantics change (every `return 0` branch preserved verbatim), no commit-gate-chain change.

CONTRIBUTING.md's core-vs-rendered discipline (never hand-edit a rendered file) was correctly
respected — only `core/scripts/` templates were touched; this repo's own `scripts/concertino/`
was left alone (no `concertino.config.json` present in this worktree to self-render against
regardless).

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` files changed by this diff.

### Overall: PASS

### Non-blocking Suggestions
- None.
