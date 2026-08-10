## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-metrics-harness-breakdown/spec.md` in full.
- Read `lib/ui/screens/fleet/metrics.js` in full (`metricsFor`,
  `metricsColumnLines`) — confirmed the design's characterization of current
  behavior is accurate line-for-line: the `terminal` definition (line 58:
  `status === 'done' || status === 'failed' && endedAt != null`), the
  `withElapsed` definition (line 35: `done.filter(r => r.elapsedMs != null)`),
  `verdictRates`/`gateRates`'s existing "over ALL history, grouped by key"
  precedent (lines 112-156) the design cites as justification for the same
  choice on the new breakdowns, and the exact "8 fixed lines" structure
  (`fixedLines = [line1..line5, '', line7, '']`, line 257) the design plans to
  extend with a `line8` block.
- Confirmed `run.harness`/`run.model` are already populated, exactly as
  described: `reducer.js:113-114` (`if (ev.harness != null) run.harness =
  ev.harness; if (ev.model != null) run.model = ev.model;`), set from the
  `run.start` event. Confirmed `drilldown.js:434-436`'s `harnessText()` reads
  the same singular `run.model` field the design says to reuse (not the
  per-role `run.models` map).
- Confirmed `sectionJumpTargets()` (`lib/ui/screens/fleet/keys.js:93`) really
  does pass `metrics: metricsVisible ? {} : null` into `buildSections`, which
  is the call site design.md's defensive-defaults rationale (task 2.4)
  targets — the `{}` claim checks out. (Note: that specific call site
  ultimately calls `metricsColumnLines` via `sections.js:192` without a
  `contentRows` override, so it never actually reaches the `expanded`
  branch today — the defensive defaults are still good insurance, not
  wasted, just not exercised by that exact path today.)
- Read `test/fleet.test.js`'s existing `metricsFor`/`metricsColumnLines`
  tests (lines 550-819), including `metricsFixtureExpanded()` (line 753) and
  the "8 fixed lines" comment at line 799. Since the existing fixture/`run()`
  helper never sets differing `harness`/`model` values, `harnessBreakdown`/
  `modelBreakdown` would both compute to length ≤ 1 under the design's
  defensive defaults, so none of these existing tests would break — the
  design's backward-compatibility claim ("degrades to exactly today's
  rendering for a single-harness/single-model fleet") holds against the
  actual fixtures, not just in the abstract.
- Checked `openspec validate metrics-breakout-by-harness-model --strict` →
  `Change 'metrics-breakout-by-harness-model' is valid`.
- Checked whether an existing capability spec already covers
  `metrics.js`'s rollup (proposal claims none does): `grep -rl
  "metricsFor|metricsColumnLines|METRICS" openspec/specs/*/spec.md` only
  matches `dashboard-iconography` (governs title icon composition only) and
  `fleet-quick-start` (one incidental cross-reference to METRICS being
  unconditional) — neither governs `metricsFor()`/`metricsColumnLines()`'s
  actual computation/rendering logic. The proposal's "no Modified
  Capabilities" claim is accurate.
- **Checked the docs claim against ground truth and found a gap**: both
  `ticket.md`'s acceptance criteria ("Documented in `docs/dashboard.md`'s
  METRICS section") and `tasks.md` task 4.1 ("Document the new breakout
  block in `docs/dashboard.md`'s METRICS section") assume an existing
  "METRICS section" in `docs/dashboard.md` to extend. `grep -n -i "metrics"
  docs/dashboard.md` and `grep -n "^## " docs/dashboard.md` confirm **no
  such section exists** — METRICS is mentioned only in passing (the `1`-`9`
  jump-key table row at line 162, and the border-style list at line 280).
  The living user doc for the whole METRICS panel (avg delivery, success
  rate, throughput, verdicts, gates, duration buckets, escalations) was
  never written; the closest thing is a design-doc historical record at
  `docs/superpowers/specs/2026-08-01-fleet-metrics-charts-design.md`, which
  is not the file the ticket/tasks name.

### Verdict: REFUTE

### Change Requests

1. **`docs/dashboard.md`'s "METRICS section" does not exist — resolve before
   execution.** `ticket.md`'s acceptance criteria and `tasks.md` task 4.1
   both direct the implementer to document the new breakdown "in
   `docs/dashboard.md`'s METRICS section," but no such section exists in
   that file today (verified via `grep -n "^## " docs/dashboard.md` — 13
   top-level sections, none about METRICS; METRICS appears only in a keys
   table row and a border-style aside). As written, this leaves the
   implementer to guess between two very different scopes: (a) write a
   full new "## METRICS panel" section documenting the whole panel
   (avg delivery, success rate, throughput, verdicts, gates, duration
   buckets, escalations) that was apparently never written for any prior
   METRICS ticket — real scope beyond this change — or (b) add a minimal,
   possibly orphaned note about just the new breakdown lines with no
   surrounding section to anchor it, which risks not actually satisfying
   the "documented in the METRICS section" AC as literally stated. Please
   amend `design.md`/`tasks.md` to explicitly resolve this: either scope
   task 4.1 to "create a new, minimal `## METRICS panel` section covering
   only [X]" (bounded, named fields) or repoint the AC/task at the correct
   existing living doc if one was missed. Either resolution is fine — the
   design just needs to stop assuming a section that isn't there.

### Non-blocking notes

- Every other technical claim in `design.md`/`tasks.md`/the spec delta
  (grouping keys, terminal/`withElapsed` definitions, ALL-history vs
  today/week windowing rationale, rendering gate `>1` entries, line
  placement between `line7` and `recent escalations`, defensive defaults,
  `f.bar`/`f.dur` reuse) checks out precisely against the current
  `metrics.js`/`reducer.js`/`drilldown.js`/`test/fleet.test.js` — this is a
  well-researched plan; the docs-target gap above is the only real issue
  found.
- Not blocking, but worth a sentence in `design.md`: a harness/model that
  has run.harness/run.model set but has zero terminal (`done`/`failed`)
  runs yet (e.g. still `running`) will still get a `harnessBreakdown` entry
  with `rate: { rate: null, done: 0, total: 0 }` and `avgMs: null` per the
  spec's literal wording ("one entry per distinct value present across
  runs"). That's a reasonable, `rateSegment`-compatible ("n/a") outcome and
  not a defect, but the design doesn't call it out explicitly the way it
  calls out the no-harness-recorded exclusion case.
