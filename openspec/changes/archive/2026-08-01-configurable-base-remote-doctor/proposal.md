## Why

`concertino doctor`'s `Git` check (`checkBaseBranch()` in `bin/concertino`) hardcodes the base
remote name to the literal string `'origin'`, while `cleanup.sh --phase4` (main-fast-forward,
CON-25) and `assert-phase.sh delivery` (delivery-stale-base-warning) already resolve the base
remote from `CONCERTINO_BASE_REMOTE` (falling back to `origin`). Today there is no config field
that writes `CONCERTINO_BASE_REMOTE`, so the two paths cannot yet disagree in practice — but the
moment one is added, `doctor` would silently keep reporting on `origin` while `cleanup.sh` fast-
forwards from whatever remote is actually configured (`upstream` on a fork being the common case).
This change closes that gap now, as a small, self-contained follow-up to CON-25.

## What Changes

- Add a `project.baseRemote` config field (default `'origin'`, mirroring the existing
  `project.baseBranch` / default `'main'` pattern) to `concertino.config.json`.
- `concertino sync`'s `renderEnv()` writes `CONCERTINO_BASE_REMOTE` from `project.baseRemote`,
  alongside the existing `CONCERTINO_BASE_BRANCH` — this is the one place both `doctor` (reads
  config directly) and every shell script (`cleanup.sh`, `assert-phase.sh`, `setup-worktree.sh`,
  all of which already read `CONCERTINO_BASE_REMOTE` from the rendered env, falling back to
  `origin`) ultimately derive their value from, so they cannot disagree by construction.
- `doctor`'s `checkBaseBranch()` reads `cfg.project.baseRemote || 'origin'` instead of the
  hardcoded literal, exactly mirroring how it already reads `cfg.project.baseBranch || 'main'`
  for the branch name.
- `concertino validate` prints the resolved `baseRemote` alongside the existing `baseBranch` line,
  for the same reason `baseBranch` is already surfaced there.
- Document the new field in `config/concertino.schema.json` and `docs/config-reference.md`.
- Absent any configuration, behavior is unchanged: `project.baseRemote` defaults to `'origin'`
  everywhere, matching today's hardcoded behavior exactly.

No new interactive wizard prompt is added — `baseRemote` is an advanced/rare override (relevant
only to fork-based workflows), consistent with how other advanced fields (`worktree.hooks`,
`canonicalDocs`, etc.) are documented as post-init customization rather than prompted for during
`concertino init`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `main-fast-forward`: the existing "doctor reports when local main is behind its remote and
  names the usual cause" requirement is tightened to specify that the "configured base
  remote/branch" it fetches and reports on is read from `project.baseRemote` /
  `project.baseBranch` (`cfg.project.baseRemote || 'origin'` inside `doctor`, the same effective
  value `CONCERTINO_BASE_REMOTE` carries for `cleanup.sh`), rather than left as an unspecified
  literal — so `doctor` and `cleanup.sh --phase4` are guaranteed, by requirement text and by
  implementation, to resolve the base remote through the same configured value.

## Impact

- `bin/concertino`: `withDefaults()`, `renderEnv()`, `checkBaseBranch()`, `cmdValidate` (affected
  code).
- `config/concertino.schema.json`: new optional `project.baseRemote` field. `config/examples/*.json`
  are not updated — the field is optional and defaults to `'origin'`, so the example configs don't
  need to demonstrate it (they don't demonstrate every optional field today).
- `docs/config-reference.md`: documents the new field.
- No *functional* changes to `scripts/concertino/cleanup.sh`, `assert-phase.sh`, or
  `setup-worktree.sh` — they already read `CONCERTINO_BASE_REMOTE` correctly; this change only
  makes something actually write it from config, and makes `doctor` agree. `cleanup.sh` does get
  one doc-comment update: its existing comment at lines 51-52 explicitly states that `renderEnv`
  "only ever writes `CONCERTINO_BASE_BRANCH` today" and that `CONCERTINO_BASE_REMOTE` "is not
  currently rendered" — this change makes that comment false, so it must be updated (or removed)
  as part of this change, not left to mislead the next reader.
- `test/scripts/doctor-base-branch.test.sh`: extended with an automated case covering a
  non-default configured `project.baseRemote`, so the ticket's second acceptance criterion
  ("doctor and cleanup.sh --phase4 resolve the base remote through the same path") has
  CI-enforced regression coverage, not just a manual verification step.
