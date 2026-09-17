## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review. HEAD reviewed: `8ec49c7b185fd4b10c6fb771823602122964741f`.

### cwd guard
`assert-cwd.sh` with ambient=`/home/matt/Development/helio` against this worktree/branch → `READY ambient=... branch=feature/followup-survival-report/CON-192`, rc=0. Proceeded.

### What I verified (with evidence)

1. **Content identity.** Worktree clean (aside from an expected `workflow-state.md` diff). `git hash-object lib/cli/report.js` == `git rev-parse HEAD:lib/cli/report.js` == `eb27b4205c3d2cd338a8ec5de463b939e2d37fea`. What was gated is what is committed.

2. **Round 1's C5 fix, re-read in full** (`lib/cli/report.js:160-204`). The `origin_role` single-valued branch for the provenance tier is now three-way: (a) `soleValue === 'orchestrator'` → the template-hardcoding claim, (b) any other single value → a generic "only one value observed (<value>)" line, (c) recovered tier → "unrecoverable from text; always unknown" (this one is architecturally guaranteed true by `buildRecoveredRows` hardcoding `originRole: 'unknown'` at construction, not merely correlated — correctly distinguished from the provenance-tier case by the existing code comment at lines 170-173).

3. **Reproduced the C5 control myself**, without trusting the executor's stash-based claim (which I could not literally repeat safely — see "process note" below). I copied `report.js` aside, mutated the fix in place to drop the `&& soleValue === 'orchestrator'` guard (reverting to round-1's unguarded condition), ran `node --test test/cli-report.test.js`, and got:
   ```
   not ok 19 - C5: a single-valued origin_role of "skeptic" (n=1) does NOT claim orchestrator-hardcoding...
   error: 'must not claim orchestrator-hardcoding for a skeptic-only corpus'
   ```
   Then restored the original file and re-confirmed `git hash-object` matches HEAD's blob. **The C5 control is real and does fail red against pre-fix logic.**

4. **Full suite, re-run myself**: `npm test` (which runs `node --test` plus ~50 bash script tests) exited 0 with the final bash suite printing `16 passed, 0 failed` (instrumentation digest) as the last block, no failures anywhere in the combined run. `openspec validate followup-survival-report --type change` → `Change 'followup-survival-report' is valid`, rc=0.

5. **Gate chain in `events.jsonl`** matches the round's claims exactly: design REFUTE(1)/REFUTE(2)/CONFIRM(3) at `5a8edb8`, evaluator PASS at `a0d66d2`, final REFUTE(1) at `a0d66d2` — all present, `head_sha_source: stated` throughout, no gaps.

### A second instance of the C5-class defect — NOT fixed by this commit

Per the brief's item 1 (generalize round 1's finding: "an explanatory annotation must be guarded on the VALUE actually observed, never a condition that merely correlates with it"), I read every other conditional annotation in `renderSegments`/`renderReport` looking for a second instance. I found one, in the **empty-provenance branch**, untouched by `8ec49c7`:

`lib/cli/report.js:259-264`:
```js
if (model.provenanceOverall.total === 0) {
  lines.push(
    '  No follow-up provenance has been recorded yet — ticket.filed only accrues from the next ' +
    'standalone triage onward (this run\'s own filing is the exception; see below). This is an ' +
    'explicitly-empty, well-formed result, never a fabricated survival figure.',
  );
```

This branch fires **exactly when `model.provenanceOverall.total === 0`** — i.e., when zero `ticket.filed` rows exist in the corpus, full stop. The parenthetical "this run's own filing is the exception; see below" asserts, as a present-tense fact, that an exception exists (a filing from "this run"). That cannot be true in the branch it is embedded in: if any filing — including "this run's own" — were present, `total` would be ≥1 and this whole branch, parenthetical included, would not render. The claim is guaranteed false by the very condition that gates it, which is precisely the C5 pattern round 1 found and this commit fixed elsewhere (a stated cause/exception sitting above data that disproves it) — just not caught here.

I confirmed this is live and reachable, not a hypothetical: `test/cli-report.test.js` line 210-215 (`4.6: zero ticket.filed rows renders an explicitly-empty provenance result...`) calls `buildModel({ provenanceEvents: [], tickets: [], now: ... })` and asserts only on `/No follow-up provenance has been recorded yet/` — it never inspects the "this run's own filing is the exception" clause, so nothing catches that the clause is nonsensical in exactly the scenario the test exercises. `"see below"` also points at nothing — no later section in `renderReport`'s output ever surfaces "this run's" filing by name.

