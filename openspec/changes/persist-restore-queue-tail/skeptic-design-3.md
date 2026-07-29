## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read round 1 (`skeptic-design-1.md`) and round 2 (`skeptic-design-2.md`)
  reports in full and re-checked every prior finding against the current,
  round-3 revised artifacts and ground truth — not against the prior
  reports' narrative.
- Read the full current `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-queue-visibility/spec.md` in the change dir.
- Read `lib/ui/queue.js` in full (130 lines, unmodified pre-change ground
  truth): `createQueue` (`queue.js:27-37`) still returns exactly
  `{ pending, inFlight, maxConcurrent, launchCommand }`, no `confirmed`
  field — consistent with this being a design gate reviewing planned, not
  yet applied, changes.
- Read `lib/ui/watch.js`'s relevant regions: the `queueState` declaration
  and its documented in-memory-only trade (`watch.js:230-252`), the single
  `queue.tick()` call site inside `draw()` guarded today by plain
  `if (queueState)` (`watch.js:367-382`) — confirming the design's planned
  guard change (`queueState.confirmed !== false`) is a small, additive
  change to a real, single call site, not invented — `draw()`'s
  `reduce(store.readAll(root, eventsCache), sampleWindows(now), now)` call
  which runs *after* that tick call (`watch.js:385`), `runs = []`'s startup
  initialization (`watch.js:183`), and the normal-path
  `queueState = queue.createQueue(...)` call site (`watch.js:982`).
- Read `lib/ui/store.js`'s `readAll(root, cache)` (`store.js:174-187`) and
  its own header comment: `cache` is optional and, when omitted, `readAll`
  falls back to a full read/re-parse with nothing persisted between calls —
  "every pre-existing call site keeps working unmodified." This confirms
  design.md Decision 5 / tasks.md 3.3's one-off startup snapshot call,
  `reduce(store.readAll(root), sampleWindows(now), now)` (omitting
  `eventsCache`), is not a bug or inconsistency with the per-poll call —
  it's a correct, deliberate choice for a call made exactly once before the
  incremental cache is meaningfully warm, and every pre-existing call site
  (including this new one-off) keeps working unmodified per `store.js`'s
  own contract.
- Read `lib/ui/screens/fleet.js`'s queue-rendering code (`fleet.js:125-225`)
  to reconfirm the round-1 non-blocking note (the "▲ queue: N running · M
  queued" tail line, gated only on `queueState` truthiness) is still
  present, unaddressed, and still correctly assessed as non-blocking.
- `grep`ed all four artifacts for every occurrence of `confirmed` to trace
  the guard formula and the mandatory-vs-optional field question
  end-to-end, rather than sampling.

### Round 1 Change Request 1 (inFlight not restored into launchable state)

**Still resolved**, unchanged from round 2's assessment — Decision 5a,
tasks.md 2.2/2.4, and the spec's "reconstructs in-flight concurrency
occupancy" requirement are all still present and consistent.

### Round 1 Change Request 2 ("first computed runs snapshot" didn't exist)

**Still resolved**, unchanged from round 2's assessment — Decision 5's
explicit one-off startup `reduce()` pass (now additionally confirmed
mechanically sound against `store.js`'s optional-cache contract, see
above) and tasks.md 3.3 both still specify it concretely.

### Round 2 Change Request (guard-formula/mandatory-field contradiction)

**Resolved, and consistently so across all three documents.**

- `design.md:59` (Decision 5a, "Combined restore result") now states the
  literal guard as `if (queueState && queueState.confirmed !== false)` —
  matching, not contradicting, `tasks.md:19` (3.2, "not `false`") and
  `spec.md:107` ("While `queueState.confirmed` is `false`, the dashboard
  SHALL NOT call `queue.tick()`").
- The permissive "or the field simply absent/true" language that made
  round 2's regression reachable is gone. `design.md:59` now states plainly
  that `confirmed` is "a mandatory field on every queue object `createQueue`
  produces, restored or not — a normal same-session queue built by
  `createQueue` at the launch-plan confirm site MUST set `confirmed: true`
  explicitly (never left absent/undefined)." `tasks.md:12` (2.3) matches
  word-for-word in substance: "`confirmed: true` (mandatory, always set
  explicitly — never left absent/undefined, so `watch.js`'s
  `queueState.confirmed !== false` guard is unambiguous for every queue
  object either path produces)."
- I re-derived the failure mode round 2 found (freshly queued normal
  batches silently never ticking) and confirmed it is closed: with
  `confirmed` mandatory-and-explicit on the normal path and the guard keyed
  on `!== false` (not truthiness), `undefined` can now only occur on a
  malformed object neither code path produces — there is no longer a
  reachable combination of "permitted" choices across the three documents
  that reproduces the regression.
- No other lingering trace of the old truthy-check or "absent/true" phrasing
  remains anywhere in `design.md`, `tasks.md`, or `spec.md` (checked via
  targeted grep across all four artifacts, not sampling).

### Other soundness check (new this round, not previously flagged)

Traced whether the one-off startup snapshot's use of `store.readAll(root)`
without the shared `eventsCache` (as design.md Decision 5 / tasks.md 3.3
literally write it) is itself a latent bug or contradiction with the
per-poll call's `store.readAll(root, eventsCache)` form. It is not:
`store.js:164-172`'s own header comment states the cache parameter is
optional and every pre-existing call site — including a new one-off call
that never touches `eventsCache` — keeps working unmodified when omitted.
Using the shared, long-lived `eventsCache` for a single call made once,
before that cache is constructed/warmed and before the main loop starts,
would be the more questionable choice; omitting it here is correct and
consistent with the module's documented contract, not a gap. Flagging this
only to record that I checked it, not because it's an issue.

### Verdict: CONFIRM

The design is sound and internally consistent across `proposal.md`,
`design.md`, `tasks.md`, and `specs/fleet-queue-visibility/spec.md`. Both
round 1 findings (unreconstructed `inFlight` risking a sequential batch
silently going concurrent across a restart; the non-existent "first
computed runs snapshot") and round 2's finding (the truthy-vs-`!== false`
guard contradiction combined with a permissive "field absent" allowance
that could silently disable all queueing) are genuinely fixed, not merely
asserted fixed — traced against the actual current text of every document
and cross-checked against unmodified ground truth (`lib/ui/queue.js`,
`lib/ui/watch.js`, `lib/ui/store.js`, `lib/ui/screens/fleet.js`). This is
sound enough to implement.

### Non-blocking notes

- Carried forward from round 1/2, still not addressed and still not
  blocking: whether `fleet.js`'s existing "▲ queue: N running · M queued"
  tail line (`fleet.js:156-162`, gated only on `queueState` truthiness, not
  `confirmed`) should also render, or be suppressed, alongside the new
  "resumed — press X to continue" affordance for an unconfirmed restored
  queue. A reasonable executor judgment call either way; would be nice as
  an explicit line in `design.md`/`tasks.md` 4.1 if trivial to add during
  implementation, but not worth a further design-gate round over.
- `design.md`'s Open Questions (exact confirmation keybinding; whether to
  cross-check per-ticket event logs for a completed-during-downtime ticket)
  remain explicitly, reasonably deferred to the executor — bounded
  deferrals, not gaps, as already noted in round 1.
