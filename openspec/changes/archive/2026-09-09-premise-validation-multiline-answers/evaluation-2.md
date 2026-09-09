## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `f65c4f2` (on top of cycle 1's `11e0df5`). Everything cleared in
cycle 1 was re-confirmed undisturbed rather than re-derived, as the orchestrator directed.
All measurements below are my own fresh runs.

### Phase 1: Spec Review — FAIL

Cycle 2 touches no source: `git diff --name-only 11e0df5..f65c4f2` is `design.md`,
`evaluation-1.md`, `files-modified.md`, `workflow-state.md`, `test/scripts/assert-phase.test.sh`.
Nothing under `core/scripts/**` or `scripts/concertino/**` changed, so the cycle-1 verdict on
the extent rule, the Verdict path, and the render obligation carries forward untouched
(re-checked mechanically: both rendered copies still `diff`-identical to their `core/scripts/`
sources).

One artifact-accuracy defect remains — see CR1. It is the same class as cycle 1's CR3, one
bullet above the bullet that was corrected.

### Phase 2: Code Review — PASS

**Cycle-1 CR1 (the tautological parity assertion) — fixed and independently verified failable.**
`test/scripts/assert-phase.test.sh:1003` now reads
`grep -c 'indexOf("\\n", at)'`. My own measurement, not the executor's:

- against `git show abd71b7:core/scripts/assert-phase.sh` → count `2`, and the assertion
  runs RED (`parity: zero remaining first-newline extraction sites` FAILs);
- against the fixed `core/scripts/assert-phase.sh` → count `0`, green.

I re-ran the entire new test block against a reconstructed pre-fix tree. The assertion that
previously printed `ok` on top of two live copies of the old parser now fails there. It clears
its own bar.

**Cycle-1 CR2 (TBD-below-marker) — added, and correctly *down*graded from PROOF to GUARD.**
I asked for a PROOF; the executor added GUARD 2.8 instead and stated why: for that exact shape
the pre-fix parser also rejects the fixture, via its empty-first-line `""` branch, without ever
reading the token. I verified all four combinations myself:

| fixture | pre-fix | fixed |
| --- | --- | --- |
| `**Claims checked:** TBD` (marker line) | FAIL `Claims checked:` | FAIL `Claims checked:` |
| `**Claims checked:**` + `TBD` on next line | FAIL `Claims checked:` | FAIL `Claims checked:` |

The reclassification is correct, and no distinguishing PROOF fixture for this behaviour can
exist (widening an extent can never make a previously-substantive answer become a placeholder,
since the extent strictly contains the first line). GUARD 2.8's failability is real: its
mutation arm flips it. Labelling it GUARD rather than claiming a PROOF it could not earn is the
right call and is exactly the discipline cycle 1 was asking for.

**Cycle-1 CR3 (whitespace-only) — fixed.** design.md now states whitespace-only answers *are*
caught, and correctly narrows the uncaught case to bullet-marker-only, with the sweep mechanism
explained and cross-referenced to GUARD 2.7b's fixture comment. Matches my probe.

**Escaping sweep — performed, correctly scoped, and independently re-verified by me.** I
enumerated every pattern-bearing line either commit added under `test/scripts/`: three `grep`
assertions and four `sed -i` mutations.

- `grep -c 'require(process.argv\[2\])'` — `\[` is a correct BRE literal; RED against the
  pre-fix script (0 vs expected 2). Failable.
- `grep -c 'indexOf("\\n", at)'` — RED (2). Failable.
- `grep -o '"\${SCRIPT_DIR}/lib/field-answers\.js"'` — RED against the pre-fix script. Failable.
- The four `sed -i` mutation patterns are self-checking by construction: a no-op `sed` leaves
  the fixture in its pre-mutation state, which is the opposite of what the following assertion
  demands, so a silently-non-matching pattern turns its own test red. All are green, so all
  four genuinely matched.

No second instance of the escaping defect exists. The executor's sweep conclusion is correct;
I confirmed it rather than accepting it.

**Gates (my own runs):**
- Every `test/scripts/*.test.sh` — all green (filtering for any file not reporting `0 failed`
  returned nothing). `rendered-scripts-drift.test.sh` still 18/18, count unchanged as designed.
- `npm test` (full suite, including `node --test`) — rc=0.
- `core/scripts/assert-phase.sh` vs `scripts/concertino/assert-phase.sh` — identical;
  `lib/field-answers.js` likewise. No re-render was needed and none was done.
- Hard constraints: `pricing-table.json` and `report-cost.sh` appear in neither commit
  (`git diff --name-only 11e0df5~1..HEAD`), and both remain untracked and unmodified in the main
  checkout (mtimes still Aug 25 12:19). No `concertino sync`, no `cleanup.sh`.

**Evidence transcript** was extended with a cycle-2 section recording the buggy-vs-corrected
pattern counts and the GUARD 2.8 both-parsers result. Its numbers match mine exactly, and it is
candid that the pre-fix parser catches 2.8 "coincidentally".

### Phase 3: UI Review — N/A

CLI/shell/JS repo, no UI-affecting files. No dev servers started.

### Overall: FAIL

Doc-only. All executable behaviour and all test quality is now verified clean; the single
remaining item is one false sentence in the binding decision record.

### Change Requests

1. **`design.md:120-122` (Decision 4, second bullet) still claims a gate-tightening that does
   not exist.** It reads: "A field answered only with `TBD` on the following line now trims to
   `tbd` and is *newly* caught; before this change it slipped through only if it was on the
   marker line. This strictly tightens the gate and is the correct direction." Every clause is
   wrong, and the cycle-2 commit message itself contradicts it ("the pre-fix parser ALSO rejects
   it ... coincidentally"). Measured, all four cases:
   - `TBD` on the marker line: caught by *both* parsers (it matched `placeholders` directly), so
     it never "slipped through";
   - `TBD` on the line below: caught by *both* parsers (pre-fix via the `""` branch, fixed via
     the `tbd` branch), so nothing is "newly caught".

   There is no newly-caught case at all, and the change cannot "strictly tighten" placeholder
   detection in either direction — widening an extent can only ever turn a placeholder answer
   into a non-placeholder one, never the reverse. Replace the bullet with what the evidence
   supports, e.g.: an answer consisting only of a placeholder token is reported unanswered
   whether it sits on the marker line or below it; the pre-fix parser reached the same verdict
   for the below-marker shape via its empty-first-line branch, so this is preserved behaviour
   reached by a sounder route, not a tightening — and this is why the covering test
   (GUARD 2.8) is a guard rather than a proof. This keeps Decision 4 consistent with the test
   labelling it justifies.

### Non-blocking Suggestions

- (Carried from cycle 1, still open, still non-blocking.) Test 2.4's name promises "ending at
  EOF, no trailing newline", but that fixture's `**Sibling collisions:**` extent is bounded by
  the following `**Verdict:**` marker, so no extent terminates at EOF there. The real
  EOF-with-no-trailing-newline path is exercised by 2.7a through the same shared function, so
  coverage exists; only the name over-promises.
- (Carried from cycle 1.) `tasks.md` 2.2 still calls the empty-extent test a PROOF; the shipped
  test is correctly a GUARD.
