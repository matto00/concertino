## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every finding below is derived from commands I ran myself in the
worktree; the executor's and evaluator's reports were read as claims only.

### What I verified (with evidence)

**Scope / hard constraints**
- `git log --name-only abd71b7..HEAD` — three commits, 21 files. `git log abd71b7..HEAD
  --name-only | grep -Ei 'pricing|report-cost'` returns nothing: neither constrained path
  appears in any of the three commits.
- Main checkout: `scripts/concertino/pricing-table.json` and `report-cost.sh` are still
  untracked (`git ls-files` empty, `git status` shows `??`) with mtime `Aug 25 12:19` —
  untouched. No `concertino sync`, no `cleanup.sh` run by me.

**AC1/AC3/AC4 — parser behaviour, measured against the pre-fix parser**
I built a pre-fix tree (`git archive HEAD` + `git show abd71b7:core/scripts/assert-phase.sh`,
lib deleted) and ran the *shipped* test file against it. Result: **117 passed, 15 failed**.
Every assertion labelled PROOF is genuinely RED pre-fix:
- PROOF 2.1 multi-bullet + internal blank line — pre-fix `FAIL unanswered: Claims checked:`
- PROOF 2.3 bold span in prose — pre-fix `FAIL unanswered: Claims checked:`
- PROOF 2.4 no trailing newline at EOF — pre-fix `FAIL unanswered: Sibling collisions:`
- PROOF 2.5 out-of-order fields — pre-fix `FAIL unanswered: Claims checked:`
- PROOF 2.7a delivery-gate multi-line checklist — pre-fix rc=1
Under the shipped parser all are green (132/132). AC1, AC3 and AC4's bold-span / EOF /
Verdict cases hold.

**Priority 1 — the tautological-assertion risk**
- The repaired parity assertion is genuinely failable: `grep -c 'indexOf("\n", at)'` against
  `git show abd71b7:core/scripts/assert-phase.sh` returns **2** (lines 173 and 311), and the
  assertion expects 0. All three parity assertions are RED pre-fix (`got [0]/[2]/[0]`). The
  over-escaped-BRE defect the evaluator caught is really fixed, not merely re-worded.
- No other new assertion is tautological: every GUARD's own mutation arm was checked, and
  GUARD 2.8's mutation arm is itself RED pre-fix (`GUARD 2.8: failable by mutation` fails
  under the pre-fix parser), so it is not vacuous.

