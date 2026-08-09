## Why

The launch plan's per-row overrides (`H` harness, `S` speed, `P` provider — `docs/dashboard.md`'s launch-pad section) have to be re-cycled by hand every time a batch is launched. A recurring combo (e.g. "fast, local/ollama, agent-merge on") has no way to be saved and reapplied, so an operator who launches the same kind of batch repeatedly re-cycles `h`/`m`/`s`/`p` from scratch every time.

## What Changes

- A new on-disk store, `.concertino/cache/presets.json`, holding named batch-level presets: `{ name, harness, speed, provider, agentMerge }` — the same four dimensions the launch plan's own batch-level knobs already cover. Sibling to `queue.json` (`lib/ui/queue-cache.js`), not folded into it — same temp-file-and-rename write, same "cold or malformed reads as empty" contract, its own record shape.
- A new **PRESETS** screen (`mode = 'presets'`), reached with `p` from the **settings** screen (`mode = 'settings'`). This is where presets are created, renamed, and deleted — per the escalated design decision below, all preset *management* lives here, not on the launch plan. Presets are listed as rows; the selected row's four fields are cycled with the same `h`/`s`/`p`/`m` keys the launch plan itself already uses for its own batch-level knobs, so the interaction model is the one operators already know rather than a new one.
- The launch plan binds a new key, `w`, to apply the next saved preset to the current batch in one keystroke — cycling through the saved list (wrapping), applying all four dimensions at once, and re-deriving the launch command / models preview exactly as `h`/`s`/`p`/`m` already do when cycled individually. `w` is unbound (and un-hinted) when no presets exist, mirroring how `h` is unbound when the project has only one configured harness.
- `docs/dashboard.md`'s launch-pad section documents `w` and the on-disk `presets.json` shape; the settings section documents the `p` entry point into the new screen.

No new external dependency, no breaking change to any existing command or config shape — `presets.json` is new, additive, and (like `queue.json`) already covered by the existing `.concertino/` gitignore entry.

### Design decisions escalated and resolved (see ticket.md)

- **Scope of a preset: batch-level only.** A preset never carries per-row (`H`/`S`/`P`) overrides — those are keyed to a specific ticket selection that will not generally match a later batch's tickets.
- **Where presets are managed: a dedicated screen off the settings screen.** Create, rename, and delete all happen there — not inline on the launch plan. The launch plan's only preset-related affordance is applying one (`w`).
- **Free letter for "apply preset" on the launch plan: `w`.**

## Capabilities

### New Capabilities

- `launch-presets`: named batch-level harness/speed/provider/agent-merge presets — the on-disk store, the PRESETS management screen, and the launch plan's `w` apply-key.

### Modified Capabilities

(none — `settings-screen`'s only change is a new, additive `p` keybinding to open the new screen, which does not alter any existing settings-screen requirement; `launchpad-detail-pane` / `launchpad-queue-status` etc. are unaffected. The launch plan's own existing keybindings/requirements are unchanged; `w` is additive.)

## Impact

- New files: `lib/ui/presets-cache.js`, `lib/ui/screens/presets.js`, `lib/ui/controllers/presets.js`.
- Modified files: `lib/ui/router.js` (register `presets` screen), `lib/ui/controllers/index.js` (register `presets` controller), `lib/ui/screens/settings.js` (bind `p`), `lib/ui/controllers/settings.js` (`open-presets` action), `lib/ui/screens/launchplan.js` (bind `w`, render the applied preset name), `lib/ui/controllers/launchpad.js` (`apply-preset` action, `plan.presets`/`plan.presetIndex` seeded in `open-launchplan`), `docs/dashboard.md`.
- No change to `setup-worktree.sh`, `concertino.config.json`'s schema, or any delivery-workflow script — this is dashboard-only.
