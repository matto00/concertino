## Why

`concertino sync` is a destructive whole-file regeneration from `core/` with
no visibility into which binary/`core/` it is rendering from, and its
existing preview machinery (`sync --dry-run` and the separate `concertino
diff` command) don't cover the exact files most likely to carry un-upstreamed
local fixes — `scripts/concertino/*`, `.concertino/laws/*`, and
`.concertino/workflow-state.template.md`. A two-day misdiagnosis (CON-128's
own original filing) could have been a single command if provenance were
visible up front.

## What already exists (established by direct code read, not assumed)

- `concertino diff` (`lib/cli/diff.js`) **already** renders a real unified
  diff, colorized, against the target directory for the rendered agent/role
  files, `.claude/commands/concertino-deliver.md`, `.concertino.env`,
  `speeds.json`, and the codex/opencode equivalents — with a
  changed/new/unchanged summary and a "run `concertino sync` to apply"
  nudge. This already satisfies most of AC3.
- `sync --dry-run` (`lib/cli/sync.js` + `write()`/`copy()` in
  `lib/cli/shared.js`) only prints `would write <path>` / `would copy <path>`
  per file — filenames only, no diff content, no changed/unchanged
  distinction.
- **Gap found by direct comparison of `cmdDiff` against every write/copy
  call `sync` actually makes** (`copyAssets`, `emitClaude`, `emitCodex`,
  `emitOpencode` in `lib/cli/emit.js` — not just `copyAssets` alone, per the
  design-gate skeptic's first-round REFUTE, which is correct): `cmdDiff`
  never diffs the files `copyAssets` writes (`core/scripts/**` →
  `scripts/concertino/*`, `core/laws/*` → `.concertino/laws/*`,
  `core/workflow-state.template.md` →
  `.concertino/workflow-state.template.md` — exactly the files CON-133 was
  filed about, local script fixes silently clobbered by sync), nor
  `.claude/commands/concertino-address-failure.md`, `.claude/settings.json`
  (merged region via `mergeAgentMergeSettings`/`mergeCostHookSettings`),
  `.codex/roles/concertino-*.md`, `AGENTS.md` (merged region), or
  `.codex/prompts/concertino-deliver.md`. So today's `diff` preview would
  show "0 changed" even when a sync is about to erase a local edit to any of
  these — the precise failure this ticket's AC4 calls out. (Separately,
  `lib/cli/doctor.js`'s `checkArtifacts` already byte-compares the
  `copyAssets` trio for drift reporting — `cmdDiff`'s new loops over that
  same trio mirror `doctor.js`'s proven compare logic rather than inventing
  a new one.)
- Neither `sync` nor `diff` prints which binary is executing or whether the
  resolved `core/` came from a linked global, a separate global install, or
  a dev checkout. `resolve-core.js` already resolves the correct `core/`
  correctly (verified in CON-128's investigation) but never surfaces *how*
  it got there.

## What Changes

- `concertino sync` (and `concertino diff`) print a provenance line before
  touching anything: the resolved binary path as invoked, whether it
  resolves through a symlink, and — when it does — whether that symlink
  targets a git working-tree root (a "linked global", e.g. `npm link`) as
  distinct from a plain copied/installed global with no `.git` of its own.
  Also prints the resolved `core/` root already computed by `resolveCore`.
- `cmdDiff` is extended to cover every file `sync` actually writes that it
  currently omits: the `copyAssets` output (`scripts/concertino/*`,
  `.concertino/laws/*`, `.concertino/workflow-state.template.md`),
  `.claude/commands/concertino-address-failure.md`, `.claude/settings.json`,
  `.codex/roles/concertino-*.md`, `AGENTS.md`, and
  `.codex/prompts/concertino-deliver.md` — using the same `diffFile`
  unified-diff renderer already used for the rendered role files. This is
  the concrete fix for AC3/AC4: a project with a local edit to any file
  `sync` touches now shows that edit as a pending loss in the diff summary,
  not just the subset `diff` happened to already cover.
- `sync --dry-run` is documented (help text) as the terse filename-only
  preview it already is, and now also prints the same provenance line
  `sync`'s real run does, pointing users at `concertino diff` for
  content-level preview rather than re-implementing diffing inside
  `--dry-run` a second way.

## Capabilities

### New Capabilities
- `sync-provenance`: reporting the resolved binary path, symlink status,
  and `core/` root before `sync`/`diff` touch any file, distinguishing a
  linked-global install from a plain separate global install; and
  `cmdDiff`'s coverage of every file `sync` writes (not only the subset it
  covered before this change), so a local edit anywhere `sync` touches shows
  as a pending loss in the diff preview.

### Modified Capabilities
(none — `resolveCore`'s resolution logic and its existing divergence note
are unchanged; see design.md Non-Goals. The provenance report is printed
by the `sync`/`diff` call sites, reusing `resolveCore`'s return value, not
folded into `core-resolution`'s own spec.)

## Impact

- `lib/cli/shared.js` — new provenance-reporting helper.
- `lib/cli/resolve-core.js` — no behavior change; provenance reporting is
  additive at the call sites, not inside resolution itself.
- `lib/cli/sync.js`, `lib/cli/diff.js` — call the new provenance helper
  before any write/diff output; `cmdDiff` gains the three missing
  `copyAssets`-parity diff calls.
- `lib/cli/help.js` — `sync --dry-run` and `diff` usage text updated to
  describe the actual, now-accurate behavior.
- Tests: `test/` additions covering provenance detection (plain global vs.
  linked global vs. dev checkout) and the new `cmdDiff` coverage of
  `scripts/concertino/*`/`laws/*`/`workflow-state.template.md`, exercised
  only against throwaway `--out=` directories.
