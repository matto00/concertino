## Evaluation Report — Cycle 2

Reviewed against full current diff `git diff main...HEAD` at commit `1934ce6` (cycle-1's `357e7a6`
plus the new consumer fix). Cycle-1 findings re-verified as part of the full diff, not just the
delta.

### Phase 1: Spec Review — PASS
Issues: none.

Cycle-1 ACs (basename-collision fix, idempotency, FAIL-outside-any-git-worktree contract, the
two-deltas test) re-confirmed unchanged and still satisfied — see evaluation-1.md.

New in this cycle — the `ticket-text.js` consumer regression and its fix:

- **Regression is real and was correctly diagnosed.** `persistedPath()` previously hardcoded
  `evidence/ticket.md` (a flat path). Since `persist-evidence.sh` now preserves a source's
  worktree-relative path, and a real `ticket.md`'s `SOURCE_PATH` is always
  `WORKTREE_PATH/<change-dir>/ticket.md` (per `orchestrator.md` Phase 1 — never the worktree root),
  every future run's persisted `ticket.md` now lands nested and the old hardcoded lookup would
  silently miss it on every run, degrading straight to the launch pad cache. This is exactly the
  `drilldown-ticket-context` spec's "survives worktree removal" guarantee being violated, correctly
  identified as in-scope for this change (not a separate ticket) since it's a direct consequence of
  this change's own destination-naming rework.
- **Human-directed decision followed exactly.** The stated resolution was "update the consumer (not
  `persist-evidence.sh`)" — confirmed: `persist-evidence.sh` is byte-identical to its cycle-1 state
  (`git diff 357e7a6...1934ce6 -- core/scripts/persist-evidence.sh` is empty), and the fix lives
  entirely in `lib/ui/ticket-text.js`.
- **The search-based approach is sound, not just test-passing.** Read `persistedPath()`/`findFile()`
  in full (`lib/ui/ticket-text.js:37-72`). Independently verified the design rationale for search-
  over-reconstruction: `lib/ui/*` has no other call site reading `concertino.config.json`'s
  `specProvider.changeDir` (confirmed via grep across `lib/`), so hardcoding this project's
  `openspec/changes/...` shape would be a hidden single-project assumption in an otherwise
  provider-agnostic dashboard layer — reconstruction would trade one hardcoded-path bug for
  another, differently-shaped one. Search is the more honest fix given that constraint.
  - `findFile()` is safe against directory-loop risk from symlinks: `fs.Dirent.isDirectory()` (from
    `readdirSync(..., {withFileTypes:true})`) reflects the raw dirent type, not a followed stat, so
    a symlinked directory is not treated as `isDirectory()` and recursion cannot loop.
  - Error handling is per-recursion-level, not just top-level: the `try/catch` around
    `fs.readdirSync` sits inside `findFile()` itself, so it re-executes on every recursive call —
    an unreadable subdirectory at any depth returns `null` for that branch rather than throwing
    uncaught, consistent with `resolve()`'s "never throws" contract.
  - The "at most one `ticket.md` per run" invariant the search relies on is a real, load-bearing
    fact (only `orchestrator.md` Phase 1 persists a file by that name, once), not an unverified
    assumption — checked against `core/roles/orchestrator.md`.
- **No other consumer independently reconstructs a `persist-evidence.sh` destination path.**
  Independently re-grepped `lib/`/`bin/` for evidence-path construction beyond relaying a logged
  `ref=` value. `lib/ui/screens/drilldown.js`'s `open-evidence-doc` action carries
  `ref: ev.ref` straight from the event log (`drilldown.js:614`) — it never reconstructs a path.
  `lib/ui/screens/fleet.js`'s "evidence" mentions are all about `.concertino/runs/` log retention,
  unrelated to path construction. Confirms task 3.6.4's claim independently — `ticket-text.js` was
  the only affected call site.
- **Spec delta for `drilldown-ticket-context` accurately reflects final behavior.** The updated
  requirement text and its two relevant scenarios ("nested under a subdirectory... still found")
  match the implemented search exactly; no reinterpretation.
