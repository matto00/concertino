## 1. `metricsFor()` breakdowns

- [x] 1.1 Add `harnessBreakdown` computation: group runs by `run.harness`
      (excluding runs with no `run.harness`), computing `rate` over the same
      terminal-run definition `successRate` uses (status `done`/`failed`,
      `endedAt != null`, over ALL history) and `avgMs` over the same
      `withElapsed` definition `avgMs` uses, per harness.
- [x] 1.2 Add `modelBreakdown` computation, identical shape, grouped by
      `run.model` instead of `run.harness`.
- [x] 1.3 Return `harnessBreakdown`/`modelBreakdown` from `metricsFor()`.

## 2. `metricsColumnLines()` rendering

- [x] 2.1 Add a "by harness" line inside the existing `expanded` branch,
      rendered only when `harnessBreakdown.length > 1`, formatted with
      `f.bar`/`f.dur` consistent with the existing `success`/`verdicts`
      lines.
- [x] 2.2 Add a "by model" line, same placement/gating, rendered only when
      `modelBreakdown.length > 1`.
- [x] 2.3 Recompute `fixedLines`/`remaining` to account for the 0-2 extra
      lines these add, preserving the existing `recentEscalations`
      degrade-gracefully behavior.
- [x] 2.4 Defensive defaults for `m.harnessBreakdown`/`m.modelBreakdown`
      being absent (mirroring the existing defensive defaults for
      `m.successRate`/etc.), so `sectionJumpTargets()`'s `{}` call site
      doesn't throw.

## 3. Tests

- [x] 3.1 `metricsFor` unit tests: single harness -> one entry; multiple
      harnesses -> one entry per harness with correctly scoped rate/avgMs;
      runs with no `run.harness` excluded; same three cases for
      `modelBreakdown`/`run.model`.
- [x] 3.2 `metricsColumnLines` unit tests: expanded tier with multiple
      harnesses renders a "by harness" line; expanded tier with a single
      harness/no more than one model renders identically to today (no
      breakdown line); expanded tier with multiple models renders a "by
      model" line; compact tier never renders a breakdown line regardless of
      breakdown contents.

## 4. Docs

- [x] 4.1 `docs/dashboard.md` has no existing "METRICS section" (confirmed —
      see design.md's "Docs target" decision). Add a new, minimal
      `### The METRICS panel` subsection under "What it looks like",
      alongside the file's existing per-panel subsections (`### The
      drill-down's TICKET panel`, `### The CHANGES panel`): briefly describe
      the existing compact tier, then the expanded tier's fields, ending
      with the new "by harness"/"by model" breakdown lines — what they show,
      and that each renders only when more than one distinct value is
      present (no degenerate box for a single-harness/single-model fleet).
      Do not attempt a full retroactive doc of every METRICS field beyond
      what's needed to give the new breakdown context.
