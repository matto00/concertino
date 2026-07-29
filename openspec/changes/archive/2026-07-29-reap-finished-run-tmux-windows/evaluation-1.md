## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed explicitly: conservative reap predicate
  (`endStatus != null && window.alive === false`) implemented exactly as
  the ticket's "trap" section demands (`lib/ui/reap.js:20-23`); the
  never-reap-without-`run.end` guarantee is enforced by the same predicate
  and independently proven via a real `reducer.reduce()` call in
  `test/reap.test.js:47-63`; scrollback capture-before-kill implemented
  (`lib/ui/reap.js:33-51`) and tested for ordering (`test/reap.test.js:69-84`)
  and for capture/write-failure not blocking the kill
  (`test/reap.test.js:86-107`); `__concertino__`/smoke-session exclusion is
  structural (`session.listWindows()` already filters `PLACEHOLDER`, smoke
  sessions live in their own tmux session) and documented as such — verified
  directly in `lib/ui/session.js`.
- No AC silently reinterpreted. The ticket explicitly left the
  conservative-vs-aggressive decision open pending a Phase 4 trace;
  design.md Decision 3 performs that trace against `core/scripts/cleanup.sh`
  and `core/roles/orchestrator.md` and reaches "conservative-only," which is
  a faithful resolution of an open question, not a reinterpretation of a
  firm requirement.
- All `tasks.md` items marked `[x]` match what's implemented: 1.1/1.2
  (`session.captureFull`, `store.scrollbackPath`), 2.1/2.2 (`reap.js`), 3.1
  (wired into `watch.js`'s `draw()` right after `reduce()`), 4.1-4.5 (tests
  present and passing — see Phase 2), 5.1 (`docs/dashboard.md` "Window
  reaping" section, cross-referencing retention).
- No scope creep — `git diff main...HEAD --stat` touches exactly the files
  listed in `files-modified.md` plus the openspec change directory itself.
- No regressions: full `npm test` (559 `node --test` cases + all bash script
  suites) passes clean, including every previously existing test.
- No API/schema contracts affected (internal module additions only).
- Planning artifacts (proposal/design/tasks/spec) match the implemented
  behavior; `openspec validate reap-finished-run-tmux-windows --strict`
  passes.

### Phase 2: Code Review — PASS
Issues: none.

- Predicate correctness verified against `lib/ui/reducer.js` directly:
  `emptyRun()` defaults `endStatus: null, window: null` (reducer.js:44/46);
  `endStatus` is set only in the `run.end` case of `applyEvent`
  (reducer.js:78); `deriveStatus` (reducer.js:150-155) confirms the tier-1
  telemetry line the ticket calls out. `reap.js`'s `selectReapable` reads
  exactly these fields with no re-derivation — matches design Decision 1.
- DRY: reuses `store.runDir`/new `store.scrollbackPath` rather than
  duplicating path logic; reuses `session.kill`'s existing error-swallowing
  contract rather than re-implementing it; explicitly does not duplicate
  `retention.hasRunEnd`'s log re-read (Decision 1's rejected alternative is
  correctly rejected — `endStatus` is already on the poll's `runs` object).
- Readable: `lib/ui/reap.js` is small (57 lines), each function has a clear
  single responsibility, comments explain the *why* (tier-1 telemetry, why
  captureFull is a separate method) not just the *what*.
- Modular: `selectReapable` is pure and independently testable;
  `reapFinished` is the only impure half, taking `session`/`runs` as
  parameters rather than reaching for globals — matches the codebase's
  existing style (`retention.js` follows the same shape).
- Type safety: plain JS, consistent with the rest of the codebase; no
  untyped escape hatches beyond what's already idiomatic here (`catch (e)`
  with unused binding matches the existing convention in
  `cache.js`/`store.js`/`session.js`/`retention.js`).
- Security: `ticket` values reaching `reap.js` originate from
  `store.readAll()`/`session.listWindows()`, both of which already sanitize/
  validate ticket shape upstream (`session.js`'s `target()` throws on an
  unsafe ticket before ever shelling out); `scrollbackPath` uses the same
  `path.join(runDir(...))` pattern already used for `eventsPath`/
  `answerPath` — no new attack surface introduced.
- Error handling: capture failure and write failure are both caught and
  swallowed independently, with the kill always proceeding — matches the
  ticket's explicit requirement ("A failure to capture or write the
  scrollback SHALL NOT prevent the window from being closed") and is
  directly tested (`test/reap.test.js:86-107`).
- Tests are meaningful, not tautological: `test/reap.test.js`'s mandatory
  guarantee test runs the *real* `reducer.reduce()` (not a stub) so it would
  actually catch a regression if `deriveStatus`'s ordering ever changed;
  the real-tmux integration test (`test/reap.test.js:140-160`, skipped when
  tmux is absent) spawns a real dying window and asserts it's gone from
  `listWindows()` plus scrollback is on disk — this is an end-to-end proof,
  not just a mock-call assertion. `test/watch.test.js`'s wiring test proves
  call-order (after `reduce()`) by asserting the run object passed to the
  faked `reapFinished` has `endStatus`/`window` already populated, which
  only `reduce()` produces.
- No dead code: no leftover TODO/FIXME, no unused imports (checked
  `lib/ui/reap.js`, `session.js`, `store.js`, `watch.js` diffs).
- No over-engineering: single new module scoped exactly to the ticket's
  ask; no speculative config toggle added (matches design's explicit
  Non-Goal, itself a defensible anti-scope-creep call already reviewed by
  the skeptic at the design gate).
- Behavior-preserving elsewhere: purely additive — no existing function
  signature changed except `store.js`'s `module.exports` (additive), no
  existing test modified besides additive new `describe`/`test` blocks in
  `session.test.js`/`watch.test.js`.
- Verification re-run independently (not trusting executor's report): `node
  --test` → 559/559 pass; full `npm test` (includes all bash script test
  suites) → all green; `openspec validate --strict` → valid.

### Phase 3: UI Review — N/A
This is a backend/dashboard-logic change (tmux window lifecycle management)
with no browser-testable UI; per task instructions Phase 3 is skipped.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- (Carried from the design-gate skeptic report, still applicable at
  implementation time, non-blocking): a window a human kills manually via
  the drilldown's `kill-confirmed` action never emits `run.end` either, so
  it is never auto-reaped under this design and remains a stray until
  closed by hand again. This is correctly out of scope per the ticket's own
  invariant and is implicitly implied by the "never reaps without run.end"
  guarantee, but an explicit one-sentence callout in `docs/dashboard.md`'s
  new "Window reaping" section would save a future operator from expecting
  auto-reap to clear windows they killed themselves.
