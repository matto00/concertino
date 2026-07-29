# CON-5: Idle time falls back to pane-content hashing after the first poll

## Description

`lib/ui/watch.js` seeds a window's idle time from tmux's `#{window_activity}` the first time it sees that window, which fixed the original bug where idle was measured from when the dashboard started. But from the second poll onward it switches to comparing hashes of `capture-pane` output, and the tmux value is never consulted again.

The hash is the weaker signal. A redraw that happens to land on identical pane content reads as idle even though the process is working — and TUI harnesses redraw the same frame often, for instance while a spinner sits at the same character.

Consulting `now - activity * 1000` on every poll would be simpler than the hash bookkeeping and more accurate, and it would let the `idle` Map be deleted entirely along with the per-poll `capture-pane` subprocess it exists to feed.

## Acceptance criteria

* Idle time comes from tmux's window activity on every poll, not only the first.
* The pane-content hash and the `idle` Map are removed if they are no longer earning their place, along with the per-window `capture` call in the poll loop.
* Idle continues to survive a dashboard restart.
* Verify against a window that redraws identical content — it must not read as idle.

## Notes

`session.listWindows()` already returns `activity`; this is mostly deletion. Confirm the claim about identical redraws before relying on it — construct a window that rewrites the same frame and check whether `#{window_activity}` advances. If it does not, say so, because then the hash is earning its place after all and this ticket should be closed rather than implemented.

## Metadata

- Ticket ID: CON-5
- Priority: Medium
- URL: https://linear.app/helioapp/issue/CON-5/idle-time-falls-back-to-pane-content-hashing-after-the-first-poll
