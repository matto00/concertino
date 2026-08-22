## 1. Provenance detection helper

- [x] 1.1 Add a `reportProvenance()` (or similar) helper in `lib/cli/shared.js`: reads `process.argv[1]`, `fs.lstatSync`/`fs.realpathSync` to detect a symlink and resolve its target, and a `git -C <dir> rev-parse --show-toplevel`-based check (mirroring `resolve-core.js`'s `gitRun`/`gitTopLevel` pattern — reuse those helpers or extract them to `shared.js` if that avoids duplication) to classify the resolved target as a linked global (inside a git working tree) vs. a plain install. For a multi-hop symlink chain, `fs.realpathSync` already resolves to the FINAL target — report and classify against that final realpath, not the first hop.
- [x] 1.2 Any `git` failure (missing binary, not a repo) SHALL fall back to "plain install" rather than throwing — no crash on a `sync`/`diff` invocation just because `git` is unavailable.
- [x] 1.3 Format the report as a short block: invoked binary path, symlink target (if any) + linked/plain classification, resolved `core/` root (from `resolveCore`'s return value, passed in by the caller — do not re-resolve).

## 2. Wire provenance into `sync` and `diff`

- [x] 2.1 `cmdSync` (`lib/cli/sync.js`) prints the provenance report before the first `write`/`copy` call, for both a real run and `--dry-run`.
- [x] 2.2 `cmdDiff` (`lib/cli/diff.js`) prints the provenance report before the first `diffFile` call.
- [x] 2.3 `--dry-run`'s existing `(dry run)` line grows a pointer to `concertino diff` for content-level preview (per design.md Decision 3) — no new diff logic inside `--dry-run` itself.
- [x] 2.4 Update `lib/cli/help.js` usage text for `sync`/`diff` to describe actual behavior (provenance line, `--dry-run` stays filename-only, `diff` is the content-level preview).

## 3. Extend `cmdDiff` to cover every file `sync` writes

- [x] 3.1 In `cmdDiff`, enumerate `core/laws/*` (mirroring `copyAssets`'s `fs.readdirSync(path.join(core, 'laws'))`, and `doctor.js`'s `checkArtifacts` equivalent loop) and call `diffFile` against `out/.concertino/laws/<f>` for each, reading source content verbatim (no `renderBody`).
- [x] 3.2 Diff `core/workflow-state.template.md` against `out/.concertino/workflow-state.template.md` verbatim via `diffFile`.
- [x] 3.3 Enumerate `core/scripts/**` via `listFilesRecursive` (mirroring `copyAssets`'s scripts loop, and `doctor.js`'s equivalent) and call `diffFile` against `out/scripts/concertino/<f>` for each, verbatim.
- [x] 3.4 Diff `.claude/commands/concertino-address-failure.md` (claude-code only, when that harness is in scope): reproduce the same `read(...).split(...).join(...)` template substitution `emitClaude` uses, call `diffFile` against `out/.claude/commands/concertino-address-failure.md`.
- [x] 3.5 Diff `.claude/settings.json`: compute the merged result the same way `mergeAgentMergeSettings`/`mergeCostHookSettings` do (read existing `out/.claude/settings.json` if present, apply the same merge), call `diffFile` against it — the diff must reflect the *merged* outcome, not a raw block, matching what `sync` actually leaves on disk. Apply both mergers **in the same order `emitClaude` does** (`emit.js:121-122` — `mergeAgentMergeSettings` then `mergeCostHookSettings`, the second reading what the first wrote); do not diff either merger's output independently.
- [x] 3.6 Diff `.codex/roles/concertino-*.md` (codex harness): reproduce `emitCodex`'s per-role render (`renderBody(read(core/roles/<role>.md), c, 'codex')` + the same title/header wrapper), call `diffFile` against `out/.codex/roles/concertino-<role>.md` for each of the five roles.
- [x] 3.7 Diff `AGENTS.md` (codex harness): reproduce `emitCodex`'s `blockText` construction (header + role index) and merge via `mergeMarkedRegion` against the existing `out/AGENTS.md` content (if present), call `diffFile` against the merged result.
- [x] 3.8 Diff `.codex/prompts/concertino-deliver.md` (codex harness): this one is a plain `copy()`, not a render — diff `adapters/codex/prompt.md`'s raw content against `out/.codex/prompts/concertino-deliver.md` verbatim.
- [x] 3.9 Confirm every new loop's path-joins and content-derivation match the corresponding `emitClaude`/`emitCodex`/`copyAssets` call exactly — read those functions again at implementation time (they're already open from tasks 1–2), don't rely on this task list's paraphrase of them.
- [x] 3.10 Confirm `counts.changed`/`counts.new`/`counts.unchanged` in the diff summary include every new category (they will automatically via the shared `diff()` closure — verify, don't assume).
- [x] 3.11 Opencode harness's `emitOpencode` output (`.opencode/agents/*`, `.opencode/commands/concertino-deliver.md`, `opencode.json`) is already fully covered by today's `cmdDiff` — confirm this by reading `cmdDiff`'s existing opencode block before assuming it needs the same treatment as codex; do not add redundant coverage.

## 4. Tests (throwaway dirs only — never render against a real repo)

- [x] 4.1 Provenance: fixture a fake "linked global" (a symlink into a git-initialized throwaway dir with a `core/`) and a fake "plain global" (a symlink, or plain file, into a non-git throwaway dir) and assert the CLI's printed provenance line distinguishes them. Must invoke the real CLI/helper, not a reimplementation of the classification logic under test.
- [x] 4.2 Red-before-green: demonstrate the *current* code's `cmdDiff` output has zero changed/new entries for a target with a local edit to a copied script/law/workflow-state-template file (proving the gap), then demonstrate the fixed code reports it as changed. Mutate the real target file under test, not a copy of the test's own expectation.
- [x] 4.3 `sync --dry-run` still writes nothing (existing behavior preserved) — assert via `fs.existsSync` on the target after a `--dry-run` invocation into a throwaway `--out=`.
- [x] 4.4 Existing test suite (including CON-133/CON-129 fixtures — `test/scripts/squash-branch.test.sh`, git-child-env tests, `listFilesRecursive` consumers) still passes unmodified.

## 5. Verification

- [x] 5.1 `npm test` (or repo's actual test command — confirm from `package.json`) green.
- [x] 5.2 `npm run test:selftest` still exits clean (it already exercises `sync --dry-run`).
- [x] 5.3 Manual smoke: render `concertino sync`/`diff` into a throwaway `--out=` tmpdir only, never against `/home/matt/Development/concertino` or `/home/matt/Development/helio`, to visually confirm the provenance line and the new diff coverage.
