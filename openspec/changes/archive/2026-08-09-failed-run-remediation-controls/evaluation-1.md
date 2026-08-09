## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All three ticket acceptance criteria addressed explicitly:
  - AC1 ("FAILED run has an action beyond generic set"): `a`/`d` bound at
    the fleet screen's top level, conditioned on `focus === 'runs'` and
    `runs[selected].status === 'failed'` (`lib/ui/screens/fleet/keys.js:320-325`).
  - AC2 ("mechanism documented, footer-hint advertised"): `docs/dashboard.md`
    gained a key-table entry for `a`/`d` and a new "Addressing a FAILED run"
    subsection; `sections.js`'s FAILED footer hint gains `a address`/`d done`
    only when `runs.some((r) => r.status === 'failed')`.
  - AC3 ("every escalated decision resolved or answered"): all 7 decisions
    from `ticket.md`'s "Design decisions to escalate" are each addressed in
    `proposal.md`'s "Why" section and `design.md`'s numbered Decisions
    1-7, including the design-ticket-type idea filed as CON-100 (decision 7).
- No AC silently reinterpreted. Verified the two round-2/round-1 skeptic
  findings that the task description specifically flagged were actually
  implemented, not just described in prose:
  - The `focus === 'runs'` guard is present on both the `a` and `d` bindings
    (`keys.js:320,323`), and is placed in the region reached for ANY focus
    value once the `queue`/`quickstart` blocks fall through — matching the
    round-2 finding exactly. Confirmed via `test/fleet.test.js`'s new
    "off-screen FAILED row" scenarios (queue-focused and quickstart-focused),
    both passing.
  - The `markDoneConfirm` banner is threaded through `render.js`'s `render()`
    (`render.js:297-299`), `watch.js`'s `draw()` `heightOpts`
    (`watch.js:640-646`), `controllers/fleet.js`'s `scrollToShow` `winOpts`
    (`controllers/fleet.js:41-44`), and `sections.js`'s `buildHeadTail` (an
    `else if (markDoneConfirm)` branch printing "mark TICKET as done...",
    `sections.js:336-345`) — not just intercepted at the keypress level.
    Confirmed with a render-level test (`fleet.test.js`: "the mark-done
    confirmation banner is visible on screen while markDoneConfirm is set").
- `run.override` event + `deriveStatus` precedence branch present exactly as
  designed (`reducer.js:239-244`: highest-precedence override branch, ahead
  of the live-escalation branch). Retry-visibility refinement to the
  `endStatus` branch present and correct (`reducer.js:250-259`), reusing
  `spawnedAt`/`endedAt` as designed, with a dedicated test for the
  "spawnedAt before endedAt is NOT mistaken for a retry" edge case that the
  design's own risk section flagged.
- `/concertino-address-failure` command
  (`adapters/claude-code/address-failure-command.md`) is a real, followable
  procedure structurally mirroring `command.md`'s shape (frontmatter,
  Arguments, What to do, When the orchestrator returns), and
  `core/roles/orchestrator.md`'s new "Address-Failure entry point" section
  is a genuine 5-step procedure (audit → `setup-worktree.sh` →
  resume-from-workflow-state.md-or-reconstruct-from-evidence-or-fresh-start →
  `persist-evidence.sh` → resume the ordinary loop) — not a stub. It reuses
  the exact `setup-worktree.sh`/`persist-evidence.sh` call shapes and
  argument order already established by ordinary Setup/Phase 1, and
  explicitly treats a `setup-worktree.sh` FAIL as a `BLOCKER` per the
  design's own risk mitigation.
- Every scenario in both spec deltas is verifiable against what was built:
  `fleet-failed-remediation/spec.md`'s scenarios all have direct unit-test
  coverage (`test/fleet.test.js`, `test/reducer.test.js`,
  `test/controllers-fleet.test.js`); `address-failure-skill/spec.md`'s
  scenarios describe agent-driven orchestrator procedure (not testable by
  `npm test`) and were traced by hand against
  `core/roles/orchestrator.md`'s new section and
  `adapters/claude-code/address-failure-command.md` — the procedure text
  matches every scenario's GIVEN/WHEN/THEN.
