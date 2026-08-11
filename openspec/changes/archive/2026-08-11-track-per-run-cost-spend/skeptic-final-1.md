## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Ground truth re-established**: read `ticket.md`, `proposal.md`, `design.md`
  (all 6 decisions), `tasks.md`, `specs/*/spec.md`, `files-modified.md`, and
  `git diff main...HEAD --stat` (33 files, +2852/-15) directly — not summarized
  from the evaluator's report.
- **Full test suite, re-run fresh**: `npm test` (this repo's `node --test` +
  every `test/scripts/*.test.sh` chain, including the new
  `report-cost.test.sh`) exited `0`. I separately re-ran the JS suite
  directly: `node --test test/reducer.test.js test/fleet.test.js
  test/drilldown.test.js test/config.test.js test/emit.test.js
  test/prompt.test.js` → `655 pass, 0 fail`.
- **`openspec validate track-per-run-cost-spend --strict`** → `Change
  'track-per-run-cost-spend' is valid`, re-run myself.
- **The trickiest part — independently sabotage-tested the incremental
  cursor** (per the debugging law: a test that passes without exercising the
  fixed path proves nothing). I did **not** just trust the evaluator's claim
  of having sabotaged it. I copied `core/scripts/report-cost.sh`, disabled
  the cursor-file read (`if (false) priorCount = n;`), and re-ran
  `test/scripts/report-cost.test.sh`: checks 4.4/4.5 failed exactly as
  predicted (`expected [30] got [130]`, `expected [15] got [65]`), 23/25
  passed. Restored the original file and confirmed byte-identical via `diff`
  and `git status --short` (clean) before continuing. This proves the
  regression test in `test/scripts/report-cost.test.sh` genuinely catches
  the double-counting bug the design's SubagentStop-resume correction fixes
  — not a tautological assertion.
- **Read `core/scripts/report-cost.sh` and `pricing-table.json` in full**:
  hook_event_name dispatch (`SubagentStop` → `agent_transcript_path`/
  `agent_id`; else → `transcript_path`/`session_id`), `CONCERTINO_TICKET`
  early-exit, `main_checkout()` duplication (matches `emit-event.sh`'s own
  helper, by design per the script suite's "stay standalone" convention),
  incremental cursor read/write (rewritten even on empty increments,
  `priorCount > lines.length` reset-to-0 guard for a rotated/shrunk
  transcript), pricing lookup with `cost_usd` omitted (not `0`) for an
  unrecognized model, `toFixed(6)` fixed-point encoding. Matches design.md
  Decisions 1/2/4/5/6 exactly.
- **Confirmed `emit-event.sh`'s `json_value()` string-encoding claim
  (Decision 6) against the actual source**: the regex
  `^-?(0|[1-9][0-9]*)$` only matches bare integers, so a fractional
  `cost_usd` is genuinely emitted as a JSON string — the reducer's
  `Number(ev.cost_usd)` parse is not solving an imaginary problem.
- **Reducer fold** (`lib/ui/reducer.js`): `run.cost` in `TIER2_KINDS`;
  `emptyRun()` gains `costUsd: null`/`tokens: null`; the fold sums (never
  overwrites), NaN-tolerant, token fields always summed even when
  `cost_usd` is absent/malformed. Read the diff directly; matches
  `test/reducer.test.js`'s 7 new cases (single/multi-event sum,
  string-encoded fractional sum, partial coverage, malformed-degrades-to-0,
  null-when-no-events, TIER2 classification → `telemetry: 'partial'`).
