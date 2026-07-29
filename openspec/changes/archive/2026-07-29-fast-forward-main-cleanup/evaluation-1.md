## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Verified each ticket acceptance criterion against the diff and the two spec deltas
(`specs/main-fast-forward/spec.md`, `specs/cross-screen-escalation/spec.md`), which
`openspec validate fast-forward-main-cleanup` confirms are structurally valid:

- "Local `main` is fast-forwarded as part of Phase 4 cleanup" — `core/scripts/cleanup.sh`
  (and its re-synced copy `scripts/concertino/cleanup.sh`, byte-identical, confirmed via `diff`)
  fetches the configured base remote/branch and fast-forwards via `git update-ref` (not checked
  out anywhere) or `git merge --ff-only` (checked out, clean).
- "A clean fast-forward proceeds silently. Anything else... escalates and changes nothing." —
  `attempt_fast_forward()` only ever moves a ref on the `current`/`updated` paths; `dirty`,
  `diverged`, and `failed` all fall through untouched to the escalation block
  (`core/scripts/cleanup.sh:163-178`). Exercised end-to-end in
  `test/scripts/cleanup.test.sh` (dirty tree and diverged base both assert the uncommitted edit /
  local `main` tip are untouched).
- "Never fast-forward over uncommitted work or a diverged base" — same as above; the divergence
  check (`merge-base --is-ancestor`) runs before any worktree/ref mutation is even considered.
