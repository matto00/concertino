## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `workflow-state.md`, `specs/orchestrator-turn-discipline/spec.md`.
- Confirmed `core/roles/orchestrator.md` exists (99,141 bytes) and that
  `orchestrator-turn-discipline` is a real existing spec
  (`openspec/specs/orchestrator-turn-discipline`), so the delta targets a real capability.
- Confirmed the anchor section the design names actually exists:
  `grep -n '^#\{1,4\} ' core/roles/orchestrator.md` → `38:## Harness resume model`.
  Placement "immediately after Harness resume model" is implementable; note the
  section ends with a `{{block:harnessResume}}` template block at line 100 — the
  executor must place the new subsection deliberately relative to that block.
- **Read the existing content of that section (lines 38–104) and the spawn/resume
  sites (lines 625–690) directly** — this is where the design's premise breaks
  (findings 1 and 2 below).
- `grep -rn "CON-141"` — the follow-up is referenced only inside this change's own
  artifacts; no escalation record artifact is present in the worktree, and there is
  no `.concertino/runs/CON-140` evidence directory.
- Scope-out of the mechanical phase-script assertion: verified it is explicitly and
  reasonedly stated in **both** `proposal.md` ("Explicitly out of scope (escalated and
  confirmed)…") and `design.md` Non-Goals, with the stated reason (no harness hook lets
  a stateless shell script observe "the orchestrator's turn ended"; only an external
  heuristic `events.jsonl` watchdog is viable) and the CON-141 follow-up. This part
  of the plan is correct and satisfies the ticket's escalation requirement — it is
  neither silently dropped nor silently implemented.

### Verdict: REFUTE

The escalation/scope-out handling is right. But the design's root-cause analysis is
**factually contradicted by the role doc itself**, and consequently the planned
intervention is the same class of intervention that has already failed three times.
Separately, task 4 does not actually commit to the demonstration bar the ticket sets.

### Change Requests

