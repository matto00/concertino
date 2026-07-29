## Why

`bin/concertino` resolves `CORE` as `path.resolve(__dirname, '..')` — the core
belonging to whichever copy of the CLI script is executing, not the
repository it is being run against. When the CLI is `npm link`ed to a
development checkout and invoked from inside one of that repo's own delivery
worktrees, `sync`/`doctor` render the **main checkout's** `core/` into the
worktree, silently reverting any in-flight edits to `core/scripts/*` that the
worktree itself made. This already happened once while rescuing PR #5 and is
the same staleness class the `doctor` drift check was built to catch — except
here it *causes* the drift rather than detecting it.

## What Changes

- `bin/concertino` gains a "target core" resolution step used by `sync`,
  `doctor`, `update`, `init`, `eject`, and `diff` (every command that reads
  from `core/` today): when (a) the executing script's own repo is itself a
  git working-tree root (not merely nested inside some other project's tree
  — this is what rules out the ordinary `node_modules/<pkg>` topology) and
  (b) the target directory (`--out`, default cwd) belongs to the *same
  superproject* as that repo (confirmed via matching `git rev-parse
  --git-common-dir` — common-dir equality alone is not sufficient, see
  Decision 1 in `design.md`) and (c) that target's own checkout (its `git
  rev-parse --show-toplevel`) has its own `core/` directory, the CLI renders
  from **the target's own core**, not the executing script's — this is the
  repository actually being operated on, so there is exactly one correct
  answer, not a guess. If that target core's content differs from the
  executing script's own core, the CLI prints a **visible one-line note**
  naming both paths, so the choice is legible rather than silent (it does not
  refuse or fail — see Decision 2 in `design.md` for why).
- A new `--core=PATH` escape hatch on `sync`/`doctor`/`update`/`init`/
  `eject`/`diff` lets a caller force the core explicitly, bypassing detection
  entirely.
- The npm-installed case is unchanged: if the target has no `core/` of its
  own, or the target's repo isn't part of the same superproject as the
  executing script's repo (confirmed via the common-dir check, not just "a
  same-named directory happens to exist"), resolution short-circuits to
  today's behavior — render from the executing script's own package core.
- `doctor` prints which core path it compared rendered artifacts against
  (and whether that was auto-detected or forced via `--core`), so the choice
  is legible even when the two agree.

## Capabilities

### New Capabilities

- `core-resolution`: the contract for how `concertino sync`/`doctor`/
  `update`/`init`/`eject`/`diff` decide which `core/` to render from —
  package-relative by default; the target's own core when the target is
  confirmed (via matching git common-dir) to be part of the same superproject
  as the executing script and has its own `core/`, with a visible note on any
  content divergence; `--core=PATH` to force a choice.

### Modified Capabilities

(none — no existing spec covers CLI core resolution today)

## Impact

- `bin/concertino`: `CORE` becomes the result of a `resolveCore(REPO, out,
  coreOverride)` call instead of a module-level constant, threaded as a
  parameter into every function that currently closes over the module-level
  `CORE` — `readRoleFile`, `emitClaude`, `emitCodex`, `copyAssets`,
  `checkArtifacts` — and read by every command that invokes them: `cmdSync`,
  `cmdDoctor`, `cmdUpdate`, `cmdInit`, `cmdEject`, `cmdDiff`.
- New test: `test/scripts/sync-core-resolution.test.sh` (or a `node --test`
  equivalent) covering the worktree case — create a worktree, edit
  `core/scripts/*` in it, run `sync` from inside it, assert the rendered copy
  matches the worktree's own core, not the main checkout's; also covers the
  npm-installed-package case (target has no `core/` of its own) staying
  unchanged, the unrelated-repo-with-a-same-named-directory case staying
  unchanged (ancestry check must reject it), and `--core` forcing a choice.
  `cmdInit` gets a smoke check that it still renders correctly post-refactor.
- `docs/` (CLI reference, if it documents `sync`/`doctor` flags) gains the new
  `--core=PATH` flag.
- No changes to `scripts/concertino/*.sh` runtime behavior — this only changes
  which `core/` the renderer reads from, not what it renders.
