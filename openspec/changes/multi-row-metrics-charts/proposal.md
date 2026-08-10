## Why

`format.js`'s `sparkline()` always renders exactly one terminal row, mapping
each data point onto one of 8 block-character levels (`▁▂▃▄▅▆▇█`). That caps
the METRICS panel's throughput chart at 8 levels of vertical resolution no
matter how much room the expanded tier's `columnAreaHeight` actually has on a
tall terminal — a wasted opportunity on exactly the terminals grid mode
already widened the trend window for.

## What Changes

- Add a new multi-row chart renderer (stacked block-character rows, per the
  resolved design decision — see design.md) that the expanded METRICS tier's
  throughput line can opt into.
- The expanded tier's throughput chart renders across a fixed cap of stacked
  rows (per the resolved design decision) when grid mode gives it the room,
  materially improving resolution over today's single 8-level row.
- Compact tier is unaffected — unchanged single-row `sparkline()`.
- Document the new renderer and its expanded-tier usage in `docs/dashboard.md`.

## Capabilities

### New Capabilities
- `fleet-metrics-multi-row-charts`: A multi-row, stacked block-character
  chart renderer for the METRICS panel's expanded tier, and the throughput
  chart's use of it in place of the single-row `sparkline()`.

### Modified Capabilities
(none — no existing capability spec governs the METRICS throughput chart's
rendering today; this is new spec-level behavior, not a change to an
existing requirement)

## Impact

- `lib/ui/format.js`: new multi-row sparkline renderer alongside the existing
  `sparkline()` (unchanged).
- `lib/ui/screens/fleet/metrics.js`: `metricsColumnLines`'s expanded-tier
  `line3` throughput construction switches to the multi-row renderer when
  there's room.
- `docs/dashboard.md`: documents the new multi-row chart and when it renders.
- No changes to `metricsFor()`'s data shape — `throughput`/`throughput30d`
  arrays are unchanged; only how they're rendered changes.