- Tasks (3.6.1–3.6.5) are all marked done and match the diff. `files-modified.md` updated to cover
  the new files. No scope creep: diff is exactly the cycle-1 files plus `lib/ui/ticket-text.js`,
  its test, and the new spec delta — all direct, necessary consequences of the regression this
  change itself introduced.

### Phase 2: Code Review — PASS
Issues: none.

Verification gates (fresh run, `WORKTREE_PATH`, `CLEAN_WORKTREE` not set at this speed):
- `npm test` → exit 0. `node --test`: 749 passed, 0 failed (748 from cycle 1 + 1 new). All 16 shell
  suites green, including `persist-evidence.sh` (32/32) and `emit-event.sh` (74/74) unchanged from
  cycle 1.
- Confirmed the new `test/ticket-text.test.js` case ("resolves a ticket.md persisted by the real
  persist-evidence.sh at its actual (nested) destination") ran and passed (17.8ms — consistent with
  a real subprocess invocation of `core/scripts/persist-evidence.sh`, not a stub).
- `diff core/scripts/persist-evidence.sh scripts/concertino/persist-evidence.sh` and the
  `emit-event.sh` equivalent both empty — synced copies still identical, no hand-edit drift.

Code-quality checklist (new file: `lib/ui/ticket-text.js`; new test: `test/ticket-text.test.js`):
- **DRY**: no duplicated traversal logic elsewhere; `findFile()` is a single well-scoped helper.
- **Readable**: `findFile`'s header comment states both *why* it searches (provider-agnostic) and
  *why it's safe* (at-most-one-candidate), not just what it does.
- **Modular**: change is contained to `persistedPath()`'s internals; `resolve()`'s call site only
  gained a null-check (`filePath != null`) before attempting the read — no wider refactor.
- **Type safety**: N/A (plain JS, consistent with the rest of the file); no new untyped escape
  hatches.
- **Security**: `findFile()` only descends under a path built from `root` +
  `.concertino/runs/<TICKET_ID>/evidence` (the same trusted root used elsewhere in this file) and a
  literal filename constant (`'ticket.md'`) — no user-controlled path component is introduced.
- **Error handling**: verified above — per-level try/catch, `resolve()`'s "never throws" contract
  preserved (`filePath` can be `null`, handled explicitly before the read attempt).
- **Tests meaningful**: the new test is a genuine regression test, not a tautology — it exercises
  the real `persist-evidence.sh` script end to end (subprocess, real git repo, real nested source
  path) and asserts the found path is NOT the old flat path, which is exactly the assertion that
  would fail against the pre-fix `persistedPath()`. The executor's claim of having verified this by
  stashing the fix is independently corroborated by re-reading the assertion itself: it's
  structurally incapable of passing against a hardcoded flat-path implementation, since it directly
  asserts `found !== <flat path>` before asserting content resolution.
- **No dead code**: no unused imports; `execFileSync` and `persistedPath` are both used in the new
  test.
- **No over-engineering**: search depth/fan-out is unbounded in code (no explicit cap), relying
  instead on the real-world invariant that an evidence directory only ever holds one run's own
  small set of planning/report artifacts — reasonable for this codebase's actual usage pattern and
  explicitly justified in comments, not left implicit. Not a defect, but noted below as a
  non-blocking hardening suggestion.
- **Behavior-preserving where expected**: the cache-fallback behavior, blank-title handling, and
  `resolve()`'s overall preference order (persisted-first, cache-second) are all unchanged — only
  path resolution semantics changed, matching the spec delta's exact framing.

### Phase 3: UI Review — N/A
No UI review configured for this project; change remains backend/script/lib-only. Dev-server steps
skipped per instructions.

### Overall: PASS

### Non-blocking Suggestions
- `findFile()` in `lib/ui/ticket-text.js` has no explicit recursion-depth or entry-count cap; it
  relies entirely on the real-world size of an evidence directory staying small. This is
  reasonable given the documented invariant, but a defensive cap (e.g. bail out past a few hundred
  entries or a shallow depth) would make the "bounded" claim in the comment mechanically true
  rather than just true-in-practice. Not required for this ticket's scope.
