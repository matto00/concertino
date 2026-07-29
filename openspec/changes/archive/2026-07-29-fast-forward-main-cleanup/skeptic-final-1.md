## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- Read `ticket.md` and cross-checked the live Linear issue (CON-25 via MCP) — description and
  acceptance criteria are byte-identical to `ticket.md`.
- Read `proposal.md` and `design.md` in full, including the two "Revised after design-gate round 1"
  decisions (4: `concertino` resolution order; 6: banner's own action namespace).
- `git diff main...HEAD --stat` (24 files, +2071/-18) — read every changed file in full or in the
  relevant diff hunks: `core/scripts/cleanup.sh` (+152), `bin/concertino` (+40, `checkBaseBranch`),
  `lib/ui/banner.js` (new, 105 lines, read in full), `lib/ui/watch.js` (+143/-6 diff, read in full),
  `core/roles/orchestrator.md` (+10), `docs/dashboard.md`, `README.md`, `package.json`, and the four
  test files.
- `diff core/scripts/cleanup.sh scripts/concertino/cleanup.sh` → byte-identical (rendered copy in
  sync, satisfies `doctor`'s own drift check).
- Ran `npm test` myself (fresh, not trusting evaluation-1.md's pasted numbers): every `node --test`
  suite and every bash suite reports `0 failed`, including the two new suites —
  `cleanup.test.sh: 28 passed, 0 failed` and `doctor-base-branch.test.sh: 10 passed, 0 failed`.
- Ran `npx openspec validate fast-forward-main-cleanup --strict` → "Change ... is valid".
- Confirmed all 34 items in `tasks.md` are `[x]`, none `[ ]`.

### The two prior-round false claims — re-verified fixed against actual code

1. **Banner action-verb collision (design.md Decision 6, revised).** Read `lib/ui/banner.js` in
   full: `handleKey` returns only `banner-reply-type`/`banner-reply-backspace`/
   `banner-cancel-reply`/`banner-submit-reply` — never the bare `reply-type`/`submit-reply`/...
   verbs. Read `lib/ui/watch.js`'s `applyAction`: `escalation.js`'s verbs (lines ~653-676) mutate
   `escalationReply`/call `answerEscalation`→`backToFleet()` on success; the `banner-*` cases (lines
   ~733-757) are entirely separate `case` blocks operating only on
   `globalEscalationReply`/`globalEscalationTicket`, and `banner-cancel-reply`/`banner-submit-reply`
   both explicitly do **not** call `backToFleet()` (confirmed by reading the code and by the comment
   at line ~747 stating this is deliberate). `grep -n "'g'"` across `lib/ui/screens/*.js` and
   `watch.js` confirms no pre-existing binding collides with the reserved key.
2. **Post-fast-forward re-render resolution (design.md Decision 4, revised).** Read
   `core/scripts/cleanup.sh`'s render block (the `if [ "$FF_STATUS" = "updated" ]` block near the
   end): resolution order is exactly `command -v concertino` on PATH → `<repo>/bin/concertino` via
   `node` (self-hosting fallback) → `npx --no-install concertino` → a non-fatal `note:` on stderr.
   This matches what an adopting project (no `bin/concertino` in their checkout, `concertino` only
   via global install or `npx`) would actually have, per `package.json`/`README.md`/
   `docs/quickstart.md`.

### Acceptance criteria — traced to evidence

- "Local `main` fast-forwarded as part of Phase 4, no human git" — `attempt_fast_forward()` +
  `cleanup.sh`'s call site between worktree removal and `run.end`. Exercised end-to-end in
  `test/scripts/cleanup.test.sh` against real bare-remote/clone pairs (not mocks); re-ran myself,
  all 28 assertions pass.
- "Clean fast-forward silent; anything else escalates and changes nothing" — `FF_STATUS` enum;
  `dirty`/`diverged`/`failed` all short-circuit before any ref/file mutation. Test asserts both the
  ref *and* the uncommitted file content are untouched on the dirty-tree path.
- "Never fast-forward over uncommitted work or a diverged base" — `git status --porcelain` check
  before `merge --ff-only`; `merge-base --is-ancestor` check before any mutation is even considered.
- "Escalation on every screen with reply box, clears when resolved" — `lib/ui/banner.js` +
  `computeLiveEscalations` in `watch.js`, `g`-key routed ahead of `router.handleKey`, banner composed
  above `router.render(...)` in `draw()`, suppressed only via `suppressedOnOwnScreen`. Clearing is
  free (banner recomputes `liveEscalations` from `runs` every poll; `reducer.js` — confirmed
  unchanged in the diff — already nulls `run.escalation` on answer/timeout). Manually rendered
  `banner.js`'s output via `node -e` with a live and an in-progress-reply state; both render sensibly
  (tag, ticket, role, elapsed time, `[g] reply` / `reply › ... ↵ send esc cancel`).
- "Post-fast-forward re-render or clear note" — verified above.
- "`doctor` reports local main behind remote, names the cause" — `bin/concertino`'s new
  `checkBaseBranch`; `test/scripts/doctor-base-branch.test.sh` (10/10, re-ran myself) exercises
  current/behind/fast-forwarded/ahead/offline cases against a real bare remote + clone, including the
  "doctor still runs its other checks when the fetch fails" case.
- "Safe with several worktrees live" — the ref-only `update-ref` path never touches a working tree
  when `<base>` isn't checked out anywhere (the common case, since every ticket worktree lives on a
  feature branch); the worktree-checkout path is gated on a clean `git status --porcelain` in that
  specific worktree only.

### Iron Laws

- Verification: re-ran `npm test` and `openspec validate` myself rather than trusting
  `evaluation-1.md`'s pasted numbers; results match what was claimed.
- No bug-fix regression-test obligation here (this is new capability work, not a bug fix), so
  `systematic-debugging.md`'s root-cause/regression-test requirement doesn't apply.

### UI / design judgment

No design standard is configured for this project (terminal dashboard, no browser UI). Read
`lib/ui/banner.js`'s render logic and manually invoked `renderBanner()` directly to sanity-check
output formatting (colour tag reuse via `f.STATUS_COLOUR['needs-you']`, truncation to terminal
width, the reply-box sub-state) — output is coherent and consistent with the existing
`lib/ui/screens/escalation.js` visual vocabulary (same reply-box affordance text style). No dev
servers relevant to this change (`DEV_PORT`/`BACKEND_PORT` are unrelated — `cleanup.sh` still stops
them unconditionally, unchanged).

### Verdict: CONFIRM

### Non-blocking notes

- `checkBaseBranch` hardcodes the remote name to `'origin'` rather than reading a
  `CONCERTINO_BASE_REMOTE`-equivalent from `cfg` — correctly noted in evaluation-1.md as consistent
  with the fact that no such config field exists anywhere yet; worth a follow-up only if a
  configurable remote is ever added to `concertino.config.json`.
- The stderr note on a retry that itself hits `fetch-failed`/`no-local-base` says "remains behind",
  which is mildly imprecise for those two sub-cases (it didn't confirm "behind", just couldn't
  check). Cosmetic only, no functional impact.
