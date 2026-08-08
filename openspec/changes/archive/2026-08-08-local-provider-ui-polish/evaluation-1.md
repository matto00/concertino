## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- [x] All ticket acceptance criteria addressed explicitly (not partial)
  - Item 1: `lib/ui/screens/launchpad.js:326` now renders `'fetching tickets…'`
    unconditionally, provider-neutral. Confirmed no `Linear` string remains
    in that render path; covered by `test/launchpad.test.js`'s new test.
  - Item 2: `lib/ui/tickets/local.js`'s `parseTicket` sets
    `state.name = STATE_NAMES[f.state]` (human label) while `state.type`
    stays the raw value — matches `linear.js:352-353`'s documented contract.
    `docs/dashboard.md:412-413` was left unchanged (correctly — it already
    described the target behavior), consistent with Decision 2's "fix the
    code, not the doc" resolution. Code and docs now agree.
  - Item 3: `lib/ui/controllers/draft.js`'s `open-ticket-draft` gate now
    calls `ctx.deps.linear.kindFor(ctx.config || {})` (confirmed
    `ctx.deps.linear` is `ticket-provider.js`'s resolver per
    `lib/ui/watch.js:44`), so `manual` resolves to `local` and gets the
    local-specific message, not the raw-kind fallback.
  - Item 4: `concertino validate --ticket <ID>` now supports `local`/`manual`
    via a new `ticket-provider.js` `fetchOneTicket` dispatch and a new
    `local.js` `fetchOneTicket`. `lib/config.js:438` and
    `lib/cli/help.js:41-42` both dropped the "linear only" framing.
    Independently verified via manual smoke test (see Phase 2) that a local
    ticket's harness override is correctly reported and a missing local
    ticket produces a clean `local: ticket "X" was not found` error, not a
    raw exception.
- [x] No AC silently reinterpreted — all four items map 1:1 to the design's
  four decisions, which were themselves confirmed against source in the
  design-gate skeptic report (`skeptic-design-1.md`, verdict CONFIRM).
- [x] All task items (`tasks.md`, 24 checkboxes across 5 groups) marked done
  and match what was implemented — verified each against the diff.
- [x] No unnecessary changes outside ticket scope — diff touches exactly the
  7 source files `files-modified.md` lists, plus the corresponding test
  files and openspec change-management artifacts. `lib/ui/linear.js` is
  untouched (confirmed via `git diff main...HEAD -- lib/ui/linear.js` —
  empty), consistent with the design's explicit constraint.
- [x] No regressions to existing Linear-provider behavior — the
  `unsupported-provider` test was correctly repointed from `manual` (which
  is now supported) to a genuinely unsupported kind (`github`); no
  Linear-path test assertions changed.
- [x] API contracts/schemas — N/A, no schema changes; the new
  `fetchOneTicket(config, opts)` dispatch mirrors the existing
  `fetchTickets`/`resolveTeam`/`createTicket` shape exactly.
- [x] Planning artifacts reflect final implemented behavior — `design.md`,
  `tasks.md`, and the three spec deltas all match the diff with no drift.

Issues: none.

### Phase 2: Code Review — PASS

Ran the project's canonical gate fresh, in `WORKTREE_PATH` (no
`CLEAN_WORKTREE` flag was passed at this speed):

```
npm test
# tests 1681
# pass 1681
# fail 0
```

All `node --test` unit tests and all `test/scripts/*.test.sh` bash
integration tests pass. `git status --short` shows only
`openspec/changes/.../workflow-state.md` modified beyond the executor's
commit (expected phase-tracking churn, not code).

Checklist:

- [x] **DRY** — the new `fetchOneTicket` dispatch mirrors the existing
  `fetchTickets` pattern in `ticket-provider.js` rather than duplicating
  alias-resolution logic; `draft.js`'s gate reuses `kindFor` rather than
  reimplementing the alias table.
- [x] **Readable** — `STATE_NAMES` is a clear, self-documenting map; no
  magic values; comments cite the exact contract lines being satisfied.
- [x] **Modular** — each fix is isolated to its own call site/module; no new
  cross-cutting coupling introduced.
- [x] **Type safety** — plain JS, no untyped escape hatches introduced;
  `STATES.includes(f.state)` gates `parseTicket` before `STATE_NAMES[f.state]`
  is read, so it can never resolve to `undefined` for a well-formed ticket.
- [x] **Security** — `local.js`'s `fetchOneTicket` uses `path.join(root, ...)`
  with a caller-supplied `id`; no new path-traversal exposure beyond what
  `readTickets`/existing `looksLikeTicket`-adjacent code already accepts (the
  id here comes from the CLI's `--ticket` flag, an operator-supplied trusted
  input, same trust boundary as the existing `set-ticket-state.sh` id
  validation covers for the write path).
- [x] **Error handling** — `local.fetchOneTicket` never throws synchronously;
  it rejects with a `local: ...`-prefixed message for both missing and
  malformed files, caught by `bin/concertino`'s top-level try/catch and
  printed as `error: local: ...`, exit 1 — verified via manual smoke test.
- [x] **Tests meaningful** — new tests exercise all five state mappings, the
  `manual`→`local` alias resolution in both `draft.js` and `validate.js`,
  and both the "found"/"missing"/"malformed" `fetchOneTicket` paths. Each
  would fail against the pre-fix code (e.g. the `state.name` assertion was
  changed from `'unstarted'` to `'Todo'`, not just added alongside).
- [x] **No dead code** — no unused imports or leftover TODO/FIXME in the
  diff.
- [x] **No over-engineering** — Decision 1's provider-neutral string (rather
  than threading `ticketProvider.kind` through `renderLaunchPad`) is the
  minimal fix the ticket's own AC explicitly permits.
- [x] **Behavior-preserving where expected** — `validate.js`'s refactor from
  a direct `lib/ui/linear.js` import to the `ticket-provider.js` dispatch is
  a structural change; confirmed the Linear branch is byte-identical
  (`if (mod === linear) return linear.fetchOneTicket(opts)`), so no Linear
  behavior change beyond the intentional gate widening.

No canonical code-quality standard is configured for this project beyond
what's enforced above; no UI/design standard applies (Phase 3 is N/A).

Issues: none.

### Phase 3: UI Review — N/A

No UI review is configured for this project (per role instructions). Dev
server steps skipped.

### Overall: PASS

### Non-blocking Suggestions

- None beyond what the design-gate skeptic already noted (that
  `ticketDetail.js`'s independent `state.name` consumer was checked and
  needs no change) — the executor's `files-modified.md` doesn't explicitly
  restate that check, but it's a documentation nicety, not a defect; the
  behavior itself is correct (confirmed the fallback `ticket.state.name ? ...
  : 'Todo'` in `ticketDetail.js` degrades safely either way).
