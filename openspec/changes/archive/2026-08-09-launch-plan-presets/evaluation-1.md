## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Reviewed against `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
`specs/launch-presets/spec.md`, diffed at commit `7d71715`
("CON-111 Add named launch presets...").

- All ticket acceptance criteria addressed explicitly:
  - Named batch-level (harness/speed/provider/agentMerge) presets, saved and
    reapplied in one keystroke via the launch plan's `w` key
    (`lib/ui/controllers/launchpad.js`'s `apply-preset` case,
    `lib/ui/screens/launchplan.js`'s `w` binding).
  - Presets persist across restarts via `.concertino/cache/presets.json`
    (`lib/ui/presets-cache.js`, mirroring `queue-cache.js`'s temp-file +
    rename contract, verified in `test/presets-cache.test.js`).
  - Documented in `docs/dashboard.md`'s launch-pad section (the `w` key,
    the `preset` header row, and the `presets.json` shape) and its settings
    section (the `p` entry point and the PRESETS screen).
- No AC silently reinterpreted — the three escalated design decisions
  (batch-level only, dedicated management screen, `w` as the free letter)
  are implemented exactly as resolved in `ticket.md`/`proposal.md`.
- All 31 `tasks.md` items are marked done and match what was implemented;
  spot-checked several against the diff (1.1–1.3 `presets-cache.js` +
  tests; 2.1–2.6 `presets.js` screen + `routeHandleKey` translation; 3.1–3.9
  `controllers/presets.js`; 4.1 router wiring; 5.1–5.3 settings `p` key;
  6.1–6.5 launch-plan `w` key, the `cycle-*` refactor into `apply<Dimension>`
  helpers, and the `apply-preset` case; 7.1–7.2 docs) — all present and
  correct.
- No scope creep: `lib/ui/app-state.js` and `lib/ui/watch.js` were touched
  in addition to the files `proposal.md`'s "Impact" list enumerated, but
  both are the same "wire a new per-visit screen session into the shared
  state container and dependency registry" plumbing every prior screen
  (settings/sessions) required — not scope creep, just an incomplete
  enumeration in the proposal's Impact section.
- No regressions: full test suite passes (1842/1842 `node --test`
  assertions, 0 failed); `test/controllers-launchpad.test.js` explicitly
  regression-tests the refactored `cycle-harness`/`cycle-agent-merge`/
  `cycle-speed`/`cycle-provider` handlers for unchanged behavior (task 6.2).
- No API/schema contracts affected beyond the new, additive
  `presets.json` shape, itself documented.
- Planning artifacts reflect the final implemented behavior — spot-checked
  design.md's Decisions 1–7 against the corresponding code and all match
  (validation domains, apply order harness→agent-merge→speed→provider,
  single rebuild-at-the-end, `back-to-settings-from-presets` translation
  pattern mirroring `docview.js`).

### Phase 2: Code Review — FAIL

**Gates (fresh run, this evaluation, not the executor's own report):**
`npm test` in `WORKTREE_PATH` (`CLEAN_WORKTREE` was not set — ordinary
in-worktree gate run per the `default`-speed instructions): exit code 0,
`node --test` summary `# pass 1842` / `# fail 0`, all shell-script test
suites (`emit-event`, `persist-evidence`, `set-ticket-state`, etc.) also
passed. No `not ok` lines anywhere in the output. Gates PASS on their own.

**Issue found on manual review (code-quality, mechanical):**

1. **`lib/ui/controllers/presets.js:59-61` — dead `case 'open-presets':`
   duplicates `lib/ui/controllers/settings.js:78`, violating
   `controllers/index.js`'s own stated invariant.**
   `controllers/index.js`'s header comment states explicitly: "Action-type
   sets are disjoint across controllers (each returns false for anything it
   doesn't own), so registry order carries no meaning." `tasks.md` task 5.2
   itself flagged this exact risk for this exact action: "delegating to
   `controllers/presets.js`'s `openPresets` handling (**or** dispatching
   the action through the shared `applyAction` loop — whichever keeps
   `CONTROLLERS` action-type sets disjoint, per `controllers/index.js`'s
   own stated invariant)."

   The executor chose the first option — `settings.js:78`'s `case
   'open-presets':` calls `presetsController.openPresets(ctx)` directly,
   not through `applyAction` — which is a fine, valid choice on its own.
   But `presets.js:59-61` *also* defines a `case 'open-presets':` in its
   own `handle` switch (calling the same `openPresets(ctx)`). Since
   `CONTROLLERS = [fleet, draft, escalation, drilldown, launchpad,
   settings, sessions, presets]` (`controllers/index.js`) puts `settings`
   ahead of `presets`, `applyAction`'s first-match-wins loop
   (`controllers/index.js`'s `applyAction`) means `settings`'s case always
   wins in the real dispatch path (`watch.js`'s `applyAction` call) —
   `presets.js`'s own `'open-presets'` case is unreachable in production.
   It is reachable only when a test calls `presetsCtl.handle()` directly,
   bypassing `applyAction` — which is exactly what
   `test/controllers-presets.test.js`'s `'open-presets via the exported
   action type also works'` test does, masking that this code path is dead
   in the shipped app.

   This is dead code contradicting the module's own documented contract,
   not a functional bug (both cases do the same thing), but it is exactly
   the kind of drift `controllers/index.js`'s invariant exists to prevent,
   and it was specifically called out as a risk to avoid in this task's own
   `tasks.md`.

   **Required fix:** remove the `case 'open-presets':` block from
   `lib/ui/controllers/presets.js`'s `handle` (lines 59-61), and its
   corresponding header-comment claim that `openPresets` "is also called
   DIRECTLY by `controllers/settings.js`'s `'open-presets'` case (not
   through the `applyAction` loop...)" should be kept accurate — it already
   correctly describes the real call path, so only the switch case itself
   needs removing. Update or remove
   `test/controllers-presets.test.js`'s `'open-presets via the exported
   action type also works'` test (lines ~78-83), since it currently
   exercises the code path being removed; `openPresets`'s direct-call
   behavior is already covered by the tests immediately preceding it.