- No scope creep: the diff touches exactly the files `proposal.md`'s
  "Impact" section named, plus the corresponding test files. No unrelated
  changes.
- No regressions to existing behavior: full test suite (see Phase 2) passes,
  including the pre-existing height-cap test that needed (and got) a
  documented floor adjustment for the new FAILED footer hint's line-wrap
  effect on an 8-FAILED-run fixture.
- No API/schema changes beyond the new, self-contained `run.override` event
  kind, which is itself the deliverable and is fully documented in the new
  spec.
- Planning artifacts (proposal/design/tasks) reflect the final implemented
  behavior — spot-checked `keys.js`, `reducer.js`, `session.js`,
  `controllers/fleet.js`, `harness.js`, `sections.js`, `emit.js`,
  `orchestrator.md` line-by-line against design.md's code samples and prose;
  no drift found.
- Sanity-checked the executor's one deliberate deviation from tasks.md 5.2
  (calling `ctx.deps.submitTicket` directly rather than `ctx.launcher.launch`):
  traced `lib/ui/launcher.js`'s `launch()` → `specFor()` →
  `harness.js`'s `commandForTicket()`, which — when a ticket's cached Linear
  labels carry a `harness:<value>` label naming a different harness than the
  run's actual recorded harness — replaces the ENTIRE command with that other
  harness's own default `/concertino-deliver` template (`harness.js`'s
  `commandForTicket`: `if (!h) return batchCommand; ... let cmd = tmpl; ...`),
  discarding the `/concertino-address-failure` command outright. Since
  `submitTicket` is the exact function `launcher.launch` itself calls one
  layer down (confirmed in `prompt.js`), the deviation is behavior-neutral
  for the common case and strictly safer for the mislabeled-ticket case the
  rationale describes. Reasoning holds up; not a problem. (Non-blocking
  trade-off noted below: bypassing the launcher also skips `specFor`'s
  session-naming decoration that ordinary launches get — see Non-blocking
  Suggestions.)

### Phase 2: Code Review — PASS

Issues: none blocking.

- **Gates run fresh, in `WORKTREE_PATH`** (no `CLEAN_WORKTREE` set —
  standard-speed rules apply): `npm test` → exit 0, full suite passes (all
  `node --test` groups plus every `test/scripts/*.test.sh` shell suite).
  `openspec validate failed-run-remediation-controls --strict` → `Change
  'failed-run-remediation-controls' is valid`.
- No canonical code-quality standard is configured for this project beyond
  the tests themselves (Phase 2 instructions list "(none configured)").
- DRY: `writeOverrideEvent` mirrors `writeSpawnEvent` field-for-field with no
  duplicated logic beyond the intentional structural mirroring the design
  calls for; `addressFailureCommand()` mirrors `defaultLaunchCommand`'s
  existing template-building shape rather than duplicating string logic.
- Readable: naming is consistent with existing precedent throughout
  (`markDoneConfirm`, `addressFailureNotice`, `open-mark-done-confirm`,
  `confirm-mark-done` all read as siblings of `forceStartConfirm`/
  `open-force-start-confirm`/`confirm-force-start`). No magic values —
  `MAX_FINISHED`/footer-hint gating reuse existing constants/patterns.
  Comments throughout the diff cite the specific skeptic-gate finding they
  close, which is unusually traceable.
- Modular: new controller cases are small, single-purpose, and each
  re-resolves `S.runs` fresh at handling time rather than trusting a cached
  value (`controllers/fleet.js:337,375`), matching the file's existing
  discipline (cited explicitly in code comments).
- Type safety: plain JS, no new `any`-equivalent escape hatches; every new
  field has a clear `{ ticket } | null` or `string | null` shape documented
  in comments at its declaration site (`app-state.js`).
- Security: `writeOverrideEvent` writes only a fixed, controlled JSON shape
  to a path derived from `root`/`ticket` exactly like the pre-existing
  `writeSpawnEvent` (no new injection surface); `d`'s event never reaches a
  shell. `a`'s command is a fixed template (`ADDRESS_FAILURE_TEMPLATE`), not
  built from unsanitized input.
