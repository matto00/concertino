## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Decision 5's factual claims, re-checked independently (not trusted from design.md's
   prose).**
   - `grep -rl -- "--skip-specs" openspec/changes/archive/ | wc -l` → **16**, matching the
     claim exactly.
   - `openspec/changes/archive/2026-08-01-fix-cleanup-sh-comment-drift/`: confirmed it has
     **no `specs/` directory** (`ls` shows only design.md/proposal.md/tasks.md/
     ticket.md/workflow-state.md/evaluation-1.md/skeptic-design-1.md/skeptic-final-1.md).
     `workflow-state.md` (lines 28-32) states verbatim: "No spec delta written — pure
     comment-only fix... archiving at Delivery will use --skip-specs (the tool's documented
     path for infra/doc-only changes) — matches precedent CON-38
     (codex-worker-dispatch-caution)." This is the precedent design.md cites, and it is
     accurately characterized — same shape (single-file, no-shipped-behavior fix), same
     mechanism (`--skip-specs`), same stated rationale.
   - `openspec validate condition-wait-con180-repro --type change` → `Change
     'condition-wait-con180-repro' is valid`, confirming `.openspec.yaml`'s `skip_specs: true`
     plus empty Capabilities sections satisfy the tool.

   Decision 5 genuinely resolves round 1's change request rather than restating it: round 1
   asked for the `--skip-specs` alternative to be weighed on its own merits, with the false
   "no precedent" premise corrected. The revision does both — cites the precedent by name,
   re-derives the 16-match count itself, and gives an affirmative argument for *this* ticket
   (one file, no shipped behavior, the invented capability would have exactly one consumer)
   rather than leaning on precedent alone.

2. **Is dropping the spec the right call, independently of round 1's framing?** Yes. The
   proposed capability (`test-interleaving-condition-wait`) would have had zero enforcement
   mechanism — openspec has no gate that checks a *new* test file against `openspec/specs/`
   at commit or CI time, so the "requirement" would sit in the tree unread by tooling and, per
   design.md's own honest admission, would make a future unrelated change *appear* to touch a
   spec (a real cost, not a hypothetical one — this repo's own MISTAKES-equivalent lessons
   elsewhere flag "evidence-shaped non-evidence" as a recurring trap). The durable lesson
   (measured margins, why any constant ≤ the poll period is unsafe) is preserved instead as a
   code comment at the wait site (task 2.4) and in this design doc — the actually-checkable
   location. I looked for a counter-argument (some other test elsewhere in the suite that
   *would* benefit from a shared "condition wait for interleaving" contract) and found none in
   the ticket, proposal, or codebase context supplied; nothing suggests this repo has a second
   test needing the same treatment today.

3. **Orphaned references to the deleted capability.** `grep -rn
   "test-interleaving-condition-wait" openspec/changes/condition-wait-con180-repro/` returns
   exactly two hits: Decision 5 itself (explaining what was removed and why — expected,
   historical) and `skeptic-design-1.md` (the round-1 report, a frozen record of the prior
   state — expected, not a live artifact). No stray references in proposal.md, tasks.md, or
   `.openspec.yaml`. `ls openspec/changes/condition-wait-con180-repro/specs` confirms no
   `specs/` directory exists (correctly absent, matching `skip_specs: true`). Impact section in
   proposal.md is internally consistent with the no-capability outcome (states "No `core/`,
   `lib/`, `adapters/`, or `bin/` change" — still true). Task 5.2 correctly reflects the new
   archive invocation (`--skip-specs`), and no other task references the deleted capability or
   a now-nonexistent `specs/` path.

4. **Decisions 1-3 and tasks 4.1-4.3, re-verified from ground truth, not from skeptic-1's
   narrative.** Read `core/scripts/emit-event.sh` lines 620-676 directly: the MALFORMED-branch
   `result` is produced by a synchronous `node -e '...'` command substitution — bash blocks
   until that subprocess exits, and the subprocess only reaches `malformed(...)` /
   `process.stdout.write("MALFORMED:"...)` after `JSON.parse(raw.toString(...))` has already
   run against a **fully read** file. This independently confirms Decision 1's marker
   placement claim (marker after `reason=` is parsed, guaranteed after the read) without
   relying on skeptic-1's transcript. Decision 3's sibling-wait categorization was spot-checked
   against `escalation-loop.test.sh`'s own committed content (not re-verified line-by-line a
   second time, since skeptic-1's citations — line numbers, assertion behavior — are concrete
   and independently falsifiable if wrong; nothing in this round's reading of the surrounding
   file contradicts them). Tasks 4.1/4.2 remain the load-bearing falsifiability check: 4.1
   proves the assertion still goes red absent the fix (guards against an unfailable
   assertion — the ticket's explicit worst-outcome AC), 4.2 proves the new bounded-wait
   check itself is failable (guards against the wait becoming decorative). Both are still
   present in tasks.md, unchanged from round 1's already-confirmed soundness.

### Verdict: CONFIRM

### Non-blocking notes

- Task 5.2's completion criterion ("`openspec/specs/` showing no new or modified capability")
  is slightly imprecise phrasing — the correct check is that no *new* `specs/` entry for this
  change's now-nonexistent capability appears, not that the whole `openspec/specs/` tree is
  untouched (other tickets may land specs concurrently). Not a design defect; worth a one-word
  tightening at execution time but not a gate blocker.
- I did not re-run the pinned/spin-loop margin measurements myself (same call skeptic-1 made:
  that belongs to execution-phase tasks 1.1/1.2, not design soundness). The mechanism claim
  (fixed wait racing an equal-length 1s poll period) is corroborated by direct reading of
  `emit-event.sh`'s poll loop structure, so I am not taking the numbers on faith alone.
