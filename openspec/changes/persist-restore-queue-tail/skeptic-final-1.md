## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket ACs re-read** (`ticket.md`) and traced each to code, not narrative:
  - "Persist the pending tail" → `lib/ui/queue-cache.js` (new module, read fully)
    and the write/clear call site in `lib/ui/watch.js:401-406` (inside `draw()`,
    guarded by `queue.shouldTick`).
  - "Restore in a paused/unconfirmed state" → `lib/ui/queue.js`'s
    `createRestoredQueue()`/`reconcileRestored()` (read fully, lines 166-213) and
    `watch.js`'s startup block (lines 483-507) which calls them against a one-off
    `reduce()` pass before the poll loop starts, exactly as design.md Decision 5
    requires (no piggybacking on an implicit first snapshot).
  - "`inFlight` occupancy reconstructed, `maxConcurrent:1` cannot silently become
    concurrent" (the specific property the design-gate skeptic scrutinized across
    3 rounds) → `reconcileRestored()` seeds `inFlight` from the persisted record
    filtered through `isRunLive`, not left empty. I did **not** just trust the
    unit test for this — see the independent probe below.
  - "`confirmed` mandatory explicit field, `!== false` guard unambiguous" →
    `createQueue()` (queue.js:38-49) sets `confirmed: true` explicitly; `tick()`
    carries it forward explicitly (line 138); `createRestoredQueue()` sets
    `confirmed: false` explicitly (line 210). `shouldTick()` (line 162-164) is the
    single guard `watch.js`'s tick call site (line 380) and the fleet render
    (`fleet.js:181`) both key off.
  - "No ticket bodies persisted, `.concertino/` gitignored" → `queue-cache.js`'s
    `write()` only serializes ids/metadata (read the whole function, lines 88-115);
    confirmed `.gitignore:4` still covers `.concertino/` in full (`git status`
    shows no untracked files under it); `test/queue-cache.test.js` asserts the
    written record's key set directly.
  - "Existing quit-confirmation guard still covers a queue with anything
    pending/in-flight" → `watch.js`'s `quit()` (line 559-565) counts
    `queueState.pending.length + queueState.inFlight.size` regardless of
    `confirmed`, unchanged in shape from before this ticket.

- **Full diff read**: `lib/ui/queue.js`, `lib/ui/queue-cache.js` (new, in full),
  `lib/ui/watch.js` (in full), `lib/ui/screens/fleet.js` diff. Matches
  `design.md`'s decisions and `tasks.md`'s items exactly; no scope creep —
  `git diff main...HEAD --stat -- lib/ test/` touches exactly the 4 source files
  + 3 test files `files-modified.md` names, nothing else.

- **Full test suite, re-run myself** (not trusting the evaluator's pasted
  output): `npm test` → exit 0, all `node --test` suites green (including
  `test/queue.test.js`'s explicit `maxConcurrent:1 restored queue ... never
  lets confirm launch a second one` test and `test/fleet.test.js`'s resume-
  affordance/inFlight-only/pre-CON-29-shape tests) plus all 15 shell-script
  suites (`check-merge-readiness.sh`, `auditor-render.test.sh`, etc.), no
  failures anywhere in the output.

- **Independent real-tmux probe** (not the evaluator's e2e — a fresh one I
  wrote and ran myself against a scratch `.concertino` root and a real tmux
  session `con29-skeptic-probe`, using the actual `queue.js`/`queue-cache.js`/
  `reducer.js`/`store.js`/`session.js` modules, not mocks):
  1. Spawned a real tmux window `CON-31` (`sleep 600`, no events.jsonl — a
     window-only live run) and confirmed the real reducer reports it
     `status: running` / `isRunLive: true`.
  2. Wrote a real `queue.json` via `queue-cache.write` with
     `pending: ["CON-32"], inFlight: ["CON-31"], maxConcurrent: 1` and read the
     raw file back — confirmed the on-disk shape is exactly
     `{sessionId, writtenAt, maxConcurrent, launchCommand, pending, inFlight}`,
     no ticket titles.
  3. Replicated `watch.js`'s exact startup restore block against this real
     tmux/store state → `createRestoredQueue` returned
     `{ pending: ["CON-32"], inFlight: ["CON-31"], confirmed: false }`.
  4. Flipped `confirmed: true` (what `confirm-restored-queue` does) and called
     the real `queue.tick()` against the still-live `CON-31` window: **`toLaunch`
     was empty** — `CON-32` did not launch on top of the occupied slot under
     `maxConcurrent: 1`, the exact hazard the design gate spent 3 rounds on.
  5. Killed the real `CON-31` tmux window (simulating it finishing), re-ran
     `tick()`: the slot freed and `CON-32` launched (`toLaunch: ["CON-32"]`).
  All assertions passed (`ALL PROBE ASSERTIONS PASSED`); tmux session and
  scratch root cleaned up afterward.

- **fleet.js render/key-dispatch, exercised directly** (not just via existing
  tests): rendered a live `{pending:['CON-32'], inFlight:['CON-31'],
  maxConcurrent:1, confirmed:false}` queueState through `renderFleet()` —
  produced a clean `QUEUED (1, running 1 at a time)` box and the
  `▲ resumed from a previous session — press c to continue` line, no garbling.
  `handleKey('c', ...)` returns `{type:'confirm-restored-queue'}` only when
  `confirmed === false`, and `null` once confirmed — verified both branches
  live, not just by reading the test file.

- **No UI design-standard review applicable** — per this project's config, no
  UI standard is configured; skipped per instructions.

### Verdict: CONFIRM

The implementation matches the proposal/design/spec exactly, the specific
safety property the design-gate skeptic spent three rounds nailing down
(`inFlight` reconstruction preventing a `maxConcurrent:1` batch from becoming
concurrent across a restart) is genuinely implemented and I reproduced it
myself against real tmux state rather than trusting the unit tests or the
evaluator's narrative, the persisted file is minimal and gitignored as
required, the full test suite passes under a fresh run, and there is no scope
creep beyond the files the design named.

### Non-blocking notes

- The evaluator's own report (`evaluation-1.md`) describes a very similar
  interactive tmux end-to-end walkthrough (spawn/quit/restart/confirm/kill/
  auto-resume) with plausible, specific detail (exact `queue.json` contents,
  exact footer text) — I did not simply take that on faith; I reproduced the
  core hazard scenario independently via the probe above, which corroborates
  it.
- `reconcileRestored`'s defensive `Array.isArray` guards on a record's
  `pending`/`inFlight` are currently unreachable given `queue-cache.js`'s own
  upstream shape validation — harmless belt-and-braces, not a bug (evaluator
  flagged the same thing; I agree it's non-blocking).