- **METRICS** (`lib/ui/screens/fleet/metrics.js`): `spendFor(windowStart)`
  scoped to the same `terminal` (done/failed, `endedAt` in window) set
  `rateFor`/`deliveredToday` already use for the coverage denominator — sums
  raw `run.cost` **events'** own `t`/`cost_usd` (not the reducer's
  accumulated `run.costUsd`), matching the design's stated reason (METRICS
  needs per-event timestamps for windowing). Line 1 now goes through
  `layout.fitSegments` instead of hard concatenation. I rendered this live
  with `node -e` against a 2-run fixture (1 reporting, 1 not) and got
  exactly the spec'd format: `spend today $1.50 (1/2 runs reporting) · week
  $1.50 (1/2)`. Verified against `test/fleet.test.js`'s 9 new cases
  (full/partial coverage, no-terminal-runs n/a, never-fabricate/never-dilute,
  week-window, malformed-cost_usd, plus 3 `metricsColumnLines` render cases).
- **Drill-down** (`lib/ui/screens/drilldown.js`): `costText(run)` — three
  distinct degrade states (reported `$X  N tok`; harness-named "not reported
  for `<harness>`" for non-claude-code; generic "not reported" for
  claude-code-with-no-data) — wired into `headerLines()` as row 5. Rendered
  live: `$1.23  12,600 tok` for a reporting run, `cost not reported for
  codex` for a non-Claude-Code run — matches spec.md exactly. Confirmed
  against `test/drilldown.test.js`'s 3 new cases.
- **Sync-time wiring** (`lib/cli/emit.js`, `lib/config.js`, `lib/cli/doctor.js`,
  `config/concertino.schema.json`): `costTracking.enabled` defaults `false`;
  `mergeCostHookSettings` additively writes the SAME hook entry into both
  `settings.hooks.SessionEnd` and `settings.hooks.SubagentStop`, preserving
  pre-existing keys, idempotent on re-sync (verified via
  `test/emit.test.js`'s 5 new cases, which I read in full). `doctor`/
  `collectConfigIssues` both check both hook entries are present when
  enabled, mirroring `checkAgentMergePermission` exactly.
- **`submitTicket()`** (`lib/ui/prompt.js`): unconditionally merges
  `{ CONCERTINO_TICKET: parsed.ticket }` first, so caller-supplied env
  (provider routing) wins on collision — confirmed by reading the diff and
  the 3 new `test/prompt.test.js` cases (no-prior-env, alongside
  provider-routing env, caller-override-wins).
- **Docs**: `docs/dashboard.md` and `docs/config-reference.md` diffs read in
  full — both accurately describe the shipped behavior (coverage-fraction
  convention, claude-code-only v1 scope, pricing-table upkeep obligation,
  both hook names named together, matching cycle-2's fix for the cycle-1
  stale-`SessionEnd`-only references).
- **`.gitignore`**: confirmed `.concertino/` is fully ignored, so the new
  `.cost-cursors/` cursor directory (design.md Decision 5) never gets
  committed, consistent with the design's "ephemeral, per-run local state,
  never inside the worktree" requirement.
- **No placeholders**: `git diff main...HEAD | grep -niE
  "TODO|FIXME|TBD|XXX|hack"` → no matches.
- **UI/design-standard review**: N/A per this project's configuration (no
  design standard doc, no browser UI — this is a terminal dashboard). I did
  render the actual terminal output (METRICS line, drill-down header) live
  via `node -e` rather than skip visual verification entirely, and it
  matches the spec'd wording/format exactly.

### Acceptance criteria — traced

1. **"At least one harness reliably reports cost/token usage into a new
   tier-2 event."** → `run.cost` in `TIER2_KINDS`
   (`lib/ui/reducer.js:13`); `report-cost.sh` emits it for Claude Code via
   both `SessionEnd` and `SubagentStop`, empirically verified (tasks.md 7.1)
   and unit-tested (25/25, including the sabotage-confirmed cursor
   regression). MET.
2. **"METRICS shows fleet-wide spend (today/week), degrading honestly (not
   silently) for runs/harnesses that don't report it."** →
   `metricsFor().spend`/`metricsColumnLines()` line 1, rendered live and
   matching the coverage-fraction convention exactly. MET.
3. **"Documented in `docs/dashboard.md` and `docs/config-reference.md`."** →
   both updated, read in full, accurate. MET.

### Design-gate correction handled correctly

The post-design-gate-CONFIRM pivot from `SessionEnd`-only to
`SessionEnd`+`SubagentStop`-with-incremental-cursor was the highest-risk part
of this change (it silently changes a load-bearing empirical premise after
the skeptic already signed off on the original design). I did not accept the
executor's/evaluator's narrative of "this was fixed" at face value — I
re-derived the fix's correctness myself by reading the implementation,
reading the regression test, and reproducing the failure the fix prevents via
my own sabotage-and-restore, independent of the evaluator's own (claimed)
sabotage run. It holds up.

### Verdict: CONFIRM

No required revisions.

### Non-blocking notes

- `costText()`'s "not reported" fallback treats any `run.harness !==
  'claude-code'` (including `null`/unset) as `!run.harness || run.harness ===
  'claude-code'` → generic message. A run with `harness: null` (predates
  harness tracking, if such a case exists) gets the generic "cost not
  reported" rather than a harness-named one — correct per spec.md (this is
  the "Claude Code run that simply has no data yet" case, and `null` can't
  be proven non-Claude-Code), just noting it's a deliberate default-to-generic
  choice, not an oversight.
- The pricing table's staleness is an accepted, documented, self-maintained
  risk (Decision 2/4) — not a defect of this change, but worth the project
  owner's attention whenever a new Claude model ships.
