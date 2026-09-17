## Skeptic Report — design gate (round 3, FINAL, skeptic-design-3.md)

Fresh, cold read. Did not trust round 1/2's or the executor's narrative — every claim below was re-derived from the repo, live Linear, or both.

### Round 2 change requests — verified genuinely closed, not reworded

1. **CR1 (tier overlap).** design.md Decision 8a now states the recovered tier is computed as `recovered \ provenance`, keyed on ticket id, with a rendered exclusion disclosure. tasks.md 4.4a requires a fixture ticket with BOTH a `ticket.filed` event and convention-matching text, asserting it is present in provenance, ABSENT from recovered, the exclusion count prints, and explicitly requires the test to fail if dedupe is removed (a real mutation-style control, not a presence check). 4.4b requires asserting the two rendered populations' intersection is empty for an arbitrary mixed fixture. Spec.md gained a full new Requirement ("The recovered tier excludes rows the provenance tier already counted") with three scenarios matching these tasks, plus standing constraint C4. **Closed in substance.**
2. **CR2 (origin_role overclaim).** Re-read `scripts/concertino/emit-event.sh` myself: `grep -n "ORIGIN_ROLE"` returns exactly 3 lines — 273 (declaration), 366 (assignment), 510 (`if [ -z "$ORIGIN_ROLE" ]`, presence-only). No enum/case validation of `origin_role`'s value exists anywhere in the file. design.md's Context bullet (line 11) now states this precisely, including that `origin_role=banana` would be accepted today, and explicitly narrates why the old wording was wrong (conflating `origin_role` with the real closed-set validation on the separate `role=` field). The passage does quote the old wrong wording, but only to correct it in the same sentence — read in context this is accurate, not a residual overclaim. **Closed.**
3. **CR3 (CON-213 provenance contradiction).** Pulled CON-213 live via `mcp__linear__get_issue`: description now reads `origin_role: skeptic` under "## Provenance", with an explicit "Provenance-record correction" paragraph disclosing the original `orchestrator` default, why it was wrong, and that it's now corrected to match the emitted event (`origin_role=skeptic`, confirmed independently via `grep CON-213 .concertino/runs/CON-192/events.jsonl` → line 13 carries `origin_role":"skeptic"`). design.md Decision 11 carries the matching disclosure. **Closed**, and the ticket's own "Note on measurement" and acceptance criteria now require the emitter fix to thread the role into ticket description text too, so the same class of drift can't recur silently.
4. **CR4 (stale counts).** design.md's Context bullet now states the CON team held 211 pre-filing / 212 post-filing, with the 159-completed figure marked pre-filing; both occurrences of the count are consistently timestamped, not merely one. **Closed.**

### Decision 8a dedupe semantics (item 2 of the brief)

The dedupe (`recovered \ provenance`, by ticket id) is directionally correct and matches the stated failure mode (CON-213 counted in both tiers). I looked for the specific distortion asked about — does dedupe create a systematic trend artifact given provenance coverage grows from zero over time?

- For the **historical decline period the ticket exists to explain (W33–W38)**, provenance was uniformly zero throughout (design.md: "`ticket.filed` count across both corpora is 0" until this run's own CON-213 filing, which postdates that window). Since there is nothing to dedupe against in that window, the recovered-tier per-period figures for the actual trend in question are unaffected by 8a — this is not a live distortion of the analysis the ticket was written to perform.
- Going forward, once CON-213 ships and provenance accrues, the mechanism the reviewer is right to worry about is real in principle: as more tickets acquire genuine `ticket.filed` events, a growing share of what would have been recovered-tier rows migrates into the provenance tier, so a naive reader comparing recovered-tier *volume* across periods could misread "provenance grew" as "follow-up filing dropped." Nothing in design.md or the spec currently calls this out as an interpretive caveat for future readers of the per-period recovered table.
- This is a genuine forward-looking gap, but it is a **documentation/interpretation gap, not a computation defect** — the dedupe itself is correct (each ticket counted exactly once, in the tier that actually has provenance for it), and it does not corrupt the report this change ships for the corpus that exists today. **Carry-into-execution**, not blocking: add a rendered or spec-level caveat that a declining recovered-tier volume over time should be read alongside provenance-tier growth, not in isolation, once both tiers have periods with data.

### Small-n + dedupe + honest-emptiness — leak check (item 3)

Traced the full chain: today's live corpus, post-CON-213, is provenance n=1 (CON-213) and recovered n=1 (CON-209, since CON-213 is excluded by 8a's dedupe). Both are below the stated minimum of 5, so both are suppressed under C3/task 1.6a — no percentage prints for either tier under current live data. The exclusion-count disclosure ("N rows excluded") is a bare count, never rendered as a rate, so it cannot itself look authoritative. Median age of non-survivors has no suppression floor, but a median of exact tickets' real ages is a fact, not a population-level rate claim, so it doesn't fit the "authoritative-looking number over untrustworthy input" failure mode Decision 10 targets. I found no path by which the current design prints a percentage over an untrustworthy denominator.