**Everything else reviewed clean:**

- **DRY**: `presets-cache.js` deliberately mirrors (not imports)
  `queue-cache.js`'s contract per design.md Decision 1's own justification
  for two small sibling modules over one with a discriminator — reasonable.
  The `cycle-*`/`apply-preset` refactor in `controllers/launchpad.js`
  correctly factors shared per-field mutation logic into
  `applyHarness`/`applyAgentMerge`/`applySpeed`/`applyProvider`, reused
  unchanged by both the individual cycle handlers and `apply-preset` (design
  Decision 3) — no parallel reimplementation.
- **Readable / modular**: consistent naming, no magic values (domains are
  named constants/sets), clear separation between the pure
  `screens/presets.js` renderer/key-handler and the stateful
  `controllers/presets.js`.
- **Type safety**: plain JS throughout, consistent with the rest of the
  codebase; shape validation (`presets-cache.js`'s `isValidEntry`) is
  explicit and defensive.
- **Security**: no new external input surface beyond what the existing
  settings-save validation pattern already covers; `presets.json` stays
  under the existing `.concertino/` gitignore, no ticket data is stored in
  it.
- **Error handling**: cold/malformed reads degrade to `{ presets: [] }`
  (never throw), matching `queue-cache.js`'s precedent; save-time
  validation surfaces specific inline errors rather than failing silently.
- **Tests meaningful**: `test/presets-cache.test.js`,
  `test/presets-screen.test.js`, `test/controllers-presets.test.js`, and
  `test/controllers-launchpad.test.js` exercise every action, every
  validation-failure path, reachability/unreachability of each dimension,
  wraparound, the zero-presets no-op, and the `dashboard.launchCommand`
  override case — these would catch a real regression.
- **No over-engineering**: Decision 4's choice to reuse the launch plan's
  own h/s/p/m cycling idiom (rather than adapting settings.js's
  schema-driven field editor) is the simpler of the two considered
  approaches and is what got implemented.
- **Behavior-preserving refactor**: the `cycle-*` handlers' extraction into
  `apply<Dimension>` helpers is behavior-preserving, confirmed both by the
  refactor's own regression tests and by the unchanged pass of every
  pre-existing `launchplan.test.js`/`launchpad`-related test.

### Phase 3: UI Review — N/A

Per orchestrator instructions, this project has no UI review configured;
Phase 3 is skipped, no dev servers were started.

### Overall: FAIL

### Change Requests

1. Remove the dead, invariant-violating `case 'open-presets':` block from
   `lib/ui/controllers/presets.js`'s `handle` function (currently lines
   59-61) — `lib/ui/controllers/settings.js:78`'s own `case
   'open-presets':` already exclusively owns this action type by calling
   `presetsController.openPresets(ctx)` directly, and `CONTROLLERS`'
   registration order (`controllers/index.js`) means `presets.js`'s copy is
   unreachable via the real `applyAction` dispatch path used by
   `watch.js`. Update `test/controllers-presets.test.js`'s `'open-presets
   via the exported action type also works'` test (~lines 78-83)
   accordingly, since it currently exercises only this dead path.

### Non-blocking Suggestions

- None beyond the above — the implementation is otherwise thorough,
  well-tested, and closely tracks the design doc's resolved decisions.
