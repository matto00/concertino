## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **The bug is real and as described.** `core/scripts/assert-phase.sh:172-175` (setup) reads
  `const lineEnd = section.indexOf("\n", at)` and trims the marker-line remainder only. A marker
  line with an empty remainder trims to `""`, which is in `placeholders` (line 167) → `FAIL
  unanswered`. Confirmed by reading the file at base `abd71b7`.
- **The second occurrence is real, and effectively — but not literally — identical.**
  `diff` of lines 172-175 vs 310-313 (indentation normalised) shows the two extraction lines are
  byte-identical; the only difference is the loop variable name (`f` vs `p`) on the two
  `missing.push(...)` lines. The design's "byte-identical in the relevant lines" is accurate for the
  extraction itself; the claim is sound and Decision 2 is not undermined.
- **The marker-delimited extent rule genuinely handles the enumerated edge cases.** I implemented
  the rule exactly as Decision 3 specifies (positions derived from text, earliest subsequent known
  marker, else section end) in a `/tmp/pv.js` prototype and ran the enumerated fixtures. Results —
  multiline bullet list with internal blank line: PASS; empty-across-extent field: correctly
  reported unanswered naming only that field; bold `**CONFIRMED:**` span inside prose: PASS
  (not truncated); answer ending at EOF with no trailing newline: PASS; fields out of document
  order: PASS with no negative slice; existing single-line shape: unchanged. The separate
  `**Verdict:**` regex still extracted `no-drift` correctly in every case (Decision 5 holds).
- **No regression to existing tests.** `test/scripts/assert-phase.test.sh` mutation cases at
  lines 607-616 (`Sibling collisions: tbd`) and 707-713 (blanked `Sibling collisions:`) both have
  `**Verdict:**` on the immediately following line, so the new extent is `"tbd"` / `""`
  respectively — still FAIL, still naming the field. Verified against the fixture text.
- **Render obligation / constraints are consistent with the tree.** `core/scripts/assert-phase.sh`
  and `scripts/concertino/assert-phase.sh` are identical at base, so the `cp` obligation (task 4.1)
  is the whole of what the CON-172 drift gate needs. No `concertino sync`, no touch of
  `pricing-table.json` / `report-cost.sh` in any task.
- **The gate-chain checklist will not self-trigger.** `ls -a` confirms no `.husky/` in this repo, so
  this delivery's own diff is not classified gate-chain-touching — the design's premise there holds
  and no `## Gate-Chain Implications Checklist` section is owed in this `design.md`.
- **Failability discipline is real, not stated.** Task 3.2 forces reclassification of any PROOF test
  green under both parsers, and the design pre-commits to the pre-fix run as evidence. That is a
  self-correcting rule, not an assertion.

### Verdict: REFUTE

One blocking item: a task that instructs an implementation the file's structure cannot support.

### Change Requests

1. **`tasks.md` 1.1/1.5 and `design.md` Decision 2 mandate a "single shared JS helper" across two
   separate `node -e` processes — not achievable as written.** The setup check
   (`core/scripts/assert-phase.sh:153`) and the Delivery checklist check (line 289) are two
   independent single-quoted `node -e '...'` inline programs, in two different `case` branches
   (`setup)` / `delivery)`) that never both execute in one invocation. There is no shared JS scope
   between them and no precedent in `core/scripts/` for one (all five `node -e` blocks in this file
   are self-contained single-quoted heredoc-style programs). Task 1.5 — "Confirm the two call sites
   share the helper rather than each holding a copy" — therefore either forces a shell variable
   holding JS source interpolated into both `node -e` invocations (a real quoting hazard inside
   single-quoted `node -e`, and a new failure mode in a gate script), or a new external `.js` file
   (which introduces a resolution-path problem for the rendered `scripts/concertino/` copy and a new
   file the CON-172 drift gate does not currently cover). Decision 2's stated benefit — "Fixing both
   is what lets the extraction become one shared helper rather than a third copy of the same logic,
   which is the smaller and more reviewable diff" — rests on that same false premise.
   Required revision: either (a) restate 1.1/1.5 and Decision 2 to accept **the same corrected
   extraction logic applied independently in each `node -e` block** (consistent with the file's
   existing style, and still fixing both sites — Decision 2's actual justification, which stands on
   its own without the shared-helper claim), or (b) if a genuinely shared helper is still wanted,
   specify the sharing mechanism explicitly, including how the rendered `scripts/concertino/` copy
   resolves it and how `test/scripts/rendered-scripts-drift.test.sh` stays at 18/18. Do not leave the
   implementer to choose.

### Non-blocking notes

- _Superseded, see design.md Decision 4 as corrected (final-gate skeptic, CON-169): the "tightening" this note refers to does not exist (measured — both parsers already reject `TBD` regardless of position), and the "loosening" it flags was closed._
- **Decision 4 records the tightening but not the loosening.** A field whose *marker line* holds
  `TBD` but which has substantive content on the lines below now passes, where it failed before
  (verified in the prototype: `tbd_then_content` → no field reported missing). This is arguably the
  correct semantics (there *is* an answer), but it is a behaviour change in the opposite direction
  from the one Decision 4 enumerates and should be recorded there alongside it.
- **Tasks 2.4 (EOF) and 2.5 (out-of-order) are unlabelled PROOF/GUARD, and the natural fixture for
  each is green under the pre-fix parser** — an EOF-terminated answer on the marker line hits the
  pre-fix `lineEnd === -1` branch and passes; an out-of-order single-line document parses fine
  pre-fix. Task 3.2 will catch and reclassify them, so this is not blocking, but pre-labelling them
  GUARD (or writing the EOF fixture with its answer *beginning below* the marker, which is red
  pre-fix) would save a cycle.
- The ticket's and design's phrase "byte-identical second occurrence" is very slightly imprecise —
  the two `missing.push()` lines differ by loop variable name. Immaterial to the fix.
