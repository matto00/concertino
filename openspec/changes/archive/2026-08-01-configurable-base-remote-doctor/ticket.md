# CON-32: doctor's base-branch check hardcodes the remote name to origin

## Description

Follow-up from CON-25 evaluation — non-blocking, noted at review and deliberately not fixed in that PR.

The `Git` section CON-25 added to `concertino doctor` (`bin/concertino`) compares local `main` against `origin/<base>` with the remote name written in as the literal `'origin'`.

This is not a contract violation today: there is no config field for a base *remote*, so there is nothing for the check to read and disagree with. It becomes one the moment such a field is added — `cleanup.sh` would fast-forward from the configured remote while `doctor` reported on `origin`, and the two would silently disagree for anyone whose remote is named something else (`upstream` is the common case, on a fork).

## Acceptance Criteria

* When a base-remote config field exists, `doctor`'s `Git` check reads it rather than assuming `origin`.
* `doctor` and `cleanup.sh --phase4` resolve the base remote through the same path, so they cannot disagree.
* Absent any configuration, behaviour is unchanged (`origin` remains the default).

Worth doing as part of whatever change introduces the configurable remote, rather than on its own.

## Notes from repo investigation

- `bin/concertino`'s `checkBaseBranch()` (around line 1014-1015) hardcodes `const remote = 'origin';`.
- `scripts/concertino/cleanup.sh` already reads `CONCERTINO_BASE_REMOTE` from its sourced `.concertino.env` (falling back to `origin`) at line 55, with a comment noting `concertino sync`'s `renderEnv` does not currently render `CONCERTINO_BASE_REMOTE` — only `CONCERTINO_BASE_BRANCH`.
- `renderEnv(c)` in `bin/concertino` (~line 547-550) writes `CONCERTINO_BASE_BRANCH` from `c.project.baseBranch`. There is no analogous `c.project.baseRemote` field today.
- To satisfy the acceptance criteria, this change should introduce a `project.baseRemote` config field (schema + example configs + docs), have `renderEnv` emit `CONCERTINO_BASE_REMOTE` from it, and have `checkBaseBranch()` in `bin/concertino` read the same resolved value (via config, with the same `origin` default) that `cleanup.sh` already falls back to — so both paths agree by construction.
