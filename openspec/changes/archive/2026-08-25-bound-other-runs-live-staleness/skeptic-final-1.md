## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is derived from the commit, the files, and commands I ran
myself. The executor's and evaluator's reports were not used as evidence.

### What I verified (with evidence)

**1. Design decisions vs. the actual diff** (`git show 25ffd4e -- core/scripts/cleanup.sh`)

- Decision 1 (time bound, not a new terminal-event kind): implemented. The `run.start`/`no run.end`
  presence check is retained and a staleness comparison added after it; no orchestrator event-writing
  path is touched anywhere in the diff.
- Decision 2 (no PID liveness): confirmed absent — no `kill -0`, no lockfile, no PID read in the diff.
- Decision 3 (6h default, `CONCERTINO_LIVE_RUN_STALE_HOURS` override): implemented as
  `stale_hours="${CONCERTINO_LIVE_RUN_STALE_HOURS:-6}"` with a `case ''|*[!0-9]*) stale_hours=6` non-numeric
  fallback, and documented in the env-var comment block alongside `CONCERTINO_CLEANUP_SKIP_SYNC`.
- Decision 4 (reuse the existing dependency-light read style): implemented with a bash `[[ =~ ]]`
  extraction of `"t":([0-9]+)`; no jq/python dependency introduced. `bash -n core/scripts/cleanup.sh`
  → clean; shebang is `#!/usr/bin/env bash`, so `[[ =~ ]]`, `local -a` and `for ((...))` are all sound.
- Decision 5 (fail closed to LIVE): implemented as a genuine *backward* scan
  (`for (( i=${#lines[@]}-1; i>=0; i-- ))`), not a blind `tail -1`, with
  `if [ -z "$last_ts" ]; then LIVE_RUN_TICKET="$t"; return 0; fi`. Verified by mutation, below.
- Stale-but-not-first behavior: a stale run now falls through and the loop *keeps scanning* other
  logs rather than returning — correct; an early `return 1` there would have masked a genuinely
  live run listed later.

**2. Spec delta — all 4 scenarios** (`specs/cleanup-sync-guard/spec.md`)

Each scenario maps to a real, executing test case in `test/scripts/cleanup.test.sh`'s new CON-121
section, and each is *mutation-proven* to actually exercise the code (see 4).

**3. Ticket acceptance criteria — traced individually**

- *"…does not permanently block `concertino sync`"* — verified against **real data**, not a fixture.
  I ran the new extraction/comparison logic read-only over `~/Development/helio/.concertino/runs/*/events.jsonl`:
  `HEL-560: NOT-LIVE (age 313h)`, `HEL-635: NOT-LIVE (age 85h)`. HEL-560 is exactly the ticket's
  named repro (46 lines, 1 `run.start`, 0 `run.end`, last event `gate.result`); it now classifies
  not-live. This also confirms the regex parses genuine `emit-event.sh` output, not just fixtures.
- *"false-positive window is bounded"* — bounded at `stale_hours * 3600 * 1000` ms; no path leaves it indefinite.
- *"lands in `core/`"* — `core/scripts/cleanup.sh` is in the commit, and the rendered copy is a
  byte-identical render, not a hand-edit (see 5).
- *"no false negative introduced"* — the `neverlive` mutation (below) fails 4 tests, two of which are
  the *pre-existing* CON-66 liveness assertions. The `fake_event()` re-parameterisation from the
  hardcoded 1970 `"t":1` to a now-default is what makes those legacy cases pass for the right reason
  (recency) rather than by accident; the mutation result proves they are load-bearing.

**4. Gates re-run by me, plus four independent mutation probes**

- `bash test/scripts/cleanup.test.sh` → `146 passed, 0 failed`.
- `npm test` → captured exit code `NPM_TEST_EXIT=0`; every suite reports `0 failed`.
  (I re-ran this deliberately: a `grep` for "fail" matches many *test names*, so the exit code —
  not the text — is the verdict.)
