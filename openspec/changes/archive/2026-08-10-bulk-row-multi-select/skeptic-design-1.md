## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all three spec
  deltas (`specs/fleet-bulk-select/spec.md`, `specs/fleet-failed-remediation/spec.md`,
  `specs/fleet-queue-force-start/spec.md`), and `workflow-state.md`.
- Cross-referenced the Linear ticket (CON-109) description/AC against
  `ticket.md` — they match verbatim; no scope drift.
- Read the actual source this change touches: `lib/ui/screens/fleet/keys.js`
  (369 lines), `lib/ui/app-state.js` (404 lines, both `createAppState()` and
  `currentState()`), `lib/ui/screens/fleet/sections.js` (`buildHeadTail`),
  `lib/ui/screens/fleet/rows.js` (`renderFinishedRow`/`renderQueuedRow`),
  `lib/ui/screens/fleet/render.js` (`mergeRenderOpts`/`render`), and
  `lib/ui/controllers/fleet.js` (`scrollToShow`, the existing `address-failure`/
  `confirm-mark-done`/`confirm-force-start`/`exit-queue-focus` handlers).
- Traced the exact data path a keypress and a render actually take:
  `watch.js:1214` (`router.handleKey(key, currentState())`) and
  `render.js:399` (`renderFleet(state.runs, mergeRenderOpts(state, opts))`,
  called from `router.render(state, opts)`) — both `handleKey` (fleet/keys.js)
  and `render` (fleet/render.js) receive only the curated `currentState(S)`
  snapshot, never raw `S`.
- Located the file path discrepancy: proposal.md/design.md/tasks.md refer to
  `lib/ui/render.js`; the actual file is `lib/ui/screens/fleet/render.js`
  (confirmed via `find lib/ui -iname "*render*"`). Non-blocking (the Impact
  section elsewhere correctly says `lib/ui/screens/fleet/`), but worth fixing
  so the executor doesn't waste a cycle looking for a file that isn't there.
- Confirmed, via `grep -rn "markDoneConfirm"`, the exact set of files a
  single prior confirm-gate field (`markDoneConfirm`, CON-98) had to be
  threaded through, and read the codebase's own comments documenting that
  omitting some of them was a real, previously-shipped bug ("fleet-metrics-
  grid final-fix 2", "skeptic gate round 1, finding 3" — both present in
  `controllers/fleet.js` and `watch.js` today).
- Read `lib/ui/widgets/confirm.js` (`confirmLines`) to verify the bulk
  confirmation banner can reuse the existing widget, as claimed.
- Read `docs/dashboard.md`'s FAILED/QUEUED key-table sections — the
  documentation-update AC (#3) is straightforward against the existing
  structure; no gap there.

### Verdict: REFUTE

The design's decisions (state shape, gate precedence, mixed-outcome
reporting) are well-reasoned and the two escalated questions are resolved
concretely. But `tasks.md` has three gaps that would each produce a
concrete, reproducible defect if implemented literally as written — two of
them recreating bug classes this exact codebase has already shipped and
fixed once (for `markDoneConfirm`, CON-98) and left comments warning about.

### Change Requests

