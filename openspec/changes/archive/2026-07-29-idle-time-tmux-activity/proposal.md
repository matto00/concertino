## Why

`lib/ui/watch.js`'s poll loop seeds a window's idle time from tmux's
`#{window_activity}` on first sight, but from the second poll onward it
switches entirely to comparing hashes of `capture-pane` output — the tmux
value is never consulted again. The hash is a *visual-diff* signal: it only
detects idle-vs-active by comparing what is on screen frame to frame. tmux's
`window_activity` is a *pty-write* signal: it advances on every byte written
to the pane, whether or not that write happens to reproduce an identical
frame (e.g. a spinner that redraws the same character, or any other
harness whose steady frame repeats visually while the underlying process is
still working). This was verified directly: a tmux window running a loop
that overwrites the screen with byte-identical output every second shows
`#{window_activity}` advancing every second, while a genuinely idle window
(no output at all) leaves `#{window_activity}` unchanged. So the hash can
misreport an actively-working window as idle in exactly the case the ticket
describes, and `window_activity` does not have that failure mode.

Consulting `now - activity * 1000` on every poll (not just the first) is
simpler than the hash bookkeeping and strictly more accurate, and it lets
the per-window `capture-pane` subprocess and the `idle` Map's hash field be
removed.

## What Changes

- `sampleWindows()` in `lib/ui/watch.js` computes each alive window's idle
  time from `now - w.activity * 1000` on every poll, not only on first
  sight.
- The `idle` Map (keyed by ticket, storing `{ hash, since }`) is removed
  entirely — idle time becomes a pure, stateless function of the window's
  `activity` field returned by `session.listWindows()` each poll. No
  per-ticket memory is needed across polls.
- The pane-content hash (`hash()` helper) and its per-window `capture-pane`
  subprocess call (`session.capture(w.ticket)`) inside the poll loop are
  removed, since nothing in the module consults them once idle no longer
  depends on the hash. (`session.capture()` itself, used elsewhere for
  on-demand pane inspection, is unaffected.)
- Idle continues to survive a dashboard restart: `window_activity` is
  tmux's own state, not the dashboard's, so a fresh process reads the same
  value a prior process would have.

## Capabilities

### New Capabilities
- `fleet-idle-tracking`: how the dashboard computes and reports each
  window's idle time from tmux's per-window activity timestamp, independent
  of pane content.

### Modified Capabilities
(none — no existing spec currently documents idle-time behavior)

## Impact

- `lib/ui/watch.js`: `sampleWindows()` rewritten to drop hash-based
  tracking; `idle` Map, `hash()` helper, `IDLE_SAMPLE_MS`/`lastSample`, and
  the per-poll `capture()` call removed. The idle-time arithmetic itself is
  extracted into a small pure `idleMsFromActivity(activity, now)` function.
- Small API surface addition, not none: `idleMsFromActivity` is added to
  `module.exports` so it is directly unit-testable, mirroring the existing
  `buildFrame`/`attachAndRestore` precedent in this same file (see
  design.md). `sampleWindows()`'s own return shape
  (`{ ticket, alive, idleMs }`) is unchanged, and no caller outside this
  module reads any of the removed internals.
- Test coverage: `test/watch.test.js` gets cases unit-testing
  `idleMsFromActivity` directly — activity advancing between two calls,
  and a case standing in for "pane content redrawn identically but
  activity advances" (the helper takes no content input at all, so this is
  demonstrated structurally: content cannot affect its result), and a case
  for restart-survival (stateless, so a "restart" is just a fresh call).
