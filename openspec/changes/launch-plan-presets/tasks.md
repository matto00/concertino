## 1. On-disk store

- [x] 1.1 Create `lib/ui/presets-cache.js` mirroring `lib/ui/queue-cache.js`'s contract: `presetsCachePath(root)`, `read(root)` (cold/malformed/per-entry-invalid degrades to `{ presets: [] }` or drops just the bad entry — never throws), `write(root, presets)` (temp file + `fs.renameSync`, `.concertino/cache/` created via `mkdirSync(..., { recursive: true })`).
- [x] 1.2 Validate each entry's shape on read per design.md Decision 1: `id`/`name` non-empty strings, `harness` is `null` or one of `'claude-code'|'codex'|'opencode'`, `speed` is one of `'default'|'fast'|'slow'`, `provider` is `null|'ollama'|'default'`, `agentMerge` boolean, `createdAt`/`updatedAt` numbers.
- [x] 1.3 Unit tests (`test/presets-cache.test.js`): missing file, malformed JSON, non-array `presets`, one malformed entry among valid ones, round-trip write→read, temp-file-and-rename write behavior (mirror `test/queue-cache.test.js`'s own test shapes).

## 2. PRESETS screen (render + key handling)

- [x] 2.1 Create `lib/ui/screens/presets.js`: pure `(state, opts) -> string` render and `(key, state) -> action|null` handleKey, plus `render`/`routeHandleKey` wrappers matching every other screen's seam (see `settings.js`/`sessions.js`). `handleKey`'s Escape branch (no prompt/confirm open) returns the generic `{ type: 'back' }`, kept opaque to this module exactly as `docview.js`'s own `handleKey` does — see 2.6 for how `routeHandleKey` translates it.
- [x] 2.2 Render: a list of staged preset rows (name, harness, speed, provider, agent-merge columns) with a `▸` row cursor; an empty-state message when the staged list is empty; footer hints for `j/k` move, `n` new, `r` rename, `d` delete, `h`/`s`/`m` (and `p` only when `providers.ollama` configured) field-cycle, `S` save, `esc` discard-and-back — only hinting keys that currently do something, same discipline `launchplan.js`'s own hints follow.
- [x] 2.3 Key handling: `j`/`k` move row cursor; `n` opens the name-entry prompt (same single-line prompt shape as `fleet/keys.js`'s `n`/settings' field prompt); `r` opens the same prompt seeded with the selected preset's current name; `d` opens a y/anything-else delete confirmation (mirror `markDoneConfirm`); `h`/`s`/`p`/`m` cycle/toggle the selected row's fields per design.md Decision 4; `S` triggers save; `esc` (no prompt/confirm open) discards and returns.
- [x] 2.4 Render the delete confirmation and the name-entry prompt as their own overlay states (mirroring `settings.js`'s `chooser`/`prompt` precedence: an open prompt or confirmation owns every keystroke until resolved).
- [x] 2.5 Unit tests (`test/presets-screen.test.js` or extend an existing screens test file, matching this repo's naming convention): render with 0/1/many presets, each key's action shape, prompt/confirm precedence.
- [x] 2.6 `routeHandleKey`: translate the internal `{ type: 'back' }` into `{ type: 'back-to-settings-from-presets' }` before it reaches `watch.js`'s `applyAction` — mirroring `lib/ui/screens/docview.js`'s own `routeHandleKey`, which translates its internal `back` into `back-to-drilldown-from-doc` for the identical reason: `watch.js`'s `applyAction` intercepts a bare `action.type === 'back'` unconditionally and routes it to `backToFleet()` before any controller sees it, so PRESETS (entered from settings, not fleet) must never emit the bare `back` action past this translation point. Cover this translation directly in the 2.5 test file (assert `routeHandleKey('\x1b', ...)` returns `back-to-settings-from-presets`, not `back`).

## 3. PRESETS controller (state mutation)

- [x] 3.1 Create `lib/ui/controllers/presets.js` with `handle(action, ctx) -> boolean`, following `controllers/index.js`'s shared contract.
- [x] 3.2 `open-presets`: builds `S.presets` fresh from `presetsCache.read(ctx.root).presets` (staged working copy, deep-cloned so edits never mutate the on-disk snapshot until `S`), `rowIndex: 0`, `prompt: null`, `deleteConfirm: null`, `saveError: null`; sets `S.mode = 'presets'`.
- [x] 3.3 `presets-move-row`, `presets-new` (opens name prompt), `presets-rename` (opens name prompt seeded with current name), `presets-open-delete-confirm`, `presets-confirm-delete`, `presets-cancel-delete`.
- [x] 3.4 `presets-prompt-type`/`presets-prompt-backspace`/`presets-cancel-prompt`/`presets-commit-prompt`: on commit, either appends a new preset (design.md Decision 2 defaults: `harness` from `ctx.config.harnesses[0]` in canonical form or `null`, `speed: 'default'`, `provider: null`, `agentMerge` from `ctx.config.agentMerge.enabled`, fresh `id` via `crypto.randomUUID()`, `createdAt`/`updatedAt` = now) or renames the selected preset (updates `name` and `updatedAt`), depending on which prompt mode is open.
- [x] 3.5 `presets-cycle-harness`/`presets-cycle-speed`/`presets-cycle-provider`/`presets-toggle-agent-merge`: mutate the selected staged preset's field per design.md Decision 4's domains (harness choices from `ctx.config.harnesses` in canonical form; provider choices from `harnessCmd.providerChoices(ctx.config, <row's harness>)`, gated on `providers.ollama` configured); bump `updatedAt`.
- [x] 3.6 `presets-save`: validates per design.md Decision 5 (non-empty names, case-sensitive uniqueness); on success calls `presetsCache.write(ctx.root, S.presets)` and returns to `mode = 'settings'`; on failure sets `S.presetsSaveError` (or equivalent) and stays on the screen.
- [x] 3.7 `back-to-settings-from-presets` (the translated Escape action from 2.6 — NOT the generic `back`, which `watch.js`'s `applyAction` already intercepts unconditionally and routes to `backToFleet()` ahead of every controller): discards `S.presets` and sets `S.mode = 'settings'` (see design.md Decision 6).
- [x] 3.8 Register `presets` in `controllers/index.js`'s `CONTROLLERS` array.
- [x] 3.9 Unit tests (`test/controllers-presets.test.js` or matching this repo's existing controller-test naming convention): each action above, including the validation-failure path and the discard-on-escape path.

## 4. Router wiring

- [x] 4.1 Register `presets: { render: presets.render, handleKey: presets.routeHandleKey }` in `lib/ui/router.js`'s `SCREENS` map, with a header comment matching the existing entries' style (how/when `mode = 'presets'` is entered).

## 5. Settings screen: `p` opens PRESETS

- [x] 5.1 `lib/ui/screens/settings.js`: bind `p` (top-level, no prompt/chooser open) to `{ type: 'open-presets' }`; add the hint to the footer.
- [x] 5.2 `lib/ui/controllers/settings.js`: add the `open-presets` case, delegating to `controllers/presets.js`'s `open-presets` handling (or dispatching the action through the shared `applyAction` loop — whichever keeps `CONTROLLERS` action-type sets disjoint, per `controllers/index.js`'s own stated invariant).
- [x] 5.3 Update settings screen tests for the new key/action.

## 6. Launch plan: `w` applies a preset

- [x] 6.1 `lib/ui/controllers/launchpad.js`'s `open-launchplan` case: seed `plan.presets` from `presetsCache.read(ctx.root).presets` and `plan.presetIndex: null`.
- [x] 6.2 Refactor `cycle-harness`/`cycle-agent-merge`/`cycle-speed`/`cycle-provider`'s per-field mutation bodies into small `apply<Dimension>(plan, value, ctx)` helpers each existing cycle handler calls with its cycled value — no behavior change to any existing cycle handler (verify against existing tests).
- [x] 6.3 Add the `apply-preset` case: advances `plan.presetIndex` (wrapping over `plan.presets`), then calls the Decision 3 sequence — harness (only if reachable), agent-merge (only if editable), speed (always), provider (only if `plan.perRowEditable && plan.providerConfigured` AND reachable — the identical two-part guard the existing `cycle-provider` case already uses, not `providerConfigured` alone) — via the helpers from 6.2, then rebuilds `plan.launchCommand` (`applyBatchProviderFlags`) and `plan.resolvedModels` once.
- [x] 6.4 `lib/ui/screens/launchplan.js`: bind `w` to `{ type: 'apply-preset' }`, gated on `plan.presets.length > 0`; add the `cfgRow('preset', ...)` row (applied preset's name, or "no presets saved" when `plan.presets.length === 0`, or "none applied" when presets exist but none has been applied yet); add `w cycles` to the footer hints only when `plan.presets.length > 0`.
- [x] 6.5 Unit tests: `apply-preset` action (reachable and unreachable-dimension cases, wraparound over multiple presets), the `w`-unbound-with-zero-presets case, the new header row's three states (applied / none-applied-but-available / none-saved).

## 7. Docs

- [x] 7.1 `docs/dashboard.md`'s launch-pad section: document `w` (apply next preset, cycling, one keystroke) alongside the existing `h`/`m`/`s`/`p`/`n` paragraph, and add a short subsection documenting `.concertino/cache/presets.json`'s shape next to the existing `queue.json`/`tickets.json` documentation.
- [x] 7.2 `docs/dashboard.md`'s settings section: document the new `p` key opening the PRESETS screen, and briefly describe what that screen does (create/rename/delete, `h`/`s`/`p`/`m` field-cycling, `S` save, `esc` discard).

## 8. Full-suite verification

- [x] 8.1 Run the full test suite and lint; confirm no regression in `test/launchplan.test.js`, `test/launchpad.test.js`, `test/watch.test.js`, or any settings/controller test touched by the refactor in 6.2.
- [x] 8.2 Remove `files-modified.md` handoff note (if used) before archiving — orchestrator's own delivery step, not an executor task, but confirm nothing here is left behind that would trip spec hygiene.
