- `lib/ui/queue.js` — `reconcileRestored` now also detects a pending ticket
  id whose run reached a terminal state (`done`/`failed`) with `endedAt`
  strictly after `record.writtenAt`, dropping it from `pending` and
  reporting it in a new `completedDuringDowntime` array; `createRestoredQueue`
  accepts an optional pre-computed `reconciled` result so the runtime path
  (`watch.js`) reconciles exactly once, not twice independently.
- `lib/ui/watch.js` — new module-scoped `restoreNotice` sticky variable
  (parallel to `queueNotice`), set from `completedDuringDowntime` in the
  startup restore block independently of whether `createRestoredQueue`
  returns a queue or `null`; threaded through `currentState()`/the
  `visibleWindow` scroll-recompute call alongside `queueNotice`/`queueState`.
- `lib/ui/screens/fleet.js` — `buildHeadTail` renders `restoreNotice` as its
  own tail line (yellow, truncated like `queueNotice`), gated only on the
  notice being non-empty, independent of `queueState`; `render(state, opts)`
  forwards `state.restoreNotice` through to it.
- `test/queue.test.js` — new tests for `reconcileRestored`'s
  `completedDuringDowntime` behavior (terminal-after-writtenAt dropped;
  terminal-at-or-before-writtenAt and no-run-object survive; a terminal
  status with no `endedAt` survives), and for `createRestoredQueue` still
  returning `null` when everything is diverted to `completedDuringDowntime`,
  plus its new optional pre-computed-`reconciled` third argument.
- `test/fleet.test.js` — new tests for the `restoreNotice` tail line
  rendering independently of `queueState` (present with `queueState: null`,
  absent when `queueState` is a normal restore with no notice, both lines
  together, truncation at the available column width).
- `openspec/changes/detect-completed-runs-on-restore/tasks.md` — all tasks
  marked complete.
