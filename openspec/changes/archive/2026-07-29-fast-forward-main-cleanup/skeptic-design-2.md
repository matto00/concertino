## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/main-fast-forward/spec.md`, `specs/cross-screen-escalation/spec.md`), and round 1's
  report (`skeptic-design-1.md`) in full, fresh, as claims to re-verify rather than trust.
- Re-traced every AC in `ticket.md` against the current design/tasks — all seven still map to a
  concrete decision/task (silent fast-forward; escalate on dirty/diverged and change nothing;
  never touch dirty/diverged; cross-screen banner + reply + auto-clear; post-ff re-render or
  clear note; `doctor` behind-remote check; multi-worktree safety via refs-only operation).

**Round-1 change request 1 (banner dispatch reusing `escalation.js`'s verbs was false) — re-verified as fixed:**
- Re-read `lib/ui/watch.js` in full (888 lines) — `applyAction`'s existing `case` blocks
  (`open-reply`/`cancel-reply`/`reply-backspace`/`reply-type`, lines 582-597) still hardcode
  `escalationReply`, and `submit-reply`/`answer` (599-605) still route through `answerEscalation()`
  (505-517), whose success path still calls `backToFleet()` unconditionally — confirming the
  original bug is real and would still exist if the banner reused these verbs.
- The revised Decision 6 / tasks 6.1-6.6 now specify a **separately-namespaced** action set
  (`banner-reply-type`, `banner-reply-backspace`, `banner-cancel-reply`, `banner-submit-reply`),
  new independent state (`globalEscalationTicket`/`globalEscalationReply`, distinct from
  `escalationTicket`/`escalationReply`), and — critically — `banner-submit-reply` is specified to
  call `store.writeAnswer` **directly**, not through `answerEscalation()`, so `backToFleet()` is
  never reached. Verified `store.writeAnswer` (`lib/ui/store.js:86-103`) is a pure disk-write
  function with no navigation side effect at all — confirms the design's "the write side is
  genuinely unchanged, reused not forked" claim is accurate this time.
- Verified `router.js`'s dispatch (`SCREENS[state.mode].handleKey`, full 46-line file) and
  `escalation.js`'s own `handleKey`/`applyAction`-facing action shapes (full 223-line file) — the
  new `banner-*` verb names cannot collide with `escalation.js`'s bare `reply-type`/`submit-reply`/
  etc. verbs in `applyAction`'s `switch`, since JS `switch` matches on exact string equality and the
  two verb sets are lexically disjoint.
- Verified `onKey()`'s current shape (`watch.js:856-860`, unconditionally calls
  `router.handleKey(key, currentState())` then `applyAction`) is a small, compatible surface for the
  described "intercept before `router.handleKey` is called at all" change — no existing behavior in
  `onKey` contradicts the revised design.
- Confirmed via `git rev-parse`-style reasoning against `reducer.js` (`deriveStatus`, lines 150-154)
  that the now-corrected "NOT the same filter as `fleet.js`'s `needsYou`" claim in Decision 6 is
  accurate: `fleet.js:115` filters on `status === 'needs-you'`, which `deriveStatus` also sets for a
  `BLOCKER`-verdict run with no live `run.escalation` — the round-1 non-blocking note about this
  inaccurate "same filter" framing has been fixed in the current text.
- Grepped every `lib/ui/screens/*.js` and `lib/ui/watch.js` for `'g'`/`key === 'g'` bindings —
  still none exist, confirming the reserved `g` key remains collision-free.

**Round-1 change request 2 (post-ff re-render assumed `bin/concertino` universally) — re-verified as fixed:**
- Re-read `package.json` (bin/files fields), `README.md`, `docs/quickstart.md`,
  `docs/adapting-to-your-project.md` — all consistently describe exactly two adopting-project
  invocation paths: `npm install -g concertino` (then bare `concertino ...`) or `npx concertino
  <command>` (no install). The revised Decision 4 / task 3.1's three-step resolution order —
  (1) `command -v concertino` on `PATH`, (2) `<checkout>/bin/concertino` as the explicitly-scoped
  self-hosting/vendoring fallback, (3) `npx --no-install concertino` as a last resort — matches this
  documented model, with (2) correctly reserved for "this repo's own self-hosting case, and any
  other project that happens to vendor the CLI the same way" rather than claimed as the general path.
