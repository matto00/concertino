## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 CR1 — engine change (EISDIR).** Read `lib/cli/emit.js:425-430` (`copyAssets`, flat
`fs.readdirSync(path.join(core,'scripts'))` + `copy()` -> `fs.copyFileSync`) and
`lib/cli/doctor.js:42-43` (`checkArtifacts`, flat `readdirSync` + `fs.readFileSync(src).equals(...)`).
Reproduced in a `mktemp -d` copy of `core/` with an added `core/scripts/lib/foo.sh`:
`EMIT ERR: EISDIR ... copyfile .../core/scripts/lib` and `DOCTOR-READ ERR: EISDIR`. The EISDIR
claim in design Decision 6 is TRUE, and `listFilesRecursive` in `lib/cli/shared.js` (which already
owns `copy`/`read`/`exists`) is the right, minimal home for it. **Addressed** — but see CR1 below:
the enumeration is not confined to those two sites.

**Round-1 CR2 — red-before-green ordering.** `tasks.md` 6.1 now explicitly requires 4.1 (the
real-file assertion) implemented and committed to the throwaway copy BEFORE the 6.2 red
demonstration, and names the vacuity failure mode. **Addressed.**

**Round-1 CR3 — cleanup sync guard.** Read helio's `scripts/concertino/cleanup.sh:251-273`:
`if true; then echo "... DISABLED in this checkout (CON-128 ...)"; elif ...` — design Decision 5's
characterisation is accurate, including the dead `elif`. The artifacts now specify an env-gated
`CONCERTINO_CLEANUP_SKIP_SYNC` (default unset = sync runs), carved into its own
`specs/cleanup-sync-guard/spec.md`, with `proposal.md`'s Capabilities updated. Confirmed
`core/scripts/cleanup.sh:250-269` really does contain the automatic-sync block the guard anchors
to. **Addressed.**

**Fresh re-verification of everything else.**
- Call-site counts in `tasks.md` 3.1-3.4 match helio ground truth exactly: `git_child` occurrences
  are assert-phase.sh 7, cleanup.sh 12, setup-worktree.sh 8, start-servers.sh 1, each with one
  `source .../lib/git-child-env.sh`, and zero bare `git` invocations remaining.
- Helper content: helio's `lib/git-child-env.sh` is `git_child() ( unset -v $(compgen -v GIT_ ...)
  ...; exec git "$@" )` — prefix strip in a `()` subshell, matching Decisions 1 and 2.
- `nohup` fix: `core/scripts/start-servers.sh:82` already has
  `eval "nohup env $cmd >\"$log\" 2>&1 & disown"`, identical to helio's line 84. The ticket's and
  proposal's "already landed in core" claim is TRUE.
- Templating risk: `grep -rln '{{' core/scripts/` returns only `check-agent-merge-permission.sh`
  — none of the four files this change touches. Design's blanket "core/scripts/*.sh are verbatim
  (non-templated)" is very slightly overstated; harmless here (non-blocking note).
- Scope: no artifact touches CON-128/131/132 work.

### Verdict: REFUTE

Two defects found on fresh re-verification (both new, neither a round-1 item).

### Change Requests

1. **The recursive-enumeration change misses a third `core/scripts/` flat-enumeration site, which
   will throw `EISDIR` in exactly the environment concertino is developed in.**
   `lib/cli/resolve-core.js:51-65` (`coresDiffer`) flat-enumerates `['scripts','laws','roles']` and
   calls `fileDiffers`, whose `fs.readFileSync(a).equals(...)` is *not* wrapped in the `try/catch`
   that `readDirSafe` has. Once `core/scripts/lib/` exists in two cores being compared, this throws
   uncaught. Reproduced with two synthetic cores each containing `scripts/lib/git-child-env.sh`:
   `CORESDIFFER ERR: EISDIR illegal operation on a directory, read`. `coresDiffer` is reached from
   `resolveCore` (`resolve-core.js:88`) whenever `out` is a *different worktree of the same repo*
   that has its own `core/` — i.e. every `concertino sync`/`doctor` run from a concertino worktree
   like this one, on any `sync` after this change lands in both cores. (Note the transitional case
   masks it: while only one core has `lib/`, `exists(a) !== exists(b)` short-circuits to `true`
   without reading — so this will surface only *after* merge, not during this ticket's own render
   test.) Required: extend design Decision 6, `tasks.md` section 1, and the
   `specs/git-child-env-hardening/spec.md` requirement "core/scripts/ renders and drift-checks a
   nested lib/ directory" to cover `resolve-core.js`'s `coresDiffer` as a third call site of
   `listFilesRecursive` (or otherwise make `fileDiffers` directory-safe), with an explicit
   verification step that a `sync`/`doctor` run from a sibling worktree whose `core/` also contains
   `scripts/lib/` does not throw.

2. **The prescribed `setup-worktree.sh` hook-eval form drops the enclosing `( ... ) || true`
   subshell, which is what makes `exit 0` mean "skip this hook".** helio's real, shipped line
   (`scripts/concertino/setup-worktree.sh:357`) is:
   `( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true`
   Every artifact instead prescribes three bare top-level lines
   (`ticket.md` Mechanism, `proposal.md` bullet 3, `design.md` Decision 3, `tasks.md` 3.3,
   `specs/git-child-env-hardening/spec.md` "setup-worktree.sh hook-eval sequencing"), and none
   mentions the subshell. Taken literally that is a real regression: outside a subshell,
   `cd "$WORKTREE_PATH" || exit 0` **terminates setup-worktree.sh entirely** on a failed `cd`
   (skipping the `run.start` emit and the `READY worktree=` line the orchestrator parses), a
   successful `cd` leaves the *caller* inside the worktree for the remainder of the script, and the
   `unset` permanently strips `GIT_*` from the calling shell — contradicting design Decision 2's own
   no-leak rationale. It also makes the spec scenario "the hook is skipped entirely" (implying the
   loop continues to the next hook) unsatisfiable. Required: state the `( ... ) || true` subshell
   wrapper explicitly in design Decision 3, `tasks.md` 3.3 and the spec requirement/scenarios, and
   make `tasks.md` 6.2's "buggy form" and 4.1's real-file assertion pattern consistent with the
   actual shipped line text (including its `>/dev/null 2>&1` and trailing `|| true`), so the
   real-file grep assertion cannot silently fail to match.

### Non-blocking notes

- `design.md`'s risk mitigation says `core/scripts/*.sh` "were confirmed during Setup to be verbatim
  (non-templated)". `core/scripts/check-agent-merge-permission.sh` does contain `{{`. Irrelevant to
  the four touched files, but the blanket statement is inaccurate as written.
- `tasks.md` 8.3 (`npm test`) does cover `test/scripts/doctor-artifacts.test.sh`, which is the
  existing guard on the `checkArtifacts` path being changed — worth calling out explicitly there so
  the executor knows a specific test exists for the code it is editing.
