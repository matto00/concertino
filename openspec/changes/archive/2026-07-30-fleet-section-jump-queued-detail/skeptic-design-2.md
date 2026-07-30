## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `workflow-state.md`, and all three spec deltas
  (`specs/fleet-section-jump/spec.md`, `specs/fleet-queue-force-start/spec.md`,
  `specs/fleet-queue-visibility/spec.md`) in full, fresh (no reliance on
  round-1's narrative except as a list of required revisions to check).

- **Round-1 change request 1 (confirmed passthrough) — verified fixed and
  correct.** Read `lib/ui/queue.js` in full (all 260 lines) again against the
  current design:
  - `tick()` (`queue.js:141`) still hard-codes `confirmed: true` on its
    returned queue, with the comment confirming it is safe only because
    `tick()` never runs except when `shouldTick(queue)` already held.
  - `shouldTick()` (`queue.js:165-167`) is `queue.confirmed !== false`.
  - Confirmed `buildSections()` (`fleet.js:154-176`) renders the QUEUED
    section purely off `queueState.pending.length` — no `confirmed` check
    anywhere in it — so design.md's claim that force-start is reachable from
    an unconfirmed, CON-29-restored queue exactly as easily as a live one is
    accurate against the real code, not asserted.
  - design.md Decision 4 (lines 174-199) now explicitly states `forceStart`
    "Does NOT hard-code `confirmed: true`" and returns the input queue's own
    `confirmed` value unchanged, with the exact failure mode it prevents
    spelled out (a single force-start silently reactivating `shouldTick()`
    for the rest of a restored batch). A matching Risk entry (lines 275-287)
    restates the mitigation and points at the task/test that covers it.
  - `tasks.md` task 1.1 now states the passthrough requirement explicitly
    ("`confirmed` is carried through unchanged from the input
    `queue.confirmed`, never hard-coded to `true`") with a one-line rationale
    pointer back to design.md Decision 4.
  - `tasks.md` task 1.2 adds a concrete unit-test spec: force-starting one
    ticket out of a `confirmed: false` queue returns `confirmed: false`
    still, and a subsequent `shouldTick()` check on that returned queue is
    still `false`; force-starting out of an already-`confirmed: true` queue
    returns `confirmed: true` unchanged.
  - `tasks.md` task 5.7 independently covers the same scenario at the
    `watch.js`-wiring level (force-starting out of an unconfirmed restored
    queue starts the one ticket but leaves `queueState.confirmed` `false` and
    the rest of `pending` un-admitted on the next simulated poll) — belt and
    braces at both the `queue.js` unit level and the integration level.
  - This is a sound, complete resolution: it does not merely acknowledge the
    hazard, it makes the fix mechanically checkable via two distinct test
    obligations.

- **Round-1 change request 2 (dangling `task 3.6` reference) — verified
  fixed.** `grep -n "task [0-9]"` across `tasks.md`/`design.md` finds exactly
  one cross-reference in tasks.md (task 4.3: "per task 3.3") and one in
  design.md (task 1.2) — both resolve to task IDs that actually exist
  (`grep -oE "^\- \[ \] [0-9]+\.[0-9]+" tasks.md` confirms 1.1 through 8.3 are
  all present, in order, with no gaps). The only remaining occurrence of
  "3.6" anywhere under the change dir is inside `skeptic-design-1.md` itself
  (the historical round-1 report, correctly left untouched as a record).

- **Non-blocking notes from round 1 also addressed** (not required, but
  checked since they're easy wins): task 4.3 now explicitly includes the
  arrow-key aliases (`\x1b[B`/`\x1b[A`) moving `queueFocus` alongside `j`/`k`;
  task group 7 (7.1/7.2) now updates the footer hint line and adds a test for
  it; task 5.3 now explicitly states the `forceStartConfirm`-before-
  `quitConfirm` precedence and that cancelling does not fall through to quit.

- **Fresh full-review checks beyond the two required fixes:**
  - Confirmed CON-6 remains merged to `main` (still the ticket's stated
    prerequisite; unchanged since round 1).
  - Re-read `lib/ui/watch.js`'s `'confirm-restored-queue'` handler
    (`watch.js:1392-1404`, the existing CON-29 `'c'`-key path) — it only ever
    flips `queueState.confirmed` from `false` to `true` via an explicit
    operator keypress on the whole-queue confirm affordance, and is
    untouched by this design. No interaction/contradiction with the new
    per-ticket `forceStart` confirmed-preservation behavior: the two paths
    are independent, exactly as Decision 4 claims.
  - Re-checked the `fleet-queue-force-start` and `fleet-queue-visibility`
    spec deltas for internal consistency with design.md/tasks.md — every
    scenario in both maps cleanly to a task (QUEUED-local cursor →
    tasks 4.x; confirmation gate → tasks 5.1-5.4; bookkeeping/no-double-admit
    → tasks 1.1-1.2, 5.5; no-op-when-already-left → tasks 1.1/5.5/5.7;
    round-trip selection preservation → tasks 4.2/4.6; speed/agent-merge
    display → tasks 2.x/6.x). No contradictions found between spec text and
    design/tasks.
  - Traced every ticket AC/scope item (digit-jump numbering ambiguity,
    QUEUED speed/agent-merge, force-start + load-bearing warning, CON-29
    persistence non-perturbation, the row-index hazard the ticket's own Notes
    section calls out) to both a Decision in design.md and a concrete task —
    no gaps, no scope drift beyond what the ticket asks for.
  - No new placeholders, TODOs, or deferred decisions found anywhere in
    design.md or tasks.md. The one remaining "Open Question" (exact key
    choice for force-start/escape) is explicitly deferred to this
    design-soundness gate itself, which is the correct place for it, and the
    design's own text supplies a specific, defensible default (`f`/bare
    Escape) rather than leaving it unspecified.

### Verdict: CONFIRM

Both round-1 required revisions are fully and correctly resolved, with
matching design decisions, a documented risk/mitigation, and concrete task +
test obligations at two levels (unit and integration). The dangling
cross-reference is gone and every remaining task cross-reference resolves.
No new issues found on a fresh full pass.

### Non-blocking notes

- None beyond what round 1 already raised, all of which are now addressed.
