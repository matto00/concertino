## 1. Config schema and docs

- [x] 1.1 Add `dashboard.retentionDays` (`integer`, `minimum: 1`, `default: 30`) to `config/concertino.schema.json`'s `dashboard` block, following the existing style of `maxConcurrent`/`escalationTimeoutMinutes`.
- [x] 1.2 Document `dashboard.retentionDays` in `docs/dashboard.md`'s "Configuration" section (the default, what it bounds, and that a run without `run.end` is never pruned regardless of age) and add a short "Retention" subsection under "Where the data lives" describing `concertino prune` and the startup prune.

## 2. `lib/ui/store.js` — incremental `readAll`

- [x] 2.1 Add a `createEventsCache()` (or equivalent `new Map()` factory) and change `readAll(root, cache)` to accept an optional cache parameter; when omitted, behavior must remain equivalent to today (full read, no persistence across calls) so every existing single-argument call site keeps working unmodified.
- [x] 2.2 Implement the offset-based incremental read: track `{ offset, size, mtimeMs, events, malformed }` per ticket; unchanged size+mtime returns the same cached `events` array (no re-parse); grown files parse only newly appended, newline-complete lines and append to the cached accumulators; an unterminated trailing partial line is left unconsumed until it completes.
- [x] 2.3 Handle truncation/rewrite (file size shrinks, or mtime moves backward) by discarding the cache entry and reading fresh from offset 0 — must not throw.
- [x] 2.4 On every `readAll` call, evict cache entries for tickets no longer present in `listTickets(root)` so the cache doesn't grow unbounded across a long-lived dashboard process.
- [x] 2.5 Leave `readEvents(root, ticket)` (the two-argument, uncached primitive) unchanged — it stays the full-reparse function used by pruning's eligibility check and by tests wanting ground truth.
- [x] 2.6 Update `lib/ui/watch.js` to create one cache instance before the poll loop and pass it into every `store.readAll(root, cache)` call.

## 3. `lib/ui/retention.js` — prune operation

- [x] 3.1 Create `lib/ui/retention.js` exporting an eligibility predicate (terminal — has a `run.end` event via `store.readEvents` — and log file mtime older than the configured retention window) and `prune(root, opts)` where `opts` includes the resolved `retentionDays` and an optional `now`/`dryRun`.
- [x] 3.2 `prune` removes the entire `.concertino/runs/<TICKET>/` directory (not just `events.jsonl`) for each eligible ticket; returns a report of `{ removed: [...], keptActive: [...] }` (or equivalent) so callers can print/log what happened.
- [x] 3.3 `dryRun: true` computes and returns the same report without touching disk.
- [x] 3.4 A run with no `run.end` event is never included in `removed`, regardless of file age (this is the core safety property — write the test in 3.x/5.x before or alongside the implementation).

## 4. CLI + dashboard wiring

- [x] 4.1 Add `concertino prune [--dry-run] [--config=PATH] [--out=DIR]` to `bin/concertino`: loads config the same way `cmdWatch` does, resolves `dashboard.retentionDays` (default 30), calls `retention.prune`, and prints what was removed (or would be, under `--dry-run`).
- [x] 4.2 Add `prune` to the CLI help text alongside the other commands.
- [x] 4.3 In `lib/ui/watch.js`'s `watch()`, call `retention.prune(root, config)` once before the poll loop starts, wrapped in try/catch so a failure never blocks the dashboard from starting.

## 5. Tests

- [x] 5.1 `test/retention.test.js`: eligibility predicate — no `run.end` present is never eligible regardless of mtime age; `run.end` present and old mtime is eligible; `run.end` present but within the window is not eligible.
- [x] 5.2 `test/retention.test.js`: `prune()` removes the whole run directory for eligible tickets and leaves ineligible ones untouched on disk.
- [x] 5.3 `test/retention.test.js`: `dryRun: true` reports the same eligible set but performs no filesystem changes.
- [x] 5.4 `test/retention.test.js`: default retention (30 days) applies when `retentionDays` is not passed/configured.
- [x] 5.5 `test/store.test.js`: `readAll(root, cache)` returns the same `events` array reference on a second call when the file is unchanged (proves no re-parse).
- [x] 5.6 `test/store.test.js`: appending new complete lines between two `readAll(root, cache)` calls yields old events plus new ones, in order, with correct `malformed` accounting.
- [x] 5.7 `test/store.test.js`: a truncated/rewritten file between two `readAll(root, cache)` calls is handled without throwing and reflects the new content.
- [x] 5.8 `test/store.test.js`: a ticket removed from disk between two `readAll(root, cache)` calls is absent from the second call's result and its cache entry is evicted (no unbounded growth).
- [x] 5.9 `test/store.test.js`: `readAll(root)` called with no cache argument behaves exactly as it does today (full read, no cross-call persistence) — confirms existing call sites/tests are unaffected.

## 6. Validation

- [x] 6.1 `openspec validate --change event-log-retention-caching --strict` passes.
- [x] 6.2 `npm test` passes, including the new retention and store tests.
