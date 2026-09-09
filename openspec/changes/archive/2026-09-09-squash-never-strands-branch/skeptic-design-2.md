## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Cold spawn. I re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` and the
spec delta directly, then read `skeptic-design-1.md` as a claim about what was asked.

**Round 1's blocking change request is closed, substantively — not gestured at.**
The CR asked for two things: a task exercising the `EXIT` trap actually firing, and
a failability arm for it.

- `tasks.md` 3.7 specifies exactly the mechanism the CR named: a `pre-commit` hook
  that `sleep`s rather than exiting, background invocation, `kill -TERM` while parked
  inside the hook (explicitly "after the forward reset, before the commit returns"),
  and the assertion that `git rev-parse HEAD` is the pre-run commit rather than the
  merge-base. It also states *why* 3.5 is not a substitute ("3.5 only proves the trap
  does NOT fire on success"), which is the CR's own reasoning, not a restatement of
  the ask.
- 3.8 is a real failability arm, not a token one: it names the specific mutation
  (delete the `trap` installation line), the specific inverted assertion (HEAD **is**
  at merge-base), and reuses the `PRISTINE_SCRIPT` machinery rather than inventing a
  second restoration path — matching 3.3's shape. I confirmed that machinery exists
  and is what 3.3 already reuses: `test/scripts/squash-branch.test.sh:28-32` defines
  `PRISTINE_SCRIPT="$(mktemp)"`, the `cp` snapshot, and the restoring trap; line 949
  documents it as the convention. So 3.8 is cheap and executable as written, not a
  task that will quietly become "asserted instead".

**I measured 3.7's central assumption rather than trusting round 1's measurement.**
Round 1 verified that an `EXIT` trap fires under `SIGTERM`, but with a bare script —
not with a foreground child running, which is exactly 3.7's situation (the shell is
blocked inside `git commit`, which is blocked inside the sleeping hook). Bash defers
*trapped* signals until the foreground command returns, so it was a live question
whether 3.7 could work at all or would hang for the length of the hook's sleep. I ran
it: a `#!/usr/bin/env bash` + `set -uo pipefail` script with an `EXIT` trap, parked in
`sleep 20`, sent `kill -TERM`. The trap fired in the same second as the kill and the
shell was gone within 3s (log timestamp `1788957988` == kill timestamp). Because no
`TERM` handler is installed, the default disposition terminates the shell immediately
and `EXIT` runs; the foreground-deferral rule does not apply. **3.7 is feasible as
written**, and this was the one thing that could have made the closure of round 1's
CR illusory.

**The three round-1 non-blocking notes were each taken, and taken correctly.**
- Spec delta opening now reads "SHALL NOT **leave** HEAD, the index, or the working
  tree changed", plus a parenthetical explicitly reconciling it with the transient
  movement the next paragraph mandates. The literal contradiction is gone.
- The abnormal-termination requirement is qualified to "abnormal catchable
  termination ... (`SIGTERM`/`SIGINT`/`SIGHUP`)" with "`SIGKILL` is uncatchable and is
  therefore outside this guarantee" stated in the requirement body, and the matching
  scenario is qualified the same way. The requirement is now exactly as strong as it
  can be and no stronger — which is the point.
- Task 3.9 states the verification route for "The restore itself fails" (direct
  inspection of the diagnostic: both SHAs, reflog named, exit non-zero) and says why
  no fixture exists. That scenario is no longer orphaned.
- `design.md` D2 gained both the hook-mutates-the-index nuance (with the `lint --fix`
  + `git add` shape named, and the honest scoping of what the script can unilaterally
  guarantee) and the double-diagnostic note framed as expected output.

**Re-examined the whole design independently for anything round 1 missed.**
- **AC trace, all seven.** AC1 → 2.1/2.2/2.4 + 3.1/3.2 (which assert `write-tree` and
  `status --porcelain` as well as `rev-parse`, so "index restored" is measured, not
  assumed). AC2 → D1, argued from the measured hook inventory in both repos. AC3 → D4,
  which rules rather than re-defers. AC4 → 2.7 + 3.10 (all pre-existing scenarios
  re-run). AC5 → 2.3's scoping below the `DRY_RUN` early return + 1.3 + 3.6. AC6 →
  3.3 and now 3.8. AC7 → 4.1 + 4.3. No AC is uncovered and no task is outside the ACs.
- **Scope.** Task 4.2 and D6 both carry the CON-173 no-sync constraint, and D6 names
  the two untracked files by path. `cp` is the stated re-render route. No drift.
- **No new placeholders, TBDs, or deferred decisions** anywhere in the three artifacts.
- **No internal contradictions** between proposal, design and tasks: I checked D5's
  five scenarios against tasks 3.1–3.6 (they correspond one-to-one), and D2's two
  arming mechanisms against 2.3/2.4.
- Ground-truth spot check: `git log --oneline` confirms HEAD is `87f1a53` and that
  `d792b42` (CON-164) is merged behind it, so design.md's Context block is still
  written against the current file.

### Verdict: CONFIRM

Round 1's change request is genuinely closed, its mechanism is measured to work, and
nothing new rises to blocking.

### Non-blocking notes

- **3.7 will orphan the hook's child process; the fixture should reap it.** In my
  measurement, killing the script left the `sleep` running (`pgrep -af "sleep 20"`
  showed it after the parent was gone). In 3.7's fixture that orphan is a `git commit`
  parked in the hook. If the hook eventually exits 0, that orphaned commit can move
  HEAD *after* the trap restored it — a flaky test that fails intermittently for a
  reason that looks like a defect in the restore. Cheap mitigations: make the hook's
  sleep long enough that the assertion always wins the race AND kill the process group
  (`kill -TERM -$PID` after `setsid`, or an explicit `pkill` in the fixture's cleanup),
  or have the hook exit non-zero after the sleep so a late completion cannot commit.
  Worth one line in the fixture; the executor should not discover this as a flake.
- D2 says the trap is "installed immediately before the forward reset". Note that
  `PRE_SQUASH_HEAD` must be recorded *before* the trap is installed (2.1 before 2.3),
  or the trap's helper reads an unset variable under `set -u` at the worst possible
  moment. Tasks list them in the right order; just don't let 2.3's "immediately before
  the forward reset" get read as "before 2.1".
