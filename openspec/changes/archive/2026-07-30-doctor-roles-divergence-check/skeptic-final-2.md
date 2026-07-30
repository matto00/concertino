## Skeptic Report — final gate (round 2)

Reviewed cold. Every conclusion below comes from a command I ran or a file I read
myself; the executor's `files-modified.md`, the evaluator's `evaluation-1.md`, and
the round-1 skeptic report were treated as claims to re-verify, not as facts. All
mutation testing was done in a throwaway copy under the scratchpad
(`.../scratchpad/mut`) — the worktree under review was never modified.

### What I verified (with evidence)

**Ground truth: the diff.** `git diff main...HEAD --stat` at `f442270`:
`bin/concertino` (+9/-5, one behavioral line), `test/scripts/doctor-artifacts.test.sh`
(+39), plus `tasks.md`/`files-modified.md`. No other production file. `coresDiffer()`
is grepped repo-wide: defined at `bin/concertino:185`, single caller `resolveCore()`
at `bin/concertino:223`. `core/roles/` is flat (5 `.md` files), so the non-recursive
`readDirSafe` is adequate.

**AC1 — `coresDiffer()` compares `core/roles/*`: MET.** `bin/concertino:192` is now
`for (const sub of ['scripts', 'laws', 'roles'])`, running the identical
`fileDiffers()` set-union logic already applied to `scripts`/`laws`.

**AC2 — a diverged `core/roles/*.md` produces the same divergence note: MET, verified
by my own isolated probe** (throwaway `git init` copy + worktree; `core/roles/executor.md`
the *only* divergence; `scripts`/`laws`/`workflow-state.template.md` byte-identical):

```
=== CONTROL: cores identical ===
(no note)
=== ROLES-ONLY DIVERGENCE ===
  note: rendering from /tmp/tmp.0Oz3SU7LPW/wt/core — differs from the executing script's own core at /tmp/tmp.0Oz3SU7LPW/core
```

Same string, same code path (`bin/concertino:224-225`) as a `scripts`/`laws` divergence.

**AC3 — existing behavior unchanged: MET.** The change is purely additive to a loop;
`checkArtifacts()` (`bin/concertino:962-1005`) is untouched, and the whole pre-existing
doctor-artifacts suite still passes.

**Declared gate (`concertino.config.json → gates`: `test`, `when: always`) re-run by me
in full:** `npm test` → `GATE EXIT=0`, every suite green (doctor-artifacts 13/13,
auditor-render 13/13, check-merge-readiness 22/22, doctor-base-branch 10/10, ...).

**Regression test is not inert — fail-before / pass-after, reproduced.** Copied the
tree to scratch, reverted `'roles'` from the loop, ran the *unmodified* test:

```
=== bug present (roles removed), clean tree ===
  FAIL CON-36 detects diverged roles file
       expected to find [differs from the executing script]
  FAIL CON-36 note names the main core
  11 passed, 2 failed        EXIT=1
=== fix present ===
  13 passed, 0 failed        EXIT=0
```

**Round-1 CR2 (false green under a dirty working tree) is genuinely fixed.** I
reproduced the exact round-1 scenario against the revised test: bug present *plus*
uncommitted edits in both `core/scripts/emit-event.sh` and
`core/laws/systematic-debugging.md`. The test still failed correctly
(`11 passed, 2 failed`, EXIT=1). The `new_main()` helper commits the copied working
tree before branching the worktree, so ambient repo dirtiness can no longer masquerade
as a `scripts`/`laws` divergence.

**Round-1 CR1 (repo mutation / worktree leakage) is fixed.** `git worktree add` now
targets the throwaway `$MAIN` (`test/scripts/doctor-artifacts.test.sh:87`), and both
`$WORK` and `$MAIN` are `rm -rf`'d by the trap at line 86. Checked the real repo
before and after two `doctor-artifacts` runs and a full `npm test`:
`git worktree list` shows only the three legitimate entries, `ls .git/worktrees/` shows
only `CON-30 CON-36 tui-fleet-dashboard`, `git worktree prune --dry-run -v` is empty,
and `git branch --list 'feat-*'` is empty (no leaked `feat-roles`).

