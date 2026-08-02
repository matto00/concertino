## Why

Once a run's PR exists, the dashboard has no way to reach it except by leaving the TUI to find the
URL manually — the drill-down's EVIDENCE panel only understands local-file artifacts (planning
docs, evaluation/skeptic reports persisted via `persist-evidence.sh`), and nothing in the repo
opens a URL in the OS default browser. CON-55 asks for a PR artifact in that same list, with Enter
opening it in the browser instead of the in-TUI doc reader.

## What Changes

- The orchestrator emits a new `pr` telemetry event (`kind: 'pr'`, carrying `url` and a `label`)
  immediately after a run's PR is created (Phase 3 Delivery step 4, `core/roles/orchestrator.md`),
  alongside its existing `evidence`/`verdict` events — the same "emit at the point the fact becomes
  true" discipline those already follow.
- `evidenceItems()` (`lib/ui/screens/drilldown.js`) recognizes both `kind: 'evidence'` and
  `kind: 'pr'` events as evidence-panel entries (a run has at most one `pr` event; if a corrected
  PR URL is ever re-emitted, the most recent `pr` event wins, mirroring how the panel already
  reasons about one entry per artifact).
- `evidenceLines()` renders a PR entry with a distinct icon/label from file artifacts, so it is
  visually clear before pressing Enter that this entry leaves the TUI rather than opening the doc
  reader.
- Pressing Enter on a PR entry dispatches a new action (`open-external-url`) instead of the
  existing `open-evidence-doc` action; `lib/ui/watch.js` handles it by shelling out to the OS
  default-browser opener (`xdg-open` on Linux — this project's only supported platform) rather than
  transitioning to `docview`.
- A failed browser-open (`xdg-open` missing, non-zero exit, or throwing) surfaces as a visible
  drill-down notice (reusing the existing `drillNotice` mechanism the restart-confirmation path
  already uses) instead of crashing the TUI or silently doing nothing.
- Enter on existing file-based evidence entries is unaffected — same action, same doc-reader
  destination, byte-for-byte.

## Capabilities

### New Capabilities
- `browser-link-open`: opening a URL in the OS default browser from within the dashboard TUI
  (`xdg-open` on Linux, the tool's only supported platform), with graceful, visible failure instead
  of a crash or a silent no-op.

### Modified Capabilities
- `evidence-telemetry`: adds a new `pr` evidence event kind, emitted by the orchestrator once a
  run's PR exists, alongside the existing `evidence`/`verdict` event kinds it already documents.
- `evidence-reader`: the EVIDENCE panel's selection, rendering, and open-key behavior extend to
  recognize a `pr`-kind entry distinctly from file-based entries, and to route its open action to
  the new browser-open mechanism instead of the doc reader.

## Impact

- `core/roles/orchestrator.md` (Phase 3 Delivery, PR-creation step): new `emit-event.sh pr ...`
  call.
- `lib/ui/screens/drilldown.js`: `evidenceItems()`, `evidenceLines()`, `describeEvent()`,
  `handleKey()` (the `open-evidence-doc` branch under `drillFocus === 'evidence'`).
- `lib/ui/watch.js`: a new action-handler case for opening an external URL; a new (or extended)
  child-process call alongside the existing `execFileSync` usage there.
- `lib/ui/icons.js`: one new glyph for the PR/link artifact type, following the existing
  `Emoji_Presentation=No` glyph-selection constraint documented in that file.
- No changes to `lib/ui/reducer.js`'s event ingestion — it already pushes every event onto
  `run.events` regardless of `kind`, so a new `pr` kind requires no reducer change to reach the
  screens; `describeEvent()`'s TIMELINE rendering gains a dedicated case purely for a friendlier
  label (it already falls back safely for unrecognized kinds).
