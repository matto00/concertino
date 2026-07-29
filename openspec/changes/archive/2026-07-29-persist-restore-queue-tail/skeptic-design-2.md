## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `proposal.md`, `design.md`, `tasks.md`, and the delta spec
  `specs/fleet-queue-visibility/spec.md` in full (current, revised state).
- Read round 1's report (`skeptic-design-1.md`) in full and re-checked both
  of its Change Requests against the revised artifacts and ground truth.
- Read `lib/ui/queue.js` in full (130 lines) — `createQueue`, `tick`,
  `isIdle`, `isRunLive`.
- Read `lib/ui/watch.js`'s startup sequence and `draw()` in full
  (`watch.js:153-560` region), including the `queueState` declaration
  comment (`watch.js:230-252`), `draw()`'s `queue.tick()` call site
  (`watch.js:367-383`) which precedes its own `reduce()` call
  (`watch.js:385`), the `runs = []` initialization (`watch.js:183`), the
  first `draw()` call (`watch.js:463`), and the actual normal-path queue
  creation call site `queueState = queue.createQueue(...)`
  (`watch.js:982-986`, inside the `confirm-launch` action handler).
- Confirmed `queue.js`'s `createQueue()` (`queue.js:27-37`) returns exactly
  `{ pending, inFlight, maxConcurrent, launchCommand }` today — no
  `confirmed` field — and is not otherwise modified in-repo (this is a
  design gate; ground truth is pre-change code).

### Round 1 Change Request 1 (inFlight not restored into launchable state)

**Resolved.** Design.md now has Decision 5a: restore explicitly reconstructs
`inFlight` by checking each persisted in-flight id against `isRunLive`
against the startup reconciliation snapshot, seeding the restored queue's
`inFlight` Set with the still-live ones (`design.md:53-57`). `tasks.md`
2.2/2.4 and the new spec requirement "A restored queue reconstructs
in-flight concurrency occupancy, not just the pending list"
(`spec.md:80-104`) match. The sequential (`maxConcurrent: 1`) double-launch
hazard I refuted round 1 is closed: a still-live in-flight ticket now
occupies a tracked slot after restore, exactly as `queue.tick()`'s own
concurrency accounting (`inFlight.size < maxConcurrent`, `queue.js:103`)
requires.

### Round 1 Change Request 2 ("first computed runs snapshot" didn't exist)

**Resolved.** Design.md Decision 5 now specifies a concrete, one-off
`reduce(store.readAll(root, eventsCache), sampleWindows(now), now)` pass,
computed once at startup before the alt-screen/poll-timer loop and before
`queueState` is (re)assigned, used only for restore-time reconciliation
(`design.md:49`). I verified this is mechanically sound against the actual
file: `sampleWindows` (`watch.js:338-351`) is a plain function declaration
inside `watch()`, hoisted and callable at any point in the function body
(its only dependency, `session`, is already constructed and `.ensure()`d by
`watch.js:165` — well before `queueState`'s declaration at `watch.js:252`);
`reduce`, `store.readAll`, and `eventsCache` (`watch.js:181`) are likewise
already available at that point. `tasks.md` 3.3 spells out the same thing
concretely, including that this snapshot is not cached or reused by the
regular per-poll `draw()` loop. This is a real, buildable ordering, not
hand-waving.

### New issue found in the revision: two authoritative, contradictory guard formulas for `queueState.confirmed`, one of which breaks the pre-existing (non-restore) queue path entirely

Verifying the "no other field changes" / "confirmed" plumbing across the
four revised artifacts surfaces a direct contradiction between design.md
and tasks.md/spec.md over the exact boolean condition gating `queue.tick()`:

- **design.md:59** (Decision 5a) states the literal code: `watch.js`'s tick
  call site is guarded: `if (queueState && queueState.confirmed) { ...call
  queue.tick()... }` — a **truthy check**, requiring `confirmed` to
  explicitly be `true` (or otherwise truthy).
- **tasks.md:19** (task 3.2) describes the same guard differently: "Guard
  the `queue.tick()` call itself so it is only invoked when
  `queueState.confirmed` is **not `false`**" — an `!== false` check, under
  which `undefined` passes.
- **spec.md:107** phrases the requirement the same way as tasks.md: "While
  `queueState.confirmed` is `false`, the dashboard SHALL NOT call
  `queue.tick()`" — again keyed on explicit `false`, not on the absence of
  `true`.

These two formulas disagree exactly where it matters: when `confirmed` is
`undefined`. And that case is not hypothetical — it is the **normal,
pre-existing, same-session queue path**, which this change does not
otherwise touch. I traced the only call site that creates a queue outside
of restore: `queueState = queue.createQueue(...)` at `watch.js:982-986`,
inside the `confirm-launch` handler (the "N" launch-pad flow, i.e. CON-28's
existing feature). `createQueue()` (`queue.js:27-37`) returns `{ pending,
inFlight, maxConcurrent, launchCommand }` — **no `confirmed` field at all**
today, and neither `design.md` nor `tasks.md` requires modifying
`createQueue` (or its call site) to add `confirmed: true`. Task 2.3 makes
this explicit and permissive: "`confirmed: true` (**or the field simply
absent/true**) ... for a normal same-session queue" — i.e. leaving the
field `undefined` is presented as an equally valid implementation choice.

