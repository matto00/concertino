## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Detail:
- AC "documented retention policy, configurable bound under `dashboard`, sensible default" — met: `config/concertino.schema.json` adds `dashboard.retentionDays` (integer, minimum 1, default 30), documented in `docs/dashboard.md`'s Configuration section and a new "Retention" subsection.
- AC "old logs pruned by something the user runs or that runs on a natural boundary; must never prune an active run's log" — met: `lib/ui/retention.js#prune` + `concertino prune [--dry-run]` (bin/concertino) and a best-effort, try/catch-wrapped call in `lib/ui/watch.js#watch()` before the poll loop. Eligibility requires both a logged `run.end` event and mtime past the retention window; absent `run.end`, a log is never pruned regardless of age (verified in tests, see Phase 2).
- AC "`readAll` no longer re-parses unchanged logs on every poll — cache by mtime/size or offset" — met: `lib/ui/store.js#readAll(root, cache)` with `createEventsCache()`, offset-based incremental reads; `lib/ui/watch.js` holds one cache instance for the process lifetime and passes it into every poll's `readAll` call (`lib/ui/watch.js:368`).
- AC "a test covers that an active run's log is never pruned" — met: `test/retention.test.js` ("no run.end is never eligible, regardless of mtime age", "prune() ... leaves ineligible ones untouched").
- All `tasks.md` items are checked and each maps to an actually-implemented piece (verified against the diff, not just the checkbox).
- No scope creep: diff touches exactly `bin/concertino`, `config/concertino.schema.json`, `docs/dashboard.md`, `lib/ui/retention.js` (new), `lib/ui/store.js`, `lib/ui/watch.js`, `test/retention.test.js` (new), `test/store.test.js`, plus the openspec change-tracking files. Nothing outside ticket scope.
- No regression to existing behavior: `readAll(root)` with no cache argument is explicitly preserved (fresh array every call, no cross-call persistence — proven in `test/store.test.js`'s dedicated no-cache-argument test) and `readEvents` is untouched. Full `npm test` (all 25 new + all pre-existing tests) passes — see Phase 2.
- Proposal's "Modified Capabilities: none" claim holds — the diff does not touch `dashboard-render-loop` or `evidence-telemetry` behavior; `store.js#readAll`'s change is additive/optional-parameter, not observable to existing callers.
- Planning artifacts (proposal/design/tasks/spec) match the final implementation; no artifact drift found.

### Phase 2: Code Review — PASS
Issues: none blocking.

Checks performed:
- **Correctness of incremental read** (`lib/ui/store.js` `readIncremental`): offset only advances past the last complete `\n`, so a writer's in-flight partial line is safely left unconsumed until it completes on a later poll; byte-offset arithmetic uses `Buffer.byteLength` on the consumed slice (not JS string length), so UTF-8 multi-byte characters near a read boundary can't corrupt the offset — verified by tracing through the split/consume logic. Truncation/rewrite (`stat.size < entry.size || stat.mtimeMs < entry.mtimeMs`) discards the cache entry and re-reads from 0, `test/store.test.js` confirms this doesn't throw.
- **Cache eviction**: `readAll` deletes any cache entry whose ticket is no longer in `listTickets(root)` on every call (`store.js:~185`), bounding cache size to current on-disk tickets — matches spec scenario "A pruned ticket's cache entry is evicted" and is covered by test.
- **Safety property (core AC)**: `retention.js#hasRunEnd` uses `store.readEvents` (uncached, full reparse) rather than `deriveStatus`/tmux liveness — deliberately decoupled per design.md Decision 1, avoiding a race where a merely-sampled-dead tmux window could cause data loss. `isEligible` requires both conditions; absent `run.end`, always `false` regardless of `now`/mtime. This is the load-bearing safety guarantee and it is enforced structurally, not just by test.
- **DRY**: `bin/concertino`'s `cmdPrune` duplicates `cmdWatch`'s five-line cfgPath-resolve-and-JSON.parse block, but this exact duplication pattern is already used at every other `cmdX` site in `bin/concertino` (cmdSync, cmdDoctor, cmdMigrate, cmdValidate, cmdUpdate, etc., all greppable at their own `cfgPath` line) — the executor followed the file's established convention rather than introducing a new one. Not flagged as a violation given precedent; noted below as a non-blocking suggestion.
- **Readable / no magic values**: `DAY_MS`, `DEFAULT_RETENTION_DAYS` are named constants; retention config resolution (`resolveRetentionDays`) is documented and handles both the flat `{ retentionDays }` shape (CLI) and the full config-object shape (`{ dashboard: { retentionDays } }`, as `watch()` passes it) without either caller duplicating default logic.
- **Modular**: new logic isolated in `lib/ui/retention.js`; `store.js` changes are additive (new optional param + new exported factory), no existing exports changed shape.
- **Type safety**: plain JS per existing project convention (no TS elsewhere in this codebase); inputs are validated (`typeof o.retentionDays === 'number'`, `Number.isInteger` check in `bin/concertino`'s `cmdPrune`).
- **Security**: `prune` only operates within `.concertino/runs/<TICKET>/` derived from `store.runDir`, no path traversal surface introduced (ticket names come from `listTickets`'s `readdirSync`, not user input).
- **Error handling**: `watch()`'s startup prune call is wrapped in try/catch per design (never blocks dashboard startup); `readIncremental`'s `fs.statSync`/`fs.openSync` failures are caught and degrade to an empty/evicted result rather than throwing; `cmdPrune`'s config JSON parse failure is caught and falls back to defaults, consistent with `cmdWatch`'s existing pattern.
- **Tests meaningful**: `test/retention.test.js` (7 tests) and additions to `test/store.test.js` (6 new tests) directly exercise every scenario in `specs/event-log-retention/spec.md` — reference-equality check for "no re-parse," incremental append ordering + malformed accounting, truncation recovery, cache eviction, no-cache-argument backward compatibility, dry-run no-disk-write, and the core "no run.end → never eligible regardless of age" property. These are not superficial — e.g. the reference-equality assertion (`assert.strictEqual`) is the only way to actually prove no re-parse occurred, and the tests would catch a real regression in any of these properties.
- **No dead code**: no unused imports, no leftover TODO/FIXME introduced by this change (pre-existing template-placeholder TODOs elsewhere in `bin/concertino` are unrelated).
- **No over-engineering**: pruning stays a "blunt age cutoff" as the ticket's own Notes section asked for; no premature abstraction (no generic cache framework, no pluggable eligibility strategy) beyond what's needed.
- **Behavior-preserving where expected**: `readEvents` (the existing full-reparse primitive) is untouched byte-for-byte; `readAll(root)`'s single-argument call path is explicitly preserved and tested.

Gates independently re-run (not trusting executor's report):
- `npm test` → full suite passes, 0 failures (includes `node --test` covering `test/retention.test.js` and `test/store.test.js`, plus all `test/scripts/*.sh` suites).
- `node --test test/retention.test.js test/store.test.js` → 25/25 pass in isolation.
- `openspec validate event-log-retention-caching --strict` → "Change 'event-log-retention-caching' is valid" (note: `tasks.md`'s `--change` flag name doesn't match the installed CLI's actual `--changes`/positional-arg syntax; the underlying validation itself passes regardless, so this is a tasks.md wording nit, not a functional gap).
- Manual smoke test of `concertino prune --dry-run` and `concertino prune` against a scratch `.concertino/runs/` directory with one old-terminal and one active-but-old run: dry-run reported the terminal run and left both directories on disk; the real run removed only the terminal one and left the active one untouched — matches the spec's core safety scenario end-to-end.

### Phase 3: UI Review — N/A
No UI review configured for this project; change is CLI/library-only (no `ui`-triggering files touched).

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `bin/concertino`'s `cmdPrune` help text line-wraps `--dry-run reports what would be removed without\n      touching disk.` awkwardly (breaks mid-clause rather than at a natural boundary) — purely cosmetic, no functional impact.
- Consider factoring the repeated `cfgPath`-resolve-and-parse block (now duplicated across ~8 `cmdX` functions including the new `cmdPrune`) into a shared helper at some point — pre-existing pattern, not introduced by this change, so not a blocker here.
- `retention.js`'s `prune()` return shape names the non-removed bucket `keptActive`, but it also includes terminal-but-within-window runs (not just genuinely active ones) — matches the task/design wording ("or equivalent") and the CLI's own printed label already clarifies this ("kept (still active, or within the window)"), so this is a naming nit only.
