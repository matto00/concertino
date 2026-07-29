## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none

- AC1 ("Idle time comes from tmux's window activity on every poll, not only the first") — met: `sampleWindows()` calls `idleMsFromActivity(w.activity, now)` unconditionally for every alive window on every poll (lib/ui/watch.js:322-323); no seed-once/refine-later path remains.
- AC2 ("hash and idle Map removed if no longer earning their place, along with the per-window capture call") — met: `hash()`, the `idle` Map, `IDLE_SAMPLE_MS`, `lastSample`, `takeSample`, and the per-window `session.capture(w.ticket)` call are all deleted. Grep for `IDLE_SAMPLE_MS|lastSample|idle.get|idle.set|hash(|takeSample` in lib/ui/watch.js returns nothing.
- AC3 ("idle continues to survive a dashboard restart") — met, and now for a stronger reason: `idleMsFromActivity` is stateless and reads `w.activity` (tmux's own `#{window_activity}`) fresh every call, so a restarted process reads the same value a prior process would. Verified `session.listWindows()` (lib/ui/session.js:63-85) parses `#{window_activity}` as epoch seconds, nullable — consistent with `idleMsFromActivity`'s `activity != null` contract.
- AC4 ("verify against a window that redraws identical content") — the design.md Context section documents the empirical check the ticket asked for (a tmux window overwriting the pane with byte-identical output every second still advances `#{window_activity}`); the executor didn't need to re-run this since it's a design-time finding already validated by the skeptic-design gate, and the resulting code structurally guarantees the scenario (no content input exists to the pure helper) — also directly exercised by `test/watch.test.js`'s "tracks activity, never pane content" test.
- No AC silently reinterpreted.
- All tasks.md items (1.1–1.8, 2.1–2.5, 3.1–3.2) map 1:1 to diff content; re-verified 3.1 (test suite run, see Phase 2) and 3.2 (grep) independently — both confirmed.
- No scope creep: diff touches exactly `lib/ui/watch.js` and `test/watch.test.js` (plus openspec planning artifacts) — `git diff main...HEAD --stat -- lib/ test/ bin/` shows only those two files.
- No regressions: `sampleWindows()`'s return shape (`{ ticket, alive, idleMs }`) is unchanged; `session.capture()` itself is untouched and has no other call sites removed (grep confirms the module's only production `.capture(` reference was the one deleted from the poll loop).
- No API/schema changes beyond the planned `idleMsFromActivity` export, which proposal.md/design.md already account for and correct the "no API surface change" claim for.
- Planning artifacts reflect the final implementation faithfully — proposal, design, and spec all match the diff with no drift.

### Phase 2: Code Review — PASS
Issues: none

- No canonical code-quality standard is configured for this repo beyond the file's own established conventions, which the change follows (matches the existing `buildFrame`/`attachAndRestore` "exported purely for tests" pattern, per design.md Decision 3 and tasks.md 1.1-1.2).
- DRY: no duplication introduced; the extracted `idleMsFromActivity` is the single source of idle-time arithmetic, called from the one call site.
- Readable: clear naming (`idleMsFromActivity`), no magic values, thorough header comments explaining the pty-write-vs-visual-diff distinction and the restart-survival property.
- Modular: pure function extracted cleanly from the stateful `sampleWindows()` closure; `sampleWindows()` itself stays private as design.md specifies.
- Type safety: plain JS, consistent with the rest of the file; `activity != null` null-check matches `session.listWindows()`'s documented nullable contract.
- Security: n/a — no new input/trust boundary introduced (activity is a locally-sourced tmux timestamp).
- Error handling: n/a — no new failure modes; the null-activity fallback (`0`) preserves prior seed-path behavior for the same edge case.
- Tests meaningful: 4 new unit tests directly exercise `idleMsFromActivity` — activity advancing between calls, structural proof content can't affect the result, restart-survival (fresh call with no prior state), and the null-activity fallback. These would catch a real regression (e.g. reverting to seed-once behavior, or reintroducing a hash dependency) since they call the exported pure function directly. Ran `node --test test/watch.test.js` directly: 15/15 pass, including all 4 new tests.
- No dead code: grep for the removed identifiers (`IDLE_SAMPLE_MS`, `lastSample`, `idle.get`, `idle.set`, `hash(`, `takeSample`) in lib/ui/watch.js returns nothing — full removal confirmed, no leftover TODO/FIXME introduced.
- No over-engineering: the extraction is minimal (one small pure function), matching an established precedent in the same file rather than inventing new abstraction.
- Behavior-preserving where expected, intentionally different where the ticket asks for it: the null-activity fallback and return shape are preserved; the idle-computation semantics are intentionally changed per the ticket, not a stray behavior change.
- Full test suite (`npm test`) re-run independently: exit code 0, all suites pass (spot-checked apparent "FAIL"/"not ok" grep hits — all are substrings inside passing test *names*, e.g. "FAIL printed to stderr", not actual failures).

### Phase 3: UI Review — N/A
This is a headless poll-loop logic change in `lib/ui/watch.js` with no visual/UI surface — the change is entirely to idle-time computation feeding an existing, unchanged terminal frame render. No dev server / browser UI applies (project has no UI review configured per task instructions), so Phase 3 is skipped per the task's own guidance.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- None of substance. Optionally, a line in `test/scripts/watch-smoke.test.sh` (or equivalent) exercising the end-to-end idle behavior against a real tmux session would add belt-and-suspenders coverage beyond the pure-function unit tests, but this is not required by the ticket or spec and the existing unit tests already fully cover the acceptance criteria.
