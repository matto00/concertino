## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of HEAD `6afa0b0` against `main`. Every finding below is derived from the
committed diff, the shipped files, and commands I ran myself — not from
`evaluation-1.md` or `files-modified.md`.

### What I verified (with evidence)

**1. The verbatim hook-eval line, subshell included (design CR2, rounds 2-3).**
`core/scripts/setup-worktree.sh:357` (read from the committed file, not the diff summary):

```
    ( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true
```

Byte-identical to helio ground truth `scripts/concertino/setup-worktree.sh:357` — `|| exit 0`
(not `&&`), `;`-separated, and the enclosing `( ... ) || true` present. The rendered copy in my
throwaway render matched too (the only delta in that whole file was a comment: `See HEL-805.` ->
`See core/scripts/lib/git-child-env.sh.`).

**2. No bare git in the four touched scripts.** Grepped each file for git invocations excluding
`git_child`: assert-phase.sh 3 hits, all inside comments/error strings (l.110 `"worktree not a git
work tree"`, l.144/146 prose); cleanup.sh, setup-worktree.sh, start-servers.sh: zero.
`git_child` occurrence counts are 7 / 12 / 8 / 1 — exactly matching helio's HEL-805 counts.
Each of the four sources `"${SCRIPT_DIR}/lib/git-child-env.sh"`.

**3. Helper is a prefix strip, not a denylist.** `core/scripts/lib/git-child-env.sh:33-36`:
`git_child() ( unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true; exec git "$@" )` —
subshell form, `compgen -v GIT_` prefix strip. `diff` against helio's helper: comment-only deltas
(de-helio-ising HEL-657/HEL-805 references). Function body identical.

**4. The selftest asserts against the REAL shipped files, and ALL PASS in place.**
Ran `bash core/scripts/lib/git-child-env.selftest.sh` from the worktree: **ALL PASS** (13 PASS
lines, exit 0). Read l.215-248: the static-wiring block greps `${CONCERTINO_DIR}/${f}` for the
real four scripts, and the hook-line block does `grep -F 'eval "$hook"' "$SETUP_WORKTREE"` then
asserts the `cd ... || exit 0;.*unset -v $(compgen -v GIT_.*;.*eval "$hook"` ordering against that
real line — not an inline copy. `CONCERTINO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"` so it is
relocatable; I also ran the **rendered** copy at
`/tmp/tmp.I3s8PlqmHG/scripts/concertino/lib/git-child-env.selftest.sh` — ALL PASS there too.

**5. Red-before-green, demonstrated by me, in throwaway `mktemp -d` copies (never a live repo).**
- RED1: reverted only the real `setup-worktree.sh` hook line to
  `( cd "$WORKTREE_PATH" && unset ... || true; eval ... ) || true`, selftest untouched ->
  `FAIL: setup-worktree.sh's real CONCERTINO_WORKTREE_HOOKS eval line does NOT match the fixed
  sequencing`, `1 FAILURE(S)`, exit 1. This is precisely the vacuity mode helio's skeptic caught;
  it is genuinely closed.
- RED2: `sed 's/git_child /git /g' cleanup.sh` -> `FAIL: cleanup.sh still contains a bare
  (unwrapped) git invocation`, exit 1.
- RED3: neutered the strip inside the helper itself -> 3 FAILs (target repo not reached, poisoned
  repo leaked onto, cwd-based resolution wrong), exit 1. The dual-arm simulation is non-vacuous:
  the bare-git control arm is asserted to *be* misdirected.

**6. Independent render + diff against helio (AC1-AC4).**
`node bin/concertino sync --config=/home/matt/Development/helio/concertino.config.json
--out=$(mktemp -d) --core=<worktree>/core`, then `diff -r <out>/scripts/concertino
/home/matt/Development/helio/scripts/concertino`. Result — **zero loss of any of the four fixes**:
- `lib/git-child-env.sh` and `lib/git-child-env.selftest.sh` are both rendered (comment-only diffs).
- `assert-phase.sh` and `start-servers.sh` are **byte-identical** to helio (so the `git_child` strip
  at every call site *and* the `nohup env` fix both survive a render).
- `setup-worktree.sh`: single comment-line delta; the hook line and all 8 `git_child` sites survive.
- `cleanup.sh`: the only substantive delta, and it is the *intended* design Decision 5 change —
  helio's hardcoded `if true; then ... DISABLED in this checkout (CON-128 ...)` replaced by the
  off-by-default `CONCERTINO_CLEANUP_SKIP_SYNC` guard (`core/scripts/cleanup.sh:250-269`), with a
  defined truthy rule (`1|true|TRUE|True|yes|YES`; everything else, including `0`/`false`/empty,
  is falsy — closing design round-3 note 3). The `elif other_runs_live` branch is live again, not
  dead. Rendering was done into a `mktemp -d`, never into a real repo.
