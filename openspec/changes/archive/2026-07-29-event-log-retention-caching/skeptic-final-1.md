## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket ACs traced to code, not just claims:**
  - "Documented retention policy, configurable bound under `dashboard`, sensible default" — `config/concertino.schema.json` diff adds `dashboard.retentionDays` (`integer`, `minimum: 1`, `default: 30`); `docs/dashboard.md` diff documents it in "Configuration" and adds a "Retention" subsection. Read both diffs directly (`git diff main...HEAD -- config/concertino.schema.json docs/dashboard.md`).
  - "Old logs pruned by something the user runs or that runs on a natural boundary; must never remove an active run's log" — `lib/ui/retention.js` (`prune`, `isEligible`, `hasRunEnd`) read in full. Eligibility requires `hasRunEnd` (via `store.readEvents`, the uncached full-reparse primitive) **and** mtime past the window; absent `run.end`, `isEligible` returns `false` unconditionally — this is a structural guarantee, not a tunable cutoff.
  - "`readAll` no longer re-parses unchanged logs" — `lib/ui/store.js`'s `readIncremental`/`readAll(root, cache)` read in full. Confirmed offsets always advance only past the last complete `\n` (never mid-line), and since a `\n` is a single ASCII byte, the read window `[offset, size)` can never begin mid-UTF-8-character — ruling out the one correctness bug this kind of code usually has.
  - "A test covers that an active run's log is never pruned" — `test/retention.test.js`'s `'isEligible: no run.end is never eligible, regardless of mtime age'` and the `prune()` test asserting `HEL-11` (no `run.end`, mtime 9999 days old) is kept.

- **Ran the gates myself, not trusting the evaluator's report:**
  - `npm test` (fresh run, full output captured to a scratch log): `node --test` → `tests 447, pass 447, fail 0`, followed by all 11 shell test suites, all passing (`35 passed, 0 failed` on `bin/concertino (core resolution)`, `14 passed, 0 failed` on `harness identity`, etc.). Exit code 0.
  - `npx openspec validate event-log-retention-caching --strict` → `Change 'event-log-retention-caching' is valid`.
  - Manual end-to-end smoke test in a scratch `.concertino/runs/` directory with two 60-day-old run logs, one with `run.end status=delivered` (CON-99) and one without (CON-100): `node bin/concertino prune --dry-run` reported only CON-99 as removable and left both directories on disk; `node bin/concertino prune` (real run) removed only CON-99's directory, left CON-100 untouched. This is the exact safety property the ticket asks for, verified against real files, not just the test suite.

- **Design/proposal/tasks/diff consistency:** `proposal.md`'s "What Changes" and "Impact" sections match the actual diff file-for-file (`bin/concertino`, `config/concertino.schema.json`, `docs/dashboard.md`, `lib/ui/retention.js` new, `lib/ui/store.js`, `lib/ui/watch.js`, `test/retention.test.js` new, `test/store.test.js`). No scope drift — `git diff main...HEAD --stat` shows nothing outside these files plus the openspec change-tracking artifacts.
  - `design.md`'s claim that `run.end` is emitted "by `cleanup.sh` on success, or `assert-phase.sh`/orchestrator on a recorded failure" — checked against `scripts/concertino/cleanup.sh:55` (emits `run.end status=delivered`) and `core/roles/orchestrator.md:84` (documents `run.end ... status=escalated` on circuit-breaker escalation). Close enough to accurate to not be misleading; `assert-phase.sh` itself doesn't emit it but the orchestrator role does on the actual terminal-failure path, which is the substance of the claim.
  - No pre-existing call site of `store.readAll(root)` (single-argument) was missed — grepped all call sites; only `watch.js:371` was updated to pass the cache, matching the design's stated backward-compatibility guarantee, and it's covered by a dedicated no-cache-argument regression test.

- **No UI review applicable** — this is a CLI/library-only change (`bin/concertino`, `lib/ui/retention.js`, `lib/ui/store.js`, `lib/ui/watch.js`); no `ui`-triggering files touched, matching the evaluator's Phase 3 N/A and this repo's "no UI configured" instruction.

### Verdict: CONFIRM

### Non-blocking notes
- `bin/concertino`'s `cmdPrune` help text still line-wraps awkwardly mid-clause (`--dry-run reports what would be removed without\n      touching disk.`) — cosmetic only, already flagged by the evaluator.
- `bin/concertino`'s `cmdPrune` defines its own local `DEFAULT_RETENTION_DAYS = 30` rather than importing `retention.DEFAULT_RETENTION_DAYS`, and separately duplicates a chunk of `retention.js#resolveRetentionDays`'s logic (`Number.isInteger(config.dashboard.retentionDays) ? ... : DEFAULT_RETENTION_DAYS`) before calling `prune`, which already has its own resolution fallback. Harmless today (both constants are `30` and would drift silently if one were ever changed without the other), but a tidier version would just pass `{ retentionDays: config.dashboard && config.dashboard.retentionDays, dryRun }` and let `resolveRetentionDays` do the one authoritative resolution.