1. **Correct the false premise in `proposal.md` (line 1 of "Why") and `design.md`
   ("Context").** Both assert that `core/roles/orchestrator.md` "has never named
   'ending a turn to wait on a sub-agent' as an explicit anti-pattern". That is not
   true. `core/roles/orchestrator.md:40` opens the "Harness resume model" section with,
   in bold: **"Never end your turn while a sub-agent you spawned or resumed is still
   outstanding."** Line 96 adds: "Ending a turn for any other reason — including while
   waiting on a spawned executor, evaluator, skeptic, or auditor — remains exactly as
   forbidden as before." Lines 66–72 pre-emptively name the exact reasoning error
   ("If you ever catch yourself reasoning that you are 'still waiting'… that reasoning
   is the bug this note exists to correct"). The anti-pattern is already named, in bold,
   at the top of the doc, and restated at every spawn/resume site (629–634, 636–638,
   668–673). Rewrite the Why/Context to state what is *actually* missing, and re-derive
   the fix from that.

2. **Confront, in `design.md`, the fact that adding a fourth restatement is the
   intervention that has already failed.** The ticket's own framing is that per-run
   prose repeating the rule failed three times and that the fix must address a *root
   cause*, "not just a missing instruction". Given CR#1, a new subsection restating the
   prohibition is a fifth restatement inside a 99KB doc — the same category of fix, one
   level in. The design must either (a) argue explicitly why a closed positive
   enumeration is structurally different from the existing negative prohibitions and
   why that difference is load-bearing, or (b) change the intervention. Right now the
   design's stated rationale ("the absence of a single, memorable, contrastive
   statement") rests entirely on the premise CR#1 refutes.

3. **Investigate and address the strongest actual root-cause candidate, which the
   plan currently misses: the doc explicitly licenses waiting at the top level.**
   `core/roles/orchestrator.md:40-43` reads: *"As the top-level `/concertino-deliver`
   session, waiting costs nothing: your session persists and will receive the
   sub-agent's result whenever it arrives, however long that takes."* And line ~670:
   *"free at the top level, fatal as a sub-agent."* All three failing runs (HEL-671,
   HEL-630, HEL-651) were top-level delivery sessions. The doc tells a top-level
   orchestrator that waiting is costless and that it "will receive the result…
   whenever it arrives" — language that both implies an arriving signal and gives
   permission for exactly the observed behavior. Per the ticket's "Root cause to
   confirm" section ("Confirm whether the role doc anywhere implies a notification
   will arrive, and remove or correct that if so — this is a root cause"), this must be
   named in `design.md` and covered by a task. A new subsection that forbids waiting
   while lines 40–43 still say waiting costs nothing is an internal contradiction the
   change would ship.

4. **Fix the audit grep list in `design.md` "Audit approach" and `tasks.md` 1.1 — it
   would not catch the hit in CR#3.** The listed terms are `notif`, `report back`,
   `let me know`, `will send`, `wait for it to`. "waiting costs nothing", "will
   receive… whenever it arrives", and "free at the top level" match none of them.
   Add at least: `wait`/`waiting` (bare stem), `whenever it arrives`, `will receive`,
   `costs nothing`, `free at the top level`, `persists`. Also state that the audit is
   over `core/roles/orchestrator.md` (the source), not "the rendered role doc" as
   design.md currently says — the fix must land in `core/`.

5. **Task 4 does not commit to the ticket's demonstration bar.** `tasks.md` 4.1's
   primary branch — "explicitly determine sub-agent completion by consuming the
   blocking call's return value" — is what every run does, including the three that
   failed; it demonstrates nothing distinctive and cannot discriminate fixed from
   unfixed. AC #3 requires "a run where a sub-agent completes **without a
   notification** and the orchestrator proceeds on its own". Rewrite 4.1 to make the
   *polling* path the required demonstration, not a parenthetical fallback ("if
   simulating a stalled/no-notification scenario"), with a defined, pre-committed
   procedure: e.g. after a sub-agent returns, the orchestrator independently
   establishes that agent's terminal state from artifacts alone (report file at a
   named path, `git log` on the branch, `workflow-state.md`) and records the concrete
   observations — path, commit SHA, timestamp — in the run notes. A get-out clause
   with no defined trigger is not a plan.

6. **Assign ownership of task 4 and make it verifiable.** Tasks in `tasks.md` are
   worked by the executor, but "the orchestrator polled instead of ending its turn" is
   an *orchestrator* behavior the executor cannot perform or observe. State explicitly
   which role performs 4.1, which role records it, and where the artifact lands
   (a named file path in the change dir). As written, task 4 can be marked complete by
   an executor that never had the ability to demonstrate anything.

7. **Add the "what was NOT verified" requirement to the spec delta or tasks as a
   binding output, not just prose.** Task 4.2 says a report "may not claim the doc
   change alone as sufficient evidence", but nothing defines the required statement's
   location or shape. Require that the executor's report and the evaluator's report
   each contain an explicit, separately-headed section stating (a) the concrete
   polling/artifact observations made, and (b) plainly, what could not be demonstrated
   end-to-end — so the final-gate skeptic has a fixed target to check rather than a
   judgement call about tone.

### Non-blocking notes

- `design.md` "Migration Plan" and `tasks.md` 3.1 say diff `.claude/agents/concertino-orchestrator.md`
  "before/after". Worth capturing the before-copy explicitly (e.g. to the scratch dir)
  as a task step, or the diff is unreproducible after the render overwrites the file.
- The new subsection's placement relative to the `{{block:harnessResume}}` template
  block at `core/roles/orchestrator.md:100` should be stated in the task, since
  "immediately after the Harness resume model section" is ambiguous about whether it
  precedes or follows that block.
- No escalation record artifact for the CON-141 scope-out exists in the worktree; the
  decision is recorded only in `workflow-state.md` NOTES and the change docs. Worth
  citing the escalation event/ref during execution so the final gate can verify it.
