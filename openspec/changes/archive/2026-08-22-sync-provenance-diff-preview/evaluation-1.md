## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All 4 ticket acceptance criteria addressed explicitly and verified live (see Phase 3 smoke evidence below) — none reinterpreted or partially done.
- All 5 task sections / all subtasks in `tasks.md` marked `[x]` and match what's actually implemented (verified against the diff, not just trusted).
- No scope creep: the `emit.js` `mergeAgentMergeSettings`/`mergeCostHookSettings` split into pure `applyAgentMergeSettings`/`applyCostHookSettings`/`readSettingsJson` helpers is directly required so `diff.js` can compute the same merged result `sync` would write (task 3.5) — not a drive-by refactor. `resolve-core.js`'s `gitRun`/`gitTopLevel` extraction to `shared.js` is likewise required so the new provenance helper reuses one degrade-safely-on-failure implementation instead of duplicating it (explicitly called out in the diff's own comments).
- No regressions: full existing suite (2247 `node --test` cases + all `test/scripts/*.test.sh`, including the CON-133/CON-129 fixtures `squash-branch.test.sh` and the `git-child-env` selftest) passes unmodified.
- No API/schema contract in play here (internal CLI tool); N/A.
- Planning artifacts (`design.md`/`proposal.md`) accurately describe the final implementation — the "what already exists" / "gap found by direct comparison" framing in `proposal.md` matches the actual pre-change `diff.js` coverage gap I confirmed by reading `HEAD~1`'s version.

### Phase 2: Code Review — PASS
Issues: none.

