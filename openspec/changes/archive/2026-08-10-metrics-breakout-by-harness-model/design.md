## Context

`metricsFor(runs, now)` in `lib/ui/screens/fleet/metrics.js` already computes
a fleet-wide `successRate` (today/week, over terminal runs) and `avgMs` (over
done runs with a known `elapsedMs`). `run.harness` and `run.model` are already
populated per run by `reducer.js`'s `run.start` handler (`ev.harness`/
`ev.model`). `run.model` (singular) is the same field `drilldown.js`'s
`harnessText()` already reads and renders as `?` when absent — no event in
the codebase currently emits a bare `model=` field (only the per-role
`models=` JSON blob used for `run.models`), so in practice `run.model` is
usually absent today. This proposal groups by the fields as they exist now;
it introduces no new telemetry.

`metricsColumnLines()` already has an `expanded` tier (`cols >= 80 &&
contentRows >= 11`) used by grid mode's METRICS column, which currently adds
a `duration` buckets line and a `recent escalations` block on top of the
5-line compact tier.

## Goals / Non-Goals

**Goals:**
- Break out success rate and avg duration by `run.harness`, and by
  `run.model` where more than one distinct value is present.
- Render only in the existing `expanded` tier, reusing its existing gate.
- Degrade to exactly today's rendering for a single-harness/single-model
  fleet — no empty/degenerate box.

**Non-Goals:**
- No new telemetry fields or event schema changes.
- No breakout by `run.models` (the per-role model map) — only the single
  `run.model` field, matching what the ticket and `drilldown.js` already use.
- No changes to the compact (non-expanded) tier.

## Decisions

- **Grouping key for harness**: `run.harness` (already populated on every
  run via `run.start`'s `harness=` field per the `harness-identity`
  capability). Runs with no `run.harness` (predating this field) are
  excluded from the breakdown, exactly like `successRate`'s existing
  `endedAt != null` exclusion for in-flight runs — a run with no harness
  recorded has no data to attribute to a bucket.
- **Grouping key for model**: `run.model` (singular), not `run.models`
  (per-role). `run.models` maps role -> model id for a single run and has no
  natural "the run's model" reduction without inventing a new convention
  this proposal doesn't need — `run.model` is the field the ticket names and
  the field `drilldown.js` already surfaces for exactly this purpose. Runs
  with no `run.model` are excluded the same way as harness above.
- **Reuse of existing per-window computations**: `harnessBreakdown`/
  `modelBreakdown` entries reuse the exact same "terminal run" definition
  `successRate` already uses (`status === 'done' || status === 'failed'`
  with `endedAt != null`) and the exact same `withElapsed` definition `avgMs`
  already uses (`status === 'done'` with `elapsedMs != null`) — grouped by
  the harness/model key instead of collapsed across all runs. This keeps the
  new numbers consistent with the existing fleet-wide ones (same terminal/
  done semantics), not a second, subtly different definition of "success".
  Unlike the fleet-wide `successRate`, the breakdown is computed over ALL
  history, not today/week windows — matching `verdictRates`/`gateRates`'
  existing "over ALL history" precedent for per-key breakdowns in this same
  function, since a per-harness/per-model breakdown is inherently a smaller
  sample than the fleet-wide number and a today/week window would make most
  buckets `n/a` on a typical fleet. A harness/model with recorded runs but
  none yet terminal (e.g. still `running`) still gets a breakdown entry, with
  `rate: { rate: null, done: 0, total: 0 }` and `avgMs: null` — the same
  "n/a"-compatible shape `rateSegment` already renders for the fleet-wide
  `successRate`, not a special case needing extra handling.
- **Rendering gate**: `harnessBreakdown` is included as a rendered line only
  when it has more than one entry (i.e. more than one distinct harness value
  has run); same for `modelBreakdown`. This is the acceptance criterion "a
  fleet with a single harness/model renders the same as today" — the arrays
  are still always computed and returned by `metricsFor()` (pure function,
  no rendering concerns), but `metricsColumnLines()` decides whether to
  render a line for each independently.
- **Placement**: a new `line8` block, appended after the existing `duration`
  line (`line7`) and before `recent escalations`, inside the existing
  `expanded` branch. This costs 1-2 extra fixed lines when it renders (one
  line per breakdown that has data), which reduces `remaining` (and thus how
  many escalation rows fit) — acceptable, matching how `line7`/its blank
  separator already reduce that same budget today.
- **Line format**: reuses `f.bar`/`Math.round(...*100)` exactly like
  `rateSegment` above, and `f.dur` for avg duration, so the new lines read
  consistently with the existing `success`/`verdicts` lines rather than
  inventing a new visual vocabulary.

- **Docs target**: `docs/dashboard.md` has no existing "METRICS section" to
  extend today (confirmed via `grep -n "^## " docs/dashboard.md` — no
  METRICS heading exists; it's mentioned only in passing, in the jump-key
  table and a border-style aside). Rather than write a full retroactive doc
  for the whole METRICS panel (avg delivery, success rate, throughput,
  verdicts, gates, duration buckets, escalations — real scope beyond this
  ticket, never written for any prior METRICS change) or leave an orphaned
  note with nothing to anchor it, this change adds one new, minimal
  subsection — `### The METRICS panel` — placed under "What it looks like"
  alongside the file's existing per-panel subsections (`### The drill-down's
  TICKET panel`, `### The CHANGES panel`), matching that existing structural
  precedent. Its content is scoped tightly to what's needed to give the new
  breakdown context: a one-line description of the compact tier (already
  shipped, undocumented, kept brief) and a fuller description of the
  expanded tier's fields, ending with the new harness/model breakdown lines
  described in full (what they show, and the `>1` distinct value gate that
  suppresses them for a single-harness/single-model fleet). This satisfies
  the ticket's literal AC ("documented in `docs/dashboard.md`'s METRICS
  section") without taking on a full METRICS-panel documentation project.

## Risks / Trade-offs

- [Fewer escalation rows fit when both breakdown lines render] → acceptable;
  `recentEscalations` already degrades gracefully to fewer rows or "no
  escalations yet" when `remaining` shrinks — the same mechanism `line7`
  already exercises.
- [`run.model` is rarely populated today, so the model breakout will rarely
  render in practice] → this is a correct reflection of current
  instrumentation, not a bug in this change; the ticket explicitly scopes
  this to "no new instrumentation needed," and the code path is exercised
  and tested with synthetic `run.model` values regardless of how often real
  runs populate it today.

## Migration Plan

No migration — pure additive rendering logic gated on existing data. No
rollback concerns beyond reverting the commit.
