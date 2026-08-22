# sync-provenance Specification

## Purpose
Reports which binary and core/ root `concertino sync`/`diff` are rendering from before any file is touched, distinguishing a linked-global dev checkout from a plain install, and gives `concertino diff` full unified-diff coverage of every file `sync` writes so local edits show as pending losses before a sync overwrites them.
## Requirements
### Requirement: Provenance report before any write
`concertino sync` (including `--dry-run`) and `concertino diff` SHALL print, before performing any write or diff comparison, a provenance report containing: the resolved binary path as invoked (`process.argv[1]`), whether that path resolves through a symlink, and the resolved `core/` root that will be used for this invocation.

#### Scenario: sync prints provenance before writing
- **WHEN** `concertino sync --out=<dir>` is run
- **THEN** the provenance report is printed to stdout before the first `wrote`/`would write` line

#### Scenario: diff prints provenance before comparing
- **WHEN** `concertino diff --out=<dir>` is run
- **THEN** the provenance report is printed to stdout before the first diff/unchanged line

### Requirement: Linked global distinguished from separate global install
When the invoked binary path resolves through a symlink, the provenance report SHALL state whether the symlink's resolved target lives inside a git working tree (a "linked global", e.g. `npm link`) or not (a plain separate install with no `.git` of its own), rather than reporting only "symlink" with no further distinction.

#### Scenario: npm-linked global resolves into a dev checkout
- **WHEN** the invoked binary is a symlink whose resolved target's directory (or an ancestor) is a git working-tree root
- **THEN** the provenance report labels it a linked global and names the git working-tree root it resolves into

#### Scenario: plain global install, no git ancestry
- **WHEN** the invoked binary is a symlink (or a real file) whose resolved target has no git working tree in its ancestry
- **THEN** the provenance report labels it a plain (non-linked) install, with no working-tree root named

#### Scenario: git unavailable
- **WHEN** the invoked binary resolves through a symlink but the `git` executable is unavailable or the ancestry check otherwise fails
- **THEN** the provenance report labels it a plain (non-linked) install rather than raising an error, matching the existing fallback discipline in `resolve-core.js`

### Requirement: `concertino diff` covers every file `sync` can write
`concertino diff` SHALL compare the target directory against every file `concertino sync` writes or merges — including but not limited to the rendered role/command files it already covers, the `copyAssets` output (`scripts/concertino/*`, `.concertino/laws/*`, `.concertino/workflow-state.template.md`), `.claude/commands/concertino-address-failure.md`, `.claude/settings.json`, `.codex/roles/concertino-*.md`, `AGENTS.md`, and `.codex/prompts/concertino-deliver.md` — using the same unified-diff rendering already used for rendered role files, and comparing merged-region files (`.claude/settings.json`, `AGENTS.md`, `.codex/config.toml`) against the same merged result `sync` would actually produce, not the raw unmerged block, so a local edit anywhere in `sync`'s blast radius is visible as a pending loss before `sync` overwrites it.

#### Scenario: local edit to a copied script shows as changed
- **WHEN** `concertino diff --out=<dir>` is run against a target directory whose `scripts/concertino/cleanup.sh` has a local edit not present in the resolved `core/scripts/cleanup.sh`
- **THEN** the diff output includes `scripts/concertino/cleanup.sh` as changed, with the local edit shown as a removed (`-`) line in the unified diff, and the summary's changed count includes it

#### Scenario: local edit to a law file shows as changed
- **WHEN** `concertino diff --out=<dir>` is run against a target directory whose `.concertino/laws/<name>.md` has a local edit not present in the resolved `core/laws/<name>.md`
- **THEN** the diff output includes `.concertino/laws/<name>.md` as changed

#### Scenario: local edit to the workflow-state template shows as changed
- **WHEN** `concertino diff --out=<dir>` is run against a target directory whose `.concertino/workflow-state.template.md` has a local edit not present in the resolved `core/workflow-state.template.md`
- **THEN** the diff output includes `.concertino/workflow-state.template.md` as changed

#### Scenario: local edit to a merged-region file (AGENTS.md) shows as changed
- **WHEN** `concertino diff --out=<dir>` is run against a target directory whose `AGENTS.md` has hand-authored content outside the `CONCERTINO:BEGIN`/`CONCERTINO:END` markers, and the managed region itself has drifted from what `sync` would currently render
- **THEN** the diff output shows the managed region's change, without treating the hand-authored content outside the markers as a diff (since `sync` itself would also leave that content untouched via `mergeMarkedRegion`)

#### Scenario: no local edits, everything unchanged
- **WHEN** `concertino diff --out=<dir>` is run against a target directory whose copied/rendered/merged files are all byte-identical to what a fresh `sync` would produce
- **THEN** every covered file reports unchanged and contributes to the unchanged count, not the changed count

