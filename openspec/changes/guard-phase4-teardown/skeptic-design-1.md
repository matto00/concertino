## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Premise correction (design.md finding 2) — CONFIRMED against the real log.**
  `/home/matt/Development/concertino/.concertino/runs/CON-163/events.jsonl` (main
  checkout, 20 lines): `grep -c '"role":"auditor"'` → **0**; no `verdict` event of
  any kind; `agent.spawn` events exist for `executor` and `evaluator` only. The
  ticket's "emitted verdict=MERGE with no ref" is indeed false, and the design's
  correction is accurate. Good work.

- **Decision 1(a) rejection of the ticket's preferred Direction 2 — CONFIRMED sound.**
  `core/roles/auditor.md:192-196` contains verbatim the failure path the design
  cites: a failed `gh pr merge` after all four conditions passed is a `BLOCKER`
  with the PR left open. `auditor.md:215` shows the report body carries a
  `### Verdict: MERGE | ESCALATE | BLOCKER | ESCALATION-RAISE` line, and the
  merge step (`:180-196`) precedes "Output / Step 1: Write report" (`:200-215`).
  So persist-before-merge would durably record `Verdict: MERGE` for a run that
  can still end `BLOCKER`. The reasoning is grounded, not asserted. Overriding
  the ticket's preference here is justified.

- **Decision 6 (render without `concertino sync`) — CONFIRMED.**
  `test/scripts/rendered-scripts-drift.test.sh` runs green at HEAD (18 passed,
  0 failed); its built-in exemption table already carries `pricing-table.json`
  and `report-cost.sh` with CON-173 reasons, and `git status --porcelain
  scripts/concertino/` in the main checkout shows exactly those two as
  untracked. Direct `cp` is sufficient and the hard constraint is respected by
  tasks 4.1/4.4.

- **Decision 5 (reuse `fail()`/`print_result()`) — CONFIRMED** against
  `core/scripts/cleanup.sh:78-95`; the port kills are at `:152-153` and worktree
  removal at `:181`, so task 1.3's insertion point exists as described.

- **Decision 2 detection mechanism — checked for efficacy against the incident
  it is built for, and this is where it fails.** See CR 1.

### Verdict: REFUTE

### Change Requests

1. **The load-bearing mechanism would not have detected CON-163, and the design
   never checks whether it would.** Decision 2 detects "a live process whose
   `/proc/<pid>/cwd` is inside the worktree". That is not the same predicate as
   "an agent is still writing into the worktree", and the gap is exactly the
   CON-163 sequence:
   - `core/roles/auditor.md:29` says "All commands run inside `WORKTREE_PATH`",
     but every actual invocation in that document passes `"$WORKTREE_PATH"` as an
     **absolute argument** (`:54`, `:230`) — it never `cd`s. The report itself
     (`:204`) is written by the harness's file-write tool, not a subprocess.
   - Agent bash calls are per-call processes whose cwd is reset between calls
     (this harness resets cwd every bash invocation), so **between tool calls an
     agent holds no process with a cwd inside the worktree at all** — which is
     precisely the state CON-163's auditor was in: report written, `persist-evidence.sh`
     not yet called.
   - The processes the probe *will* reliably find are the dev/backend servers
     (`core/scripts/start-servers.sh:84` does `cd "${WORKTREE_PATH}/${cwd}"`) —
     and those are the ones `cleanup.sh:152-153` has just killed, i.e. the
     false-positive case Decision 3's settle window exists to suppress.

   As specified, the guard is close to a no-op against the failure it is adopted
   to prevent, while proposal.md:9 calls it "a mechanical guarantee that does not
   depend on any prompt being read correctly" and design.md:18 claims it makes
   destruction "structurally impossible". Required: either (a) add a signal that
   actually covers an agent that is live but momentarily has no process in the
   worktree — e.g. a marker/lease file written into the worktree by the auditor
   (and any future role that writes there near teardown) and cleared after its
   final `emit-event.sh`, which the guard checks alongside the `/proc` probe; or
   (b) if (a) is rejected, say so explicitly and rewrite Decision 2, the
   Risks section, and proposal.md's "mechanical guarantee" / "structurally
   impossible" claims to state the residual gap plainly — that the process probe
   covers stray shells and surviving servers only, and that Direction 1 (prose)
   is what carries the CON-163 shape. Note that (b) materially weakens Decision
   1's own argument for rejecting Direction 2 on "it does not close the class",
   so if (b) is chosen, Decision 1 must be re-argued on ground (a) alone.

2. **`--force-teardown` argument parsing is under-specified and collides with the
   existing opt-in guard.** `core/scripts/cleanup.sh:40-49` hard-requires
   `--phase4` to be **the first argument**, and offers a second entry form
   (`CONCERTINO_PHASE4=1` with no flag at all, `:41-42`, documented at `:22`).
   Task 1.1 asks for `--force-teardown` "accepted in either order relative to
   `--phase4`" without saying how either form survives. Under the env-sentinel
   form, `cleanup.sh --force-teardown <path> ...` would bind
   `WORKTREE_PATH="--force-teardown"` at `:50`. Specify the parsing explicitly:
   which forms are legal, that the `--phase4`-first / `CONCERTINO_PHASE4` opt-in
   semantics are unchanged, and that an unrecognised leading `--`-argument fails
   loudly rather than being consumed as `WORKTREE_PATH`. Add a test for the
   env-sentinel + `--force-teardown` combination to task 3.1.

3. **Settle-window semantics are ambiguous on the one case the tests exercise.**
   design.md:73 says refuse "only if a holder survives" the window; task 3.1
   requires "a holder that exits during the settle window (teardown proceeds)".
   These are only equivalent if the rule is "re-probe until the holder set is
   empty, up to a hard bound", and are contradictory if it is "any holder seen
   at any probe refuses". State the rule in one sentence, state whether a holder
   appearing *newly* mid-window refuses, and name the bound and poll interval as
   concrete defaults (Open Questions may keep the value tunable, but the
   implementer needs a number).

4. **Self-exclusion must be specified as ancestors-only, and the reason recorded.**
   Task 1.2's "the cleanup process itself and its full ancestor chain" is the
   right rule, but it is one loose reading away from a guard that is vacuous:
   in this harness every agent's bash process shares the harness process as a
   common ancestor, so excluding "the ancestor chain and everything under it"
   would exclude every agent the guard exists to detect. Say explicitly that the
   exclusion set is the literal pid chain (`self` → PPid → … → 1) and never
   siblings or other descendants of those ancestors, and that the `/proc` walk
   must tolerate pids disappearing mid-scan (`set -e` + a vanished
   `/proc/<pid>/cwd` is a real race here).

### Non-blocking notes

- AC 4 / task 2.3's framing (a refusal is a `BLOCKER`, not something to retry
  with `--force-teardown` unilaterally) is consistent with AC 3's operator
  override — no conflict; worth keeping the wording as-is.
- design.md:65's "degrade to no-holders on a platform without `/proc`" is the
  right call and is stated rather than hidden.