- Read `bin/concertino`'s `resolveCore` (lines 173-207) in full: confirmed that for a real,
  npm-installed adopting project, `core/` is always resolved from the *installed package's own*
  bundled `core/` (Part 1's `gitTopLevel(repo) !== repo` early return), never from the target
  project's own git history — so a post-fast-forward re-render is a meaningful fix for staleness
  bite #2 specifically in the self-hosting/vendoring case (path (2)), and a harmless no-op for a
  typical installed consumer (paths (1)/(3)). This is consistent with what Decision 4's own text
  claims (an accurate *invocation-resolution* claim, not an over-claim about what the re-render
  changes) — not a design defect, just a boundary worth naming (see non-blocking notes).
- Traced `core/scripts/cleanup.sh`'s existing `REPO_ROOT="$(git rev-parse --show-toplevel)"`
  (line 41) against `core/roles/orchestrator.md`'s Phase 4 invocation
  (`scripts/concertino/cleanup.sh --phase4 "$WORKTREE_PATH" ...`, a path relative to the
  orchestrator's own persistent session cwd — the primary checkout, not the ticket worktree being
  torn down) — confirms `REPO_ROOT` already resolves to "the primary checkout" the design's prose
  refers to as `<checkout>`/`<primary checkout>`, in every fast-forward outcome (update-ref-only or
  `merge --ff-only` in a worktree) — an implementable, non-ambiguous target using a variable the
  script already has in scope, even though tasks.md doesn't spell out "reuse `REPO_ROOT`" explicitly.

**Other things checked for round-2-introduced regressions:**
- `bin/concertino`'s `renderEnv` (lines 460-488): confirmed still only writes
  `CONCERTINO_BASE_BRANCH`, never `CONCERTINO_BASE_REMOTE` — task 1.1's corrected phrasing
  ("only `CONCERTINO_BASE_BRANCH` is actually rendered there today... read both with
  `${VAR:-default}`") is accurate and the round-1 non-blocking note is resolved.
- `core/scripts/setup-worktree.sh` (lines 41, 49-50): confirmed the `.concertino.env` source +
  `${CONCERTINO_BASE_REMOTE:-origin}`/`${CONCERTINO_BASE_BRANCH:-main}` pattern task 1.1 says to
  mirror is exactly what's there.
- `core/scripts/cleanup.sh` (current, pre-change, 59 lines) re-read in full: confirmed the
  unconditional `run.end` emission (lines 53-56) still sits immediately after worktree removal
  (lines 47-51) and before the final `READY` line — task 1.2's now-explicit "this is load-bearing:
  reducer.js only reads a run as needs-you-while-blocked... until run.end lands" reordering
  instruction is accurate and resolves the round-1 non-blocking note about it being implicit.
- `lib/ui/reducer.js` (full 220-line file): `deriveStatus`/`escalationStale` logic unchanged from
  round 1's reading — Decision 1's "no reducer change needed" claim still holds.
- Confirmed `test/escalation.test.js`, `test/reducer.test.js`, `test/watch.test.js`,
  `test/scripts/doctor-artifacts.test.sh` all exist as tasks.md's test tasks (8.1-8.4) assume.
- Confirmed all seven ticket ACs still trace to a concrete decision + task group with no gaps
  introduced by the round-1 edits.

### Verdict: CONFIRM

### Non-blocking notes

- Decision 6 / task 6.6 specify `banner-submit-reply`'s **success** path precisely (clear the two
  global-reply fields, no navigation) but not its **failure** path. `answerEscalation()`
  (`watch.js:505-517`, the function the dedicated escalation screen uses) has three distinct
  failure branches (`reason: 'answered'` clears the reply and sets a notice; a mid-reply write
  error keeps the reply and surfaces `reply.error`; other cases set a bare notice) — the banner's
  own `store.writeAnswer` failure handling is left unspecified. Worth a sentence in Decision 6/task
  6.6 before implementation (even "mirror `answerEscalation`'s non-success branches, targeting
  `globalEscalationNotice`/`globalEscalationReply.error` instead" would close the gap) so the
  implementer doesn't have to invent this behavior from scratch, and so `test/banner.test.js`
  (task 8.3) has something concrete to assert for the double-answer race.
- Task 3.1/Decision 4 refer to the re-render target as `<checkout>`/`<primary checkout>` without
  explicitly naming `cleanup.sh`'s own existing `REPO_ROOT` variable as that value. It resolves
  correctly today (see verification above), but a one-line pointer ("use the same `REPO_ROOT` this
  script already computes at the top") would remove any doubt for the executor, particularly since
  `REPO_ROOT` is computed once at the top of the script, before Phase 4's worktree-removal step —
  worth confirming it is still in scope (not shadowed or reassigned) by the time task 3.1's step runs.