**Round-1 CR3 (silent skip) is fixed.** Line 87 is now
`|| { bad "CON-36 worktree setup"; exit 1; }` — a hard failure, not a `skipped` that
still exits 0. The trap is reset to include `$MAIN` (line 86) *before* the failing
command, so the early exit still cleans up.

**Round-1 CR4 (false comment) is fixed and the new comment is accurate.**
`bin/concertino:177-184` now states the larger set and why it exceeds
`checkArtifacts()`'s. I verified the claim against the code rather than the prose:
`checkArtifacts()` at `bin/concertino:975-980` compares exactly `core/scripts/*`,
`core/laws/*`, and `workflow-state.template.md`, and role files are rendered into
`.claude/agents/concertino-*.md` (lines 992-999, existence-only check) — so there is
indeed no byte-identical artifact for roles, exactly as the comment says.

**Systematic-debugging law:** the root cause is a documented omission, not a mystery —
stated in `ticket.md`, `design.md` ("`roles/` is never included"), and confirmed by my
control probe (no note before, note after). A regression test exists that provably
exercises the fixed path (fail-before/pass-after above).

**Spec delta:** `specs/core-resolution/spec.md` names the requirement and a scenario
that matches what the code and test actually do (roles diverged, other three identical).
No scope creep; no API/schema surface touched, so no other contract update is owed.
No stale docs — `README.md`'s only hit is a directory tree, and no doc enumerates the
compared set.

**UI review: N/A.** `concertino.config.json → ui.enabled: false`, `tool: "none"`; the
diff contains no UI files. Servers not started, per config.

### Verdict: CONFIRM

The one-line production fix is correct and minimal, all three ACs trace to evidence I
produced myself, the declared gate passes, and all four round-1 change requests are
substantively resolved — including the two I specifically tried hardest to re-break
(the dirty-tree false green and the repo mutation). This ships.

### Non-blocking notes

- `test/scripts/doctor-artifacts.test.sh:101` —
  `has "CON-36 note names the worktree's core" "$WT/core"` does **not** discriminate:
  it passed in my mutation run with the bug fully present, because
  `bin/concertino:964` (`r.ok('core', ...)`) prints the resolved core path
  unconditionally (`✓ core   /tmp/.../wt/core  (auto-detected)`). It is harmless
  (lines 100 and 102 both fail without the fix, so the suite's verdict is sound), but
  it is decorative rather than protective. If kept, assert the whole note line
  (`rendering from $WT/core — differs`) instead. Correspondingly,
  `files-modified.md`'s "assertions are specific to roles divergence" is true of two
  of the three assertions, not all three.
- `new_main()` (lines 23-34) duplicates the helper of the same name and purpose in
  `test/scripts/sync-core-resolution.test.sh`. Round 1 suggested relocating this case
  there as `3.8`; that remains the tidier home, since the case exercises
  `resolveCore()`/`coresDiffer()` rather than in-project artifact drift.
- Line 96's `sync --out="$WT" > /dev/null 2>&1` result is unchecked, and the three
  assertions do not depend on it (the note is printed by `resolveCore()` during
  `doctor` regardless). A broken sync would not be noticed by this case — fine for
  its subject, worth knowing if the case is later extended.
- **Unrelated observation, not a change request:** during my review window an untracked
  `render.js` appeared in the *main* checkout (`/home/matt/Development/concertino/render.js`,
  mtime 00:20). It is a launch-pad rendering probe (`require('./lib/ui/screens/launchpad')`,
  `renderLaunchPad`) and matches the concurrently running
  `claude /concertino-deliver CON-30 --agent-merge fast` process (CON-30 =
  visual-design-color-hierarchy). Nothing in CON-36's diff or test suite references
  `render.js` or any UI module (`grep -rn "render\.js" test/ lib/ bin/` → no hits), so it
  is not attributable to this change. Flagging it for the human to clean up.
