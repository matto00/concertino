## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket/proposal/design/tasks/spec deltas** read in full (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/launchpad-detail-pane/spec.md`, `specs/ticket-priority/spec.md`). Also read `skeptic-design-1/2/3.md` and `workflow-state.md` — the design gate went through 3 skeptic rounds (fixed: `P` reducer wiring, correct test mechanism for private `applyAction`, three smoke-test cache fixtures needing `schemaVersion`) before an escalation-approved proceed. Verified in the diff (not just trusted) that all three of those fixes actually landed:
  - `git diff main...HEAD -- test/scripts/watch-smoke.test.sh` shows `LP2_WORK`, `Q_WORK`, `H_WORK` fixtures each gained `"schemaVersion":2`, and the new `LP3_WORK` fixture (task 4.8's end-to-end `P`-key case) was written with `"schemaVersion":2` from the start.
  - `lib/ui/watch.js` diff shows `openLaunchPad()` seeds `ticketSort: 'identifier'` and `applyAction` gains `case 'toggle-ticket-sort':` as a sibling of `case 'set-mode':`.

- **`git diff main...HEAD --stat`** — 6 `lib/` files touched (`cache.js`, `linear.js`, `screens/launchpad.js`, `screens/ticketview.js`, `ticketDetail.js` new, `watch.js`), matching `proposal.md`'s Impact section exactly. No scope creep.

- **Full diffs read** for `lib/ui/linear.js`, `lib/ui/cache.js`, `lib/ui/screens/launchpad.js`, `lib/ui/screens/ticketview.js`, `lib/ui/ticketDetail.js` (full file), `lib/ui/watch.js`, `test/scripts/watch-smoke.test.sh`, `test/launchpad.test.js`, `test/cache.test.js`, `test/linear.test.js`.

- **AC tracing** (against `ticket.md` + spec deltas):
  1. Priority fetched — `linear.js:63` adds `priority` to `QUERY`; `linear.js:207` normaliser uses `typeof node.priority === 'number' ? node.priority : null` (no `||`, `0` preserved). Confirmed by `test/linear.test.js`'s `priority 0 (None) round-trips as 0, not null` and the "missing/non-numeric normalises to null" cases.
  2. Cache-migration hazard — `cache.js` adds `CACHE_SCHEMA_VERSION = 2`; `write()` stamps it; `read()` returns `empty()` on missing/mismatched version, checked before any other field. `test/cache.test.js` covers missing/older/current schemaVersion and a write/read priority round-trip.
  3. Priority column rendering — `ticketRow` in `launchpad.js` re-derives `TICKET_ROW_FIXED = 8 + 1 + PRIORITY_WIDTH`, renders a distinct label per value and `f.dim('?')` for unknown (never blended with None). Confirmed with a live manual render (see below) and `test/launchpad.test.js`.
  4. Priority sort — `P` key → `{type:'toggle-ticket-sort'}` → `watch.js`'s new `case` → `launchPad.ticketSort` → `ticketsForEpic`'s `sortByPriority`, ranked Urgent<High<Med<Low<None<unknown (not raw integer). Confirmed end-to-end by the new `watch-smoke.test.sh` case (`LP3_WORK`), which I re-ran myself.
  5. Inline detail pane — third full-width pane below the `hsplit`, using shared `lib/ui/ticketDetail.js` (`buildDetailLines`), degrades to omitted (not squeezed) below `layout.MIN_BOX_HEIGHT`, renders full content height when `opts.rows` is unbounded. Confirmed by unit tests and my own manual render (below).
  6. Empty description / `commentsTruncated` — both explicitly handled in `ticketDetail.js`'s `buildDetailLines` (`(no description)`, `showing N of M — see <url> for the rest`), used by both `ticketview.js` and the inline pane. `ticketview.js`'s own diff shows a byte-faithful extraction (identical logic moved, not rewritten) and its own test file (`test/ticketview.test.js`) is unmodified and still passes.
  7. Row-width re-derivation — `TICKET_ROW_FIXED` comment and code correctly account for the new column; `test/launchpad.test.js`'s "status column is not truncated" test asserts `In Progress` survives whole.

- **Re-ran gates myself, fresh, in the worktree** (not trusting the evaluator's pasted output):
  - `node --test` → 527/527 pass.
  - `bash test/scripts/watch-smoke.test.sh` → 54/54 pass, including `P actually reorders the tickets pane — Urgent (CON-42) renders ahead of None (CON-41) after the real keypress`.
  - `npm test` (full suite, all shell + node suites) → exit 0, no failures anywhere (checked `grep -i "not ok\|fail"` output for stray failures — none besides the expected `0 failed`/`ℹ fail 0` summary lines and test names containing the word "failed" as part of their own description).

- **Manual visual verification** (this project has no browser UI — terminal dashboard only, matching the evaluator's "UI review N/A" call; I did not skip visual judgment, I applied it to the actual terminal render): seeded a fresh cache with 3 tickets under one epic (priority `0`, `1`, and unset), launched `node bin/concertino watch` in a real tmux session, pressed `N` to open the launch pad, and captured the raw ANSI output. Confirmed:
  - Tickets pane renders `None CON-41`, `Urg  CON-42`, `?    CON-43` as three visually distinct, correctly fixed-width, aligned labels — unknown (`?`, dimmed) is clearly distinct from `None`.
  - The inline detail pane renders below the `hsplit`, boxed, showing `CON-41  none-priority-ticket`, `DESCRIPTION` (wrapped correctly to the pane width), `COMMENTS  (1)` with the seeded comment's author/timestamp/body.
  - No truncation artifacts, no blank/garbled regions, no `\x1b[2J` full-screen clears in the captured session (matches the project's own render-loop invariant, exercised elsewhere in the suite).

- **Reducer-wiring correctness independently checked**: `grep -n 'ticketsForEpic' lib/ui/watch.js` (implicit in reading the diff/design) — the design's Decision 3 claim that every launch-pad caller resolves through the same `ticketsForEpic` (so the rendered order and `lp.ticketIndex`'s resolved ticket never disagree) is structurally true from the diff: `ticketsForEpic` now applies `lp.ticketSort` once, and `currentTicket` (the new detail-pane lookup) calls `ticketsForEpic` too — no second, independently-filtered/sorted ticket list was introduced.

### Verdict: CONFIRM

### Non-blocking notes
- `ticketDetail.js` exports `commentBlock`/`fmtDate` that are used only internally by `buildDetailLines` (not consumed by any external caller today) — harmless, matches the module's stated "one implementation, both screens" design, not a defect.
- The design-gate history (3 REFUTE rounds before proceeding) is exactly the kind of iteration the process is meant to produce; all three change requests from round 3 are verifiably present in the final diff, not just in the planning docs.
