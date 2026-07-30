## Why

The drill-down's EVIDENCE panel (`lib/ui/screens/drilldown.js`, `evidenceLines()`) lists a run's
persisted artifacts — proposal, design, evaluation reports, both skeptic reports — as names only.
Reading one means leaving the dashboard, finding its path under `.concertino/runs/<TICKET>/evidence/`,
and opening it in an external editor. The whole point of persisting these durably (CON-10) was so a
human reviewing a run could see what the skeptic actually refuted without leaving the screen; that
payoff is still one manual file lookup away.

## What Changes

- Add a new shared, pure `docview` screen (`lib/ui/screens/docview.js`) that renders a `{ title, body
  }` document in a bounded, scrollable bordered pane — the general form of the "long text document"
  problem `ticketview.js` already solves for a single ticket's description/comments.
- Refactor `ticketview.js` to build its `{ title, body }` shape and delegate its box-drawing/scrolling
  to `docview.js`, rather than keeping a second, independent box-rendering implementation. `ticketview.js`
  remains reachable via `↵` from the launch pad exactly as before; the only observable change is that
  a ticket description too long to fit the terminal is now scrollable instead of silently overflowing
  off-screen (previously unbounded, unscrollable — an existing gap this happens to close as a
  byproduct of sharing the renderer).
- Add evidence-entry selection to the drill-down's EVIDENCE panel: `↑`/`↓` (or `j`/`k`) move a
  selection cursor among listed entries, gated behind a `tab`-style focus switch so the screen's
  existing `↵ attach` / `k kill` / `r restart` bindings are unambiguous when the panel is not
  focused (mirrors `launchpad.js`'s existing epics/tickets `\t` pane switch and its `focused`
  border rendering — see `lib/ui/layout.js`'s `focused` option).
- Selecting an entry and pressing `↵` while EVIDENCE is focused opens it via `docview`, reading the
  file at its persisted `ref` path. `esc` from that reader returns to the drill-down with the same
  entry still selected (selection index is preserved, not reset).
- An entry whose file is missing (a ref that has outlived its file — see CON-4's retention proposal)
  opens the reader with an explicit "file not found" body instead of an empty pane, or a thrown error.
- The reader's body is rendered as plain text via the existing `lib/ui/markdown.js` `toPlainText()`
  stripper, and control bytes are stripped via the existing `f.truncate` choke point every screen
  already routes free text through (`lib/ui/format.js`) — the same two mechanisms the launch pad's
  ticket text already relies on, applied here rather than duplicated.
- No new key is advertised on the EVIDENCE panel's footer hint unless the panel is currently focused
  and has at least one entry to select.

## Capabilities

### New Capabilities
- `docview`: a shared, pure `{ title, body }` scrollable document reader screen — bordered pane,
  bounded to available terminal rows, `↑`/`↓`/`pgup`/`pgdn` scroll, `esc` returns to caller.
- `evidence-reader`: the drill-down EVIDENCE panel's selection, focus, and open/esc behavior —
  including the missing-file degradation and the "no key advertised unless bound" footer contract.

### Modified Capabilities
(none — `ticketview.js`'s existing spec commitments, in `launchpad-detail-pane`, are about the
shared `buildDetailLines` body renderer and about remaining reachable via `↵`; both hold unchanged.
The scrolling this change adds to its outer box is new capability surfaced through `docview`, not a
change to a documented `launchpad-detail-pane` requirement.)

## Impact

- `lib/ui/screens/docview.js` (new), `lib/ui/screens/ticketview.js` (refactored to delegate),
  `lib/ui/screens/drilldown.js` (evidence selection/focus state and footer hints),
  `lib/ui/router.js` (registers `docview`), `lib/ui/watch.js` (new mode transitions:
  `open-evidence-doc` / `back-to-drilldown-from-doc`, and the scroll-state plumbing docview needs,
  mirroring `scrollOffset`'s existing precedent in `fleet.js`/`watch.js`).
- No backend, telemetry, or persisted-file-format changes — this reads the same `ref` paths
  `evidence`/`verdict` events already carry (`evidence-telemetry` capability), unchanged.
