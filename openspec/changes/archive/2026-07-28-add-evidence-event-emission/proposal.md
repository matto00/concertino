## Why

The event schema already defines an `evidence` kind (`ref`, `label`) and the
drill-down's EVIDENCE panel already renders it — but no role or script ever
emits one, so the panel permanently reads "no evidence recorded". Evidence
artifacts (proposals, design docs, evaluation reports, skeptic reports) exist
on disk today; the dashboard just cannot point at them. This is the same
defect class as CON-1 (`gate.result` grew `duration_ms`/`first_error` fields
before anything produced them).

## What Changes

- A new canonical script, `persist-evidence.sh`, copies an artifact file from
  wherever it currently lives into `.concertino/runs/<TICKET>/evidence/` in
  the **main checkout** (never the worktree) and prints back the durable,
  absolute path. This is the load-bearing fix: `cleanup.sh --phase4` destroys
  the worktree while the event log — and now the evidence copies beside it —
  survive, so a `ref` built from this script's output can never dangle.
- The orchestrator emits one `evidence` event per planning artifact
  (`proposal.md`, `design.md`, `tasks.md`, any spec deltas) at the point it
  already writes `workflow-state.md` transitioning out of Planning — using
  `persist-evidence.sh`'s durable path as `ref`.
- The evaluator and skeptic route their existing `verdict` event's `ref`
  through `persist-evidence.sh` instead of the raw (worktree-relative,
  post-cleanup-dangling) report path. **No new `evidence` event is added for
  their reports** — see design.md for the redundancy analysis; `verdict`
  already carries a `ref`, and duplicating it under a second event kind adds
  a second broken-then-fixed pointer to the same file for no reader benefit.
- No reducer or drill-down UI change: `lib/ui/reducer.js` already folds any
  event kind into `run.events`, and `lib/ui/screens/drilldown.js`'s
  `evidenceLines()` already filters for `kind === 'evidence'` and already
  degrades to "no evidence recorded" — built ahead of any emitter, per the
  ticket's description of slice 2b.

## Capabilities

### New Capabilities

- `evidence-telemetry`: the `persist-evidence.sh` script's durable-copy
  contract, the orchestrator's per-planning-artifact `evidence` emission, and
  the evaluator/skeptic's durable `verdict.ref`.

### Modified Capabilities

(none — `gate-telemetry` and `phase-telemetry` are unaffected)

## Impact

- `core/scripts/persist-evidence.sh` (new), `scripts/concertino/persist-evidence.sh` (synced copy)
- `core/scripts/README.md` (script table)
- `core/roles/orchestrator.md`, `core/roles/evaluator.md`, `core/roles/skeptic.md`
- `.claude/agents/concertino-{orchestrator,evaluator,skeptic}.md` (re-synced)
- `test/scripts/persist-evidence.test.sh` (new)
- `package.json` (`test` script gains the new suite)
- No changes to `lib/ui/reducer.js` or `lib/ui/screens/drilldown.js` — already implemented.