- I did not accept GREEN as proof the tests exercise the fix. I built throwaway `git archive 25ffd4e`
  copies in scratch (the worktree was never modified) and mutated one arm at a time:

  | Mutation | Result |
  |---|---|
  | staleness comparison → always live (restores pre-fix behavior) | **3 failed** — the RED case, reproduced independently |
  | unparsable-`t` arm → not-live (breaks Decision 5) | **2 failed** |
  | liveness → never live (max false negative) | **4 failed** |
  | env override ignored (hardcode 6) | **1 failed** |

  All four logic arms are covered by tests that genuinely fail when the behavior is removed. This is
  real coverage, not a green check over a dead arm.

  Methodology note, in the spirit of not trusting my own first reading: my *first* mutation attempt
  patched only `scripts/concertino/cleanup.sh` and reported a false `146 passed, 0 failed`. Rather
  than treat that anomaly as a verdict, I read the harness — `test/scripts/cleanup.test.sh:27` sets
  `CLEANUP="$ROOT/core/scripts/cleanup.sh"` — re-ran the mutation against the correct file, and got
  the stable RED shown above.

**5. `core/` vs. rendered copy byte-identity**

`diff core/scripts/cleanup.sh scripts/concertino/cleanup.sh` → no output.
`md5sum` both → `a02b27621ab0ddec16e72eb0ee14d939` for each. Identical, per CON-133/CON-140/CON-138.

**6. The inverted retention.js comment is corrected, and the replacement is accurate**

The old text claiming a stuck run stays live "until its run dir is pruned (`lib/ui/retention.js`
prunes exactly those, by mtime)" is deleted in the diff. The replacement asserts the opposite:
`retention.isEligible()` requires `hasRunEnd()`, so a run missing `run.end` is permanently ineligible.
I verified this against source rather than accepting it: `lib/ui/retention.js:46` is
`if (!hasRunEnd(root, ticket)) return false;`. The claim is correct. I also grepped every remaining
`retention` mention in the file (lines 419-421 new, line 536 pre-existing) — line 536's
"has emitted run.end (`lib/ui/retention.js`)" is likewise accurate and untouched. No new inaccurate
assertion was introduced.

**7. Scope**

`git show --stat 25ffd4e` = `core/scripts/cleanup.sh`, `scripts/concertino/cleanup.sh`,
`test/scripts/cleanup.test.sh`, and the change-dir artifacts. Nothing else.
The two sync side-effect files are confirmed **NOT** in the commit — `git status --porcelain` shows
`?? scripts/concertino/pricing-table.json` and `?? scripts/concertino/report-cost.sh` still untracked,
exactly as required. No unrelated refactor, no drive-by edits.

### Verdict: CONFIRM

The diff implements all 5 design decisions and all 4 spec scenarios, every acceptance criterion traces
to real evidence (including a read-only dry run against the actual HEL-560 marker the ticket was filed
over), both script copies are byte-identical, both gates pass under my own re-run, and every branch of
the new logic is mutation-proven to be under test. Ships.

### Non-blocking notes

1. `tasks.md` 1.5 justifies re-rendering by saying "the test suite in task 2.2 executes the worktree's
   rendered copy." That rationale is factually wrong — the harness copies from `core/scripts/cleanup.sh`
   (`test/scripts/cleanup.test.sh:27`). The re-render is still correct and required (CON-133 precedent),
   and the files are identical so nothing is affected; only the stated reason is inaccurate. Worth not
   carrying that claim forward into a future change's tasks.
2. `CONCERTINO_LIVE_RUN_STALE_HOURS=0` passes the `*[!0-9]*` numeric test and yields `stale_ms=0`, which
   makes *every* non-ended run classify not-live — i.e. it silently disables the concurrency guard
   entirely. Not a spec violation (the spec only mandates a non-numeric fallback), and arguably a
   legitimate escape hatch, but a floor of 1 or an explicit doc line would make that intent deliberate
   rather than incidental.
3. Fractional and negative values (`0.5`, `-1`) fall back to the 6h default via the same `case`. That
   matches the spec's "non-numeric" wording, though `0.5` may surprise a user who expects sub-hour tuning.
4. The whole `events.jsonl` is slurped into a bash array per candidate log. Negligible at observed sizes
   (HEL-560 is 46 lines) and it only runs for `run.start`-without-`run.end` logs, so no action needed.
