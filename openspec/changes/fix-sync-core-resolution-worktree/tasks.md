## 1. Core resolution logic

- [x] 1.1 In `bin/concertino`, remove the module-level `CORE` constant and add
      a `resolveCore(repo, out, coreOverride)` function implementing the
      two-part ancestry check from `design.md` Decision 1: returns
      `coreOverride` resolved-absolute if given; otherwise, **first** confirm
      `repo` is itself a git working-tree root (`git rev-parse
      --show-toplevel` from `repo` equals `repo`, normalized) — if not (e.g.
      `repo` is `node_modules/<pkg>` nested inside a foreign consumer
      project), stop and fall back to `path.join(repo, 'core')` immediately,
      without ever comparing common-dirs. Only if that first check passes,
      **then** compute `git rev-parse --git-common-dir` from both `repo` and
      `out` (mirroring `core/scripts/emit-event.sh`'s `main_checkout()`
      normalization of relative-vs-absolute output across git versions); if
      both succeed and are equal (same superproject), resolve `out`'s own
      checkout root via `git rev-parse --show-toplevel` and check for a
      `core/` directory there; if found, that is the resolved core (print a
      one-line note if its content differs from `repo`'s own `core/`, via
      the same `fs.readFileSync(...).equals(...)` byte comparison
      `checkArtifacts` already uses); otherwise (git failure, no shared
      superproject, or target has no `core/` of its own) fall back to
      `path.join(repo, 'core')` unchanged.
- [x] 1.2 Add `--core=PATH` argument parsing shared by `sync`, `doctor`,
      `update`, `init`, `eject`, and `diff`.
- [x] 1.3 Thread the resolved core as an explicit parameter (not a
      reassigned module variable) into every function that currently reads
      the module-level `CORE` directly: `readRoleFile(role, out, core)`,
      `emitClaude(..., core)`, `emitCodex(..., core)`, `copyAssets(out, core,
      dry)`, `checkArtifacts(out, core, harnesses, r)`. Update every call
      site of these five functions across `cmdSync`, `cmdDoctor`,
      `cmdUpdate`, `cmdInit` (calls `copyAssets` directly, before `cmdSync`
      runs), and `cmdEject`/`cmdDiff` (call `readRoleFile`/`emitClaude`/
      `emitCodex` independently of `cmdSync`) to call `resolveCore` once at
      the top of the command and pass the result through.
- [x] 1.4 Fix `cmdInit`'s internal `cmdSync(...)` call (`bin/concertino:
      1394-1395`, currently `cmdSync({ _: ['sync'], config: cfgPath, out })`)
      per `design.md` Decision 6: `cmdInit` must resolve its core exactly
      once and use that single resolved value for *both* its own direct
      `copyAssets` call and the internal `cmdSync` call — do not let the
      inner `cmdSync` re-resolve independently with a literal args object
      that drops `core`. Prefer extending `cmdSync`'s signature to accept an
      optional pre-resolved `core` parameter (`cmdSync(args, resolvedCore)`)
      that skips its own `resolveCore` call when given; forwarding
      `core: args.core` into the literal object and letting the inner call
      re-resolve is acceptable only as a fallback (it duplicates git
      subprocess calls and would print any divergence note twice per `init`
      invocation). Either way, `concertino init --core=X` must render *all*
      of its output — directly-copied assets and internally-synced
      role/agent files alike — from `X`, with no split provenance.

## 2. doctor reporting

- [x] 2.1 In `cmdDoctor`'s "Rendered artifacts" section, print the resolved
      core path before running comparisons, noting when it came from
      `--core` vs. auto-detection.

## 3. Tests

- [x] 3.1 Add `test/scripts/sync-core-resolution.test.sh` (mirroring the
      throwaway-repo pattern in `test/scripts/emit-event.test.sh`): create a
      main checkout with `core/`, add a git worktree of it, edit
      `core/scripts/*` inside the worktree, run `node bin/concertino sync`
      from inside the worktree (simulating the executing script living in
      the *main* checkout by invoking `<main>/bin/concertino` with
      `--out=<worktree>`), and assert the rendered `scripts/concertino/*` in
      the worktree matches the worktree's own (edited) `core/`, not the main
      checkout's — this is the ticket's central acceptance criterion; the
      command SHALL exit zero and print a divergence note naming both core
      paths.
- [x] 3.2 Add a case for the npm-installed scenario: a target directory with
      no `core/` and no git ancestry to a repo with `core/` — assert output
      is byte-identical to today's (pre-change) rendering, with no note
      printed.
- [x] 3.3 Add a case for the unrelated-independent-repo false-positive: a
      target that is its own wholly independent git repo (not a
      worktree/checkout sharing common-dir with the executing script's repo)
      that happens to have a top-level `core/` directory — assert the CLI
      renders from the executing script's own core, not the target's
      unrelated one, and prints no note.
- [x] 3.4 Add the realistic npm-nested-dependency false-positive case
      (design-gate round 2, finding 3 — the one 3.3 alone does not cover):
      set up a git-tracked consumer project with `node_modules/concertino`
      (no `.git` of its own) nested inside it, playing the role of `repo`,
      where the consumer project itself has its own top-level `core/`
      directory; assert `git rev-parse --show-toplevel` from `repo` does
      **not** equal `repo` (so the ancestry check's first part correctly
      fails), the CLI renders from `repo`'s own `core/`, the consumer's
      coincidental `core/` is never touched, and no note is printed.
- [x] 3.5 Add a case for `--core=PATH`: overrides both the worktree-own-core
      path and the fallback path, with no note printed and no ancestry check
      performed.
- [x] 3.6 Add a smoke test that `concertino init` (which calls `copyAssets`
      directly, ahead of `cmdSync`) against a worktree target still renders
      from the resolved core post-refactor, and does not throw a
      `ReferenceError` now that `CORE` is no longer a module-level constant.
      Extend this test (per `design.md` Decision 6 / task 1.4) with a
      `concertino init --core=PATH` case that asserts **both** the
      directly-copied assets **and** the role/agent files produced by
      `cmdInit`'s internal `cmdSync(...)` call come from `PATH` — not a mix
      of `PATH` and auto-detected core — closing the design-gate round 3
      finding.
- [x] 3.7 Add a smoke test that `concertino eject` and `concertino diff`
      (which call `readRoleFile`/`emitClaude`/`emitCodex` independently of
      `cmdSync`) against a worktree target read role content from the
      resolved core post-refactor, and do not throw a `ReferenceError` —
      this closes the residual test-coverage gap the design-gate round 2
      skeptic flagged against `spec.md`'s "eject and diff read from the
      resolved core" scenario.
- [x] 3.8 Register the new test file in `package.json`'s `test` script,
      alongside the existing `test/scripts/*.test.sh` entries.

## 4. Validation and self-safety

- [x] 4.1 Run `node --check bin/concertino`, then run the new test file in
      full isolation (against throwaway repos only, never this worktree)
      before invoking `concertino sync`/`doctor`/`init` against this worktree
      itself — a syntax check alone will not catch a runtime
      `ReferenceError` from a missed call site, so the full test suite must
      pass first.
- [x] 4.2 Once validated, run `concertino doctor` from inside this worktree
      and confirm it reports the worktree's own core path, with a divergence
      note if (and only if) this worktree's `core/` has actually diverged
      from the main checkout's at that point.
- [x] 4.3 Update any CLI reference docs (`docs/`, `bin/concertino`'s own
      `--help` text) that enumerate `sync`/`doctor`/`update`/`init`/`eject`/
      `diff` flags to include `--core=PATH`.
