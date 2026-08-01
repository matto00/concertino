## Why

On both the fleet page and the escalation answer screen, a long escalation *question* is
hard-truncated with `…` instead of word-wrapping, so it runs off (or is clipped at) the edge
of the screen. The escalation *context* field, right next to it, already wraps correctly via
`lib/ui/textwrap.js`'s `wrap()` — the question field was simply never updated to match when
that utility was introduced. This is a straightforward bug fix that brings the question field
in line with the context field's existing, already-correct behavior; it does not change any
capability's documented contract.

## What Changes

- `lib/ui/screens/fleet.js:196` (the NEEDS YOU / RUNNING row): stop hard-truncating
  `run.escalation.question` with `f.truncate(...)`; wrap it with `textwrap.wrap()` instead,
  onto additional line(s) under the run row, without corrupting box borders or other rows.
- `lib/ui/screens/escalation.js:146` (the escalation answer screen's headline): stop
  `f.truncate(currentQuestion, innerWidth)`; wrap it with `textwrap.wrap()`, the same utility
  already used for the context field at `escalation.js:160`.
- Short questions that already fit on one line are unaffected in both places.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — no capability's documented requirements currently mandate truncation-by-ellipsis for
the escalation question; this is a bug fix bringing implementation in line with the
already-correct, already-specified wrapping behavior for the context field.)

## Impact

- Affected files: `lib/ui/screens/fleet.js`, `lib/ui/screens/escalation.js`.
- Reused utility: `lib/ui/textwrap.js`'s `wrap()` (no new dependency).
- No API, schema, or telemetry changes. Purely a rendering fix in the dashboard TUI.
