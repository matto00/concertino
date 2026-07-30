## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read fresh (not from round-1 memory): `ticket.md`, `proposal.md`,
  `design.md`, `tasks.md`, `specs/fleet-queue-visibility/spec.md`, and
  `skeptic-design-1.md` (treated as a claim of what round 1 found, verified
  independently below rather than trusted).

- **Round-1 change request re-verified as actually fixed, not just
  asserted:**
  - `design.md` Decision 2 now has an explicit "Revision after design-gate
    skeptic round 1" paragraph explaining exactly the round-1 failure mode
    (nesting `completedDuringDowntime` under `restoredFrom` loses it when
    `createRestoredQueue` returns `null`) and Decision 4 now specifies
    delivery via a **new, `queueState`-independent** `restoreNotice`
    variable in `watch.js`, modeled on the existing `queueNotice` variable.
  - Read `lib/ui/screens/fleet.js:186-243` (`buildHeadTail`) directly: the
    existing `queueNotice` line (`if (queueNotice) tail.push(...)` at line
    238) is *already* rendered unconditionally on `queueNotice` truthiness
    alone, with **no** dependency on `queueState` — this is a real,
    pre-existing precedent in the codebase for exactly the independent-notice
    pattern Decision 4 proposes, confirming the plan is not just plausible
    but mirrors code already shipped and working the same way.
  - Read `lib/ui/watch.js:351-372`: `queueState`/`queueNotice` are both
    plain module-scoped `let`s threaded through `currentState()` (line 372)
    and consumed by `fleet.js`'s `render(state, opts)` (`screens/fleet.js:614-627`,
    which does `queueNotice: state.queueNotice, queueState: state.queueState`).
    A `restoreNotice` variable added the same way is a drop-in, mechanically
    unambiguous addition — no structural obstacle found.
  - Read `lib/ui/watch.js:688-702` (the actual startup restore block): today
    it only branches on `restored` (the `createRestoredQueue` result) and
    would need exactly the task-2.2 change (obtain `completedDuringDowntime`
    from the reconciliation pass regardless of whether `restored` is
    truthy). Confirmed there is no other consumer of this block to break.
  - `tasks.md` 1.4 and 4.4 now explicitly require a test proving
    `createRestoredQueue` still returns `null` when everything drains into
    `completedDuringDowntime` — the exact scenario round 1 flagged as
    silently broken — and `tasks.md` 4.6/4.7 require tests for
    `restoreNotice` being set/rendered specifically when `queueState` is
    `null`. `specs/fleet-queue-visibility/spec.md`'s new ADDED requirement
    has a scenario ("A completed-during-downtime notice appears even when
    nothing is left to restore") stating this in unconditional SHALL
    language with no carve-out — the exact gap round 1 flagged in the
    MODIFIED requirement's wording is now closed by giving the notice its
    own requirement, independent of the restore-affordance requirement.
  - Verdict on the round-1 item: **fixed**, and fixed with an approach
    (independent notice, not restructuring `createRestoredQueue`'s null-return
    contract) that keeps CON-29's existing, tested "no empty-but-confirmable
    queue" invariant intact rather than weakening it — a cleaner fix than
    either of the two options round 1 suggested picking between.

- **Ground-truth spot checks on design.md's other factual claims:**
  - `lib/ui/reducer.js:168-175` (`deriveStatus`): confirmed line 169
    (`if (run.endStatus) return ...`) and line 170
    (`if (run.window && !run.window.alive) return 'failed'`) are two
    genuinely separate paths to a terminal `status` — the second reachable
    with `endedAt` still `null` (initial state, `reducer.js:49`). This
    exactly matches Decision 3's claim (and corrects skeptic-design-1's
    non-blocking note, which flagged the original design text as slightly
    inaccurate on this point — the revision has since folded the correction
    directly into Decision 3's prose).
  - `lib/ui/queue.js` (full file, current `main`): `reconcileRestored`
    (lines 184-195) and `createRestoredQueue` (lines 204-216) match the
    "before" state Decisions 1-3 describe exactly, including the literal
    "both pending and inFlight empty -> return null" rule at line 207 that
    Decision 3 says is unchanged.
  - `lib/ui/queue-cache.js`: confirmed `writtenAt` is the actual persisted
    field name (`queue-cache.js:69,91,129,132`) that Decision 3's
    `endedAt > record.writtenAt` comparison depends on.
  - `test/queue.test.js`, `test/fleet.test.js`, `test/watch.test.js` all
    exist (`ls test/`), so `tasks.md` section 4's file references are real,
    not aspirational.

- **New issues introduced by the revision:** none that block. One stale
  leftover found (see non-blocking notes) — `proposal.md`'s "Impact"
  section (line 62) still reads "`lib/ui/watch.js`: no code change
  expected... verify during implementation," which is now contradicted by
  the same document's own "What Changes" bullet (line 31: "`watch.js`'s
  startup restore block surfaces `completedDuringDowntime` through a new
  sticky notice") and by `design.md` Decision 4 / `tasks.md` section 2,
  which unambiguously require new code in `watch.js` (`restoreNotice`
  variable, startup-block change, threading into render options). This is a
  genuine internal contradiction within the planning artifacts, but it does
  not create real implementation ambiguity: `tasks.md` section 2 (2.1-2.3)
  is the executable checklist and is fully unambiguous and consistent with
  `design.md`; the stale `proposal.md` bullet is a one-line "at a glance"
  summary an implementer following `tasks.md` would not be misled by.
  Flagged as non-blocking, recommend fixing before this reaches an executor
  who skims only `proposal.md`.

### Verdict: CONFIRM

### Non-blocking notes

1. `proposal.md` line 62 ("`lib/ui/watch.js`: no code change expected...")
   should be updated to match line 31 and `design.md` Decision 4 /
   `tasks.md` 2.1-2.3 — it is stale text left over from before the round-1
   revision and now contradicts the rest of the same document.
2. `design.md` Decision 1's parenthetical ("or to call `reconcileRestored`
   itself and have `watch.js` call it a second time only for
   `completedDuringDowntime`") reads at first glance as license to call the
   pure function twice, immediately followed by "the two call sites MUST
   NOT each run their own independent reconciliation pass." These are not
   actually contradictory (calling the same deterministic pure function
   twice with identical inputs cannot diverge; the prohibition is against
   two *different* code paths computing the drop logic independently), but
   the wording is dense enough that a quick read could parse it as
   self-contradicting. Worth a one-clause tightening (e.g. "calling the same
   `reconcileRestored` function a second time is fine; reimplementing its
   drop logic separately at the second call site is not") if this design
   doc is touched again, but not worth a re-review cycle on its own.
