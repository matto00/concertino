## 1. Config schema + docs

- [x] 1.1 Add `"baseRemote": { "type": "string", "default": "origin", "description": "Remote PRs target and diffs/fast-forward compare against." }` to `project` in `config/concertino.schema.json`, alongside the existing `baseBranch` property.
- [x] 1.2 Document `baseRemote` in `docs/config-reference.md`'s `project` section (table row + updated example), mirroring `baseBranch`'s entry.

## 2. bin/concertino implementation

- [x] 2.1 In `withDefaults()`, add `c.project.baseRemote = c.project.baseRemote || 'origin';` next to the existing `c.project.baseBranch = c.project.baseBranch || 'main';` line.
- [x] 2.2 In `renderEnv(c)`, add `L.push('CONCERTINO_BASE_REMOTE=' + envValue(c.project.baseRemote || 'origin'));` next to the existing `CONCERTINO_BASE_BRANCH` line.
- [x] 2.3 In `checkBaseBranch(out, cfg, r)`, replace `const remote = 'origin';` with `const remote = (cfg.project && cfg.project.baseRemote) || 'origin';`.
- [x] 2.4 In `cmdValidate`'s `Project` section, add `ok('baseRemote', p.baseRemote || dim('(defaults to origin)'));` immediately after the existing `ok('baseBranch', ...)` line.
- [x] 2.5 Update the stale comment at `scripts/concertino/cleanup.sh:51-52` (which currently states `CONCERTINO_BASE_REMOTE` "is not currently rendered") to reflect that `renderEnv()` now writes it from `project.baseRemote` — the `${VAR:-default}` fallback logic on the following lines stays unchanged, only the comment needs correcting.

## 3. Automated regression coverage

- [x] 3.1 Extend `test/scripts/doctor-base-branch.test.sh` with a case that: renames the test's remote to a non-`origin` name (e.g. `upstream`), sets `project.baseRemote` to that name in the throwaway project's `concertino.config.json`, re-runs `concertino sync`, puts the base branch behind that remote (same technique the existing "a merge lands on the remote" case already uses), and asserts `concertino doctor`'s `Git` check reports the commits-behind warning against the configured remote — mirroring the file's existing `has`/`hasnt` style.
- [x] 3.2 In the same test file (or a new one alongside it), add a case confirming `.concertino.env` (rendered via `concertino sync`) carries `CONCERTINO_BASE_REMOTE='upstream'` when `project.baseRemote` is set to `upstream` — the assertion that ties `doctor`'s config-read path and `cleanup.sh`'s env-read path back to the same source of truth.

## 4. Verification

- [x] 4.1 Run the project's existing lint/test/build gates and confirm they pass with no regressions.
- [x] 4.2 Manually verify: with no `project.baseRemote` set, `concertino sync` renders `CONCERTINO_BASE_REMOTE='origin'` into `.concertino.env`, and `concertino doctor`'s `Git` check compares against `origin/<baseBranch>`.
- [x] 4.3 Manually verify: with `project.baseRemote` set to a non-default value (e.g. `"upstream"`) and `concertino sync` re-run, `concertino doctor`'s `Git` check compares against `upstream/<baseBranch>` and `.concertino.env` carries `CONCERTINO_BASE_REMOTE='upstream'` — matching what `cleanup.sh --phase4` and `assert-phase.sh delivery` would read.
- [x] 4.4 Run `concertino validate` and confirm the `baseRemote` line appears in the `Project` section output.
