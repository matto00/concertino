## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `8c746fb255e848eea0976dccba019e48e1f4f6e7`.

### What I verified (with evidence)

- Read all five planning artifacts: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/methodology-carryover/spec.md`.
- **Premise (proposal "Why") is TRUE.** `grep -n resum core/roles/executor.md`
  → line 27 "When resumed, DO NOT re-read…", line 224 "On resume, do NOT
  re-read step-1 context". `core/roles/evaluator.md` line 27 "First run only
  (skip on resume)", line 360 "On resume, do NOT re-read stable context
  (ticket/artifacts)". Line 34 "Every run (including resume):" — and
  `executor.md:103` reads `WORKTREE_PATH/<change-dir>/workflow-state.md`. So
  `workflow-state.md` genuinely is the one file re-read on resume. The
  reachability half of the fix is well-founded.
- **`assert-phase.sh` phase list, read directly.**
  `grep -n "^  [a-z]*)" core/scripts/assert-phase.sh` → `setup)` 119,
  `servers)` 232, `delivery)` 247, `cleanup)` 375. The `*)` default at line 392
  prints `FAIL unknown phase '$PHASE' (expected: setup|servers|delivery|cleanup)`
  and exits 2. Re-ran; stable.
- **Orchestrator call sites.** `grep -n "assert-phase.sh" core/roles/orchestrator.md`
  → lines 334 (`setup`), 1005 (`delivery`), 1108 (`cleanup`), plus `servers`
  elsewhere. There is **no** Execution or Evaluation phase assertion, and no
  call site for one.
- **Exit-code vocabulary.** `assert-phase.sh` header: non-zero = phase did not
  complete; body uses `exit 1` (fail) and `exit 2` (unknown phase) only.
  `grep -rn "exit 4" core/scripts/*.sh` → only `check-merge-readiness.sh:563`,
  where 4 is CON-166's `STALE`, explicitly documented as dominated by exit 1.
- **`workflow-state.template.md` invariant.** Line 4: "Holds ONLY ids/paths/
  counters — **never prose procedure**."
- **Roles reading workflow-state.** `grep -rln workflow-state core/roles/` →
  executor, evaluator, orchestrator (skeptic is cold and reads the change dir).

### Verdict: REFUTE

The reachability half (Decision 1, option 1) is sound and correctly argued, and
the Decision 3 placement call is justified — I would not change either. The
mechanical-detection half does not survive contact with the actual scripts: it
targets a phase gate that does not exist, has no defined I/O contract, and — as
specified — cannot see the failure mode the ticket describes.

### Change Requests

1. **`assert-phase.sh` has no `execution` or `evaluation` phase — task 4.3 and
   the spec are unimplementable as written.** `tasks.md:20` says "wire the check
   into `core/scripts/assert-phase.sh` for the `execution` and `evaluation`
   phases", and `specs/methodology-carryover/spec.md:50` says the check "SHALL
   run as part of the **existing** phase-assertion gate for the Execution and
   Evaluation phases". Ground truth: the only phases are
   `setup|servers|delivery|cleanup` (`core/scripts/assert-phase.sh:119/232/247/375`,
   default branch line 392), and the orchestrator only ever invokes `setup`,
   `servers`, `delivery`, `cleanup` (`core/roles/orchestrator.md:334/1005/1108`).
   No such existing gate exists. Decide and write down which it is: (a) add new
   `execution`/`evaluation` phases to `assert-phase.sh` **and** add the
   orchestrator call sites — which is real added scope and must appear as its
   own tasks, including updating the `*)` usage string and the header `Usage:`
   block; or (b) hang the check off an existing gate (`delivery` is the only one
   that runs after execution) or call it directly from `orchestrator.md`. As
   currently written, even a faithful implementation of 4.1–4.4 produces a check
   that is **never executed**, and nothing in the plan would notice.

2. **The check has no defined input contract — it cannot locate either file.**
   Task 4.1 specifies behavior and exit codes but never says what arguments
   `check-constraints-carryover.sh` takes. `workflow-state.md` and `tasks.md`
   live at `WORKTREE_PATH/<change-dir>/…` (`core/roles/executor.md:103`), and
   `assert-phase.sh` receives only `WORKTREE_PATH` — it never derives a change
   dir anywhere today (`grep -n "openspec/changes" core/scripts/assert-phase.sh`
   → one hit, line 281, inside the gate-chain evidence glob, unrelated). Specify
   the signature (e.g. `check-constraints-carryover.sh <WORKTREE_PATH>
   <CHANGE_NAME> [TICKET_ID]`), the change-dir resolution rule, and the behavior
   when either file is absent (a missing `tasks.md` must not be `OK (none)` —
   that is a silent pass on the exact absence the check exists to detect).

3. **Exit 4 collides with two existing contracts; task 4.3's "propagate its exit
   code" would corrupt `assert-phase.sh`'s.** `assert-phase.sh` documents
   non-zero as "phase did not complete" and emits only `1` (fail, with a
   `gate.result status=fail` event at line ~397) and `2` (unknown phase). Exit
   `4` in this repo is CON-166's `STALE` in `check-merge-readiness.sh:563`.
   Propagating 4 out of `assert-phase.sh` both invents a third undocumented code
   there and overloads a code that already means something else. Either map the
   inner 4 to `assert-phase.sh`'s existing `fail`/exit-1 path (and let the script
   keep its own 4 when invoked standalone), or justify the new code explicitly in
   `design.md` and update `assert-phase.sh`'s header contract as a task. Also
   state whether the `gate.result`/`FAIL <reason>` emission still happens on the
   `DIVERGED` path — as written it would be bypassed by an early `exit 4`.

4. **Decision 2's marker design cannot detect the ticket's actual failure mode —
   the check largely relocates the gap rather than closing it.** The only writer
   of the `tasks.md` `- [C<n>]` marker is the *same* orchestrator instruction, in
   the *same* moment, that writes the `CONSTRAINTS` entry (task 2.1). Therefore:
   a constraint the orchestrator never promotes produces **no marker on either
   side**, and the check returns `OK (none)` — passing silently on precisely the
   scenario `ticket.md:6-9` describes. Today's real `tasks.md` methodology text
   is free prose with no markers, so the check is blind to it by construction.
   The only state it can actually catch is a half-completed dual write by a
   single actor within one instruction. That is a much narrower guarantee than
   `design.md:59-70`'s claim that this "closes the *silence* gap" and than the
   `Risks` section's framing (which concedes only the never-written case, not
   that never-written is the *dominant* case). Required: either (a) strengthen
   the trigger so silence is detectable — e.g. fire when `SKEPTIC_CYCLE > 1` /
   a design-gate REFUTE round occurred while `CONSTRAINTS` is still `[]` unless
   the orchestrator has recorded an explicit "no standing constraint agreed"
   acknowledgment — or (b) rewrite Decision 1's claim honestly to say the check
   covers partial-write divergence only, and state in `design.md` why that
   residual is acceptable given the ticket's AC. Do not leave the current
   overstatement standing.

5. **Task 4.2's red-first proof does not prove what the AC demands.** `ticket.md:67-70`
   requires new assertions be "proven to fail against the pre-fix tree", and
   names this batch's "precondition guarantees its own assertion" trap. Task 4.2
   runs the new script against a hand-built fixture **"before wiring it into
   `assert-phase.sh`"** — that only demonstrates a brand-new script's own
   branching, and by design never exercises the wiring. The gate that must go red
   is the *phase assertion*: after wiring, construct a divergent run dir and show
   `assert-phase.sh <phase> …` itself exits non-zero and prints the failure, then
   show it green once reconciled. Add that as an explicit task with pasted raw
   output, and add the negative control the current 4.2 also lacks: the
   pre-fix tree (no markers anywhere) must be shown to pass, so the red is
   attributable to the divergence and not to the fixture.

6. **`CONSTRAINTS` contradicts `workflow-state.template.md`'s own stated
   invariant, and its parse contract is undefined.** Line 4 of the template:
   "Holds ONLY ids/paths/counters — **never prose procedure**." A
   `{"id":"C1","text":"read token values from source, never transcribe them"}`
   entry is prose procedure, verbatim. Task 1.1 adds the field without touching
   that line. Either amend the invariant deliberately (with the reasoning in
   `design.md` — it is a real, defensible change, but it must be a decision, not
   a silent violation) or store a pointer instead of text. Separately, since the
   divergence check must parse this: state the serialization rule for a
   line-oriented file (single line like `PENDING_ESCALATION`? embedded quotes,
   newlines, `:` characters escaped how?) and whether `jq` may be assumed —
   task 4.1 says "extract ids from `workflow-state.md`'s `CONSTRAINTS`" with no
   parsing contract at all, which is the kind of ambiguity that ships a regex
   that breaks on the first realistic constraint text.

### Non-blocking notes

- Decision 3 (Concertino core, not per-repo) is correct and adequately reasoned:
  the resume-skip behavior lives in `core/roles/*.md` and every consuming repo
  inherits it verbatim, so a per-repo fix would be duplicated with no shared
  detection. No revision needed.
- The rejection of option 2 (re-read `tasks.md` everywhere) on CON-146 cost
  grounds is sound.
- `design.md:17-22` ("this run is itself an instance of the problem it fixes")
  is a genuinely good framing; task 5.2 operationalizes it. Keep both.
- AC 2 says "every role doc whose resume path already reads `workflow-state.md`";
  `orchestrator.md` also reads it and is uncovered by tasks 3.1/3.2. It is the
  writer, so this is likely fine — but a one-line "the orchestrator treats
  `CONSTRAINTS` as binding when composing resume input" would close the AC
  cleanly.
- Consider stating whether a constraint can ever be *retired* mid-run (the
  ticket's own example mentions "this exception must be able to expire").
  Currently `CONSTRAINTS` is append-only with no removal semantics, and removal
  would trip the id-diff check.