Root cause: this sentence is a verbatim carry-over from the **design.md narrative** (Decision 11 / Context: "this run filed CON-213... this run's own log carries a non-orchestrator row"), which was true of the *design session's* corpus at the time design.md was written, but was never adapted for the shipped, general-purpose CLI text that a real user reads on an arbitrary empty corpus (their own "run" of the *tool*, not the *design/delivery* session, files nothing).

**Severity / classification: blocking-implementation.** This is not cosmetic — the entire premise of this ticket and Decision 5 (design.md) is that the report must never assert something the data doesn't support ("explicitly-empty... never a fabricated survival figure"). A dangling, self-contradicting exception-claim in that exact sentence is a real instance of the class this round exists to close out, sitting in the one branch whose entire job is to be scrupulously honest about having nothing to report.

### Standing constraints C1–C5

- C1 (needle false-negative): `CONVENTION_NEEDLE` unchanged, positive-controlled test still present. Honored.
- C2 (bulk fetch only): `fetchTickets` used, no single-issue lookup added. Honored.
- C3 (n/a naming — not separately named in artifacts I could find as distinct from C4/C5, no regression found).
- C4 (dedupe recovered vs provenance, disclosed exclusion count): `buildRecoveredRows` still excludes by identifier and returns `excludedCount`, rendered at line 279. Honored.
- C5 (guard annotation on observed value, not correlated condition): **fixed at the one site round 1 found, but a second, adjacent instance of the same defect class survives** (see above) — so C5 as a *general* principle is not yet fully honored across the file.

### CR2 (fmtCounts) sanity check

`fmtCounts()` extraction (line 151-153) is a straightforward de-duplication, used consistently at both `fmtSurvivalLine` and the `marker=` line. No new defect introduced; its own test passed in the full run.

### Process note (self-disclosed, not load-bearing for the verdict)

While reproducing the executor's stash-based C5 control I ran `git stash push -- lib/cli/report.js`, which printed "No local changes to save" (report.js was already committed/clean) and did *not* create a new stash entry. My next command (`git stash show -p stash@{0}`) then operated on a **pre-existing, unrelated stash entry** from another ticket's worktree usage (`On feature/differential-line-diff-rendering/CON-27: probe`), and `git stash pop` applied it, producing conflicts in `lib/ui/watch.js` / `test/watch.test.js`. I resolved this immediately with `git checkout HEAD -- lib/ui/watch.js test/watch.test.js` (not the destructive `git reset --merge`, which the environment's permission classifier correctly blocked) — the pre-existing stash entry (`stash@{0}`) is intact and untouched, and the worktree is back to matching HEAD exactly (`git diff --stat HEAD` shows only the pre-existing `workflow-state.md` diff, `hash-object` matches). I then re-verified the C5 control safely via direct file mutation/`sed`+restore instead (see item 3 above), which is what the verdict actually rests on. Flagging this for the record since it touched a stash entry that isn't mine — no data was lost, but it could have been with a less careful recovery path.

### Verdict: REFUTE

### Change Requests

1. **[blocking-implementation]** `lib/cli/report.js:259-264` — remove or rewrite the "this run's own filing is the exception; see below" parenthetical in the `provenanceOverall.total === 0` branch. It asserts an exception that cannot exist given the branch's own guard condition, and "see below" references nothing in the rendered output. Replace with text that doesn't claim a present-tense exception that contradicts `total === 0` (e.g., drop the parenthetical entirely, or reword to a forward-looking statement like "future filings that call the real emitter will populate this tier" with no false claim about the current corpus). Extend `test/cli-report.test.js`'s 4.6 case (or add a sibling) to assert the empty-provenance message does NOT claim a same-run exception, mirroring how C5's own test asserts the guarded claim only appears when true — this is the same defect class and deserves the same regression coverage.

### Non-blocking notes

- Consider a repo-wide sweep (not blocking this ticket) for other design.md-narrative phrases ("this run", "see below", "as measured before this run filed CON-213") that may have leaked into other CLI-facing strings verbatim from the design document's point-in-time narrative.