- Error handling: `writeOverrideEvent` never throws (try/catch-swallow,
  matching `writeSpawnEvent`'s documented "telemetry must never fail a
  dashboard action" contract) and this is exercised by a dedicated test
  (an unwritable root). `address-failure`'s spawn failure surfaces to
  `S.addressFailureNotice` rather than being swallowed, and the harness
  mismatch case surfaces an explanatory notice rather than silently no-op-ing
  (matches design's "explain why rather than doing nothing" discipline).
- Tests meaningful: reducer precedence/retry-visibility, controller
  re-resolution/stale-ticket/harness-gating, screen-level `handleKey`
  scenarios (all four from the spec, plus the QUICK START `a`-already-claimed
  edge case, plus a `focus`-entirely-absent-from-state default check), the
  on-screen banner render check (the load-bearing round-1 finding), the
  footer-hint gating, the notice render, and the emit/sync claude-only
  scoping are all exercised against the real production code (not mocked
  internals) — these would catch a real regression in any of the flows
  reviewed above.
- No dead code: no unused imports, no leftover TODO/FIXME/XXX anywhere in
  the diff (checked via grep across `lib/`, `adapters/`, `core/`, `docs/`).
- No over-engineering: Decision 1's rejected focus-mode alternative was
  correctly NOT implemented; the actual binding is the minimal top-level
  conditional the corrected design calls for.
- Behavior-preserving where expected: `deriveStatus`'s pre-existing branches
  (dead window, plain escalation, BLOCKER, alive/unknown) are untouched;
  the new override/retry-visibility branches are strictly additive/ahead-of
  in precedence, confirmed by the "no `run.override` event → unaffected" and
  the pre-existing reducer tests still passing unchanged.
- One incidental, pre-existing artifact (not introduced by this change,
  confirmed by diffing `main`'s own copy): `lib/ui/harness.js` contains a
  literal NUL byte inside a regex character class
  (`/[\x00-\x1f\x7f]/g`, written as a raw byte rather than the `\x00` escape
  sequence), which is why `git diff` renders this file as "Binary files ...
  differ" instead of a normal text diff. Verified this byte is present
  identically in `main`'s pre-change version at the same offset — pre-existing,
  not a regression, out of scope for this ticket. Noted here only so a future
  reviewer doesn't mistake `git diff`'s binary-file rendering for something
  this change did.

### Phase 3: UI Review — N/A

Per the task framing: this is a TUI-dashboard feature to the concertino
project itself, not a web-app UI with a Playwright-reviewable dev server.
No browser-based UI review is applicable; the on-screen rendering
(confirm banner, footer hint, inline notice) was instead verified via the
render-level unit tests cited in Phase 2, which assert on the actual
rendered terminal output (`plain(renderFleet(...))`).

### Overall: PASS

### Non-blocking Suggestions

- `controllers/fleet.js`'s `address-failure` case calls
  `ctx.deps.submitTicket` directly rather than going through
  `ctx.launcher`, which (correctly, per the sanity-check above) also means
  it skips `launcher.js`'s `specFor()` session-naming decoration
  (`harnessCmd.withSessionName(cmd, harnessCmd.sessionNameFor(...))`) that
  every other spawn path in this file gets. This isn't required by the
  ticket or either spec delta, and the deviation's own stated rationale
  (avoiding `specFor`'s per-ticket harness relabeling) is sound, but a
  spawned `/concertino-address-failure` tmux window won't register a
  friendly name with Claude Code's Remote Control feature the way an
  ordinary launch does. Worth a one-line follow-up if that visibility ever
  turns out to matter in practice — not blocking here.
- `keys.js`'s pre-existing comment near the `v`/`open-sessions` binding
  ("...see the letters already bound above: a c d f h H j k l L m n N p P q
  r s S t y") predates this change and was the literal source of the false
  premise design-gate round 1 caught (see `design.md`'s "Revision note").
  It is arguably accurate again now that `a`/`d` are genuinely bound
  (conditionally) at the top level, but a future reader skimming just this
  comment still has no way to tell "unconditional" from "conditional on a
  FAILED row" without reading further down. Not required by any task item;
  a short parenthetical here would close the loop that caused three rounds
  of design-gate back-and-forth.
