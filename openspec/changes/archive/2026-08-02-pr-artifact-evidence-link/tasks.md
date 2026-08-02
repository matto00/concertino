## 1. Icon

- [x] 1.1 Add one new glyph to `lib/ui/icons.js` (e.g. `icons.pr` or `icons.link`) for the PR
      artifact type, drawn from the same restricted codepoint classes the file's header comment
      already constrains every glyph to.

## 2. Telemetry emission

- [x] 2.1 In `core/roles/orchestrator.md`'s Phase 3 Delivery section, add a step immediately after
      PR creation (before "Post the PR link back to the ticket") that emits
      `scripts/concertino/emit-event.sh pr ticket=$TICKET_ID role=orchestrator url="$PR_URL"
      label="<short label>"`.
- [x] 2.2 Confirm `scripts/concertino/emit-event.sh` needs no changes to accept an arbitrary `pr`
      kind with `url=`/`label=` fields (it already writes through generic `k=v` pairs verbatim per
      its own usage contract) — verify with a manual invocation against a scratch ticket log and
      inspect the resulting JSONL line.

## 3. Drill-down: recognize and render PR entries

- [x] 3.1 Update `evidenceItems(run)` in `lib/ui/screens/drilldown.js` to include events where
      `ev.kind === 'evidence' || ev.kind === 'pr'`, preserving existing event order.
- [x] 3.2 Update `evidenceLines()` to prefix a `pr`-kind entry's rendered line with the new icon
      (distinct from the plain selection-marker prefix file entries use), leaving file-entry
      rendering byte-for-byte unchanged.
- [x] 3.3 Add a `case 'pr':` to `describeEvent()`'s switch (TIMELINE rendering) with a friendly
      label/detail (e.g. `{ label: 'PR opened', detail: ev.url || '' }`), matching the existing
      convention that every defined kind gets its own case rather than falling through to the
      default.

## 4. Drill-down: route Enter to the new action for PR entries

- [x] 4.1 In `handleKey()`'s `drillFocus === 'evidence'` branch, on `\r`, branch on the selected
      item's `kind`: a `pr` item returns `{ type: 'open-external-url', ticket: run.ticket, url:
      ev.url, label: ev.label }`; an `evidence` item returns the existing `open-evidence-doc`
      action unchanged.

## 5. Browser-open mechanism in watch.js

- [x] 5.1 Add a small `openInBrowser(url)` helper in `lib/ui/watch.js` using
      `execFileSync('xdg-open', [url], { stdio: 'ignore' })`, matching the file's existing
      `execFileSync` usage pattern.
- [x] 5.2 Add a `case 'open-external-url':` action handler that calls `openInBrowser(action.url)`
      inside try/catch: on success, no mode change, no notice; on thrown error, set `drillNotice`
      to a visible message identifying the URL and the failure (reusing the existing `drillNotice`
      mechanism the `restart-confirmed` handler already uses), and do not change `mode`.

## 6. Verification

- [x] 6.1 Manual test: with a scratch run whose event log has both `evidence` and `pr` events,
      confirm the EVIDENCE panel shows both, the PR entry is visually distinct, Enter on the PR
      entry opens a browser and does not enter `docview`, and Enter on a file entry still opens
      `docview` exactly as before. (Automated equivalent: `test/watch.test.js`'s CON-55 harness
      tests — a real `xdg-open` is never touched; a fake one is shadowed onto PATH for the
      duration of each test — see its own header comment.)
- [x] 6.2 Manual test: temporarily rename/hide `xdg-open` (or point the helper at a nonexistent
      binary) and confirm Enter on the PR entry shows a visible notice rather than crashing the
      TUI. (Automated equivalent: `test/watch.test.js`'s "xdg-open fails"/"xdg-open is missing
      entirely" CON-55 tests.)
- [x] 6.3 Run the project's existing test suite (`npm test` or equivalent) and confirm no
      regression in `drilldown.js`/`watch.js` coverage; add/update unit tests for
      `evidenceItems()`, `evidenceLines()`, `handleKey()`'s new branch, and the `open-external-url`
      handler's success/failure paths.
- [x] 6.4 `openspec validate --change pr-artifact-evidence-link` passes with no errors. (The
      installed CLI's actual flag is a bare positional `<item-name>` / `--changes`, not
      `--change` — ran `openspec validate pr-artifact-evidence-link --strict` per the skeptic's
      design-gate note; this is a pre-existing repo-wide convention issue, not unique to this
      change.)
