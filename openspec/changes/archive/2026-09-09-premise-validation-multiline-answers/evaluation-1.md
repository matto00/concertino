## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `11e0df5`. All gate runs below are my own fresh runs, not the
executor's reported ones.

### Phase 1: Spec Review — PASS

- AC1 (multi-line extent at the `setup` site) — met. `core/scripts/lib/field-answers.js`
  computes each field's extent from the end of its marker to the earliest *subsequent*
  known marker, or the section end.
- AC2 (placeholder detection over the whole extent) — met in code. I probed the lib
  directly: `TBD` on the line below a marker → reported unanswered; whitespace-only
  extent → reported unanswered; empty extent → reported unanswered. **Untested**, see CR2.
- AC3 (single-line no regression) — met; GUARD 2.6 plus the entire pre-existing
  premise-validation block (128/128 green) covers it.
- AC4 (bold span, EOF, Verdict) — met. Verdict keeps its own separate regex + vocabulary
  validation, unchanged in the diff; it is added to the marker set as a *delimiter* only
  and filtered out of the required-field list, so an absent Verdict still falls through to
  the `invalid verdict` path (probed: `missingFields` returns `["Verdict:"]`, filtered,
  then the regex path reports it). See non-blocking note 1 on where the EOF case is
  actually exercised.
- AC5 (design records the direction + the second-occurrence decision) — met; design.md
  Decisions 1 and 2 are explicit, including the correction that the "shared helper" is a
  file rather than a scope because the two sites are separate `node -e` processes.
- AC6 (PROOF tests demonstrated red against the pre-fix parser) — met and independently
  verified, see Phase 2.
- AC7 (rendered copy updated) — met, byte-identical, drift gate 18/18.
- Scope: no creep. The only extra file touched is the second parser occurrence, whose
  inclusion is an explicit, reasoned design decision the ticket asked for.
- Spec deltas (`premise-validation`, `gate-chain-live-infra-classification`) accurately
  describe the shipped extent rule; `openspec validate --strict` is clean.
- HARD CONSTRAINTS respected: `scripts/concertino/pricing-table.json` and
  `scripts/concertino/report-cost.sh` are absent from the commit and still untracked and
  unmodified in the main checkout (mtimes Aug 25). Only `assert-phase.sh` and
  `lib/field-answers.js` changed under `scripts/concertino/` — consistent with a direct
  `cp`, not a `concertino sync` run.

### Phase 2: Code Review — FAIL

**Gates (my own runs):**
- `npm test` (full suite) — rc=0, no failures.
- `test/scripts/*.test.sh` individually — all green; `assert-phase.test.sh` 128/0;
  `rendered-scripts-drift.test.sh` 18/18; `premise-validation-demonstration.test.sh` 9/0.
- `diff core/scripts/assert-phase.sh scripts/concertino/assert-phase.sh` — identical.
  `diff core/scripts/lib/field-answers.js scripts/concertino/lib/field-answers.js` — identical.
- Render red-then-green independently reproduced: with
  `scripts/concertino/lib/field-answers.js` removed, the drift test goes 17/1 with
  assertion 2.12 and the real-tree check naming `lib/field-answers.js` under
  `never rendered:`; restored → 18/18. The executor's claim holds.
- `scripts/concertino/assert-phase.sh setup <worktree> CON-169` against this run's real
  evidence → `PASS setup` (rc=0). Notably that artifact is itself the multi-line shape the
  fix exists to accept.
- `prettier --check core/scripts/lib/field-answers.js` — clean.

**Failability verification (AC6), done independently rather than read from the transcript:**
I reconstructed the pre-fix script (`git show abd71b7:core/scripts/assert-phase.sh` over a
copy of `core/scripts/`) and re-ran the whole new test block against it. Result:

- Every PROOF assertion is RED under the pre-fix parser and green under the fixed one:
  2.1 (multi-bullet w/ internal blank line), 2.3 (bold span in prose), 2.4, 2.5
  (out-of-order), 2.7a (gate-chain multi-line). No PROOF test is green under both parsers.
- Every GUARD is green under both parsers, exactly as labelled, and each carries a real
  mutation that flips it (2.2, 2.6, 2.7b). The label/behaviour split is honest.
