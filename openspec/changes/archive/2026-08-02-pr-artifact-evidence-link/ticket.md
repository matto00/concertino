# CON-55: Add PR artifact type to run evidence — Enter opens the PR link in the default browser

## Description

The run drilldown's EVIDENCE panel (`lib/ui/screens/drilldown.js`, `evidenceItems()` at line ~238, `evidenceLines()` at ~274) only handles local-file artifacts today (planning docs, phase reports persisted to `.concertino/runs/<TICKET>/evidence/` via `scripts/concertino/persist-evidence.sh`), opened into the in-TUI doc viewer (`lib/ui/screens/docview.js`). There is no concept of a URL-based artifact, and no code anywhere in the repo opens a link in the system's default browser (`grep -rn "xdg-open|openBrowser|openUrl"` across `lib/`, `bin/`, `core/`, `scripts/` returns nothing).

Add a PR artifact: once a run's PR is created, surface it in the evidence/artifacts list, and let the user press Enter on it to open the PR URL in their default browser instead of routing into the doc viewer.

## Acceptance Criteria

* A PR artifact (label + PR URL) is added to a run's evidence list once the PR exists (likely emitted as a new evidence event kind, e.g. `kind: 'pr'` with a `url` field, alongside the existing file-based evidence events — check how/where PR URLs are already captured post-creation, e.g. auditor/orchestrator PR-creation step).
* `evidenceItems()`/`evidenceLines()` in `drilldown.js` recognize this new kind and render it distinctly from file artifacts (e.g. a distinguishing icon/label so it's clear Enter will leave the TUI).
* Pressing Enter on a PR artifact opens the URL in the OS default browser (e.g. `xdg-open` on Linux; check whether other platforms need support or if this tool is Linux-only) instead of routing to `docview.js`.
* Pressing Enter on existing file-based evidence items is unaffected.
* If the browser-open command fails (e.g. `xdg-open` missing), fail gracefully with a visible message rather than crashing the TUI.

## Metadata

- Linear: https://linear.app/helioapp/issue/CON-55/add-pr-artifact-type-to-run-evidence-enter-opens-the-pr-link-in-the
- Priority: No priority
- Labels: Feature
