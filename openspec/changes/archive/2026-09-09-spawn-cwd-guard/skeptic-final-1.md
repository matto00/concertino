## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed cold from ground truth: `git diff main...HEAD` (dcd4ddc on aa9d511), the
scripts, the tests, and my own re-runs/mutants. No UI in this change (doc/tooling
only, Concertino's own workflow) — no server/browser phase applies.

### What I verified (with evidence)

**AC 1 — every worktree-bound role verifies ambient cwd + branch as literal first action.**
`grep -n 'block:cwdGuard' core/roles/{executor,evaluator,skeptic,auditor}.md` → present in
all four, each as a `## Spawn-cwd guard (CON-174, literal first action)` section placed
immediately after `## Input` and before any other step section (executor:25/27,
evaluator:22/24, skeptic:26/28, auditor:31/33). The rendered block (`lib/cli/render.js`
`case 'cwdGuard'`) instructs a standalone `pwd -P`, then `assert-cwd.sh <pwd> $WORKTREE_PATH $BRANCH`.

**AC 2 — canonical script, mirrored byte-for-byte.**
`diff core/scripts/assert-cwd.sh scripts/concertino/assert-cwd.sh` → identical, both in
commit aa9d511. `bash test/scripts/rendered-scripts-drift.test.sh` → 19 passed, 0 failed.

**AC 3 — loud failure + BLOCKER-and-stop; normal spawn must not BLOCKER.**
I re-ran `bash test/scripts/assert-cwd.test.sh` → 11 passed, 0 failed, and then wrote and
ran **my own four mutants** against the real test suite (restored clean afterward,
`git diff --quiet` verified):
- M1 — collision check no-op'd → case 2 goes RED (`2: cross-worktree ambient` fails). Killed.
- M2 — naive "ambient must be under WORKTREE_PATH" → cases 1b and the BASE boundary go RED. Killed.
- M3 — **the evaluation-1 CR #1 mutant**: reject an ambient outside BASE that is still an
  ancestor of WORKTREE_PATH → **case 1a goes RED** (`expected to find [READY] in [FAIL
  cwd-mismatch: MUTANT ancestor-rejected]`). Killed. This is the exact gap evaluation-1
  found and cycle 2 claimed to fix; I confirmed it independently rather than reading it.
- M4 — branch check no-op'd → case 3 goes RED. Killed.
The fixture is a real git repo with two real `git worktree add` lanes under a real
`$MAIN_REPO/.concertino/worktrees` base, with the ancestor fixture a **genuine strict
ancestor** (MAIN_REPO ⊃ BASE ⊃ LANE2_WT), not a sibling — which is what makes M3 killable.

**AC 4 — BRANCH as a structured spawn input.** `git diff main...HEAD -- core/roles/orchestrator.md`
adds `BRANCH` to the executor spawn, evaluator spawn, skeptic design-gate spawn and
skeptic final-gate spawn; auditor spawn already carried it (orchestrator.md:1098). The
warm `SendMessage` resume path is explicitly documented as carrying it implicitly, and the
cold `RESUME` fallback spawn (render.js `harnessResume`, claude-code arm) now explicitly
passes `WORKTREE_PATH`/`CHANGE_NAME`/`TICKET_ID`/`BRANCH` — closing evaluation-1 CR #3.

**AC 5 — 16 ambient-cwd-relative call sites hardened.** I re-enumerated from the tree
rather than trusting the number: `grep -n 'scripts/concertino/'` in the four role docs,
minus `cd "$WORKTREE_PATH" &&`-prefixed and `$WORKTREE_PATH/scripts/concertino`-absolute
forms, leaves only 6 lines and **all six are prose, not invocations** ("never invoke
`cleanup.sh`", "If `next-report-number.sh` prints FAIL", "the canonical
`start-servers.sh`"). Hardened invocation counts: executor 1 (152), evaluator 6
(163,164,195,233,322,324), skeptic 6 (98,99,123,165,206,208 — including the
start-servers/assert-phase pair), auditor 3 (58,263,265) = **16**, matching the AC exactly.

**AC 6 — red case + green ancestor case demonstrated.** Case 2 uses a real pre-existing
sibling worktree under the same base and goes red (verified above); cases 1a/1b use the
value a correct spawn actually produces (strict ancestor; unrelated repo) and go green.
Not a fixture that starts in the right directory by construction.

**AC 7 — CON-139 scope decision stated.** design.md:21 states explicitly "This change does
NOT fix the CON-139 reporting-channel gap … **Decision: left entirely to CON-139**", with
the rationale re-derived from the shipped mechanism at design.md:58.

**Iron Laws.**
- *Verification-before-completion*: I re-ran, myself, `assert-cwd.test.sh` (11/0),
  `cwd-guard-render.test.sh` (14/0), `rendered-scripts-drift.test.sh` (19/0), the **full**
  `npm test` (exit 0, no `N failed` lines), and `openspec validate spawn-cwd-guard --type
  change` ("is valid", rc=0).
- *Systematic-debugging*: root cause is a probe-confirmed reproduction (the harness's
  per-Bash-call cwd reset, design.md Decisions 1/3) of a real dated incident, not a guess;
  the regression guard is `test/scripts/assert-cwd.test.sh`, wired into `package.json`'s
  `test` script, and I proved by mutation that it actually exercises the fixed path.

**Adversarial probes that did not find a defect.**
- BASE derivation: `assert-cwd.sh` strips `/$BRANCH` from `WORKTREE_PATH`, which exactly
  matches `core/scripts/setup-worktree.sh:250` (`WORKTREE_PATH="${REPO_ROOT}/${WORKTREE_BASE}/${BRANCH}"`).
  If the suffix ever doesn't match, `BASE=""` and the collision check is skipped —
  degrading to branch-check-only, never a false BLOCKER. Correct failure direction.
- The guard invokes itself via an absolute `$WORKTREE_PATH/...` path, so locating the
  check does not depend on the correctness it is verifying.

### Verdict: CONFIRM

### Non-blocking notes
1. `openspec/changes/spawn-cwd-guard/evaluation-2.md` is still untracked (`git status`);
   evaluation-1.md is committed. Fold it into the delivery commit for a complete record.
2. The spec delta's last scenario reads "WHEN the orchestrator spawns **or warm-resumes**
   the executor … THEN the spawn/resume inputs include `BRANCH`", while the shipped
   orchestrator.md deliberately does not re-pass `BRANCH` on a warm resume (it is already
   bound in that session). The behaviour is right and explained; the scenario wording is
   the only place that reads as if re-passing were required. Worth a one-line softening
   ("…or is already bound in the resumed session") in a later pass.
3. `assert-cwd.sh` only detects collisions within the **same** worktree base. An ambient
   cwd inside another *repository's* worktree tree is tolerated. That matches the ticket's
   incident and design Non-Goals, but is worth remembering if lanes ever span repos.
