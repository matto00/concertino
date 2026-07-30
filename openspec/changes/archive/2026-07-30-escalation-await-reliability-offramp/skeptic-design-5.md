## Skeptic Report — design gate (round 5)

Reviewed cold, from ground truth only. I read `ticket.md`, `proposal.md`, `design.md`,
`tasks.md`, and both files under `specs/` in full, and re-derived every load-bearing
factual claim against the actual repo rather than carrying anything forward from
rounds 1-4.

### What I verified (with evidence)

**1. Round 4's CR (a) — the README hand-edit approach genuinely avoids the CON-22 drift.**
Re-simulated end to end rather than reasoning about it.

- Ground truth drift, in this worktree (`diff -u core/scripts/README.md scripts/concertino/README.md`):
  two hunks, 9 content lines — a `resolve-speed.sh` table row, a `setup-worktree.sh`
  row rewrite, and the 7-line `resolve-speed.sh` paragraph. Exactly what tasks.md 4.1
  describes.
- The `emit-event.sh` entries are textually identical in both files: mentions at lines
  20/29/35/36 sit inside the identical (non-hunk) region, and the table row is
  `core:48` / `vendored:47` — context *between* the two hunks, byte-identical. So the
  "apply the same targeted edit to the vendored file's own pre-drift entry" instruction
  is actually applicable; there is no divergent text to reconcile.
- Simulation (scratchpad copies, worktree untouched): applied one identical targeted
  edit (table-row annotation + a 3-line prose addition to the `emit-event.sh` bullet)
  to both files, then compared.
  - `scripts/concertino/README.md` vs its own pre-change state → **exactly the two
    intended edits, nothing else.** Zero CON-22 lines in its diff.
  - core-vs-vendored drift before vs after → **content identical** (9 lines, same
    `-`/`+` lines); only the hunk headers' line offsets shift (`@@ -40,8` → `@@ -43,8`,
    `@@ -49,13` → `@@ -52,13`), which is the arithmetic consequence of inserting 3 lines
    above, not a change in divergence.
  - This is the outcome tasks.md 4.3 specifies, and it is mechanically checkable.
    Round 4's CR (a) is resolved.

**2. Round 4's CR (b) — design.md no longer contradicts tasks.md.**
`design.md:81` (Migration Plan) now reads "refresh the tracked rendered copies by hand
(see tasks.md section 4 — **not** a full `concertino sync`, which would sweep in
pre-existing, unrelated vendored drift…)". Consistent with tasks.md 4.1. I grepped all
artifacts for `concertino sync` / `byte-for-byte` / `identical` / `hand-cop`: design.md
carries no residual byte-identity claim for README, and no spec requires one. Resolved.

**3. Decision 1's mechanics, re-verified against the actual script (not the narrative).**
- `core/scripts/emit-event.sh:32` defines `SCRIPT_DIR`; `:142` is `ROOT="$(main_checkout)" || exit 0`
  (the stated insertion point exists); `:381` is `TIMEOUT_MIN="${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"`.
- `grep -n concertino.env core/scripts/emit-event.sh` → **no matches**: the script really
  does not source it today. The root cause is real.
- All five siblings do (`assert-phase.sh:26`, `cleanup.sh:47`, `resolve-speed.sh:77`,
  `setup-worktree.sh:70`, `start-servers.sh:35`) — the "matching convention" and
  "unconditional source overrides ambient env" claims are accurate.
- `bin/concertino:53` `DEFAULT_ESCALATION_TIMEOUT_MIN = 8`; `concertino.config.json` sets
  no `dashboard.escalationTimeoutMinutes` override; the main checkout's
  `scripts/concertino/.concertino.env:10` is `CONCERTINO_ESCALATION_TIMEOUT_MIN=8`. So
  480s inside a 600s cap is arithmetic, not assertion.
- `scripts/concertino/emit-event.sh` is byte-identical to `core/` today (`diff -q`) —
  tasks.md 4.1's differentiated treatment of the two files rests on a true premise.

**4. Decision 2's insertion point and non-contradiction.**
`core/roles/orchestrator.md:468` "### How to raise one"; the Exit 0 / Non-zero-exit
bullets at `:520-528` with the manual fallback snippet at `:530`; "**A timeout is
never an approval**" at `:526`. Task 3.5's answers-not-timeouts scoping is therefore
anchored to text that actually exists, immediately adjacent to the insertion point.

