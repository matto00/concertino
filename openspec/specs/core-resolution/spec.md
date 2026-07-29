# core-resolution Specification

## Purpose
Defines how `concertino sync`/`doctor`/`update`/`init`/`eject`/`diff` decide which `core/` directory to render from — the executing script's own package by default, or the target's own core when it's confirmed (via a two-part git-ancestry check) to be a worktree of the same superproject, with a visible divergence note rather than a silent or refused pick.
## Requirements
### Requirement: Default core resolution matches the executing script's package
When no `--core` override is given, and either the executing script's own `REPO` is not itself a git working-tree root (`git rev-parse --show-toplevel` from `REPO` does not equal `REPO`) or the target directory (`--out`, default cwd) is not part of the same superproject as `REPO` (per matching `git rev-parse --git-common-dir` on both), `concertino sync`, `doctor`, `update`, `init`, `eject`, and `diff` SHALL render from and compare against `path.join(REPO, 'core')`, where `REPO` is the directory containing the executing script's package root — unchanged from prior behavior.

#### Scenario: npm-installed package with no core/ of its own
- **WHEN** `concertino sync` is run from within a project that installed
  `concertino` as an npm dependency (the project has no `core/` directory of
  its own)
- **THEN** the CLI renders using the installed package's own `core/` and does
  not attempt any worktree-based detection

#### Scenario: CLI and target are the same checkout
- **WHEN** `concertino sync` is run from inside the same repository checkout
  that contains the executing `bin/concertino` script
- **THEN** the CLI renders using that repository's own `core/`, exactly as
  before this change

#### Scenario: unrelated project has its own unrelated core/ directory
- **WHEN** `concertino sync` is run from within a project that is not part of
  the same superproject as the executing script's repository (per
  `git rev-parse --git-common-dir`), but happens to contain its own top-level
  `core/` directory for unrelated reasons
- **THEN** the CLI renders using the executing script's own `core/`,
  ignoring the target's unrelated `core/` directory entirely, with no note
  or divergence check performed

#### Scenario: npm-installed package nested inside a git-tracked consumer with its own coincidental core/ directory
- **WHEN** `concertino sync` is run from within a git-tracked consumer
  project that has `npm install`ed `concertino` as a dependency (so the
  executing script's own `REPO`, e.g. `node_modules/concertino`, has no
  `.git` of its own and is merely nested inside the consumer's own
  repository), and that consumer project happens to have its own top-level
  `core/` directory for unrelated reasons
- **THEN** the CLI renders using the executing script's own (package) `core/`,
  never considering the consumer's coincidental `core/` directory, because
  `REPO` is not itself a git working-tree root and the ancestry check never
  reaches the common-dir comparison

### Requirement: Target's own core is used when ancestry is confirmed
When the executing script's own `REPO` is itself a git working-tree root (`git rev-parse --show-toplevel` from `REPO` equals `REPO`) and the target directory's repository shares the same superproject as `REPO` (confirmed by both resolving to the same value under `git rev-parse --git-common-dir`) and the target's own checkout (`git rev-parse --show-toplevel` from the target) has its own `core/` directory, `concertino sync`, `doctor`, `update`, `init`, `eject`, and `diff` SHALL render from and compare against that target's own `core/` directory, whether or not its content matches the executing script's own `core/`.

#### Scenario: freshly created worktree, core unmodified
- **WHEN** `concertino sync` is run from inside a git worktree of the same
  repository as the executing script, and neither `core/` has diverged since
  the worktree was created
- **THEN** the CLI renders from the worktree's own `core/`, with no
  divergence note printed since the two are byte-identical

#### Scenario: worktree edited core/scripts since branching from main
- **WHEN** `concertino sync` is run against a worktree whose `core/scripts/*`
  has been edited since the worktree diverged from the main checkout, using a
  `concertino` binary executing from the main checkout, and `--core` is not
  given
- **THEN** the CLI renders `scripts/concertino/*` in the worktree from the
  worktree's own (edited) `core/scripts/*`, matching the worktree's core
  rather than the main checkout's

### Requirement: Divergence between the target's own core and the executing script's core is announced, not silent
When the target's own core is used (per the previous requirement) and its content differs from the executing script's own `core/`, `concertino sync`, `update`, `init`, `eject`, and `diff` SHALL print a visible, non-blocking note naming both the target's core path and the executing script's core path, and SHALL still complete the render successfully — this is not a failure condition.

#### Scenario: divergent core prints a note but still renders
- **WHEN** `concertino sync` is run against a worktree whose core content
  differs from the executing script's own core
- **THEN** the command prints a note naming both core paths, exits zero, and
  writes the rendered files from the target's own core

### Requirement: --core forces a specific core explicitly
`concertino sync`, `doctor`, `update`, `init`, `eject`, and `diff` SHALL accept a `--core=PATH` argument that, when given, is used as the resolved core directly, bypassing ancestry detection and any divergence note entirely.

#### Scenario: --core overrides automatic detection
- **WHEN** `concertino sync` is run with `--core=PATH`, regardless of what
  automatic detection would otherwise resolve
- **THEN** the CLI renders using `PATH` with no ancestry check performed and
  no divergence note printed

### Requirement: doctor reports which core it compared against
`concertino doctor` SHALL always print the absolute path of the `core/` directory it used for rendered-artifact drift comparison, whether or not a divergence note was printed, and SHALL indicate when that path was set via `--core` rather than resolved automatically.

#### Scenario: doctor run with default resolution
- **WHEN** `concertino doctor` is run with no `--core` override
- **THEN** its output includes the absolute path of the `core/` directory it
  compared rendered artifacts against

#### Scenario: doctor run with --core override
- **WHEN** `concertino doctor` is run with `--core=PATH`
- **THEN** its output includes `PATH` and notes that it was explicitly forced
  rather than auto-detected

### Requirement: Every core-reading code path uses the resolved core
`readRoleFile`, `emitClaude`, `emitCodex`, `copyAssets`, and `checkArtifacts` — every function that reads from `core/` — SHALL receive the resolved core as an explicit input rather than reading a module-level constant, so that `cmdInit` (which calls `copyAssets` directly) and `cmdEject`/`cmdDiff` (which call `readRoleFile`/`emitClaude`/`emitCodex` independently of `cmdSync`) resolve and use the correct core exactly as `cmdSync`/`cmdDoctor`/`cmdUpdate` do.

#### Scenario: init renders from the resolved core
- **WHEN** `concertino init` is run against a target whose own core would be
  selected per the ancestry requirement above
- **THEN** the files `init` copies via `copyAssets` come from that resolved
  core, not the executing script's own core

#### Scenario: eject and diff read from the resolved core
- **WHEN** `concertino eject` or `concertino diff` is run against such a
  target
- **THEN** the role content they read via `readRoleFile`/`emitClaude`/
  `emitCodex` comes from that resolved core