1. **`currentState(S)` in `app-state.js` is missing from every task, but
   `handleKey`/`render` cannot see `S.multiSelect`/`S.bulkConfirm`/
   `S.bulkResult` without it — guaranteed crash on first use.**
   `currentState(S)` (`lib/ui/app-state.js:311-341`) is a deliberately
   curated allowlist, not a spread of `S` (see its own header comment) — it
   is the *only* state object `fleet/keys.js`'s `handleKey` and
   `fleet/render.js`'s `mergeRenderOpts` ever receive (confirmed at
   `watch.js:1214` and `render.js:399`). Every other confirm/focus field this
   design's own Decisions rely on (`markDoneConfirm`, `forceStartConfirm`,
   `focus`, `queueFocus`, `clearQueueConfirm`) is explicitly listed in both
   `createAppState()` *and* `currentState()`. Task 1.1 only says "Add
   `S.multiSelect`... to `app-state.js`'s initial state" — that describes
   `createAppState()` alone. Design.md Decision 3's bulk-dispatch check
   (`if (S.multiSelect.failed.size > 0)`, tasks 3.1/3.2) is written against
   `state.multiSelect` inside `handleKey`, which only ever sees
   `currentState(S)` — without adding `multiSelect`/`bulkConfirm`/
   `bulkResult` to `currentState()` too, `state.multiSelect` is `undefined`
   and `state.multiSelect.failed.size` throws a `TypeError` the first time
   `a`/`d`/`f` is pressed after this ships. Add an explicit task (e.g. "1.2
   Add `multiSelect`/`bulkConfirm`/`bulkResult` to `app-state.js`'s
   `currentState()` snapshot, mirroring `markDoneConfirm`'s own listing at
   line 332") and call out that `render.js`'s `mergeRenderOpts` also needs
   `bulkConfirm`, `bulkResult`, and (for row-marker rendering, task 6.3)
   `multiSelect` added to the object it builds at `render.js:350-392` —
   currently that function lists `markDoneConfirm`/`forceStartConfirm`/
   `clearQueueConfirm`/`addressFailureNotice` explicitly but the new fields
   are absent from tasks.md entirely for this call site.

2. **`bulkConfirm`/`bulkResult` are missing from the two scroll/height-budget
   opts objects that are separate from the render-opts object task 4.3
   names — this is the exact bug class the codebase already shipped once for
   `markDoneConfirm` and left comments warning about.** Any state that
   lengthens `buildHeadTail`'s `tail` (which both `bulkConfirm`'s banner and
   `bulkResult`'s per-row list do, per Decision 4) must be threaded through
   *three* separate opts-construction sites, not the one task 4.3 names:
   - `lib/ui/screens/fleet/render.js`'s `mergeRenderOpts` (task 4.3 covers
     this one — "render.js's render()")
   - `lib/ui/controllers/fleet.js`'s `scrollToShow`'s `winOpts` object
     (`controllers/fleet.js:27-58`, used by every `move`/`jump` action to
     decide whether to scroll into view) — its own comment at line 36-40
     documents that omitting `forceStartConfirm`/`clearQueueConfirm` here was
     a real, separately-fixed bug ("fleet-metrics-grid final-fix 2"), and
     that `markDoneConfirm` was added there for the identical reason
     (line 41-44). Neither `bulkConfirm` nor `bulkResult` is named anywhere
     in design.md/tasks.md for this site.
   - `lib/ui/watch.js`'s own separate `heightOpts` object
     (`watch.js:670-678`, built at the top of `draw()` purely to re-clamp
     `S.scrollOffset`, independent of the render-opts object built later for
     the actual screen draw) — its own comment (line 661-669) explicitly
     names `markDoneConfirm` as a field that had to be added here to avoid
     "systematically OVER-estimate[ing] columnAreaHeight." Not named in
     design.md/tasks.md either.

   `bulkResult` in particular renders a variable-length, up to ~5-line
   per-ticket list (bounded by `MAX_FINISHED`/`QUICK_START_COUNT`-style caps
   on what's reachable via the cursor) — materially longer than any existing
   single-row confirm banner — so omitting this threading is *more* likely to
   produce a visible scroll-miscalculation than the historical bug this same
   omission already caused for `markDoneConfirm`. Extend task 4.3 (or add a
   new task) to explicitly name all three sites for both `bulkConfirm` and
   `bulkResult`, and add a task under section 9 (Tests) asserting the height
   budget accounts for an open bulk confirm / a rendered bulk result the same
   way an existing regression test presumably pins `markDoneConfirm`'s fix.

3. **`S.bulkResult`'s "clears on the next keypress (any key)" behavior has no
   analogous mechanism anywhere in this codebase, and neither design.md nor
   tasks.md says where it lives.** Every existing one-shot/gate piece of
   fleet state clears one of two ways: (a) a dedicated confirm gate
   (`markDoneConfirm`, `forceStartConfirm`, `clearQueueConfirm`, `quitConfirm`)
   that *exclusively* intercepts every key while open — `fleet/keys.js`'s
   `handleKey` returns early for these before any other key means anything
   (lines 139-164); or (b) a persistent notice (`addressFailureNotice`,
   `queueNotice`) cleared only by a specific follow-up action, never by "any
   key." Design.md Decision 4 explicitly says `bulkResult` is neither: "it is
   a one-shot result display, not a gate; nothing about it is `y`-confirmable
   itself" — meaning the key that dismisses it (e.g. `j`) must *also* still
   perform its ordinary action (move the cursor), not be swallowed the way
   `markDoneConfirm`'s gate swallows every key while open. `onKey` in
   `watch.js` (line 1166-1217) has no existing hook for "clear this piece of
   state on every keypress but let the key's normal handling still occur" —
   confirmed by reading the function in full. Tasks 5.5's "cleared on the
   very next keypress (any key)" needs a concrete mechanism named (e.g. "add
   `if (S.bulkResult) S.bulkResult = null;` at the top of `watch.js`'s
   `onKey`, before `router.handleKey` is called, so the triggering key still
   resolves normally") — as written, a competent implementer could
   reasonably (and wrongly) implement this as a third confirm-style
   intercept in `handleKey`, which would silently eat the next `j`/`a`/`1`
   press instead of letting it act.

### Non-blocking notes

- Proposal.md's "Impact" section and design.md/tasks.md both cite
  `lib/ui/render.js` for the render-opts threading; the actual file is
  `lib/ui/screens/fleet/render.js`. Worth a one-line fix before execution
  starts so the executor isn't searching for a nonexistent path.
- `workflow-state.md`'s `DESIGN_QUESTIONS` field currently reads `null` even
  though design.md's Context section says the two escalated decisions were
  "recorded in `workflow-state.md`'s `DESIGN_QUESTIONS`." If that's expected
  post-resolution bookkeeping (cleared once consumed), no action needed —
  flagging only in case it indicates the resolution didn't actually get
  persisted where design.md claims it did.
- Task 5.2/5.3's "apply the existing per-ticket logic" (for `address-failure`/
  `confirm-force-start`) currently lives inline inside each single-row
  `switch` case in `controllers/fleet.js` (no already-factored-out helper
  function exists to call). Not a design flaw — but tasks.md should be
  explicit about whether the bulk handlers are expected to factor that logic
  into a shared helper first (avoiding copy-paste of the tmux-spawn /
  `queue.forceStart` bookkeeping) or duplicate it inline; leaving this
  implicit invites the two paths (single-row vs. bulk) to drift apart over a
  future edit to one but not the other.
