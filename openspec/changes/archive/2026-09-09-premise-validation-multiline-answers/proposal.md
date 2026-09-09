# Proposal: premise-validation gate accepts multi-line field answers

## Why

`core/roles/orchestrator.md` Setup step 2 asks every run to write a `premise-validation.md`
whose `**Claims checked:**` field holds "one line per cited fact/root-cause claim". For any
real multi-claim ticket that means a bullet list beneath the bold label. The `setup` gate in
`core/scripts/assert-phase.sh` reads each field's answer only as far as the first newline after
its `**<field>:**` marker, so a well-formed multi-line artifact leaves an empty remainder on the
label line, which matches the `""` placeholder and is reported as `FAIL unanswered: Claims
checked:`.

The gate therefore rejects the exact shape the prompt asks for, and the error message says the
field is unanswered when it is answered at length directly below. The undiscoverable workaround
— summarise on the label line, keep detail beneath — is what four consecutive delivery lanes
independently converged on, at a cost of roughly one cycle each.

## What Changes

- Field-answer extraction in the `setup` gate's premise-validation check reads to the next field
  marker or section boundary instead of to the first newline, so a multi-line answer is seen in
  full.
- Placeholder detection is applied to the whole extracted answer, so a genuinely empty or
  `TBD`-only multi-line field is still reported unanswered — whether the placeholder sits on the
  marker line or alone on the line below it, both the pre-fix and fixed parsers already reach the
  same "unanswered" verdict (the pre-fix parser by a coincidental empty-first-line match, the
  fixed parser by actually reading the placeholder text), so this is preserved behaviour reached
  by a sounder route, not a tightening. See `design.md` Decision 4.
- The extraction logic moves into a new `core/scripts/lib/field-answers.js`, `require()`d by both
  `node -e` programs via the existing `SCRIPT_DIR` idiom — the two checks are separate node
  processes and cannot share an in-file function.
- The identical parser guarding the Delivery gate's `## Gate-Chain Implications Checklist` in the
  same file is fixed the same way, in the same change (see `design.md` Decision 2).
- `test/scripts/assert-phase.test.sh` gains coverage for multi-line answers, single-line
  regression, empty-multi-line placeholder detection, bold spans inside answer prose, and
  EOF-terminated answers.
- The rendered copies `scripts/concertino/assert-phase.sh` and `scripts/concertino/lib/field-answers.js`
  are refreshed/created by direct `cp` so the CON-172 drift gate stays green. Its assertion count
  stays 18/18 — a skipped `cp` surfaces as assertion 1.1 going red under `never rendered:`, not as
  a count change. See `design.md` Decision 2 for the single authoritative statement.

## Capabilities

- `premise-validation` — MODIFIED: the field-completeness requirement is restated to define the
  answer's extent explicitly, rather than leaving it implicitly line-bounded.
- `gate-chain-live-infra-classification` — MODIFIED: the same restatement for the checklist
  prompts.

## Non-Goals

- Tightening the orchestrator template to demand single-line answers (rejected — see `design.md`
  Decision 1).
- Any change to the set of required fields, the placeholder vocabulary, the verdict vocabulary,
  or the material-drift escalation requirement.
- Running `concertino sync`.