**5. No-Codex-artifact claim (round 3's CR1) re-verified independently.**
`bin/concertino:645` renders `.toml` only `for (const role of ['executor', 'evaluator', 'auditor'])`
— no orchestrator `.toml` is ever emitted. `git ls-files | grep -i codex` shows no
`.codex/agents/*.toml` tracked. `git check-ignore` confirms
`.claude/agents/concertino-orchestrator.md` is ignored via `.gitignore:8`. All accurate.

**6. Ticket AC coverage traced.**
- Part 1's "measure against real traces before concluding the prose needs to change" →
  done in rounds 1-2; the prose is left unchanged and the measured defect is what's fixed.
- Part 1's "preserve `on_kill`'s trap-based `escalation.timeout` and the
  `answer_discarded` handling" → the change is additive sourcing that touches neither
  (`on_kill` at `:355`, `trap` at `:360`, `answer_discarded` at `:377`), and task 2.5's
  full-suite run is a *real* guard: `test/scripts/emit-event.test.sh:209/226/242/243`
  already assert TERM-kill, INT-kill, and `answer_discarded` behavior.
- Part 2's four numbered prose requirements → tasks 3.1/3.2/3.3/3.4 and the three
  `escalation-trust-offramp` requirements, one-to-one.
- "Both parts ship together" → Migration Plan lands them in one PR.
- No `TODO`/`TBD`/`FIXME`/deferred-decision placeholders anywhere in the artifacts.

**7. Nothing else disturbed.** Working tree is clean apart from the untracked change
directory itself (`git status --porcelain` → only
`?? openspec/changes/escalation-await-reliability-offramp/`). Both specs are unchanged
from the state round 4 confirmed and remain internally consistent with tasks.md.

### Verdict: CONFIRM

The design is sound and implementable as written. Part 1 is a probe-grounded root-cause
fix with a correct two-branch sourcing pattern and a spec that pins the no-`.concertino.env`
case to zero behavior change; Part 2 is a well-scoped prose addition anchored to real
text; and the vendored-copy handling in tasks.md section 4 is now correct, differentiated
per file, and self-verifying via 4.3's acceptance signal, which I reproduced.

I want to be plain that note 1 below was a close call rather than a throwaway nit — I
weighed it as a REFUTE. I did not block on it because the operative artifact (tasks.md,
the checkbox list the executor implements from, whose 4.3 mechanically forecloses the
bad outcome) is correct and unambiguous, design.md agrees with it, no spec requires the
wrong end state, and proposal.md's own sentence explicitly defers to "tasks.md section 4"
on this exact point. It is a stale summary over-generalizing a statement that is true of
`emit-event.sh` to both files — not a competing instruction with equal authority. It
should be corrected during execution, and the final gate can verify it from the diff.

### Non-blocking notes

1. **Correct `proposal.md:13` and `proposal.md:38` during execution — they still describe
   the round-4-rejected approach.** Line 13 says "Hand-copy the two changed `core/` files
   into their tracked `scripts/concertino/` counterparts (`emit-event.sh`, `README.md`) so
   each stays byte-for-byte identical to `core/`", and line 38 calls
   `scripts/concertino/README.md` a "hand-copied tracked counterpart". Both are false for
   README under the corrected plan: tasks.md 4.1 says "do **not** hand-copy the whole
   file … a hand edit, not a file copy", and my simulation confirms the correct end state
   leaves README differing from `core/` by 9 lines — so byte-for-byte identity is not just
   unintended, it is unachievable without sweeping in the CON-22 drift. Suggested fix:
   scope line 13's copy-and-identity language to `emit-event.sh` only and say README gets
   the same targeted entry edit applied by hand; change line 38's "hand-copied" to
   "hand-edited (targeted `emit-event.sh` entry only — not a copy; see tasks.md 4.1)".
   Do **not** resolve this the other way by relaxing tasks.md.
2. Task 3.5 (off-ramp covers *answers*, never *timeouts*) has no corresponding requirement
   in `specs/escalation-trust-offramp/spec.md`. It is a phrasing/consistency constraint
   rather than new behavior, so this is defensible, but if the executor wants the
   evaluator to check it from the spec rather than the task list, a short scenario
   ("a reader finds the off-ramp explicitly does not extend to a timeout") would close
   the gap.
3. For the final gate: the highest-value diff check on this change is
   `git diff main...HEAD -- scripts/concertino/README.md` — it must contain *only* the new
   `emit-event.sh` `.concertino.env` mention. Any `resolve-speed.sh` / `setup-worktree.sh`
   line appearing there means the copy-not-edit mistake was made.
4. design.md's Open Questions (sibling-script sourcing gap, a correct `answer.json`-reading
   recovery mechanism, the CON-22 orphan-poller hazard, lowering the hardcoded `:-60`
   fallback) are all legitimately deferred and each names why. Worth actually filing rather
   than leaving in this change's design doc once it archives.
