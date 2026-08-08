## Why

`.github/workflows/publish.yml` only triggers on a `v*` tag push or manual
dispatch. Nothing runs the test suite on `pull_request` or on `push` to
`main`, so every merge lands with zero machine verification, and the
auditor's `check-merge-readiness.sh` condition 1 ("CI green") passes
vacuously against an empty `statusCheckRollup`. This was surfaced concretely
on PR #78, where the only thing standing behind the merge was a local
`npm test` run and human judgement. Concertino ships an auditor whose first
safety condition is inert in Concertino's own repository.

## What Changes

- Add a new GitHub Actions workflow that runs `npm test` on `pull_request`
  (against `main`) and on `push` to `main`.
- Run that workflow's test job on a matrix covering both the declared
  `engines.node` floor (`16`) and the version `publish.yml` actually
  publishes from (`22`), so the declared Node support range is genuinely
  exercised rather than just claimed in `package.json`.
- No changes to `check-merge-readiness.sh` — its empty-rollup pass-through
  is correct behavior for consuming projects with no CI; once this repo has
  a `pull_request`-triggered workflow, `statusCheckRollup` is populated and
  condition 1 stops being vacuous automatically, with no script change
  needed.
- No changes to `publish.yml` — it keeps its own `Self-test` step and its
  own trusted-publishing trigger untouched.

## Capabilities

### New Capabilities

- `pr-ci`: a GitHub Actions workflow that runs the test suite on every pull
  request against `main` and on every push to `main`, exercising both the
  declared Node engines floor and the version used for publishing, so a PR
  with a failing suite reports a real failed check via the GitHub API rather
  than an empty rollup.

### Modified Capabilities

(none — `check-merge-readiness.sh`'s behavior itself is unchanged; only the
previously-empty rollup it reads becomes populated as a result of this
change)

## Impact

- New file: `.github/workflows/pr-ci.yml` (or similar name).
- No changes to application code, `core/scripts/check-merge-readiness.sh`,
  or `publish.yml`.
- CI minutes: adds one workflow run per PR push and per push to `main`,
  matrixed across two Node versions. Concertino has zero runtime
  dependencies (`publish.yml`'s own comment: "Zero-dependency CLI: no
  install step, nothing to lock"), so each job is checkout + `setup-node` +
  `npm test`, no install step — cheap.