- The persisted transcript at
  `.concertino/runs/CON-169/evidence/.concertino/tmp/pre-fix-parser-transcript.txt`
  matches what I observed, and is honest about two earlier 2.7a attempts that failed for
  the wrong reason before the fixture was corrected.

**Code quality:** the lib is small, single-purpose, well-commented, and derives extents
from real positions (guarding the negative-slice case). Both `node -e` sites pass the lib
path as an argv element rather than interpolating it into the single-quoted JS body, which
is the right call. No dead code, no leftover TODOs. The old parser is genuinely gone: my
own `grep -c 'indexOf("\n", at)'` returns 2 on the pre-fix script and 0 on both the core
and rendered copies.

**Finding (blocking): one new assertion is a tautology of exactly the CON-170 class.**
See CR1. This is the only Phase-2 blocker; the shipped behaviour is correct, but a guard
shipped as coverage that can never fail is not coverage.

### Phase 3: UI Review — N/A

CLI/shell/JS repo; no UI-affecting files in the diff. No dev servers started.

### Overall: FAIL

### Change Requests

1. **`test/scripts/assert-phase.test.sh:1003` — the "zero remaining first-newline
   extraction sites" parity assertion can never fail.** The pattern is written as
   `grep -c 'indexOf("\\\\n", at)'`. Inside single quotes that is a BRE for `indexOf("`
   + *two* literal backslashes + `n", at)`, which matches nothing in any version of the
   script. Proof: run it against the pre-fix script, which contains the old parser twice —
   `grep -c 'indexOf("\\\\n", at)' <pre-fix> → 0`, while the correct pattern
   `grep -c 'indexOf("\\n", at)' <pre-fix> → 2` and `→ 0` on the fixed script. This is
   confirmed end-to-end: running the new test block against the pre-fix parser, this
   assertion prints `ok` while sitting on top of two live copies of the very code it
   claims to forbid. Change line 1003 to
   `OLD_PARSER_COUNT="$(grep -c 'indexOf("\\n", at)' "$SCRIPT" || true)"` and confirm the
   assertion goes RED against `git show abd71b7:core/scripts/assert-phase.sh` (expecting
   `got [2]`) and stays green against the fixed script.

2. **No test covers AC2's placeholder-token case over a multi-line extent.** design.md
   Decision 4 claims a *newly-caught* behaviour ("a field answered only with `TBD` on the
   following line ... is newly caught; before this change it slipped through"). The only
   `tbd` fixture in the file (line 610) is the pre-existing single-line one, which was
   already caught before this change; the new tests cover only the empty-extent case. I
   verified by direct probe that the claimed behaviour does work, but a claimed
   gate-tightening with no test is untested behaviour. Add a PROOF fixture to
   `test/scripts/assert-phase.test.sh` with `**Claims checked:**` empty on its marker line
   and `TBD` alone on the next line, asserting
   `FAIL unanswered: Claims checked:`, and demonstrate it RED against the pre-fix parser
   (which passes that fixture) as AC6 requires.

3. **`design.md:123` states a behaviour the implementation does not have.** Decision 4
   says "A whitespace-only or bullet-marker-only answer (`-` with no text) is **not**
   treated as a placeholder." The bullet-marker half is correct; the whitespace-only half
   is not — the extent is `.trim()`ed, so a whitespace-only answer becomes `""` and *is*
   reported unanswered (probed directly). That is the correct and intended behaviour, and
   it contradicts the sentence three bullets above it in the same decision. Drop
   "whitespace-only or" from that sentence so the binding decision document matches what
   shipped.

### Non-blocking Suggestions

- Test 2.4 is named "multi-line answer ending at EOF, no trailing newline", but in that
  fixture `**Sibling collisions:**`'s extent is bounded by the following `**Verdict:**`
  marker, so no extent actually terminates at EOF there. It is still a valid PROOF (red
  pre-fix for the multi-line reason) and the true EOF-with-no-trailing-newline extent path
  *is* exercised — by 2.7a's last checklist prompt, through the same shared lib function.
  Consider renaming 2.4 to what it actually proves, so the premise-validation spec
  scenario "The last field's multi-line answer ends at end-of-file" is not credited to a
  test that does not reach that branch.
- `tasks.md` 2.2 still reads "PROOF that placeholder detection survives" while the shipped
  test is correctly labelled a GUARD (the reclassification task 3.2 asks for). The test is
  right; the task line is stale.
