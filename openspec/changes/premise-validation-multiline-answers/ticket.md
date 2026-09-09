# CON-169: premise-validation gate rejects the multi-line answer format the orchestrator's own template asks for

## Description

`core/roles/orchestrator.md` (Setup step 2) specifies the premise-validation artifact shape as `**Claims checked:** <one line per cited fact/root-cause claim, each tagged CONFIRMED | STALE | UNVERIFIABLE, with what was found>`. "One line per claim" naturally produces a bullet list beneath the bold label — which is what a multi-claim ticket needs, since a real premise check covers several independent claims.

`scripts/concertino/assert-phase.sh` (the `setup` gate) reads only up to the first newline after each `**<field>:**` marker:

```js
const lineEnd = section.indexOf("\n", at);
const answer = (... section.slice(at + marker.length, lineEnd)).trim();
if (placeholders.has(answer.toLowerCase())) missing.push(f);
```

An empty remainder of that line hits the `""` placeholder case, so a well-formed multi-line answer is reported as `FAIL unanswered: Claims checked:` even though the content is right there on the following lines.

Impact: costs a cycle per run, and the failure message actively misleads — it says the field is unanswered when it is answered at length. The workaround (cram a summary onto the label line, keep the detail below) is undiscoverable from the error. Field-confirmed on four consecutive delivery lanes.

Directions considered (not decided by the ticket; picking is this ticket's job):
- Read the field's answer to the next `**<field>:**` marker or blank-line-delimited block rather than to the first newline.
- Or tighten the orchestrator template to demand a single-line answer and say so explicitly.

The first preserves the more useful artifact.

## Acceptance Criteria

1. The `setup` gate's premise-validation check in `core/scripts/assert-phase.sh` accepts a field whose answer begins on the line(s) *below* its `**<field>:**` marker (e.g. a bullet list), treating the answer as everything up to the next field marker / section boundary rather than to the first newline.
2. Placeholder detection still works: a field that is genuinely empty across its whole multi-line extent (or contains only `TBD`/`N/A`/`NA`/`TODO`) is still reported as unanswered.
3. The single-line form that works today continues to work unchanged (no regression for existing artifacts).
4. Parsing edge cases are handled and covered by tests: a bold `**...**` span appearing inside an answer's prose must not be mistaken for a field marker; an answer that ends at EOF with no trailing newline is read correctly; the `**Verdict:**` field remains correctly extracted and validated.
5. The chosen direction is recorded with its reasoning in `design.md`, including the explicit decision on whether the byte-identical second occurrence of the same parser (the Delivery gate's `## Gate-Chain Implications Checklist` check in the same file) is fixed in this change or deferred.
6. New tests live under `test/scripts/`, follow the repo's existing script-test conventions, and each asserts on a fixture that genuinely fails under the pre-fix parser — demonstrated by running the new tests against the pre-fix `assert-phase.sh` and recording the observed failures as evidence.
7. Because `core/scripts/assert-phase.sh` changes, the rendered copy at `scripts/concertino/assert-phase.sh` is updated in the same delivery so `test/scripts/rendered-scripts-drift.test.sh` stays green.

## Constraints

- Do NOT run `concertino sync` anywhere. Update the rendered `scripts/concertino/` copy by direct `cp` from `core/scripts/`.
- Do not touch, delete, move, commit or render over `scripts/concertino/pricing-table.json` or `scripts/concertino/report-cost.sh` (untracked in the main checkout, pending owner ruling CON-173).
