## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Judged afresh against the live tree at base abd71b7; prior rounds' findings re-derived, not assumed.

### What I verified (with evidence)

- **Ticket premise is real.** `core/roles/orchestrator.md:245` does specify
  `**Claims checked:** <one line per cited fact/root-cause claim, ...>`, and
  `core/scripts/assert-phase.sh:173-174` reads only to `section.indexOf("\n", at)` with
  `placeholders` containing `""`. The multi-line shape the prompt asks for does fail.
- **Decision 2's second site exists and is byte-identical in the relevant lines.**
  `assert-phase.sh:311-312` repeats the same two lines verbatim for the five
  `## Gate-Chain Implications Checklist` prompts (markers there are `**<prompt>**`, no
  colon — the delta's `**<prompt>**` wording matches). The two `node -e` programs begin at
  lines 153 and 289 in different `case` branches, so R1's "cannot share an in-file
  function" correction is confirmed correct and the `core/scripts/lib/field-answers.js`
  remedy is the right mechanism; `SCRIPT_DIR` at line 29 and the
  `source "${SCRIPT_DIR}/lib/git-child-env.sh"` idiom at line 31 exist as cited, and
  `core/scripts/lib/` + `scripts/concertino/lib/` both already exist as render targets.
- **PRIORITY 1 — gate-chain MODIFIED delta faithfully reproduces the baseline.** Programmatic
  diff of the delta's `### Requirement: Delivery blocks on missing gate-chain evidence` against
  the identically-titled baseline requirement in
  `openspec/specs/gate-chain-live-infra-classification/spec.md`: the diff is **purely additive**
  — one "Answer extent (CON-169)" paragraph and two new scenarios. Every baseline sentence,
  bullet and all five baseline scenarios are reproduced byte-for-byte. Archiving will replace,
  not truncate or duplicate. Header matches the baseline exactly, so R3(b) is closed.
- **Same check on the premise-validation delta.** Diff against the baseline
  `### Requirement: assert-phase.sh fails the setup gate when the premise-validation evidence
  is missing or incomplete` is likewise purely additive (one paragraph + four scenarios), all
  three baseline scenarios reproduced verbatim.
- `npx openspec validate --changes --strict` → `1 passed, 0 failed`.
- **PRIORITY 2 — no stale drift-gate count survives.** `grep -rn "19/19|18/18|assertion count|assertions"`
  across the change dir returns four hits (tasks.md:62, proposal.md:36-37, design.md:79,
  design-gate-budget-decision.md:24) and all four say 18/18 or describe the corrected history.
  No `18→19` claim remains anywhere. R2/R3(a) closed.
- **The 18/18 claim is itself true and the failure mode is as described.** Ran
  `test/scripts/rendered-scripts-drift.test.sh` on the live tree: `18 passed, 0 failed`. Its
  enumeration is `(cd "$core_dir" && find . -type f)` (line 87) — a recursive whole-tree walk
  reported as a single assertion, with a `never rendered:` bucket (line 102). So a skipped `cp`
  of `lib/field-answers.js` does turn assertion 1.1 red without changing the count, exactly as
  Decision 2 and task 4.1/4.3 state. Re-ran the suite a second time to rule out a flaky reading.
- **Constraints respected in the plan.** Task 4.2 uses direct `cp` and explicitly excludes
  `pricing-table.json`/`report-cost.sh`; no task invokes `concertino sync`.
- **Scope/AC coverage.** AC1→D1+D3+tasks 1.1-1.5; AC2→D4+2.2; AC3→2.6 (correctly labelled a
  GUARD with mutation-based failability, per the red-vs-guard distinction); AC4→2.3/2.4/2.5+D5;
  AC5→D2 (explicitly decides "fix both, in this change"); AC6→3.1-3.3 against
  `git show abd71b7:core/scripts/assert-phase.sh`; AC7→4.2/4.3. No task exceeds the ACs.
- No `.husky/` exists in this repo, so this change is not gate-chain-touching and needs no
  Gate-Chain Implications Checklist of its own — consistent with Decision 2's exposure argument.
- No placeholders/TODO/TBD or unresolved decisions remain in proposal/design/tasks; Decision 3
  correctly rejects blank-line delimiting (which would truncate an intro-sentence-plus-bullets
  answer) and Decision 5 correctly keeps `**Verdict:**` on its own regex while adding it to the
  delimiter set so `Sibling collisions:` cannot swallow it.

No scratch files were created; nothing in the tree was modified.

### Verdict: CONFIRM

### Non-blocking notes

- The gate-chain delta introduces a **doubled blank line** before the "Answer extent (CON-169)"
  paragraph (baseline body → two blank lines → new paragraph). Harmless to OpenSpec, but it
  will land in the archived spec; collapse to one when editing next.
- Task 1.6's parity assertion ("both call sites resolve the lib to the same file") is the least
  concretely specified task. A simple realization — assert `assert-phase.sh` contains exactly
  two `require(...)`s of the lib and zero remaining `indexOf("\n", at)` occurrences — would
  satisfy both 1.5 and 1.6; worth pinning during execution so the assertion cannot degrade into
  a tautology.
- Decision 3 accepts that an answer containing a *literal* other field marker (e.g. the string
  `**Verdict:**` inside Claims-checked prose) will truncate. That is a reasonable, documented
  restriction, but note the pre-existing `**Verdict:**` regex takes the section's first match,
  so such a document would also mis-extract the verdict today. Unchanged behaviour, not a
  regression — no action required.
