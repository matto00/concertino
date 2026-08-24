## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-verification of CON-136 at `5155ce6`, checking round 1's two change
requests and re-deriving the whole gate from ground truth.

### What I verified (with evidence)

**CR2 — stale step-number cross-references (CLOSED).**
- `grep -n -i "step [0-9]"` over the whole Setup section of `core/roles/orchestrator.md`
  (lines 155–335) returns 13 hits; I checked each by hand against the actual
  1–7 sequence (1 fetch, 2 premise-validation, 3 branch, 4 worktree, 5 gate,
  6 AGENT_MERGE, 7 workflow-state). All 13 are now correct — including the
  three round 1 named (`step 5's gate`, `(step 5 below)`, `which step 4 creates`).
- `grep -rn -i "setup step [0-9]"` across `core/`, `scripts/concertino/`, `test/`:
  four hits (`orchestrator.md:401`, `:1177`, `:1587`, `assert-phase.sh:102`), all
  correct (step 1 fetch, step 2 premise-validation ×2, step 5 gate).
- `core/scripts/assert-phase.sh:102-103` now reads "step 5 … after setup-worktree.sh
  has already run at step 4" — correct.
- Re-sync verified by me: `diff core/scripts/assert-phase.sh scripts/concertino/assert-phase.sh`
  → identical; same for `gather-escalation-context.sh`.
- `files-modified.md` no longer claims "fixed every internal cross-reference"; it
  now states the specific three refs fixed and how they were re-verified.
- The `5155ce6` diff is 6 changed doc/comment lines + the new test + package.json —
  no behavioral code touched, so nothing round 1 confirmed could have regressed.

**CR1 — AC5 red-before-green evidence (CLOSED). The two claims are distinct and
neither is passed off as the other.**
- *(a) Enforcement is genuinely covered.* I read
  `test/scripts/premise-validation-demonstration.test.sh` in full. It derives its
  findings by actually running `stat -L -c '%i'` / `readlink -f` (CON-128-shaped
  symlink fixture) and `git config --get core.bare` (CON-131-shaped repo fixture)
  and asserting on the derived values, then feeds those derived findings into
  `premise-validation.md` fixtures and runs the **real rendered**
  `scripts/concertino/assert-phase.sh setup` (FAIL/exit 1 unescalated → PASS/exit 0
  after a real `gather-escalation-context.sh ticket-drift` escalation event).
  I proved it is load-bearing by **single-line mutation** in an isolated copy at
  `.concertino/worktrees/skeptic-probe-CON136-r2` (since removed): changing
  `if [ "$PV_VERDICT" = "material-drift" ]` → `"zzz-never"` (one line of the real
  script) flipped the suite to `5 passed, 4 failed` (rc=1); reverting restored
  `9 passed, 0 failed` (rc=0). Not a whole-file swap.
- *(b) The live transcript is a real one-time record, not the enforcement test.*
  `.concertino/runs/CON-136/evidence/premise-validation-demonstration.md` records
  the same commands run against real machine state, and **I independently
  reproduced its exact outputs**: `stat -L -c '%i' /usr/lib/node_modules/concertino`
  → `29375144`, same for `/home/matt/Development/concertino` → `29375144`,
  `readlink -f` → `/home/matt/Development/concertino`,
  `git config --get core.bare` → `false`. Byte-for-byte matches the transcript.
  The artifact explicitly labels the committed test as the "portable, CI-safe,
  repeatable version" of the same sequence, and the test's header comment points
  back at the persisted live run — no conflation in either direction. The artifact
  is also explicit that CON-131's check ran against the concertino repo as a
  *stand-in* (the historical helio state is unrecoverable) rather than overclaiming;
  CON-128's is the genuine historical artifact, which I reproduced live.
- *Evidence trail is real:* `.concertino/runs/CON-136/events.jsonl` line 21 —
  `kind=evidence, role=executor, ref=.concertino/runs/CON-136/evidence/premise-validation-demonstration.md,
  label=premise-validation-ac5-demonstration`.

**Constraint 1 — shape/presence only, never correctness (HOLDS).** Re-read the
`node -e` scan in `core/scripts/assert-phase.sh` (~lines 152–188): heading presence,
three fields present and not in the placeholder set (`tbd|n/a|na|todo|""`), and a
`**Verdict:**` enum membership check. Nothing inspects whether any claim was
judged correctly. No faked mechanical correctness check anywhere in the diff.

**Constraint 2 — proportionate cost (HOLDS).** Only the `material-drift` branch
reaches the `events.jsonl` escalation lookup; `no-drift`/`minor-staleness` return
straight from the artifact read. The role doc's "Cost on a no-drift ticket"
paragraph states it explicitly: one verification pass + one `persist-evidence.sh`
write, no sub-agent spawn, no new loop. `minor-staleness` is corrected inline in
the artifact with no escalation.

**AC trace (all six).** AC1 ✓ Setup step 2, before step 3 branch derivation.
AC2 ✓ procedure's "confirm they exist as described" + `Claims checked:` field
(mandatory, non-placeholder-enforced). AC3 ✓ `material-drift` → escalation with
`claimed`/`actual`/`options`; `minor-staleness` re-derived, no escalation.
AC4 ✓ unconditional `assert-phase.sh setup` check, reproduced by my own mutation
probe. AC5 ✓ now traceable to both the committed test and the persisted live
transcript (was the round 1 REFUTE). AC6 ✓ per Constraint 2 above.

**Full gate suite re-run by me, fresh.** `npm test` → exit 0. Individually:
`assert-phase.test.sh` 103/0, `gather-escalation-context.test.sh` 48/0,
`premise-validation-demonstration.test.sh` 9/0 (all rc=0). 36 "0 failed" summary
lines, zero non-zero-failure summaries. `node bin/concertino doctor` → exit 0
("environment ready", one pre-existing warning: this self-hosted repo has no
`concertino.config.json`, which is expected — its rendered `scripts/concertino/`
copies I verified byte-identical to `core/` by direct diff instead).

**Untouched as instructed:** the CON-87 worktree, and the three untracked WIP
paths. My probe worktree lived under `.concertino/worktrees/` and is removed.

### Verdict: CONFIRM

### Non-blocking notes
- `design.md:24` / `design.md:76` still say "Setup step 4" using the pre-change
  numbering (carried over from round 1's note). Defensible as authoring-time
  freeze; aligning to step 5 would read better.
- `openspec/changes/.../evaluation-1.md` and `skeptic-final-1.md` are untracked in
  the worktree; both are persisted to run evidence, so cosmetic only.
- Two of the demonstration test's nine assertions are near-tautological
  (`git init` default `core.bare=false`; a fresh symlink resolving to its own
  target). They are honest fixtures of the *mechanism*, and the real refutation
  lives in the persisted live transcript — but they carry no independent
  refutational weight on their own.
