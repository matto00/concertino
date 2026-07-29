## Context

`lib/ui/watch.js`'s poll loop (`sampleWindows()`) tracks per-window idle time
in an in-memory `idle` Map keyed by ticket: `{ hash, since }`. `since` is
seeded once, on first sight of a window, from tmux's `#{window_activity}`
(via `session.listWindows()`'s `activity` field, already read on every
poll). From the second poll onward, `since` is only ever advanced by
comparing a hash of `session.capture(w.ticket)` (a `capture-pane`
subprocess call) against the previous poll's hash — `w.activity` is not
consulted again after the seed.

This was empirically checked before committing to this design (per the
ticket's request to confirm the claim rather than assume it): a tmux window
running a loop that overwrites the pane with byte-identical output every
second shows `#{window_activity}` advancing every second; a window with no
output at all leaves `#{window_activity}` frozen. So `window_activity`
tracks pty writes, not visual state, and does not share the hash's failure
mode of reading a byte-identical redraw as inactivity.

## Goals / Non-Goals

**Goals:**
- Idle time for every alive window is `now - w.activity * 1000`,
  recomputed every poll, not only seeded once.
- Remove the `idle` Map, the `hash()` helper, and the per-window
  `capture-pane` call in `sampleWindows()` once nothing depends on them.
- Idle time still survives a dashboard restart (it already does, and
  continues to, since it comes from tmux's own state, not the dashboard's).

**Non-Goals:**
- Changing `session.capture()` itself, which survives unaffected as a
  general-purpose method — only the one call to it inside
  `sampleWindows()` is in scope for removal. (A repo-wide grep confirms it
  has no other current production call site; it is not being changed, just
  no longer called from this one place.)
- Changing `sampleWindows()`'s return shape (`{ ticket, alive, idleMs }`) or
  any downstream consumer of it.
- Changing the `IDLE_SAMPLE_MS` throttle's role elsewhere, if it is used for
  anything besides the hash sampling cadence (it is not, per the code read
  during planning — its only reference is the hash `takeSample` gate this
  change removes).

## Decisions

**Decision: Compute idle purely from `w.activity`, no per-ticket memory.**
`w.activity` is already returned by `session.listWindows()` on every poll
(it is tmux's own `#{window_activity}` timestamp, in epoch seconds). Idle
time becomes `Math.max(0, now - w.activity * 1000)` when `w.activity != null`,
else falls back to reporting the window as having just appeared (`0`) the
same way the old seed path did when `activity` was unavailable — this
preserves existing behavior for the edge case where tmux hasn't set an
activity timestamp yet. No Map, no per-run state: this is now a stateless
function of each poll's own `listWindows()` output, so it also drops the
unbounded-growth concern of a Map keyed by ticket that is never pruned when
a window dies (dead windows already short-circuit to `idleMs: null` before
touching the map, but removing the map removes even that latent concern).

*Alternative considered*: keep the Map but also refresh `since` from
`w.activity` every poll (belt-and-suspenders). Rejected — once idle is
purely a function of `w.activity`, keeping a Map around to cache a value
that is recomputed identically every poll from data already in hand is
dead weight, and the ticket explicitly asks to delete it if it is no
longer earning its place.

**Decision: Remove `hash()` and the per-poll `capture-pane` call.**
Once idle no longer depends on the hash, `session.capture(w.ticket)` inside
`sampleWindows()` has no remaining reader. It is a subprocess spawn per
alive window per sample tick — removing it also removes that cost.
`IDLE_SAMPLE_MS` and the `takeSample` gate that throttled the hash sampling
are removed with it, since nothing else in the module reads them.

*Alternative considered*: keep the hash as a secondary signal (e.g. "idle
unless either activity advanced or content changed"). Rejected per the
ticket's own framing and the empirical check above: the hash's only case
where it could add information beyond `window_activity` is a byte-identical
redraw, and that is exactly the case where the hash is *wrong* (it reads as
idle) and `window_activity` is *right* (it reads as active, because the pty
was written to). There is no case in this codebase's usage where the hash
catches something `window_activity` misses.

**Decision: Extract and export a pure `idleMsFromActivity(activity, now)` helper.**
`sampleWindows()` itself is a private closure inside `watch()`, closed over
`session` (constructed unconditionally by `createSession()` with no
injection seam) and, today, over the `idle` Map and `lastSample`. There is
no way to call it from a test as-is, and this file already has an
established precedent for this exact problem: `buildFrame` and
`attachAndRestore` were pulled out and exported "purely for tests" (see
their own header comments and `test/watch.test.js`) rather than exercised
only end-to-end. Once idle time is a stateless function of `(activity,
now)` — no Map, no closure state — the entire piece worth unit-testing is
small enough to extract the same way:

```js
function idleMsFromActivity(activity, now) {
  return activity != null ? Math.max(0, now - activity * 1000) : 0;
}
```

`sampleWindows()` calls this helper for each alive window; the helper
itself is added to `module.exports` alongside `buildFrame`/
`attachAndRestore`. This makes every scenario in
`specs/fleet-idle-tracking/spec.md` — activity advancing between polls,
identical pane content not mattering (the helper never takes content as an
input at all, which is itself the proof that content can't affect the
result), and restart-survival (the helper is stateless, so "restart" is
just "call it again with a fresh `now`") — directly unit-testable without
a real tmux session or a fake `session` double. `sampleWindows()` itself
stays private; only the pure computation is exported.

This does mean `proposal.md`'s Impact section's "No API surface change" is
not quite accurate — `idleMsFromActivity` is a small new export. It is
corrected there to note this one addition, consistent with the existing
`buildFrame`/`attachAndRestore` precedent in the same file.

*Alternative considered*: export `sampleWindows` itself, restructured to
take `session` as a parameter instead of closing over it. Rejected — it
would require also deciding how to handle `session.listWindows()`'s
tmux-format `#{window_activity}` parsing in a fake double, more surface
area than the test scenarios actually need, when the entire behavior under
test is the one-line arithmetic in `idleMsFromActivity`.

## Risks / Trade-offs

- [Risk] A harness that writes to its pane in a tight loop without tmux
  attached (e.g. some sandboxed execution mode) might not update
  `#{window_activity}` the way a normal attached tmux window does. →
  Mitigation: `window_activity` is tracked by the tmux server itself from
  pty writes regardless of whether a client is attached (verified via the
  detached-session test above, which never attached a client); this is not
  a new dependency the change introduces, since `activity` was already
  being read from `listWindows()` for the first-poll seed.
- [Risk] Removing the hash removes the only signal that previously covered
  a hypothetical case where tmux's activity tracking itself misses a
  write. → Mitigation: no such case was found or is expected (tmux's
  `window_activity` is a core, long-standing feature the whole fleet
  dashboard already depends on for the existing seed path); if one turns
  up in practice, the same acceptance-test approach used here (construct
  the failing window, capture `#{window_activity}`) applies to confirm it
  before reintroducing any content-based signal.

## Migration Plan

No data migration — this changes only in-memory poll-loop behavior in a
single process. Deploy is a normal code change: merge, and the next
`concertino watch` invocation picks up the new logic. No flag or rollback
mechanism beyond reverting the commit is needed.

## Open Questions

None — the ticket's own open question (does `window_activity` advance on
identical redraws) was resolved during planning; see Context above.
