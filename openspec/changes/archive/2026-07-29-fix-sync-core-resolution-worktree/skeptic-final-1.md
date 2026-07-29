## Skeptic Report — final gate (round 1)

Commit verified: `92e64c1` (`bin/concertino`, `package.json`,
`test/scripts/sync-core-resolution.test.sh`, plus openspec artifacts).

### What I verified (with evidence)

1. **Central behavioral contract (no refusal, always renders, always exits
   0, note printed on divergence).**
   - Read `resolveCore` (`bin/concertino:173-207`) end to end: no
     `process.exit` calls anywhere in it, `coresDiffer`, `gitRun`,
     `gitTopLevel`, or `gitCommonDir` (grep of `process.exit` across the
     whole file shows 21 call sites, none inside lines 129-207).
   - Manual, independent reproduction (outside the test suite): built a
     throwaway main checkout + `git worktree add`, edited
     `core/scripts/start-servers.sh` in the worktree, ran
     `node <main>/bin/concertino sync --out=<worktree>`. Result: printed
     `note: rendering from <worktree>/core — differs from the executing
     script's own core at <main>/core`, exited `0`, and the rendered
     `scripts/concertino/start-servers.sh` contained my
     `MANUAL-DIVERGENCE-MARKER` edit. This is the ticket's literal AC,
     confirmed by my own hands, not the executor's or evaluator's claim.

2. **Two-part ancestry check.** Read `resolveCore` directly: Part 1
   (`repoToplevel = gitTopLevel(repo); if (!samePath(repoToplevel, repo))
   return path.join(repo, 'core')`) unconditionally short-circuits before
   Part 2 ever computes a common-dir. Falls back to `path.join(repo,
   'core')` on git failure, non-matching common-dir, or missing target
   core (lines 180, 204-206).
   - Independently reproduced the npm-nested-dependency false positive
     (not just re-running the shipped test): built a git-tracked
     `consumer/` with its own coincidental `core/scripts/start-servers.sh`
     (`echo CONSUMER-OWN-CORE`) and `node_modules/concertino` (copied
     bin/adapters/core/package.json, **no** `.git` of its own) nested
     inside it. Ran `node <consumer>/node_modules/concertino/bin/concertino
     sync --out=<consumer>`. Result: rendered script contains zero
     occurrences of `CONSUMER-OWN-CORE` — the consumer's own core is never
     touched, confirming Part 1 correctly rejects this topology.

3. **Decision 6 / task 1.4.** Read `cmdInit` directly
   (`bin/concertino:1477-1497`): `const core = resolveCore(REPO, out,
   args.core)` is called exactly once, then passed to both `copyAssets(out,
   core, false, true)` (line 1483) and `cmdSync({ _: ['sync'], config:
   cfgPath, out }, core)` (line 1497). `cmdSync`'s signature
   (`cmdSync(args, resolvedCore)`, line 1381) uses `resolvedCore ||
   resolveCore(...)` — so when called with a pre-resolved value it never
   re-resolves. No split provenance is possible. Confirmed by the shipped
   test 3.6b, which I re-ran independently and additionally reproduced by
   hand at the git-history level (see #6 below).

4. **Parameter threading completeness.** `grep -n '\bCORE\b' bin/concertino`
   returns zero matches — the bare module constant is fully gone.
   `readRoleFile(role, out, core)`, `emitClaude(c, out, core, dry)`,
   `emitCodex(c, out, core, dry)`, `copyAssets(out, core, dry,
   withScripts)`, `checkArtifacts(out, core, coreForced, harnesses, r)` all
   take `core` as an explicit parameter. Verified every call site: `cmdSync`
   (1388, 1393, 1395-1396), `cmdDoctor` (960-961), `cmdInit` (1482-1483,
   1497), `cmdEject` (766, 780, 792), `cmdDiff` (1024, 1040, 1056).
   `cmdUpdate` forwards `args` wholesale to a single `cmdSync(args)` call
   (1437), which resolves its own core once — no second core-reading call
   site inside `cmdUpdate` itself, so no split-provenance risk there.

5. **doctor reporting.** `checkArtifacts` (line 852) unconditionally prints
   `r.ok('core', core + (coreForced ? '(forced via --core)' : '(auto-detected)'))`
   before any comparison. Ran `node bin/concertino doctor` inside this
   worktree myself: output included
   `✓ core   .../CON-13/core  (auto-detected)`.

6. **Test suite.** Ran `npm test` myself: `423/423` node tests pass, all
   shell suites pass, including the new `sync-core-resolution.test.sh`
   (`35 passed, 0 failed`), overall exit `0`.
   - Non-tautology check: checked out the **pre-fix** `bin/concertino`
     (`git show fc14537:bin/concertino`, the commit immediately before this
     one) into a scratch dir alongside the current `core/`/`adapters/`, and
     ran the *current* `sync-core-resolution.test.sh` against it. Result:
     **10 of 35 assertions failed** — exactly the worktree-divergence
     (3.1), `--core` override (3.5), `init` (3.6/3.6b), and `eject` (3.7)
     scenarios — proving these tests exercise real behavior and would have
     caught this bug, not tautologies. The npm-nested-dependency case (3.4)
     correctly still passed against the old code too, since the pre-fix
     code always used the executing script's own core unconditionally,
     which happens to be right for that scenario by coincidence — expected
     and consistent with the ticket's framing that only the worktree case
     needed to change.

7. **Self-safety.** `git status` in the worktree shows only the expected
   `workflow-state.md` modification (orchestrator bookkeeping) and the new
   `evaluation-1.md`; no changes to `scripts/concertino/*` or `.claude/`.
   `scripts/concertino/*` here is git-tracked source (part of this repo's
   own checkout, not gitignored rendered artifacts — confirmed via
   `git ls-files scripts/concertino/`), so there is no rendered-vs-source
   drift to corrupt. `.concertino/laws` and `.claude/agents` are gitignored
   rendered artifacts that simply don't exist in this worktree (this
   worktree was never itself a `sync` target) — a pre-existing, unrelated
   condition, not new corruption from this change.

8. **Spec conformance / scope.** Re-read
   `specs/core-resolution/spec.md` requirement-by-requirement against the
   diff; every scenario traces to real code (verified above). `git diff
   main...HEAD --stat` outside `openspec/` touches exactly `bin/concertino`,
   `package.json`, and the new test file — matches the proposal's stated
   footprint, no scope creep. No `TODO`/`FIXME`/`TBD` introduced by the
   diff. `tasks.md`'s 16 items all trace to concrete diff hunks I read
   directly, not just the checkboxes.

### Verdict: CONFIRM

### Non-blocking notes

- `coresDiffer` only byte-compares `scripts/`, `laws/`, and
  `workflow-state.template.md`, not `roles/*.md` — so a worktree that has
  only edited a role template prints no divergence note even though it
  still (correctly) renders from its own core. This is faithful to
  design.md Decision 1 and task 1.1 as written, not a deviation — flagged
  only as a possible future follow-up, as the evaluator also noted.
