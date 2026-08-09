## Context

The launch plan (`lib/ui/screens/launchplan.js` + `lib/ui/controllers/launchpad.js`) already exposes four batch-level knobs — harness (`h`), speed (`s`), provider (`p`), agent-merge (`m`) — each cycled independently. There is no way to save a combination of these four and reapply it later; an operator re-cycles them by hand every time. CON-111 asks for a named preset capturing exactly those four dimensions, persisted to `.concertino/cache/` (the same directory `tickets.json`/`queue.json` already live in), applied to a later batch in one keystroke.

Three design decisions were explicitly escalated in the ticket and resolved by the human before this document was written (see `ticket.md` and `proposal.md`'s "Design decisions escalated and resolved"):

1. Presets are **batch-level only** — no per-row overrides.
2. Presets are **managed** (created, renamed, deleted) on a **dedicated screen off the settings screen** — not inline on the launch plan.
3. The launch plan's **apply** key is **`w`**.

## Goals / Non-Goals

**Goals:**
- Save a named (harness, speed, provider, agentMerge) combination and reapply it to a later batch's launch plan in one keystroke.
- Presets persist across dashboard restarts (same durability precedent as `queue.json`).
- Creating, renaming, and deleting presets happens entirely on the new PRESETS screen — the launch plan gains exactly one new key (`w`, apply-only).
- Documented in `docs/dashboard.md`.

**Non-Goals:**
- Per-row (`H`/`S`/`P`) overrides are never part of a preset (explicitly resolved above).
- No import/export, no sharing presets across machines/projects beyond what committing/copying `.concertino/cache/presets.json` by hand would already do (and that file is gitignored by design, same as `tickets.json`/`queue.json` — see `docs/dashboard.md`'s "Sensitivity" note, though presets themselves carry no ticket data).
- No live-capture of "whatever the currently-open launch plan happens to be set to" as the seed for a new preset. See Decision 2 below for why, and what a new preset's fields default to instead.
- No preset-name collision UI beyond straightforward validation (non-empty, unique) — see Decision 5.

## Decisions

### Decision 1: `presets.json` is a sibling of `queue.json`, not folded into `cache.js`

New module `lib/ui/presets-cache.js`, mirroring `lib/ui/queue-cache.js`'s own contract exactly:

```
.concertino/cache/presets.json   { presets: [ { id, name, harness, speed, provider, agentMerge, createdAt, updatedAt } ] }
```

- `id`: `crypto.randomUUID()`, minted once at creation — stable identity independent of `name` (a rename must not change what a running session's `plan.presetIndex` points at, and must not require rewriting anything that referenced the preset by name).
- `name`: non-empty string, unique (case-sensitive) among presets at save time (see Decision 5).
- `harness`: a **canonical** harness id (`'claude-code' | 'codex' | 'opencode'`, i.e. `harnessCmd.canonicalHarness()`'s output domain) or `null`. `null` is a legitimate stored value (see Decision 3 on why a fresh preset defaults to `null`), meaning "don't touch the batch's harness when this preset is applied."
- `speed`: one of `'default' | 'fast' | 'slow'`.
- `provider`: `null | 'ollama' | 'default'` — the exact value domain `harnessCmd.providerChoices()` already returns and `plan.provider` already stores. Never a new vocabulary.
- `agentMerge`: boolean.

`read(root)` returns `{ presets: [] }` on a missing file, malformed JSON, non-array `presets`, or any entry failing shape validation — validated **per entry**, so one malformed preset does not blank the whole list (same "degrade the one bad field, not the whole record" discipline `queue-cache.js`'s `read()` already applies to `perTicket`). `write(root, presets)` does the same temp-file + `fs.renameSync` dance `queue-cache.js`'s `write()` does. No `clear()` is needed (nothing ever needs to blow away the whole file at once — deletion is per-preset, handled by the PRESETS screen writing back the array with one entry removed).

**Alternative considered:** extend `queue-cache.js` itself with a second record type. Rejected for the same reason `queue-cache.js`'s own header comment gives for not folding *itself* into `cache.js`: different record shape, different lifecycle, and a shared module would need a discriminator threaded through every call site for no benefit — two small sibling modules are more readable than one with a `kind` switch.

### Decision 2: creation happens on the PRESETS screen, with sensible defaults — not a live capture from the launch plan

The ticket's "Proposed" section says a preset is "captured from the launch plan's current batch-level settings," but the escalated answer to "where are presets managed" was **"dedicated screen off the settings screen"** for creation as well as rename/delete (the escalation bundled all three under one question; the human's answer applies to all three, not just rename/delete). Those two statements are in tension: the settings screen has no live launch-plan session to capture from — an operator can reach PRESETS without ever having opened a launch plan in that session at all.

Resolution: "captured from...batch-level settings" is read as describing the **data model** a preset holds (the same four dimensions a batch has), not a literal requirement that creation reads a live in-flight launch plan. A new preset created on the PRESETS screen starts from defaults that mirror what a *fresh* launch plan itself seeds from (`controllers/launchpad.js`'s own `open-launchplan` case):
- `harness`: the project's first configured harness (`ctx.config.harnesses[0]`, converted to canonical form), or `null` if the project has no `harnesses` configured at all.
- `speed`: `'default'`.
- `provider`: `null`.
- `agentMerge`: `!!(ctx.config.agentMerge && ctx.config.agentMerge.enabled)` — the same expression `open-launchplan` already uses to seed `plan.agentMerge`.

The operator then edits those four fields in place (Decision 4) before saving. This keeps every management action on one screen, matches the escalated answer literally, and never requires the settings/presets code path to reach into `S.launchPlan` (which may not exist).

**Alternative considered:** let `w`, if pressed with the launch plan showing unsaved *would-be* preset state, offer a "save current as preset" sub-action inline on the launch plan. Rejected outright — it directly contradicts the escalated "dedicated screen" answer, and would split preset creation across two screens for no benefit.

### Decision 3: applying a preset sets, not cycles

The launch plan's `w` key applies the *next* saved preset (cycling through `plan.presets`, wrapping — the same "repeated presses of a batch-level key sweep through the option space" idiom `h`/`s`/`p` already use, so this needs no new interaction vocabulary). But *within* one application, every field is **set** to the preset's stored value, not cycled:

- `harness`: only applied when the preset's `harness` is non-null **and** present in `plan.harnesses` (the CLI-label array the batch's own `h` cycle already restricts itself to, converted via `harnessCmd.cliLabel()`) — otherwise this dimension is left untouched, mirroring how `cycle-harness`'s own provider-drop logic ("An explicit batch provider may not be reachable from the NEW harness...drop it rather than carry a choice this harness cannot honour") already treats an unreachable choice as "skip, don't error."
- `agentMerge`: only applied when `plan.agentMergeEditable`.
- `speed`: always applied (every project has at least `default` — same reasoning `s`'s own footer hint is unconditional).
- `provider`: only applied when `plan.perRowEditable && plan.providerConfigured` **and** the preset's `provider` value is a member of `harnessCmd.providerChoices(ctx.config, <the harness in effect after the harness step above>)` — otherwise left untouched, same graceful-skip precedent as harness. The `plan.perRowEditable` half of this guard is required, not optional: it is the exact condition the existing `cycle-provider` case already checks (`if (!plan || !plan.perRowEditable || !plan.providerConfigured) return true;`) — a project running under a `dashboard.launchCommand` override has no flag slot to safely decorate with a provider choice, and `w` must never set a value the batch's own `p` key would itself refuse to set.

Order matters, and mirrors the dependency order already encoded in `controllers/launchpad.js`'s existing cycle handlers (`cycle-harness` re-applies agent-merge and drops an unreachable provider; `cycle-provider`/`cycle-speed` each rebuild the command and re-resolve the models preview once at the end): apply harness first, then agent-merge, then speed, then provider, then rebuild `plan.launchCommand` via the existing `applyBatchProviderFlags()` helper and re-resolve `plan.resolvedModels` via `ctx.resolveModels(...)` **once**, at the end — not once per field. This is a straight reuse of the existing per-field mutation bodies already in `cycle-harness`/`cycle-agent-merge`/`cycle-speed`/`cycle-provider`, refactored into small `apply<Dimension>(plan, value, ctx)` helpers those four cases call with the *cycled* value and the new `apply-preset` case calls with the *preset's stored* value — not a second, parallel implementation of the harness/speed/provider/agent-merge mutation logic.

**Alternative considered:** a modal chooser (à la settings' `enum-list` chooser) listing every preset, letting the operator pick directly rather than cycling. Rejected for scope: it is a second new sub-state (`plan.presetChooser`) for a payoff cycling already delivers ("apply...in one keystroke" is satisfied by repeated `w` presses just as well as by `h`/`s`/`p` today), and the escalated free-letter answer was for a single cycle-style key, matching the existing idiom, not a chooser-opening key.

### Decision 4: the PRESETS screen reuses the launch plan's own field-cycling keys (`h`/`s`/`p`/`m`), not the settings screen's per-field-prompt/chooser machinery

Each saved preset renders as one row (name, harness, speed, provider, agent-merge columns), with a `▸` row cursor (`j`/`k`). On the selected row: `h` cycles harness through `[null].concat(configuredHarnesses)` (configured harnesses in canonical form, from `ctx.config.harnesses`, falling back to `['claude-code']` exactly as `open-launchplan` already does), `s` cycles speed through `['default','fast','slow']`, `p` cycles provider through `harnessCmd.providerChoices(ctx.config, <row's current harness>)` (only bound when `providers.ollama` is configured, exactly mirroring the launch plan's own `p`-cycle gate), `m` toggles agent-merge. `n` creates a new preset (opens the one free-text prompt this screen has — for the *name* only, seeded empty, reusing the exact `promptKey`-style prompt shape `fleet/keys.js`'s `n`/settings' field-prompt already use); on submit, a new row is appended with Decision 2's defaults and the cursor moves to it. `r` renames the selected row (same prompt shape, seeded with the current name). `d` opens a y/anything-else delete confirmation (mirroring `markDoneConfirm`/`clearQueueConfirm`'s established shape exactly). `S` validates (Decision 5) and writes the staged list to `presets.json` via `presets-cache.write()`. `esc` discards every staged change and returns to `mode = 'settings'`.

This is a **deliberate structural divergence** from `settings.js`'s own two-pane SECTIONS/FIELDS-plus-chooser pattern: a preset has exactly four bounded-domain fields, all of which already have an established single-key-cycle idiom on the launch plan that operators already know. Reusing that idiom (rather than settings' generic schema-driven field editor, built for dozens of heterogeneous fields across many sections) is less new code and a shorter mental hop for anyone who has ever cycled the launch plan's own `h`/`s`/`p`/`m`.

**Alternative considered:** reuse `settings.js`'s `buildFieldMeta`/`fieldKind`/chooser machinery directly, modeling a preset as a tiny ad hoc "schema." Rejected: that machinery is built around `concertino.config.json`'s JSON-schema-declared fields (enum lists sourced from the schema, dotted paths, `configLib.deepSet`) — a preset is not a config field and has no schema entry, so adapting it would mean inventing a fake schema fragment for four values, which is more code and more indirection than four direct cycle handlers.

### Decision 5: validation on save

`S` (save) on the PRESETS screen validates the staged list before writing, mirroring the settings screen's own validate-then-write gate:
- every preset has a non-empty `name`;
- every `name` is unique among the staged list (case-sensitive);
- every `speed`/`provider`/`agentMerge`/`harness` value is within the domains Decision 1 defines (this can only be violated by a bug, since every field is cycled through a bounded domain, but is checked defensively rather than trusted).

On failure, the specific error(s) are shown inline (same `settings.saveError` shape/precedent) and the screen stays open with the invalid state still staged — nothing is written. `esc` always discards cleanly regardless of validation state, exactly as it does on the settings screen.

**Alternative considered:** validate per-keystroke (reject a duplicate name the moment it is typed). Rejected — matches settings' own "validate once, on save" precedent (`settings.js`'s header comment: "Validation happens once, on save, against the whole candidate — not here"), and per-keystroke validation of a *sequence of independent creates* (an operator can type two presets with the same working name before renaming one) is a worse experience than a single save-time report.

### Decision 6: `router.js` / `controllers/index.js` wiring, and Escape's origin-aware routing

`mode = 'presets'` is registered in `router.js`'s `SCREENS` map exactly like every other screen (`{ render, handleKey: routeHandleKey }`), and `lib/ui/controllers/presets.js` is added to `controllers/index.js`'s `CONTROLLERS` array. `open-presets` (settings screen's new `p` key) builds `S.presets` fresh every time (mirroring `openSettings()`'s own "no persistent reuse across visits" precedent) by reading `presets-cache.read(ctx.root).presets` into a staged working copy.

**Escape must NOT emit the bare `{ type: 'back' }` action.** `lib/ui/watch.js`'s `applyAction` intercepts `action.type === 'back'` unconditionally and routes it straight to `backToFleet()`, before any controller — including the new `presets` controller — is ever consulted (verified directly in `watch.js`; this is not something a controller can override by also handling `'back'`, since `watch.js`'s own interception happens first). `sessions.js`/`launchpad.js` are not usable precedent for "a screen's `esc` returns somewhere other than fleet" — both are only ever opened *from* fleet, so `back → fleet` is coincidentally correct for them, not evidence of origin-aware routing. The real precedent is `lib/ui/screens/docview.js`: its internal `handleKey` returns the generic `back` (kept "OPAQUE to this module" per its own header comment), but its `routeHandleKey` — the function the router actually calls — translates that into a concrete, non-generic action name, `back-to-drilldown-from-doc`, specific to the one screen docview is always entered from.

`lib/ui/screens/presets.js` follows the identical pattern: its internal `handleKey` may return `{ type: 'back' }` for its own testability/symmetry with every other screen's internal shape, but its exported `routeHandleKey` translates that into `{ type: 'back-to-settings-from-presets' }` before it ever reaches `watch.js`'s `applyAction`. The `presets` controller handles `back-to-settings-from-presets` (discard `S.presets`, `S.mode = 'settings'`) — never `back` itself, so there is no ambiguity about which controller's `back`-shaped case wins.

### Decision 7: the launch plan's `w` key and header row

`plan.presets` (the array read once, at `open-launchplan` time, from `presets-cache.read(ctx.root).presets` — a point-in-time snapshot, same "resolved once when the plan opens" precedent `plan.resolvedModels`/`plan.commitSha` already follow) and `plan.presetIndex` (`null` until the first `w` press) are added to the launch-plan state object `controllers/launchpad.js`'s `open-launchplan` case builds. `launchplan.js` adds a `cfgRow('preset', <name or "none applied">, 'w cycles')` row directly under the existing `provider` row — visible pre-flight, same discipline the header's harness/agent-merge/speed/provider rows already follow — and `w cycles` is included in the footer hints **only when `plan.presets.length > 0`**, mirroring the `h`-hint's `harnesses.length > 1` gate exactly. When `plan.presets.length === 0` the `preset` header row itself still renders (showing `no presets saved`), matching how the `provider` row explains its own unavailability rather than disappearing (`set providers.ollama in config to use p/P`).

## Risks / Trade-offs

- **A preset applied to a project whose configured harnesses have since changed (or whose `providers.ollama` was removed) silently no-ops those dimensions.** Mitigation: this is the same graceful-degradation behavior the batch's own `h`/`p` cycles already have for an unreachable choice (Decision 3) — consistent, not a new failure mode, and the header's `preset` row still shows which preset was last applied, so the operator can see one dimension apparently "stuck" and investigate rather than being told nothing happened at all.
- **Two independently-evolving copies of the harness/speed/provider/agent-merge mutation logic** (the launch plan's own `cycle-*` handlers vs. the PRESETS screen's `h`/`s`/`p`/`m` row-cycle handlers) is a drift risk if not shared carefully. Mitigation: Decision 4's row cycles operate on plain preset-record fields (canonical harness id / `'default'|'fast'|'slow'` / `null|'ollama'|'default'` / boolean) with no launch-command string to rebuild and no models preview to refresh — there is no shared *rebuild* logic to reuse there (only the *domain* of legal values, which both already source from `ctx.config.harnesses`/`harnessCmd.providerChoices()`, one shared source of truth). The launch plan's own `apply-preset` case (Decision 3), by contrast, explicitly reuses (not reimplements) the existing per-field mutation bodies factored out of `cycle-harness`/`cycle-agent-merge`/`cycle-speed`/`cycle-provider` — this is the one place actual duplication risk exists, and it is closed by that refactor, not left open.
- **`presets.json` growing without bound** (an operator who never deletes anything). Not mitigated — no cap is proposed; this mirrors `queue.json`'s own lack of a size cap, and a realistic preset count (a handful of named combos) never approaches a concern on the scale `tickets.json`'s `MAX_TICKETS` was built for.

## Migration Plan

Purely additive — no existing file, schema, or config shape changes. A project with no `.concertino/cache/presets.json` yet reads as `{ presets: [] }` (Decision 1's cold-cache contract), so this ships with zero migration steps and no behavior change for any project that never opens the new screen or presses `w`.

## Open Questions

None outstanding — the three decisions the ticket flagged for escalation were resolved before this document was written (see `ticket.md`); every other choice here is an ordinary implementation decision within that resolved scope.