Gates re-run fresh by me (not trusting the executor's own report), in `WORKTREE_PATH` (`EVALUATOR_CLEAN_WORKTREE: false` in `workflow-state.md`, so no clean-worktree re-run required):
- `npm test` → exit 0. `node --test`: `1..2247`, `# pass 2247`, `# fail 0`. All `bash test/scripts/*.test.sh` suites (including `squash-branch.test.sh: 19 passed, 0 failed`) green.
- `npm run test:selftest` → exit 0, clean `sync --out=/tmp/concertino-selftest --dry-run` render; confirmed the provenance line (`binary:`/`core:`) prints before the first `would copy`/`would write` line in the actual output.

Code review against `CONTRIBUTING.md` (this repo's canonical standard — no `DESIGN.md`-equivalent applies, this is a CLI tool with no `frontend/**`):
- No file-size budget is enforced in this repo (`CONTRIBUTING.md:45` — explicitly "no lint rule or convention"); no violation regardless.
- Comment-heavy, ticket-id-tagged provenance style (`CONTRIBUTING.md:46`) followed throughout — every new/changed block in `shared.js`, `diff.js`, `emit.js` is annotated with the CON-128 ticket id and a rationale, consistent with the existing `watch.js`-style convention.
- DRY: `gitRun`/`gitTopLevel` de-duplicated into `shared.js` rather than copy-pasted for the new provenance helper; `readSettingsJson`/`applyAgentMergeSettings`/`applyCostHookSettings` are genuine pure-function extractions reused identically by both `sync`'s writer and `diff`'s previewer — no new duplication introduced.
- Readable/modular: `reportProvenance()` is a single well-scoped function; `cmdDiff`'s new coverage blocks each carry a task-id comment naming exactly which `emit*`/`copyAssets` call they mirror.
- Type safety: plain JS, consistent with the rest of the codebase; no new unsafe casts or escape hatches.
- Error handling: `gitRun`/`gitTopLevel` degrade to `null` on any failure (missing `git`, non-repo, non-zero exit) rather than throwing — verified live via the "git failure falls back to plain install" test AND by design (`PATH` overridden to a nonexistent dir in that test).
- Tests meaningful: see red-before-green check below — genuine regression coverage, not synthetic passes.
- No dead code: no leftover TODO/FIXME, no unused exports introduced (`module.exports` additions in `emit.js`/`shared.js` are all consumed by `diff.js`).
- No over-engineering: the merge-settings split is the minimum surface needed to share logic between `sync` and `diff`; no speculative abstraction beyond what tasks.md called for.
- Behavior-preserving where expected: `mergeAgentMergeSettings`/`mergeCostHookSettings`'s external call signatures and write behavior are unchanged — confirmed by reading the diff (the public functions still take `(c, out, dry)` and still early-return/write exactly as before; only the internal body was factored into a pure helper).

**Red-before-green credibility check** (explicitly requested): read both new test files in full.
- `test/provenance.test.js` spawns the real `bin/concertino` (via `node [binPath, ...args]`, `spawnSync`) against real throwaway fixture directories built with real `fs.symlinkSync`/`git init` calls (`newDevCheckout()`, `newPlainCheckout()`, multi-hop symlink chains) — assertions are on the real CLI's stdout, not a reimplementation of the classification logic. Confirmed live myself: symlinking `bin/concertino` into a git-initialized dev checkout produces `install: linked global (dev checkout at ...)`, and the diff between HEAD~1 and HEAD shows `reportProvenance` did not exist before this commit — so these tests could not have passed pre-change (genuine red-before-green).
- `test/diff-coverage.test.js` runs a real `sync` into a throwaway `--out=` dir, then mutates the REAL rendered target file (`fs.appendFileSync` on the actual `scripts/concertino/cleanup.sh`, `.concertino/laws/*.md`, etc.) and asserts the real `diff` subcommand's stdout reports it as changed — not a reimplementation of `diffFile`. I independently reproduced this by hand (see Phase 3) and confirmed `HEAD~1`'s `diff.js` has no `copyAssets`-parity loop at all, so these tests are a genuine gap-closing regression suite, not self-referential.
- All new/changed tests run against throwaway `os.tmpdir()`-based fixtures only — no invocation targets this repo's own root or any other real repository (safety constraint honored by the executor).

### Phase 3: UI Review — N/A
Concertino is a CLI tool (`bin/concertino`) with no dev server, no frontend, and no `ApiRoutes.scala`/`schemas/**`/`openspec/specs/**`-triggering change in this diff — verified by reading `package.json` (no `dev`/`start` server script) and the diff's file list (only `lib/cli/*.js`, `test/*.test.js`, and `openspec/changes/**` planning docs touched). No dev server exists to start; Playwright review is skipped for a substantive reason (not merely assumed).

In place of Phase 3's UI checks, I independently smoke-tested all four acceptance criteria live in throwaway `/tmp` directories (never against a real repo):

1. **AC1 (provenance before write)**: `sync --out=/tmp/concertino-selftest --dry-run` printed `binary: .../bin/concertino` and `core: .../core` before the first `would copy`/`would write` line — confirmed in raw stdout.
2. **AC2 (linked global vs. plain)**: symlinked `bin/concertino` into `/tmp/con128-linkdir/concertino` and ran `diff` through it — printed `symlink → .../bin/concertino` and `install: linked global (dev checkout at .../CON-128)`, correctly identifying the dev checkout's git working-tree root.
3. **AC3 (diff preview, no write)**: ran a real `sync` into `/tmp/con128-target`, then `diff --out=/tmp/con128-target` after a local edit — printed a full changed/unchanged report with no write occurring (target directory only modified by the explicit test edit, not by `diff` itself).
4. **AC4 (local edits shown as pending losses)**: appended `# LOCAL EDIT TEST` to the rendered `scripts/concertino/cleanup.sh`; `diff` reported it non-unchanged with a unified diff showing the local line as a `-` (would-be-removed) line — exactly the "pending loss" AC4 calls for.

All four confirmed working end-to-end from real CLI invocations, not just from reading the source.

### Overall: PASS

### Non-blocking Suggestions
- `reportProvenance()` only prints an `install:` classification line when `process.argv[1]` is itself a symlink (`lib/cli/shared.js`'s `isSymlink` check). The spec's own "plain global install, no git ancestry" scenario text allows for "a symlink (or a real file)" resolving with no git ancestry, but a non-symlinked real file (e.g. a plain `npm install -g` that copies rather than links, on a platform where npm doesn't symlink bin shims) currently prints no `install:` line at all rather than an explicit "plain install" line. This is a narrow edge case (most npm global installs, including `npm link` and ordinary `npm install -g` on Linux/macOS, do produce a bin symlink) and none of the four ACs' literal scenarios require it, so it is not blocking — but worth a follow-up ticket or a one-line tweak if a genuinely-copied (non-symlinked) global install is ever observed in practice.