**Priority 2 — PROOF/GUARD labelling honesty**
GUARDs 2.2, 2.6, 2.7b, 2.8 are green under both parsers, exactly as their labels claim, and
each carries a mutation arm that flips the result. The executor's downgrade of 2.8 checks
out: for the shape "empty marker line, `TBD` alone below", the pre-fix parser rejects via its
`""` branch and the fixed parser via its `tbd` branch — identical rc and identical message,
so no distinguishing fixture exists for that shape. The design.md wording ("preserved
behaviour reached by a sounder route") is accurate.

**Priority 3 — extent rule and Verdict**
- `core/scripts/lib/field-answers.js` matches design.md Decision 3: only enumerated markers
  delimit; extents are computed from real positions (`other.at >= found.end`), so out-of-order
  documents cannot yield a negative slice (confirmed by PROOF 2.5).
- The `**Verdict:**` regex `/\*\*Verdict:\*\*\s*([^\n]*)/` and the
  `{no-drift, minor-staleness, material-drift}` vocabulary are byte-unchanged in the diff,
  while `"Verdict:"` is added to the delimiter list and filtered back out of `missing` —
  so it bounds `Sibling collisions:` without becoming a required field. Existing verdict
  mutation tests still pass.

**Priority 4 — renders and drift**
- `cmp core/scripts/assert-phase.sh scripts/concertino/assert-phase.sh` and the same for
  `lib/field-answers.js`: byte-identical.
- `rendered-scripts-drift.test.sh`: **18 passed, 0 failed**.
- I independently reproduced task 4.1's red-then-green claim: in a copy of HEAD with
  `scripts/concertino/lib/field-answers.js` deleted, the drift gate reports
  `never rendered: lib/field-answers.js` and goes **17 passed, 1 failed**. The gate really
  protects the render step, and the count does not rise per rendered file.

**Priority 5 — documentation truthfulness**
- `grep -rniE "tighten|newly (caught|catch)|stricter"` across design.md, proposal.md,
  tasks.md, the spec deltas and the lib: no surviving "this newly tightens" variant. The
  remaining hits are Decision 1's template-tightening discussion and the explicit *negation*
  ("This is *not* a tightening"), which measurement supports.
- `specs/premise-validation/spec.md` and `specs/gate-chain-live-infra-classification/spec.md`
  describe the shipped extent rule accurately. tasks.md's per-task claims match what I
  measured. **One exception — see Change Request 1.**

**Priority 6 — suites re-run by me**
- Full `test/scripts/` suite, every file: all green (assert-phase 132/132, cleanup 153/153,
  squash-branch 86/86, premise-validation-demonstration 9/9, drift 18/18, etc. — 0 failures
  in any file).
- `node --test`: **2253 pass, 0 fail**.
- `scripts/concertino/assert-phase.sh setup <worktree> CON-169` against this run's real
  persisted `premise-validation.md`: `PASS setup`, rc=0.

### Verdict: REFUTE

One finding, narrow but real: this change **loosens** both gates for a shape it never
discloses, and the design document presents that loosening as a pre-existing limitation.

Measured (reproduced twice, plus direct inspection of the extractor):

```
fixture:  - **Claims checked:**
          - **Already-done scope:** none
          - **Sibling collisions:** none found
          - **Verdict:** no-drift

pre-fix parser : rc=1  FAIL unanswered: Claims checked:
shipped parser : rc=0  PASS setup

extractFieldAnswers(...) -> [["Claims checked:","-"], ...]
```

An empty field written as a bullet — the exact style real `design.md` checklists use, and the
style the suite's own PROOF 2.7a fixture uses (`- **What does it execute?**`) — was rejected
before this change and is accepted after it, because the *next* bullet's leading `-` is swept
into the empty field's extent and trims to `"-"` instead of `""`. This applies to both the
`setup` premise-validation check and the `delivery` Gate-Chain Implications Checklist check.

design.md Decision 4 does describe the mechanism, and calls detecting it "out of scope" — but
it frames it as "the one case that is *not* caught", which reads as a limitation inherited
from the old parser. Measurement says the old parser caught it. Given that two cycles of this
same ticket were spent deleting a false claim in the *opposite* direction, the symmetric
obligation applies here. It is also the one place where AC2 ("a field that is genuinely empty
across its whole multi-line extent ... is still reported as unanswered") is not literally met.

### Change Requests

1. **Close, or honestly disclose, the bullet-marker-only loosening.** Preferred: treat an
   extracted answer consisting only of markdown list/whitespace residue as a placeholder in
   `core/scripts/lib/field-answers.js` — e.g. in `missingFields`, after `.trim()`, also treat
   an answer matching `/^[-*+]$/` (or `/^[-*+\s]*$/`) as missing, alongside the existing
   `placeholders` set. That restores pre-fix strictness for this shape and makes AC2 literally
   true. Add a test using the fixture above, labelled **PROOF-in-reverse** (it is RED under
   the *shipped* parser and green under both pre-fix and the corrected one) so the assertion
   is demonstrably failable, and re-`cp` the lib to `scripts/concertino/lib/field-answers.js`.
   Acceptable alternative if the loosening is judged deliberate: leave the code as-is, but
   (a) correct design.md Decision 4 to state plainly that this shape *was* rejected by the
   pre-fix parser and is now accepted — a deliberate, measured loosening, with the reason —
   (b) mirror that statement in the two spec deltas' placeholder wording so the specs do not
   over-promise, and (c) add a GUARD test pinning the current `"-"` behaviour so it is not
   later rediscovered and filed as a bug.

### Non-blocking notes

- `extractFieldAnswers` uses `section.indexOf(marker)` — first occurrence only. A document
  that repeats a field marker binds the first and silently ignores the second. Not reachable
  from the templates in `core/roles/orchestrator.md`, and out of scope here, but worth a
  sentence in the lib's header comment.
- The `specs/premise-validation/spec.md` scenario "The last field's multi-line answer ends at
  end-of-file" is exercised for the `delivery` site (PROOF 2.7a) but not for the `setup` site,
  where `**Verdict:**` is always the terminal marker. Test 2.4's comment is candid about this;
  no action needed, but the spec scenario is slightly broader than its `setup`-side coverage.
- Everything outside Change Request 1 is in good shape — in particular the pre-fix-red
  demonstration discipline is the strongest I have seen on this repo, and it is what let me
  confirm the parity assertion's repair rather than take it on trust.
