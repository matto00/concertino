# Tasks

## 1. Extract the shared field-answer parser

- [x] 1.1 Add `core/scripts/lib/field-answers.js` exporting one function that, given a section
      string and a list of marker labels, returns each label's answer as the span from the end of
      its marker to the earliest subsequent occurrence of any marker in the list, or the section
      end. Positions are derived from the text, never from declared field order. A file — not an
      in-file function — because the two call sites are separate `node -e` processes in different
      `case` branches and share no JS scope.
- [x] 1.2 Apply the existing `placeholders` set to the whole trimmed span; preserve the exact
      `FAIL unanswered: <a> | <b>` output format so downstream callers and existing tests are
      unaffected.
- [x] 1.3 Wire the `setup` premise-validation check to the helper, passing the three required
      fields plus `**Verdict:**` as delimiters (Verdict delimits but is not itself required by
      this check — it keeps its own separate regex validation, unchanged).
- [x] 1.4 Wire the Delivery gate's Gate-Chain Implications Checklist check to the same helper
      with its five prompts.
- [x] 1.5 Both `node -e` programs `require()` the lib via the absolute path derived from the
      existing `SCRIPT_DIR`, passed as an argv element (never interpolated into the single-quoted
      JS body). Confirm neither site retains a private copy of the extraction logic.
- [x] 1.6 Add a parity assertion **in `test/scripts/assert-phase.test.sh`** (not a runtime check
      inside `assert-phase.sh`) that both call sites resolve the lib to the same file, so a future
      edit cannot silently fix one site only.

## 2. Tests

- [x] 2.1 Add to `test/scripts/assert-phase.test.sh`: a premise-validation fixture whose
      `**Claims checked:**` is a multi-bullet list (with an internal blank line) beneath an empty
      marker line — expect PASS. Labelled a PROOF test.
- [x] 2.2 Add a fixture whose `**Already-done scope:**` is empty across its whole extent — expect
      `FAIL unanswered:` naming exactly that field. Placeholder detection survives, but this fails
      identically under the pre-fix parser too (empty marker line matches its `""` branch
      trivially), so the shipped test is correctly labelled a GUARD, not a PROOF, with failability
      demonstrated by mutation.
- [x] 2.3 Add a fixture whose multi-line answer contains a bold span in prose — expect PASS.
- [x] 2.4 Add a fixture whose last field's answer ends at EOF with no trailing newline — expect
      PASS.
- [x] 2.5 Add a fixture with fields written out of document order — expect PASS (no negative slice).
- [x] 2.6 Add a single-line-answer fixture, labelled explicitly as a GUARD (expected to pass under
      both parsers); demonstrate its failability by mutation rather than by the pre-fix run.
- [x] 2.7 Add the equivalent multi-line and empty-extent cases for the Gate-Chain Implications
      Checklist site.
- [x] 2.8 Assert on the specific `FAIL unanswered:` text and field name, never on exit status
      alone, so an unrelated failure cannot be mistaken for the behaviour under test.

## 3. Failability evidence

- [x] 3.1 Run the new tests against the pre-fix parser (`git show abd71b7:core/scripts/assert-phase.sh`)
      and capture the transcript.
- [x] 3.2 Confirm every test labelled PROOF is RED under the pre-fix parser. Any PROOF test that
      is green under both parsers is reclassified as a GUARD and labelled, or replaced.
- [x] 3.3 Persist the transcript as run evidence.

## 4. Render + gates

- [x] 4.1 BEFORE copying anything: run `test/scripts/rendered-scripts-drift.test.sh` and confirm
      it is RED, with assertion 1.1 naming `lib/field-answers.js` under `never rendered:`. Capture
      that output. This demonstrates the gate genuinely protects the render step rather than
      asserting it does.
- [x] 4.2 `cp core/scripts/assert-phase.sh scripts/concertino/assert-phase.sh` and
      `cp core/scripts/lib/field-answers.js scripts/concertino/lib/field-answers.js` (never
      `concertino sync`). Do not touch `scripts/concertino/pricing-table.json` or
      `report-cost.sh`.
- [x] 4.3 Re-run the drift test and confirm it returns to 18/18 green — the count does NOT rise
      per rendered file; 1.1 is a single whole-tree assertion. Then run the full `test/scripts/`
      suite; `assert-phase.test.sh` must be fully green, and
      `test/scripts/premise-validation-demonstration.test.sh` — which exercises the real rendered
      `scripts/concertino/assert-phase.sh` against premise-validation fixtures, and is therefore
      the closest existing regression surface to this change — must be green too.
- [x] 4.4 Run this run's own `assert-phase.sh setup` against the real CON-169 evidence to confirm
      no self-inflicted regression.
- [x] 4.5 Commit with the `CON-169` prefix.