- "The escalation appears on every screen with an input box to reply, and clears when resolved" —
  `lib/ui/banner.js` + `lib/ui/watch.js` wiring (`computeLiveEscalations`, `g`-key routing ahead
  of `router.handleKey`, `banner-*` action namespace, composed above `router.render(...)` in
  `draw()`, suppressed only on the escalation's own dedicated screen). Covered by
  `test/banner.test.js` and the `computeLiveEscalations` cases in `test/watch.test.js`.
- "After a successful fast-forward, either re-render or state clearly that a re-render is
  needed" — the post-fast-forward block (`core/scripts/cleanup.sh:180-199`) implements the
  three-tier `concertino` resolution order from design.md Decision 4 (revised) and prints a
  `note:` to stderr on failure rather than ever escalating over a rendering failure, matching the
  design's explicit "two different failure domains" reasoning.
- "`doctor` reports when local `main` is behind its remote" — `bin/concertino`'s new
  `checkBaseBranch` (Git section, best-effort fetch, silent on failure, silent when
  even/ahead, warns with commit count + names Phase 4's fast-forward as the usual cause).
  Verified live: `node bin/concertino doctor --out=.` prints `✓ base branch  main is current
  with origin/main` under a new `Git` section.
- "Safe with several worktrees live" — the ref-only path (`update-ref`) never touches a working
  tree at all in the common case (no ticket worktree ever has `<base>` checked out), and the
  worktree-checkout path is gated on a clean `git status --porcelain`, matching design.md
  Decision 2 exactly.

Task list cross-check: all 34 items in `tasks.md` are marked `[x]` and each maps to an actual
diff hunk (no task marked done with no corresponding change, no task silently reinterpreted).
Decisions 4 and 6's "Revised after design-gate round 1" text is what's actually implemented
(three-tier `concertino` resolution order; `banner-*`'s own action namespace never touching
`escalation.js`'s `escalationReply`/`backToFleet()` path) — confirmed by reading `banner.js`'s
`handleKey`/`suppressedOnOwnScreen` and `watch.js`'s `applyAction` `banner-*` cases directly.

No scope creep: every changed file is accounted for in `files-modified.md` and traces to one of
the ticket's stated impact areas (`cleanup.sh`, `bin/concertino`'s doctor, the dashboard banner,
the orchestrator role note, docs, and their tests). No regressions found — `reducer.js`,
`lib/ui/screens/escalation.js`, and `lib/ui/screens/fleet.js` are untouched, matching design.md's
explicit claim that the existing escalation model needs no change.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Fetch/compare/act algorithm** (`core/scripts/cleanup.sh:92-153`) matches design.md Decision 2
  line for line: fetch (best-effort, silent on failure), equal-tip no-op, ancestor check,
  `worktree list --porcelain` lookup, ref-only update vs. `merge --ff-only`, dirty/diverged
  short-circuit. Clear status enum (`FF_STATUS`) documented in a header comment; no magic strings
  used without being named in that enum.
- **Escalation bound** — the retry loop is genuinely bounded to two attempts total
  (`core/scripts/cleanup.sh:163-178`); a second unresolved outcome logs to stderr and does not
  re-escalate, matching spec.md's "A second consecutive failure does not escalate a third time"
  scenario exactly.
- **`run.end` ordering** — task 1.2's load-bearing reordering (moving the unconditional `run.end`
  emission to *after* the fast-forward/escalation/re-render block) is done correctly
  (`core/scripts/cleanup.sh:201-202` is now the last statement before the final `echo`), which is
  what makes the escalation banner show correctly (`reducer.js`'s `needs-you`-while-blocked logic
  depends on `run.end` not having landed yet).
- **Namespacing discipline** — `banner.js`'s `banner-reply-type`/`banner-reply-backspace`/
  `banner-cancel-reply`/`banner-submit-reply` never collide with `escalation.js`'s bare
  `reply-type`/`submit-reply`/... verbs; `watch.js`'s `applyAction` has entirely separate `case`
  blocks for each, and `banner-cancel-reply`/`banner-submit-reply` deliberately never call
  `backToFleet()`, exactly per design.md Decision 6 (revised).
- **DRY** — `banner-submit-reply` reuses `store.writeAnswer` directly (not a fork); `renderBanner`
  reuses `f.STATUS_COLOUR['needs-you']` rather than an ad hoc colour; `suppressedOnOwnScreen` is
  exported and used by both `watch.js`'s `draw()` and the module's own tests, so the "is this the
  escalation's own screen" condition exists in exactly one place.
- **`g`-key collision audit** — independently re-verified (not just trusted the executor's
  claim): `grep -n "key === 'g'" lib/ui/screens/*.js lib/ui/watch.js` returns nothing, confirming
  `g` is genuinely unbound everywhere else.
- **Type safety / error handling** — the fast-forward's every git invocation either checks its
  exit status explicitly or is inside an `||` fallback with a named `FF_STATUS`/`FF_REASON`; no
  silent swallowing of an unexpected git failure (it becomes `FF_STATUS=failed` and escalates,
  per spec.md's "the fast-forward attempt itself failing unexpectedly" case).
- **Tests are meaningful, not just present** — `test/scripts/cleanup.test.sh` runs the algorithm
  against real throwaway bare-remote/clone pairs (not mocks), covering all six algorithm outcomes
  plus a successful retry, and asserts both the ref state *and* the untouched uncommitted file
  content on the dirty-tree case — a regression that started deleting or checking out over local
  edits would be caught. `test/banner.test.js` exercises rendering, the reply-box state machine,
  and suppression on the owning screen as pure-function tests, matching `escalation.test.js`'s
  existing style. Independently re-ran the full suite (`npm test`): **459 `node --test` assertions
  pass (0 fail)**, plus every bash suite reports `0 failed`, including the two new ones
  (`cleanup.test.sh`: 28/28, `doctor-base-branch.test.sh`: 10/10).
- **No dead code** — no new TODO/FIXME; the pre-existing `TODO: configure lint/test/build gate`
  strings in `bin/concertino` are unrelated template placeholders, not introduced by this change.
- **Sync drift check** — `diff core/scripts/cleanup.sh scripts/concertino/cleanup.sh` is
  byte-identical, so `doctor`'s own artifact-drift check stays green (task 4.1 honored).

Non-blocking observations (do not affect the PASS verdict — see below):
- `checkBaseBranch` in `bin/concertino` hardcodes the remote name to `'origin'` rather than
  reading a `CONCERTINO_BASE_REMOTE`-equivalent from `cfg`. This matches existing precedent (no
  `baseRemote` field exists anywhere in `concertino.config.json`/`buildConfig`), so it isn't a
  contract violation, just worth a follow-up if a configurable remote is ever added.
- On a retried fast-forward that itself hits `fetch-failed` or `no-local-base` (e.g. a flaky
  network between the first escalation and the retry), the stderr note says "remains behind"
  (`core/scripts/cleanup.sh:173`), which is slightly imprecise wording for those two specific
  sub-cases (it didn't necessarily confirm "behind", it just couldn't check). Cosmetic only —
  doesn't affect exit code, ref safety, or the escalation bound.

### Phase 3: UI Review — N/A
Per the task framing for this project (terminal dashboard rendered by pure functions in
`lib/ui/*.js`, no browser to click through), Phase 3 is reviewed by reading the render/handleKey
functions and their tests rather than a dev server. That review is folded into Phase 2 above
(`lib/ui/banner.js`, `lib/ui/watch.js`'s wiring, and `test/banner.test.js`/`test/watch.test.js`).
No dev servers were started; `DEV_PORT`/`BACKEND_PORT` are not exercised by this change (cleanup.sh
still stops them unconditionally, unchanged from before).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Consider making the doctor `Git` section's remote name configurable (currently hardcoded to
  `'origin'`) if `CONCERTINO_BASE_REMOTE`-equivalent project config is ever introduced.
- Consider a more precise stderr note for the rare "retry itself couldn't fetch" sub-case,
  distinct from "retry confirmed still behind" — purely cosmetic.
