## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Read ticket/proposal/design/tasks/spec fresh in full** (`openspec/changes/launch-plan-presets/{ticket,proposal,design,tasks}.md`,
   `specs/launch-presets/spec.md`) and the two evaluation reports/`files-modified.md` as claims.

2. **Re-ran the project's gates myself, fresh, in `WORKTREE_PATH`**: `npm test`
   (this repo's only gate — no separate `lint` script exists). Output:
   `# tests 1843 / # pass 1843 / # fail 0 / # cancelled 0`, and the shell-script
   suites chained into the same `npm test` invocation all reported `ok`/passed
   with no `not ok` lines. Matches the evaluator's cycle-2 claim exactly.

3. **Cycle-2 fix (dead `open-presets` case) verified live**, not just via the
   evaluator's narrative:
   - `lib/ui/controllers/presets.js`'s `handle` switch has no `case 'open-presets':` —
     confirmed by reading the file directly (lines 63-268); `openPresets` is
     exported and called directly by `controllers/settings.js:79`.
   - `lib/ui/controllers/index.js`'s `CONTROLLERS` array registers `settings`
     ahead of `presets` (`[fleet, draft, escalation, drilldown, launchpad,
     settings, sessions, presets]`), so `applyAction`'s first-match-wins loop
     resolves `'open-presets'` through `settings.js`'s case — matches the
     header comments in both files.
   - `test/controllers-presets.test.js` contains `handle does not own
     "open-presets"` (asserts `false`) and an end-to-end test dispatching
     through the real `controllers/index.js.applyAction`, confirming
     `settings.js`'s case is the one that fires in production.

4. **Traced every ticket AC to concrete code**:
   - *"A batch-level harness/speed/provider/agent-merge combo can be saved
     as a named preset and reapplied to a later batch in one keystroke"* —
     `lib/ui/screens/presets.js`'s `n`/`h`/`s`/`p`/`m`/`S` key handling +
     `lib/ui/controllers/presets.js`'s corresponding cases create/edit/save a
     preset; `lib/ui/screens/launchplan.js:492` binds `w` to
     `{ type: 'apply-preset' }`, and `lib/ui/controllers/launchpad.js`'s
     `apply-preset` case (lines 588-639) applies all four dimensions in one
     keystroke.
   - *"Presets persist across dashboard restarts"* — `lib/ui/presets-cache.js`'s
     `write()` (temp-file + `fs.renameSync`) and `read()` (cold/malformed/
     per-entry degrade to `{ presets: [] }`), covered by
     `test/presets-cache.test.js`'s round-trip/temp-file tests.
   - *"Documented in `docs/dashboard.md`'s launch-pad section"* — confirmed
     `docs/dashboard.md` lines 537-586 document `w`, the `preset` header row,
     and the `presets.json` shape in the launch-pad section, and lines
     758-780 document the settings `p` key and the PRESETS screen.

5. **Design decisions independently re-verified against the actual diff**
   (not trusted from design.md's own prose):
   - **Origin-aware Escape routing (design.md Decision 6)**: confirmed
     `lib/ui/watch.js`'s `applyAction` (line 1131-1136) intercepts a bare
     `{ type: 'back' }` unconditionally and routes to `backToFleet()` before
     any controller runs. `lib/ui/screens/presets.js`'s `routeHandleKey`
     (lines 199-204) translates its internal opaque `{ type: 'back' }` into
     `{ type: 'back-to-settings-from-presets' }` before it ever reaches
     `applyAction` — mirroring `docview.js`'s precedent exactly, as claimed.
     `lib/ui/controllers/presets.js`'s `handle` has a case for
     `'back-to-settings-from-presets'` (not `'back'`), so there is no
     ambiguity.
   - **The provider dimension's two-part guard**: `lib/ui/controllers/
     launchpad.js`'s `apply-preset` case (line 618) reads
     `if (plan.perRowEditable && plan.providerConfigured) { ... }` — the
     identical two-part condition `cycle-provider`'s own top-of-case check
     uses (line 479) — plus a reachability check
     (`choices.includes(preset.provider)`) before calling `applyProvider`.
     Verified with a dedicated regression test
     (`test/controllers-launchpad.test.js`: "provider is left unchanged
     under a dashboard.launchCommand override (perRowEditable is false)")
     that explicitly exercises the override case and confirms provider stays
     `null` while speed still applies.
   - Order of application (harness → agent-merge → speed → provider, single
     rebuild at the end) matches design.md Decision 3 exactly
     (`launchpad.js:588-639`); the four `apply<Dimension>` helpers (lines
     51-71) are shared, unchanged, by both the individual `cycle-*` cases and
     `apply-preset`, closing the "two independently-evolving copies" risk
     design.md flagged.

6. **Spot-checked for scope drift / dead code / placeholders**: none found.
   `git diff 01541a9...a11b9ed --stat` shows exactly the files
   `files-modified.md` claims (presets-cache.js, screens/presets.js,
   controllers/presets.js, router.js, controllers/index.js,
   controllers/settings.js, screens/settings.js, controllers/launchpad.js,
   screens/launchplan.js, app-state.js, watch.js, docs/dashboard.md, plus
   matching test files) — no unrelated files touched. No `TODO`/`FIXME`/
   hand-waving found in any new/modified source file.

7. **No UI review performed** — per the orchestrator's instructions, this
   project has no design standard/UI review configured (N/A), consistent
   with evaluation-2.md's own Phase 3 N/A and with this being a terminal
   dashboard with no browser-based screens to screenshot.

### Verdict: CONFIRM

Every acceptance criterion traces to real, tested code. Both prior
design-gate change requests (origin-aware Escape routing via
`back-to-settings-from-presets`, and the `plan.perRowEditable &&
plan.providerConfigured` two-part provider guard) are correctly and
completely implemented, not just claimed — verified directly against the
running source and covered by a targeted regression test for the override
case specifically. The evaluator's cycle-1 change request (dead
`open-presets` case) is genuinely fixed, confirmed by direct dispatch-order
inspection of `controllers/index.js`, not merely re-asserted. `npm test`
reproduces clean (1843/1843) on a fresh run in this worktree.

### Non-blocking notes

- None.