One process gap worth naming (carry-into-execution): tasks.md verifies global disjointness (4.4b) and the top-line exclusion count (4.4a) but no task explicitly requires the **per-period and per-segment breakdowns** of the recovered tier to be built from the already-deduped set (as opposed to deduping only the top-line total while `bucketByWeek`/`segmentBy` run over the raw, non-deduped recovered rows). The pure functions are generic over "rows," so a correct implementation naturally dedupes upstream once before bucketing/segmenting — but nothing in tasks.md pins this order of operations with a test. Recommend adding a task/assertion that a per-period or per-segment breakdown of the recovered tier also excludes provenance-tier rows, mirroring 4.4b's disjointness check but at the bucket/segment level, not just the whole-population level.

### Spec sufficiency and falsifiability (item 4)

Read all 11 requirements and their scenarios in `specs/followup-survival-report/spec.md`. Each requirement has scenarios that name a concrete WHEN/THEN pinned to an observable output (exit code, presence/absence of a `%`, printed labels, disjoint sets, counts). Cross-checked against tasks.md's 35 tasks: each requirement maps to at least one task with an independent verification method (fixture assertion, subprocess exit code, grep of rendered output). I did not find a requirement with no corresponding task, nor a task whose stated verification would pass without exercising the behavior (task 4.4's transport-call-argument capture and 4.9's positive+negative pairing were exactly the prior rounds' fixes for this failure mode, and both are still intact in the current tasks.md).

### Accumulated-edit incoherence check (item 5)

- Cross-referenced every design.md decision number against tasks.md and spec.md: 8a inserted between 8 and 9 without renumbering — mechanically fine (Markdown ordering, not code), and it's referenced consistently everywhere else (tasks 4.4a/4.4b, spec's new Requirement, C4) by name ("Decision 8a") rather than by a position-dependent index, so no dangling reference risk.
- Standing constraints are listed as C1, C2, C4, C3 (out of numeric order in tasks.md's final section) — purely cosmetic, not a coherence defect; each is used correctly and consistently by other artifacts.
- design.md's Context bullet still narrates the original zero-hit false-negative discovery and its correction in the same paragraph as the current count — read together it's coherent, not self-contradictory, though it requires a careful read (three rounds of correction inline in one paragraph makes it dense). Non-blocking style note, not a defect.
- Verified no orphaned reference to the old, corrected claims: grepped design.md for "validates \`origin_role\`" — the only occurrence is inside the corrective sentence itself, not left standing as an assertion elsewhere.

```
grep -n "validates .origin_role" design.md
```
returned the single corrective line only (already quoted above) — no other stray copy of the retracted claim exists in the document.

### Verdict: CONFIRM

Round 2's four change requests are genuinely resolved against ground truth (code, live Linear, live event log), not merely reworded. Decision 8a's dedupe is computationally sound for the corpus and time window this change actually reports on. No small-n/dedupe/honest-emptiness leak was found. The spec's 11 requirements are individually falsifiable and collectively cover the acceptance criteria and prior gate findings. No blocking defect remains.

### Carry into Execution (non-blocking, for tasks during implementation — not required to close this design gate)

1. Add a caveat (in the rendered report and/or spec) that a declining recovered-tier volume over time, once provenance coverage is non-trivial, should be read alongside provenance-tier growth rather than as an isolated signal — the current design is correct for today's all-heuristic history but doesn't yet warn a future reader about the migration effect as CON-213 lands and provenance accrues.
2. Add an explicit test/task pinning that the recovered tier's **per-period and per-segment** breakdowns are built from the already-deduped population (mirroring 4.4b's whole-population disjointness check at the bucket/segment level), not just the top-line total — closing an order-of-operations gap that the current tasks don't pin with a failing-if-violated assertion.

### Non-blocking notes

- The positive-control discipline (C1) and the CON-213 self-filing as a live provenance exercise are genuinely good process and caught a real defect (Finding 1 from round 2) before any code shipped — worth preserving as a pattern beyond this change.
- design.md is now dense from three rounds of inline correction; a future pass (not blocking) could fold the corrected Context bullets into clean prose rather than "old claim, correction" pairs, now that the corrections are settled.