Combine the permitted choice (leave `confirmed` absent on a normal queue,
per task 2.3) with the literal guard design.md hands the executor as
authoritative pseudo-code (`if (queueState && queueState.confirmed)`, a
truthy check): every normal, same-session queue created via the existing
"N" launch-pad flow would have `confirmed === undefined`, the guard would
evaluate false, and `queue.tick()` would **never fire for any freshly
queued batch again** — a silent, total regression of the entire pre-existing
CON-28 queueing feature, not a nuance of the new restore path. Since
`watch.js` has exactly one `queue.tick()` call site (confirmed by grep and
by the file's own comment, `watch.js:967`), this single guard formula
necessarily applies uniformly to both the restored and the normal path —
there is no way to apply design.md's truthy guard only to restored queues.

This is precisely the class of "internal contradiction — tasks contradict
design" and "ambiguity a competent implementer could read two ways" the
design gate exists to catch, and the consequence of picking the
wrong-but-explicitly-permitted combination is severe (breaks all queueing,
not just restore).

### Verdict: REFUTE

### Change Requests

1. **Reconcile the `queueState.confirmed` guard formula across design.md,
   tasks.md, and spec.md, and remove the "field simply absent" option for
   normal queues if the truthy-check guard is kept.** Concretely, pick one
   of:
   - (a) Keep the `!== false` guard (tasks.md 3.2 / spec.md's phrasing,
     which already correctly and safely handles `undefined` as "not
     explicitly unconfirmed"), and fix `design.md:59`'s literal code to
     match (`if (queueState && queueState.confirmed !== false)`), so an
     implementer copying design.md's snippet does not regress the normal
     path; or
   - (b) Keep the truthy guard as design.md:59 literally states it, and
     make `createQueue()` (or its `watch.js:982` call site) explicitly set
     `confirmed: true` as a **required**, not optional, part of task 2.3 —
     removing "(or the field simply absent/true)" as a permitted
     alternative, since that phrasing is exactly what makes the regression
     reachable.
   Either fix is acceptable; what is not acceptable is leaving both
   documents in place simultaneously, since together they hand the
   executor an explicitly-sanctioned path to silently disable all
   queueing.

### Non-blocking notes

- Round 1's non-blocking note about whether the existing "▲ queue: N
  running · M queued" tail line in `fleet.js` (gated only on `queueState`
  truthiness) should also render or be suppressed for an unconfirmed
  restored queue is still not addressed explicitly in the revision. Still
  not blocking — a reasonable executor judgment call — but worth an
  explicit line in `design.md`/`tasks.md` 4.1 if it's easy to add now that
  4.1 is already being written.
- `queue-cache.js`'s `write()` (task 1.3) will need to serialize the
  `inFlight` `Set` to a plain array (`Array.from(...)`) for JSON — not
  stated explicitly anywhere, but low-risk and unambiguous enough not to
  block on.
