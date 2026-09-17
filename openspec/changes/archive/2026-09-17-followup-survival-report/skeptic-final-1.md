## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/followup-survival-report/CON-192 rc=0` before any other read/write.
- **Diff base**: resolved live via `resolve-review-base.sh` → `BASE_SHA=5a8edb8eaffa161d2ed5a647cef1ca4b15bec57b`, diffed `BASE_SHA...HEAD`. Scope matches `files-modified.md` (bin/concertino, lib/cli/help.js, lib/cli/report.js, lib/followup-survival.js, lib/ui/linear.js, plus tests/openspec artifacts).
- **Scope discipline**: confirmed the delivered scope is the pre-amendment `ticket.md` (survival report only); the added "verification machinery" analysis is genuinely absent and is not held against this gate per the owner's disclosed, escalated ruling.
- **Full test suite**, re-run myself (`timeout 590 npm test`, no `-n`): exit 0, `# tests 2362`, `# pass 2362`, `# fail 0`. Matches claim exactly; did not hit the CON-209 flake this run.
- **openspec validate**: `openspec validate "followup-survival-report" --type change` → `Change 'followup-survival-report' is valid`, exit 0.
- **tasks.md**: 37/37 checked, 0 unchecked (`grep -c '^\- \[x\]'` = 37, `'^\- \[ \]'` = 0).
- **C1 (positive control)**: `lib/cli/report.js:20-29` defines a formatting-tolerant `CONVENTION_NEEDLE`; `test/cli-report.test.js:83-86` (test `4.3a`) asserts it matches a real backticked rendering (`* \`origin_kind\`: followup`) AND that the naive strict form does NOT match the same fixture — a genuine positive control, not a bare zero-hit probe.
- **C2 (client method)**: `lib/cli/report.js:336-341` calls `linear.fetchTickets({..., stateTypes: ALL_STATE_TYPES, ...})`, never `fetchOneTicket`/`ISSUE_QUERY`. `ALL_STATE_TYPES` (line 36) includes `completed`, closing the `OPEN_STATE_TYPES` gap the ticket flagged.
- **C3 (small-n suppression, segment/period granularity)**: reproduced live in `lib/followup-survival.js` directly — n=4 → `pct: null, suppressed: true`; n=5 → numeric `pct`; n=0 → `pct: null` (never 0). Confirmed via a synthetic run of the real `buildModel`/`renderReport` pipeline that per-segment and per-period lines each independently render `small-n (n=1)` rather than a bare percentage.
- **C4 (dedupe)**: `buildRecoveredRows` (report.js:116-143) excludes any ticket already present in `provenanceIds` (by identifier) before it ever enters `recoveredRows`, so segment/period views built from `recoveredRows` inherit the dedupe for free — I confirmed this is not merely asserted but structurally true (dedupe happens at row-construction time, upstream of every segmentBy/bucketByWeek call). `excludedCount` is rendered explicitly.
- **Mutation testing, reproduced myself** (not trusted from evaluator's report):
  - Mutated `computeSurvival`'s `suppressed = total < min` to `suppressed = false` → `node --test test/followup-survival.test.js` went from all-green to `# pass 12 / # fail 2`. Restored via backup.
  - Mutated `buildRecoveredRows`'s dedupe `if (provenanceIds.has(t.identifier)) {...}` to a no-op comment → `node --test test/cli-report.test.js` went from all-green to `# pass 21 / # fail 3`. Restored via backup.
  - Both controls are real reds, not vacuous — confirms the evaluator's mutation-testing claim.
- **Independent arithmetic control** (my own, on the actual `lib/followup-survival.js` in the worktree, not a copy): 6-row set flipping one survivor moved `pct` 67→50 (direction/mechanism matches the claimed 67→33 example — exact percentages differ because fixtures differ, but the causal claim — flipping a survivor changes `pct` — is verified); n=4 `suppressed:true, pct:null`; n=5 numeric; `median([])` null; `median([1,3,5,7])` = 4; `segmentBy` `singleValued` true for one shared value, false for two distinct values. All consistent with the claims in the prompt.
- **Non-blocking finding 2 (stray colon)**: reproduced. `fmtSurvivalLine('', result, '')` returns `': ' + ...` and the marker line template already appends its own `': '`, so live output reads `marker=prose: : 8/14 (57%)`. Confirmed cosmetic only — no numbers are wrong, only a doubled separator.

### Non-blocking finding 1 — actually a REAL, substantive defect (upgraded)

I did not take the evaluator's framing ("arguably imprecise") at face value and went to ground truth: I pulled the actual `ticket.filed` events from the live event store (`/home/matt/Development/concertino/.concertino/runs/*/events.jsonl`) rather than trusting either report's narrative.

```
followup skeptic 1789616034502
```

There is exactly **one** `origin_kind=followup` `ticket.filed` event in the entire corpus today, and its `origin_role` is `skeptic`, not `orchestrator`. I then fed this exact event plus a synthetic ticket through the real `buildModel`/`renderReport` pipeline (not a hand-rewrite) and got:

```
by segment:
    origin_role: SINGLE-VALUED — the emitting path (standaloneTicket template) hardcodes origin_role=orchestrator, so this axis cannot currently resolve the five roles named in the ticket's acceptance criteria.
      skeptic: 0/1 (small-n (n=1))
```

This is not a precision nitpick — it is a **false, unconditional claim** rendered directly above evidence that contradicts it in the same block: the report tells the reader the axis can only ever be `orchestrator` because of a hardcoded emitting path, then immediately shows a `skeptic` bucket. Root cause: `lib/cli/report.js:170-175` fires this specific explanatory text whenever `seg.singleValued && isProvenanceTier`, without checking that the one observed value is actually `'orchestrator'`. The `standaloneTicket` template only *suggests* `origin_role=orchestrator` as boilerplate (`lib/cli/render.js:175`) — it is not an enforced constant, and the live corpus already proves an agent can and does override it. Today's real single-ticket dataset is not the degenerate all-orchestrator case the ticket's "Known acceptance-criterion defects" section anticipated; it is a different, unaccounted-for state, and the report actively misleads about it. This is exactly the class of "evidence-shaped non-result" the ticket itself calls out as unacceptable elsewhere (the Done-state gap).

### Verdict: REFUTE

### Change Requests

1. **`lib/cli/report.js:170` (SINGLE-VALUED origin_role explanation is unconditionally wrong when the sole value isn't `orchestrator`).** Guard the hardcoded-template explanation on the actual observed value, not just `singleValued && isProvenanceTier` — e.g. check `Object.keys(seg.buckets)[0] === 'orchestrator'` before emitting the "hardcodes origin_role=orchestrator" text, and fall back to a generic "SINGLE-VALUED — only one origin_role value observed in this corpus (`<value>`)" message otherwise (mirroring the existing generic branch used for the recovered tier). Add a regression test using a provenance row with `origin_role: 'skeptic'` (or any non-orchestrator value) and n=1, asserting the rendered explanation does NOT claim orchestrator-hardcoding and instead names the actual value — this is directly reachable with the corpus as it exists today, not a hypothetical.

### Non-blocking notes

- The stray double-colon in recovered-tier marker lines (`marker=prose: : 8/14 (57%)`, `lib/cli/report.js:274` via `fmtSurvivalLine('', ..., '')`) is cosmetic only — no numeric or structural defect, safe to fix opportunistically alongside Change Request 1 but not blocking on its own.
- No UI changes in this ticket (CLI only); design-judgment section of my mandate is not applicable.
- Verification-before-completion: all claims in the evaluator's report that I checked (test counts, mutation-testing reds, C1–C4 compliance) reproduced cleanly under my own fresh execution. The one exception is the single defect above, which the evaluator itself flagged but under-classified as cosmetic; going to the live event store (rather than accepting either report's characterization) is what surfaced that it is a live, reachable, currently-wrong report output today — not a hypothetical edge case.