- No only-in-A / only-in-B entries anywhere.

**7. `listFilesRecursive` doesn't regress flat behavior.** Read the implementation
(`lib/cli/shared.js:81-107`): `withFileTypes`, try/catch -> `[]` on a missing dir, POSIX-relative
paths, files-only. Three call sites wired: `emit.js:426` (`copyAssets`), `doctor.js:43`
(`checkArtifacts`), `resolve-core.js:58-70` (`coresDiffer`, `scripts` only; `laws`/`roles`
deliberately left on flat `readDirSafe` with an in-code rationale) — i.e. all three sites the
design gate identified, and my own `grep -rn "readdirSync\|'scripts'" lib/ bin/` found no fourth.
Evidence it works: `concertino doctor --out=<rendered> --core=<worktree>/core` reports
`✓ copied assets  24 files match core` (nested `lib/` included, no EISDIR); rendered `lib/*.sh`
are mode 755, so the `chmodSync` on nested destinations works.

**8. Project test suite green (I ran it, full output captured).**
`npm test` -> **exit 0**. `node --test`: `# pass 2230 / # fail 0`. All 31 shell suites report
`N passed, 0 failed`, including the two directly relevant guards `doctor-artifacts.test.sh` and
`sync-core-resolution.test.sh`.

**9. The two test-fixture edits are minimal, necessary and non-weakening.**
`test/scripts/harness-identity.test.sh:95-96` and `test/scripts/cleanup.test.sh:64,67` each add a
`mkdir -p .../lib` + `cp core/scripts/lib/git-child-env.sh` into the fixture. That is required
because the scripts under test now `source` the helper; without it the fixtures would fail to
start. No assertion, filter, or expectation was removed or loosened — the diff is purely additive
(3 added lines, 1 changed `mkdir -p` path). This is fixture maintenance, not scope creep, and not
a weakening.

**10. Scope (AC6).** Non-openspec files touched: the 4 core scripts + 2 new lib files, the 4
engine files, the 2 test fixtures. Nothing else. No version-stamping (CON-128), no change to
cleanup.sh's exit-code-on-git-failure behavior (CON-131 — the guard port left exit semantics
untouched), no commit-gate-chain files (CON-132).

**No UI surface.** This change is CLI/shell only; no frontend files, no design-standard
applicability, so servers were not started and the visual-judgment section does not apply.

### Verdict: CONFIRM

Every acceptance criterion traces to evidence I produced myself, all three design-gate
change requests are correctly implemented in the shipped code (not merely in the artifacts),
the regression test is demonstrably non-vacuous against the real files, and a fresh render
loses none of the four fixes. Ships.

### Non-blocking notes

1. **The selftest is not wired into `npm test`.** `package.json:24`'s `test:selftest` is an
   unrelated dry-run sync, and the `test` script chain does not invoke
   `core/scripts/lib/git-child-env.selftest.sh`. It passes when run manually (verified above), but
   nothing in CI runs it, so a future regression in `core/scripts/*.sh` would go uncaught by the
   project's own suite — exactly the "fix ships without its guard" shape this ticket exists to
   prevent. Adding `bash core/scripts/lib/git-child-env.selftest.sh` to the `test` chain is a
   one-line follow-up. (Not an AC; AC5 only required the red demonstration, which is satisfied.)
2. **The selftest's hook-line assertion does not check the enclosing `( ... ) || true` subshell.**
   It greps the line containing `eval "$hook"` for the `cd || exit 0` / `unset` / `eval` ordering;
   a regression that dropped only the surrounding subshell would still pass. The design gate
   established that subshell as load-bearing. Tightening the grep to require a leading `( ` and
   trailing `) || true` would close it.
3. **Downstream note for helio:** once this merges and helio syncs, helio's currently-hardcoded
   sync disable becomes the off-by-default env guard, so helio must set
   `CONCERTINO_CLEANUP_SKIP_SYNC=1` in its cleanup invocation environment if it still wants the
   automatic re-render suppressed. Also note `cleanup.sh` sources `.concertino.env`, which
   `renderEnv` regenerates on every sync — so a hand-edit there is not a durable place to set it
   (design round-3 note 2 flagged this; plumbing it through `concertino.config.json` remains a
   worthwhile spinoff).
4. Other `core/scripts/*.sh` (`emit-event.sh`, `persist-evidence.sh`, `triage-followup.sh`,
   `check-merge-readiness.sh`, `set-ticket-state.sh`, `report-cost.sh`,
   `check-agent-merge-permission.sh`) still make bare `git` calls. That matches HEL-805's scope
   exactly and is correctly out of scope here, but now that the helper ships in `core/scripts/lib/`
   a follow-up sweep is cheap.
