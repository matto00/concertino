# Files modified — CON-111 launch-plan-presets

## Cycle 2 (evaluator change request 1)

- `lib/ui/controllers/presets.js` — removed the dead, invariant-violating
  `case 'open-presets':` from `handle()` (unreachable via the real
  `applyAction` dispatch path since `controllers/settings.js` — registered
  ahead of `presets` in `CONTROLLERS` — already owns that action type
  exclusively); tightened the header comment to say so explicitly.
- `test/controllers-presets.test.js` — replaced the test that exercised the
  now-removed dead path with two tests: `handle` returns `false` for
  `'open-presets'` (proving disjointness), and an end-to-end check through
  the real `controllers/index.js` `applyAction` dispatch confirming
  `settings.js`'s case is the one that actually opens PRESETS.

Note: `git diff --name-only main...HEAD` includes ~50 unrelated files from
already-merged tickets (CON-112/CON-100/CON-84) whose commits sit in this
worktree branch's history ahead of the local `main` ref — this list is
curated by hand from the actual working-tree changes (`git status --short`)
instead.

## New files

- `lib/ui/presets-cache.js` — on-disk store for named presets
  (`.concertino/cache/presets.json`), sibling to `queue-cache.js`: path,
  per-entry-validated `read()`, temp-file-and-rename `write()`.
- `lib/ui/screens/presets.js` — the PRESETS screen: render (row list,
  empty-state, delete-confirm/prompt overlays, footer hints) and handleKey;
  `routeHandleKey` translates the internal `back` into
  `back-to-settings-from-presets`.
- `lib/ui/controllers/presets.js` — the PRESETS screen's actions:
  `openPresets` (also called directly by `controllers/settings.js`),
  row navigation, create/rename (prompt), delete-with-confirm, the h/s/p/m
  field cycles, and the validate-then-save gate.
- `test/presets-cache.test.js` — cold/malformed/per-entry-invalid reads,
  round-trip write→read, temp-file-and-rename behavior.
- `test/presets-screen.test.js` — render (0/1/many presets, overlays,
  footer-hint gating), handleKey action shapes, the `routeHandleKey`
  back-translation.
- `test/controllers-presets.test.js` — every action against a real
  `presets-cache` + tmp root: open/create/rename/delete/cycle/save
  (including the duplicate-name and empty-name validation-failure paths)
  and the discard-on-escape path.
- `test/controllers-launchpad.test.js` — `open-launchplan`'s
  `plan.presets`/`plan.presetIndex` seeding, `apply-preset` (reachable/
  unreachable dimensions, the `dashboard.launchCommand`-override case,
  wraparound over multiple presets, the zero-presets no-op), and a
  regression pass over the refactored `cycle-harness`/`cycle-agent-merge`/
  `cycle-speed`/`cycle-provider` handlers.

## Modified files

- `lib/ui/router.js` — registers `presets: { render, handleKey }` in
  `SCREENS`.
- `lib/ui/controllers/index.js` — registers the `presets` controller in
  `CONTROLLERS`.
- `lib/ui/controllers/settings.js` — new `open-presets` case, delegating to
  `controllers/presets.js`'s `openPresets`.
- `lib/ui/screens/settings.js` — binds `p` to `{ type: 'open-presets' }`;
  adds the `p presets` footer hint.
- `lib/ui/controllers/launchpad.js` — `open-launchplan` seeds
  `plan.presets`/`plan.presetIndex`; the four existing cycle-* handlers'
  per-field mutation bodies are factored into `applyHarness`/
  `applyAgentMerge`/`applySpeed`/`applyProvider` helpers (no behavior
  change, verified against existing + new tests); new `apply-preset` case
  (Decision 3's harness→agent-merge→speed→provider order, single
  rebuild-at-the-end, override-safe).
- `lib/ui/screens/launchplan.js` — binds `w` to `{ type: 'apply-preset' }`
  (gated on `plan.presets.length > 0`); renders the `preset` header row
  (applied name / "none applied" / "no presets saved"); adds the `w preset`
  footer hint (gated the same way).
- `lib/ui/app-state.js` — adds `presets` to `createAppState()`/
  `currentState()`; `backToFleet()` defensively clears it.
- `lib/ui/watch.js` — requires `presets-cache`, adds it to `ctx.deps`, adds
  `presets: 'PRESETS'` to `SCREEN_LABELS`.
- `docs/dashboard.md` — documents `w`, the `preset` header row, and
  `.concertino/cache/presets.json`'s shape in the launch-pad section;
  documents the settings screen's `p` key and the new PRESETS screen in the
  settings section.
- `test/launchplan.test.js` — new tests for the `preset` header row's three
  states and the `w` key's gating.
- `test/settings.test.js` — new tests for the `p` footer hint, the `p` key
  action, and `open-presets` delegating to `controllers/presets.js`.
