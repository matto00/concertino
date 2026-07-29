## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- Ticket's core requirement (persist pending tail, restore paused/unconfirmed, reconcile against `isRunLive`, staleness bound, no ticket bodies persisted) is implemented exactly as scoped.
- All tasks.md items (1.1–6.2) are marked done and match the diff: `lib/ui/queue-cache.js` (new), `lib/ui/queue.js` (`shouldTick`/`reconcileRestored`/`createRestoredQueue`/`confirmed` field), `lib/ui/watch.js` (one-off startup `reduce()`, write/clear at the tick call site, `confirm-restored-queue` action), `lib/ui/screens/fleet.js` (resume affordance + key dispatch).
- No AC reinterpreted: restore is unconfirmed by default (`confirmed: false`), `inFlight` reconstruction is implemented per Decision 5a (verified live end-to-end, see Phase 3), staleness defaults to 24h, empty-after-reconciliation restores nothing (`createRestoredQueue` returns `null`), persisted record shape is ids+metadata only (verified by both a unit test and my own manual round-trip below).
- No scope creep: all four touched source files (`queue-cache.js`, `queue.js`, `watch.js`, `fleet.js`) are exactly the files design.md's Impact section named. Test files added mirror the same scope.
- No regressions: full test suite (`npm test`, includes `node --test` + all shell-script suites) passes at 546/546 JS tests plus every shell suite; existing QUEUED row-index/trimming tests (CON-28) are unmodified and still pass; the fleet-queue-visibility spec file's pre-existing scenarios are untouched, only new requirements appended.
- API/schema: the new on-disk `queue.json` shape is documented in design.md Decision 2 and matches the implementation exactly (field names, types, `inFlight` degrade behavior).
- Planning artifacts (proposal/design/tasks/spec delta) match the final implementation; no drift found between design.md's decisions and the code.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **DRY**: `reconcileRestored`/`createRestoredQueue` reuse `isRunLive` (no second live-check invented); `queue-cache.js` mirrors `cache.js`'s temp-file+rename pattern exactly rather than duplicating logic awkwardly or forcing a shared module (matches design.md Decision 1's explicit rationale for a sibling module, not a fold-in).
- **Readable**: naming is consistent and self-documenting (`shouldTick`, `reconcileRestored`, `createRestoredQueue`, `queueSessionId`); no magic values — `DEFAULT_STALE_MS` is a named constant, staleness comparison boundary-tested (`isStale` at exactly the bound is not-stale, one ms past is stale).
- **Modular**: `queue-cache.js` has zero knowledge of `queue.js`'s in-memory shape beyond the fields it reads; `queue.js` has zero filesystem knowledge (per its own updated header comment) — matches design.md's stated separation of concerns.
- **Type safety**: JS, no TS in this codebase; `queue-cache.js`'s `read()` does full shape validation before trusting a record (pending is string[], maxConcurrent is number, writtenAt is number), degrading to `null` otherwise — appropriate defensive input validation for a boundary that reads untrusted on-disk JSON.
- **Security**: the persisted-record-shape test (`test/queue-cache.test.js`, "a written record contains only ticket ids and queue metadata") asserts the object's own `Object.keys()` never exceeds the documented 6 fields, which is a real (not just believed) guarantee against a future caller accidentally attaching richer ticket data to the queue object before it reaches `write()`. I re-verified this live (see Phase 3) — the persisted `queue.json` from a real run contained exactly `sessionId, writtenAt, maxConcurrent, launchCommand, pending, inFlight`, no titles/descriptions.
- **Error handling**: `queue-cache.js`'s `read()` never throws (missing file, malformed JSON, wrong shape, non-object, array — all six cases unit-tested); `write()`'s rename failure path cleans up the temp file before rethrowing, matching `cache.js`'s existing precedent exactly.
- **Tests meaningful**: reconciliation tests cover both directions (pending dropped when live / survives when not live), the `maxConcurrent: 1` double-launch hazard is explicitly tested and would catch a real regression (`reconcileRestored`/`createRestoredQueue` tests in `test/queue.test.js`), and the fleet-render tests distinguish confirmed/unconfirmed/pre-CON-29-shaped queue objects.
- **No dead code**: no leftover TODO/FIXME; all new exports are used by watch.js or fleet.js; nothing orphaned.
- **No over-engineering**: `sessionId` is explicitly not used for locking (per design.md Decision 4) and the code doesn't invent unused locking machinery; the one-off startup `reduce()` pass is scoped narrowly to the restore reconciliation and is not cached/reused elsewhere, exactly as design.md specifies.
- **Behavior-preserving**: `tick()`'s core admission logic is unchanged; the only structural addition is `confirmed`/`restoredFrom` carried on the returned queue object, which is additive, not a behavior change to existing callers.
- One minor observation (non-blocking): `lib/ui/queue.js`'s `reconcileRestored` silently treats a non-array `record.inFlight`/`record.pending` as `[]` — this can't happen in practice since `queue-cache.js`'s `read()` already guarantees array shape before handing a record to `reconcileRestored`, but the redundant guard is cheap defense-in-depth, not a bug.

### Phase 3: UI Review — N/A (per orchestrator config), but manually re-verified the end-to-end scenario as fresh evidence
This project has no UI review configured, and the task specifies skipping the dev-server steps. However, per the resumability/fresh-evidence guardrail and since tasks.md 6.2 calls for exactly this scenario, I independently drove a real `concertino watch` process against a real tmux session (not trusting the executor's own claim of manual verification):

1. Seeded a 2-ticket batch (`CON-31`, `CON-32`, `maxConcurrent: 1`, `launchCommand: sleep 300`), launched it via the real launch-pad keystrokes (`N`, tab, select both, sequential, launch, confirm). Verified `CON-31` spawned a real tmux window and `.concertino/cache/queue.json` was written with `pending: ["CON-32"], inFlight: ["CON-31"], maxConcurrent: 1` — exactly the persisted shape design.md specifies, and containing no ticket titles/descriptions.
2. Quit (piped EOF, functionally identical to a crash for what's left on disk) and restarted the dashboard against the same `--out` dir. Confirmed the fleet view rendered `QUEUED (1, running 1 at a time)` / `1. CON-32 batch-two` / `resumed from a previous session — press c to continue` — the paused/unconfirmed affordance, before any confirmation.
3. Kept a live process running (via a FIFO stdin so it doesn't hit EOF/quit), pressed `c` to confirm. Verified the "resumed" banner disappeared and `CON-32` was **not** launched while `CON-31` still occupied the queue's one concurrency slot (the `maxConcurrent: 1` double-launch hazard design.md Decision 5a exists to prevent).
4. Killed the `CON-31` tmux window (simulating it finishing) and, without restarting the process, observed the next poll automatically spawn a real `CON-32` tmux window and update `queue.json` to `pending: [], inFlight: ["CON-32"]` — ticking resumed normally post-confirmation, exactly as the ticket's core safety property requires.

All four steps behaved exactly per spec/design with no console errors, no hangs, no unhandled exceptions. Cleaned up all tmux sessions, background processes, and temp directories created during this verification (confirmed via `ps`/`tmux ls` afterward — no leftovers).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `reconcileRestored`'s defensive `Array.isArray` guards on `record.pending`/`record.inFlight` are currently unreachable given `queue-cache.js`'s own shape validation upstream — fine to leave as belt-and-braces, but could be noted as intentionally redundant if a future reader wonders why the check exists.
