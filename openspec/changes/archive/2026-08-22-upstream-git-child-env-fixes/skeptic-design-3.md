## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold re-review of all six planning artifacts against ground truth in
`/home/matt/Development/helio/scripts/concertino/` and concertino's own engine
(`lib/cli/emit.js`, `doctor.js`, `shared.js`, `resolve-core.js`). Nothing below is taken
from the executor's narrative.

### What I verified (with evidence)

**Round-2 CR1 — `coresDiffer` as a third enumeration site: ADDRESSED.**
- `lib/cli/resolve-core.js:51-65` read directly: `coresDiffer` loops `['scripts','laws','roles']`
  with `readDirSafe` + `fileDiffers`; `fileDiffers` (l.53-57) does a bare
  `fs.readFileSync(a).equals(fs.readFileSync(b))` with **no** try/catch, unlike the sibling
  `readDirSafe` (l.52). Reproduced on this machine: `fs.readFileSync(<dir>)` -> `EISDIR`,
  `fs.copyFileSync(<dir>,…)` -> `EISDIR`. The design's claim is exact, including that it only
  detonates when *both* cores have `scripts/lib/` (otherwise the `exists(a) !== exists(b)`
  early-return at l.54 fires first).
- Coverage now present in: proposal.md ("What Changes" + Impact), design.md Decision 6
  (names all three sites and the sibling-worktree trigger), tasks.md 1.4 (resolve-core, `scripts`
  sub-loop only, `laws`/`roles` left on `readDirSafe`) and 1.5 (sibling-worktree verification).
- I searched for a *fourth* site myself: `grep -rn "readdirSync" lib/ bin/` and
  `grep -rn "'scripts'" lib/`. Only `emit.js:426`, `doctor.js:42`, `resolve-core.js:58` enumerate
  `core/scripts/`. `lib/cli/upgrade.js:29` enumerates only `.claude|.codex|.opencode` agent dirs
  (read in full, l.23-31) — not affected. The enumeration is now exhaustive.
- `copy()` (`lib/cli/shared.js:76-80`) already does `mkdirSync(path.dirname(dest),{recursive:true})`,
  so nested destinations render without further change — task 1.2 is sufficient as written.

**Round-2 CR2 — hook-eval line with its enclosing subshell: ADDRESSED.**
- helio ground truth `scripts/concertino/setup-worktree.sh:357` is verbatim:
  `( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true`
- That exact string, subshell included, now appears in ticket.md ("Mechanism"), proposal.md,
  design.md Decision 3, tasks.md 3.3, and `specs/git-child-env-hardening/spec.md`'s
  "setup-worktree.sh hook-eval sequencing" requirement. The "buggy form" is stated consistently
  as `( cd … && unset … || true; eval … ) || true` in tasks 6.2 and both spec comparison lines —
  subshell preserved, only internal punctuation reverted. Consistent everywhere; no artifact
  still carries the subshell-less form.
- The revert in 6.2 is a genuine red trigger: helio's selftest (l.243-244) greps the *real* file
  for `cd "\$WORKTREE_PATH" \|\| exit 0;.*unset -v \$\(compgen -v GIT_.*;.*eval "\$hook"`, which
  the buggy form cannot match.
- Note: `core/scripts/setup-worktree.sh:349` today is `( cd "$WORKTREE_PATH" && eval "$hook" … ) || true`
  (no strip). The buggy form in 6.2 is therefore an artificial regression fixture, not the
  current core line — correct and intentional for a red-before-green demo.

**Fresh full pass on everything else:**
- Call-site counts in tasks 3.1-3.4 verified against helio: assert-phase 7 (l.135,137,153,154,156,158,160),
  cleanup 12 (l.52,69,71,108,109,112,115,124,137,141,151,157), setup-worktree 8 (l.211,253,255,256,263,264,266,277),
  start-servers 1 (l.45). All four exactly match. `diff core/scripts/<f>` vs helio confirms the only
  deltas are the `source` line + `git`→`git_child` substitutions (+ the hook line), i.e. the port is
  mechanically well-defined.
- All four scripts already define `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`
  (core: assert-phase:29, cleanup:46, setup-worktree:107, start-servers:39), so the ported
  `source "${SCRIPT_DIR}/lib/git-child-env.sh"` and the selftest's static-wiring grep both work
  in-place in `core/scripts/` and post-render.
- Selftest relocatability claim in task 4.1 verified: helio's selftest derives
  `CONCERTINO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"` (l.36-37) — correct under both `core/scripts/lib/`
  and rendered `scripts/concertino/lib/`. Its real-file assertion (l.236-248) is genuinely
  non-self-referential.
- Templating risk claim verified: `grep -ln '{{' core/scripts/*.sh` returns exactly
  `check-agent-merge-permission.sh` — design.md's scoped restatement is now accurate (round-2
  cleanup holds).
- Decision 5's characterization of helio's guard verified verbatim at
  `helio/scripts/concertino/cleanup.sh:261-283`: `if true; then … elif other_runs_live; …`, comment
  "Remove this guard … once the binary resolution is fixed", citing CON-128. Core's own
  `cleanup.sh:249` still has the live `if other_runs_live;` form, so the port target is unambiguous.
- Scope boundaries hold: no artifact touches CON-128/131/132 work; the `cleanup-sync-guard` spec
  explicitly disclaims CON-131's exit code.
- Acceptance-criteria trace: every ticket AC maps to a task (AC1/2→3.x+2.1+7.1, AC3→3.4, AC4→7.2/7.3,
  AC5→6.1-6.3, AC6→8.2). No orphan AC, no task outside the ticket's scope.
- No `TODO`/`TBD`/deferred decisions remain; Open Questions is "None" and justified.

### Verdict: CONFIRM

Both round-2 change requests are correctly and completely addressed, and the independent fresh
pass found no new blocking defect. The design is implementable as written.

### Non-blocking notes

1. `design.md` Decision 5 asserts a project can set the guard "exactly as helio does today via its
   own wrapper". There is no such wrapper: helio's orchestrator invokes
   `scripts/concertino/cleanup.sh --phase4` directly (`.claude/agents/concertino-orchestrator.md:922-925`)
   and `grep -rn CLEANUP_SKIP /home/matt/Development/helio` returns nothing. The rationale sentence is
   factually wrong; the decision itself still stands. Executor should drop or correct that clause.
2. Related and more useful: `cleanup.sh` sources `${SCRIPT_DIR}/.concertino.env` (core l.48) *before*
   the sync block, but `.concertino.env` is regenerated by `renderEnv` (`lib/cli/render.js:214+`) on
   every sync — so a hand-edited value there is clobbered by the very mechanism this ticket is about.
   Consider (in this change or a spinoff) plumbing the guard from `concertino.config.json` through
   `renderEnv` so it is durably configurable rather than per-invocation-only.
3. `specs/cleanup-sync-guard/spec.md` says "set to a truthy value" without defining truthy
   (is `CONCERTINO_CLEANUP_SKIP_SYNC=0` a skip?). Pin it to one rule (suggest: non-empty and not
   `0`/`false`) during implementation.
4. `specs/git-child-env-hardening/spec.md`'s nested-directory requirement still names only
   `emit.js`'s `copyAssets` and `doctor.js`'s `checkArtifacts`. Tasks 1.4/1.5 cover `coresDiffer`,
   so implementation cannot go wrong, but the archived spec will understate the requirement — worth
   adding a `resolve-core` clause/scenario while editing.
